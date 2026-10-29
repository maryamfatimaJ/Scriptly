import { useId } from "react";
import { cn } from "@/lib/cn";

// The recurring brand mark: a capsule split into two contrasting halves.
// Pure SVG so it stays crisp at any size — from a 20px footer mark to the
// architectural-scale form in the homepage hero — and never needs an
// image asset.
//
// The halves are configurable because the mark has to survive being
// placed on a dark field as well as a light one — the default blue half
// all but disappears against a dark-blue panel. Callers that need that
// pass their own fills; everything else gets the brand defaults.

interface CapsuleMotifProps {
  className?: string;
  /** Leading half. Defaults to the primary blue. */
  leadFill?: string;
  /** Trailing half. Defaults to the surface tint. */
  trailFill?: string;
  /** Hairline outline. Pass "none" to drop it on dark backgrounds, where it reads as a seam. */
  strokeColor?: string;
}

export function CapsuleMotif({
  className,
  // Read from the shared design tokens in src/styles/index.css, so the
  // mark always matches the palette (and the 3D capsule it is derived
  // from) without holding its own copy of any colour.
  leadFill = "rgb(var(--sc-primary))",
  trailFill = "#F3F8FC",
  strokeColor = "rgb(var(--sc-ink))",
}: CapsuleMotifProps) {
  // Several of these can share a page (nav, hero, footer), and a
  // duplicated clipPath id makes whichever renders last win — the mark
  // then loses its rounded ends. useId keeps each instance independent.
  const clipId = useId();

  return (
    <svg
      viewBox="0 0 160 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("block", className)}
      aria-hidden="true"
      // Default preserveAspectRatio ("xMidYMid meet") is deliberate: the
      // mark is a brand asset and must never be stretched to fill a box
      // whose ratio differs from its own. Size it with matching
      // proportions instead.
    >
      <clipPath id={clipId}>
        <rect x="2" y="2" width="156" height="68" rx="34" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect x="2" y="2" width="78" height="68" style={{ fill: leadFill }} />
        <rect x="80" y="2" width="78" height="68" style={{ fill: trailFill }} />
      </g>
      {strokeColor !== "none" && (
        <rect
          x="2"
          y="2"
          width="156"
          height="68"
          rx="34"
          style={{ stroke: strokeColor }}
          strokeOpacity="0.15"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
