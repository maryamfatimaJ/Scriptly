# Capsule intro / loading animation

The current asset is:

    capsule-intro.gif          ->  client/public/animations/capsule-intro.gif

A Lottie export is also supported as a fallback, if one is ever produced:

    capsule-intro.json         ->  client/public/animations/capsule-intro.json

`src/animations/CapsuleIntro.tsx` prefers the GIF and falls back to the
Lottie JSON, so either works and you can switch by swapping files.

## If you replace the GIF, re-measure its duration

A GIF fires no "animation finished" event in the browser, and this one
loops forever, so the intro is ended by a timer rather than by the asset.
`GIF_LOOP_MS` in `CapsuleIntro.tsx` is set to the current file's real
duration (48 frames, 1.92s). A longer replacement will be cut off
mid-motion until that constant is updated to match.

## Behaviour you can rely on

- Plays once per browser tab session (sessionStorage), not once ever.
- Skipped entirely for `prefers-reduced-motion` — the GIF is not even
  requested in that case.
- Skipped if the asset is missing, broken, **or merely slow**: there is a
  2.5s budget for the asset to load and a hard 6s ceiling on the overlay,
  so a stalled request can never trap someone behind it.
- Dismissable with the Skip button, Escape, Enter or Space.

## Background colour

The asset's background is baked in and fully opaque (`#262b2f` on every
frame — the GIF transparency flag is set but unused). `GIF_BACKDROP` in
`CapsuleIntro.tsx` matches it exactly so the animation sits seamlessly
full-bleed. **If you replace the GIF with one on a different background,
update that constant too**, or you'll get a visible rectangle.
