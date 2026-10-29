import { useState } from "react";
import { cn } from "@/lib/cn";

// Stock placeholder (Unsplash, free-to-use license) standing in for real
// product photography — prescription paper + medicine packaging in
// natural daylight, as the brief calls for. Replace `src` with a licensed
// photograph before shipping; swap it in one place, here.
const PLACEHOLDER_SRC =
  "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=900&q=80";

const PLACEHOLDER_ALT = "A paper prescription beside medicine packaging, photographed in natural daylight";

export function HeroPhoto({
  className,
  src = PLACEHOLDER_SRC,
  alt = PLACEHOLDER_ALT,
}: {
  className?: string;
  /** Image URL; defaults to the stock placeholder above. */
  src?: string;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    // Graceful fallback if the placeholder URL is ever unreachable — a
    // soft capsule-toned gradient rather than a broken image icon.
    return (
      <div
        className={cn(
          "bg-gradient-to-br from-forest via-sage to-offwhite",
          className
        )}
        role="img"
        aria-label={alt}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn("object-cover", className)}
      onError={() => setFailed(true)}
      loading="eager"
    />
  );
}
