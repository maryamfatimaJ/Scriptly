import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { Button } from "@/components/Button";
import * as prescriptionsApi from "@/api/prescriptions";

type Mode = "choose" | "camera" | "preview";

// Each stage is a real request: the upload, then the AI reading (one
// server call that returns when the medicines are extracted). There is no
// percentage because the server reports none.
type Stage = "idle" | "uploading" | "reading" | "ready" | "upload-failed" | "read-failed";

const SLOW_AFTER_MS = 25_000;

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-forest/25 border-t-forest motion-safe:animate-spin"
      aria-hidden="true"
    />
  );
}

function StepRow({ state, label }: { state: "waiting" | "active" | "done"; label: string }) {
  return (
    <li className={`flex items-center gap-3 text-sm ${state === "waiting" ? "text-charcoal/45" : "text-charcoal"}`}>
      {state === "active" ? (
        <Spinner />
      ) : (
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
            state === "done" ? "bg-forest text-offwhite" : "border border-charcoal/25"
          }`}
          aria-hidden="true"
        >
          {state === "done" ? "\u2713" : ""}
        </span>
      )}
      {label}
    </li>
  );
}

const GUIDANCE = [
  "Lay the prescription flat on a plain, well-lit surface — natural daylight works best.",
  "Fill the frame with the page; avoid glare from overhead lights or flash.",
  "Crop out the background so the page fills as much of the photo as possible.",
  "Hold steady until the text looks sharp, especially the medicine names and dosages.",
  "If the prescription is handwritten, make sure each line is fully visible and not cut off at the edge.",
];

// Basic, client-side-only image-quality signal: a very low-resolution
// photo is unlikely to produce legible text no matter how good the
// extraction provider is. This is advisory, not a hard block — it's
// entirely possible to continue anyway (e.g. if the phone camera reports
// odd dimensions), since a false positive here must never prevent upload.
const MIN_SHORT_EDGE_PX = 600;

function checkImageQuality(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(null); // PDFs aren't checked this way
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const shortEdge = Math.min(img.naturalWidth, img.naturalHeight);
      if (shortEdge > 0 && shortEdge < MIN_SHORT_EDGE_PX) {
        resolve(
          "This photo looks low-resolution — small text may not extract cleanly. Consider retaking it closer up or in better light."
        );
      } else {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export function CapturePrescription() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("choose");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [qualityWarning, setQualityWarning] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [stageError, setStageError] = useState<string | null>(null);
  // The uploaded prescription's id: a retry after a reading failure reads
  // the same upload again instead of creating a duplicate prescription.
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const busyRef = useRef(false);
  const busy = stage === "uploading" || stage === "reading" || stage === "ready";

  useEffect(() => {
    setSlow(false);
    if (stage !== "uploading" && stage !== "reading") return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [stage]);

  const stopCamera = useCallback(() => {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
  }, [stream]);

  useEffect(() => stopCamera, [stopCamera]);

  async function openCamera() {
    setCameraError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      setStream(mediaStream);
      setMode("camera");
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError(
        "We couldn't access your camera. Check your browser permissions, or upload a photo instead."
      );
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const capturedFile = new File([blob], `prescription-${Date.now()}.jpg`, { type: "image/jpeg" });
      selectFile(capturedFile);
      stopCamera();
    }, "image/jpeg", 0.92);
  }

  function selectFile(selected: File) {
    setFile(selected);
    setUploadedId(null);
    setStage("idle");
    setStageError(null);
    setPreviewUrl(URL.createObjectURL(selected));
    setMode("preview");
    setQualityWarning(null);
    checkImageQuality(selected).then(setQualityWarning);
  }

  function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (selected) selectFile(selected);
  }

  function retake() {
    if (busyRef.current) return;
    setUploadedId(null);
    setStage("idle");
    setStageError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setQualityWarning(null);
    setMode("choose");
  }

  async function readPrescription(id: string) {
    setStage("reading");
    setStageError(null);
    try {
      await prescriptionsApi.extractPrescription(id);
      setStage("ready");
      navigate(`/review/${id}`);
    } catch (err) {
      setStage("read-failed");
      setStageError(errorText(err, "We couldn't read this prescription. Please try again."));
    }
  }

  async function retryRead(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await readPrescription(id);
    } finally {
      busyRef.current = false;
    }
  }

  async function start() {
    if (busyRef.current || !file) return;
    busyRef.current = true;
    try {
      let id = uploadedId;
      if (!id) {
        setStage("uploading");
        setStageError(null);
        try {
          const { prescription } = await prescriptionsApi.uploadPrescription(file);
          id = prescription.id;
          setUploadedId(id);
        } catch (err) {
          setStage("upload-failed");
          setStageError(errorText(err, "The upload didn't go through. Check your connection and try again."));
          return;
        }
      }
      await readPrescription(id);
    } finally {
      busyRef.current = false;
    }
  }

  const stepState = (step: "upload" | "read" | "ready"): "waiting" | "active" | "done" => {
    const order = { upload: 0, read: 1, ready: 2 } as const;
    const current = stage === "uploading" ? 0 : stage === "reading" ? 1 : 2;
    if (order[step] < current) return "done";
    return order[step] === current ? (step === "ready" ? "done" : "active") : "waiting";
  };

  return (
    <div className="mx-auto max-w-content px-6 py-16 sm:py-20">
      <header className="max-w-xl">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-forest">Capture</p>
        <h1 className="font-display text-4xl sm:text-5xl">Photograph or upload your prescription</h1>
        <p className="mt-4 text-charcoal/75">
          Extracted details are a starting point you'll review next — nothing is confirmed automatically.
        </p>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          {mode === "choose" && (
            <div className="flex flex-col items-start gap-4 rounded-3xl border border-dashed border-charcoal/25 bg-mint/30 p-10">
              <p className="text-charcoal/80">Choose how you'd like to add this prescription.</p>
              <div className="flex flex-wrap gap-4">
                <Button onClick={openCamera}>Use camera</Button>
                <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  Upload a file
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={handleFileInput}
              />
              {cameraError && <p className="text-sm text-red-700">{cameraError}</p>}
            </div>
          )}

          {mode === "camera" && (
            <div className="overflow-hidden rounded-3xl border border-charcoal/15 bg-charcoal">
              <video ref={videoRef} className="aspect-[3/4] w-full object-cover" muted playsInline />
              <div className="flex items-center justify-center gap-4 bg-charcoal py-4">
                <Button variant="secondary" className="border-offwhite/40 text-offwhite" onClick={stopCamera}>
                  Cancel
                </Button>
                <Button onClick={capturePhoto}>Capture</Button>
              </div>
            </div>
          )}

          {mode === "preview" && previewUrl && (
            <div>
              <div className="overflow-hidden rounded-3xl border border-charcoal/15">
                <img src={previewUrl} alt="Captured prescription preview" className="max-h-[520px] w-full object-contain bg-charcoal/5" />
              </div>
              {qualityWarning && (
                <p className="mt-3 text-sm text-amber-700">{qualityWarning}</p>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Button variant="secondary" onClick={retake} disabled={busy}>
                  Retake / replace
                </Button>
                {(stage === "idle" || stage === "upload-failed") && (
                  <Button onClick={start} disabled={!file}>
                    {stage === "upload-failed" ? "Retry upload" : "Continue to review"}
                  </Button>
                )}
                {stage === "read-failed" && uploadedId && (
                  <Button onClick={() => retryRead(uploadedId)}>Try reading again</Button>
                )}
              </div>

              {(busy || stage === "read-failed") && (
                <div className="mt-6 rounded-2xl border border-charcoal/10 bg-mint/30 p-5" aria-live="polite">
                  <ol className="flex flex-col gap-3">
                    <StepRow state={stepState("upload")} label={stepState("upload") === "done" ? "Prescription uploaded" : "Uploading prescription\u2026"} />
                    <StepRow
                      state={stage === "read-failed" ? "waiting" : stepState("read")}
                      label={stage === "read-failed" ? "Reading your prescription" : "Reading your prescription\u2026"}
                    />
                    <StepRow state={stage === "ready" ? "done" : "waiting"} label="Ready to review" />
                  </ol>
                  {slow && busy && (
                    <p className="mt-4 text-sm text-charcoal/75">
                      This is taking longer than usual \u2014 the AI service may be busy. Please keep this page open.
                    </p>
                  )}
                </div>
              )}

              {stageError && (
                <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900" role="alert">
                  <p>{stageError}</p>
                  {stage === "read-failed" && uploadedId && (
                    <p className="mt-2">
                      Your photo is saved. You can try reading it again, or{" "}
                      <button type="button" onClick={() => navigate(`/review/${uploadedId}`)} className="underline underline-offset-2">
                        open it to review later
                      </button>
                      .
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />
        </div>

        <aside className="rounded-3xl bg-mint/40 p-8">
          <h2 className="font-display text-xl">For a clean read</h2>
          <ul className="mt-4 flex flex-col gap-3 text-sm text-charcoal/75">
            {GUIDANCE.map((tip) => (
              <li key={tip} className="flex gap-3">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-forest" />
                {tip}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
