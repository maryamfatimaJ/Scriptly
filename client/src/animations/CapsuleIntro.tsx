import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

// Lazily imported so lottie-web stays out of the critical-path bundle —
// see LottiePlayer.tsx. The shipped asset is a GIF; this branch is a
// fallback that most visitors will never reach.
const LottiePlayer = lazy(() => import("./LottiePlayer"));

// -----------------------------------------------------------------------------
// CapsuleIntro — full-screen brand intro, isolated from the rest of the app.
//
// SUPPORTED ASSETS (in priority order)
//   1. client/public/animations/capsule-intro.gif   <- current asset
//   2. client/public/animations/capsule-intro.json  <- Lottie, if ever exported
//
// Anything under client/public/ is served from the site root, so these are
// requested as /animations/capsule-intro.{gif,json}. Drop in a replacement
// with the same filename and nothing here needs to change.
//
// If neither asset loads, the intro is skipped entirely and the homepage
// shows immediately — a missing or broken asset must never block the site.
//
// WHY A GIF NEEDS DIFFERENT HANDLING FROM LOTTIE
// Lottie fires onComplete when the animation ends. A GIF fires nothing:
// the browser exposes no "animation finished" event, and this particular
// file is authored to loop infinitely, so there is no natural end to wait
// for in the first place. Waiting for a completion signal that can never
// arrive would leave the user watching the capsule loop until the safety
// timeout fired. So for the GIF path we measure one pass instead — see
// GIF_LOOP_MS, which is the file's real duration (48 frames, 1.92s).
//
// PLAYBACK PERSISTENCE (sessionStorage, not localStorage)
// The intro plays once per browser tab session: reloading or navigating
// within the same tab won't replay it, but a fresh tab will see it again.
// Chosen over "every load" (annoying during normal use) and "once ever"
// (under-uses a deliberate brand moment on a product people return to
// daily). Isolated to the two lines marked PERSISTENCE.
// -----------------------------------------------------------------------------

const GIF_PATH = "/animations/capsule-intro.gif";
const LOTTIE_PATH = "/animations/capsule-intro.json";
const STORAGE_KEY = "capsuleIntroShown"; // PERSISTENCE

// One full pass of capsule-intro.gif (48 frames @ 4cs = 1.92s), plus a
// short beat so the capsule is seen closed again rather than cutting mid-
// motion. Re-measure this if the asset is replaced.
const GIF_LOOP_MS = 1920;
const GIF_HOLD_MS = 260;

// Two independent ceilings, because the failure modes are different.
//
// ASSET_LOAD_BUDGET_MS: how long we will wait for the asset to resolve
// before giving up and showing the site. A request that HANGS fires
// neither onload nor onerror, so without this the overlay would sit on
// the grey placeholder indefinitely — verified in the browser, it stayed
// up for 25s. It also caps "dead air": the animation clock only starts
// once the GIF has decoded, so on a slow connection every extra second of
// download is a second of motionless placeholder. Past this budget the
// homepage matters more than the brand moment.
// Kept deliberately tight. The intro's total length is download time plus
// one loop, so a generous budget produces a wide spread: at 2500ms, a
// visitor on a 2.4s connection sat through a 4.7s intro while one on a
// 2.6s connection saw none at all. 1200ms caps the worst case at ~3.4s
// and makes the slow-connection outcome consistently "no intro, straight
// to the site" — which is the better outcome anyway.
const ASSET_LOAD_BUDGET_MS = 1200;

// Absolute ceiling on the overlay, armed on mount and never cleared by
// asset state. This is the promise the comment at the top makes: whatever
// goes wrong — hung request, malformed Lottie, a looping animation used
// here by mistake — the user is never trapped.
const SAFETY_TIMEOUT_MS = 6000;

// The GIF's background is baked in and fully opaque (every frame is
// #262b2f — the transparency flag is set but unused). Painting the
// overlay the same colour makes the asset sit seamlessly full-bleed
// instead of appearing as a dark rectangle floating on the brand green.
const GIF_BACKDROP = "#262b2f";

type Asset =
  | { kind: "probing" }
  | { kind: "gif" }
  | { kind: "lottie"; data: object }
  | { kind: "none" };

export function CapsuleIntro({ children }: { children: React.ReactNode }) {
  const prefersReducedMotion = usePrefersReducedMotion();

  const alreadyShown = typeof window !== "undefined" && sessionStorage.getItem(STORAGE_KEY) === "true"; // PERSISTENCE
  const [introComplete, setIntroComplete] = useState(alreadyShown || prefersReducedMotion);
  const [asset, setAsset] = useState<Asset>({ kind: "probing" });

  const finishIntro = useCallback(() => {
    if (typeof window !== "undefined") sessionStorage.setItem(STORAGE_KEY, "true"); // PERSISTENCE
    setIntroComplete(true);
  }, []);

  // --- Asset resolution: GIF first, then Lottie, then give up ----------
  useEffect(() => {
    if (introComplete) return;
    let cancelled = false;

    // Decoding the GIF up front means it starts animating the moment the
    // overlay paints, rather than popping in part-way through.
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setAsset({ kind: "gif" });
    };
    image.onerror = () => {
      if (cancelled) return;
      fetch(LOTTIE_PATH)
        .then((res) => {
          if (!res.ok) throw new Error(`Lottie not found (${res.status})`);
          return res.json();
        })
        .then((data) => {
          if (!cancelled) setAsset({ kind: "lottie", data });
        })
        .catch(() => {
          // Neither asset is present — expected on a fresh checkout.
          if (!cancelled) setAsset({ kind: "none" });
        });
    };
    image.src = GIF_PATH;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [introComplete]);

  // Nothing to play — reveal the homepage immediately rather than showing
  // an empty overlay.
  useEffect(() => {
    if (asset.kind === "none") finishIntro();
  }, [asset.kind, finishIntro]);

  // The GIF has no completion event, so its run length is what ends it.
  useEffect(() => {
    if (introComplete || asset.kind !== "gif") return;
    const timer = setTimeout(finishIntro, GIF_LOOP_MS + GIF_HOLD_MS);
    return () => clearTimeout(timer);
  }, [introComplete, asset.kind, finishIntro]);

  // Give up on an asset that never resolves. Covers a stalled request
  // (no onload, no onerror, forever) and slow connections where the wait
  // itself would be longer than the animation.
  useEffect(() => {
    if (introComplete || asset.kind !== "probing") return;
    const timer = setTimeout(() => setAsset({ kind: "none" }), ASSET_LOAD_BUDGET_MS);
    return () => clearTimeout(timer);
  }, [introComplete, asset.kind]);

  // Absolute ceiling, armed on mount and deliberately NOT dependent on
  // asset state — an earlier version armed this only for the Lottie path,
  // which left the GIF path with no backstop at all.
  useEffect(() => {
    if (introComplete) return;
    const timer = setTimeout(finishIntro, SAFETY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [introComplete, finishIntro]);

  // Let someone dismiss the intro from the keyboard without hunting for
  // the skip button.
  useEffect(() => {
    if (introComplete) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") finishIntro();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [introComplete, finishIntro]);

  return (
    <>
      {!introComplete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
          style={{ backgroundColor: asset.kind === "lottie" ? undefined : GIF_BACKDROP }}
          role="status"
          aria-label="Loading Scriptly"
        >
          {asset.kind === "gif" && (
            <img
              src={GIF_PATH}
              alt=""
              aria-hidden="true"
              // Sized against the ANIMATION's bounding box, not the
              // file's canvas.
              //
              // Two failed approaches, both verified in a browser, worth
              // recording so they aren't retried:
              //   - A fixed 30rem box: the capsule is only ~24% of the
              //     800x600 canvas, so it rendered at ~115px — a small
              //     pill lost in a dark field.
              //   - `object-cover`: correct size, but on a 375x812 phone
              //     it discards 65% of the width, and the capsule halves
              //     separate HORIZONTALLY — so they were sliced flat
              //     against both screen edges for a third of the loop.
              //
              // At full separation the halves and beads span roughly
              // 500x360 of the 800x600 canvas. Solving for that box
              // fitting inside ~90% of the viewport gives width
              // <= 1.44vw and <= 2vh; 185vh is used rather than 200vh to
              // keep the desktop capsule near 400px instead of 430px.
              // Empty margin beyond the viewport is cropped by the
              // parent's overflow-hidden, which is invisible because the
              // asset's background matches the overlay exactly.
              // shrink-0 is load-bearing, not tidiness: as a flex item
              // with the default `min-width: auto`, the declared width
              // was silently ignored and the image collapsed to the
              // container (1440px instead of 1665px at 1440x900), so the
              // 185vh term never applied on a desktop viewport.
              className="max-w-none shrink-0"
              // 190vw (up from 144vw) brings the phone capsule to ~170px
              // from ~132px. Measured headroom before the separated
              // halves touch the edges again is ~232vw, so this keeps a
              // real margin.
              style={{ width: "min(190vw, 185vh)", aspectRatio: "4 / 3" }}
              decoding="async"
            />
          )}

          {asset.kind === "lottie" && (
            <Suspense fallback={<div className="h-24 w-24 animate-pulse rounded-capsule bg-offwhite/10" />}>
              <LottiePlayer data={asset.data} onComplete={finishIntro} />
            </Suspense>
          )}

          {/* Only while we're still deciding which asset exists — keeps the
              overlay from flashing empty for a frame. */}
          {asset.kind === "probing" && (
            <div className="h-24 w-24 animate-pulse rounded-capsule bg-offwhite/10" />
          )}

          <button
            type="button"
            onClick={finishIntro}
            className="absolute bottom-8 right-8 rounded-capsule border border-offwhite/30 px-4 py-2 text-sm text-offwhite/80 transition hover:border-offwhite/60 hover:text-offwhite focus-visible:outline focus-visible:outline-2 focus-visible:outline-offwhite"
          >
            Skip
          </button>
        </div>
      )}

      <div
        className={introComplete ? "opacity-100 transition-opacity duration-700 ease-out" : "opacity-0"}
        aria-hidden={!introComplete}
      >
        {children}
      </div>
    </>
  );
}
