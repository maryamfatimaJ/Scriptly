import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import * as prescriptionsApi from "@/api/prescriptions";

type Mode = "choose" | "camera" | "preview";

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
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setQualityWarning(null);
    setMode("choose");
  }

  const uploadMutation = useMutation({
    mutationFn: async (toUpload: File) => {
      const { prescription } = await prescriptionsApi.uploadPrescription(toUpload);
      // Read it straight away. If reading fails (provider busy, quota,
      // unreadable photo) the upload itself still succeeded, so go to the
      // review page anyway: it shows the honest reason and a retry button.
      try {
        await prescriptionsApi.extractPrescription(prescription.id);
      } catch {
        /* surfaced on the review page */
      }
      return prescription.id;
    },
    onSuccess: (id) => navigate(`/review/${id}`),
  });

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
                <Button variant="secondary" onClick={retake} disabled={uploadMutation.isPending}>
                  Retake / replace
                </Button>
                <Button
                  onClick={() => file && uploadMutation.mutate(file)}
                  disabled={!file || uploadMutation.isPending}
                >
                  {uploadMutation.isPending ? "Reading your prescription…" : "Continue to review"}
                </Button>
              </div>
              {uploadMutation.isError && (
                <p className="mt-3 text-sm text-red-700">
                  {(uploadMutation.error as Error).message || "Something went wrong. Please try again."}
                </p>
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
