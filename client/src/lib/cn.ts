import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Combines conditional class logic (clsx) with correct Tailwind override
// resolution (tailwind-merge). Plain clsx concatenates class *strings*, but
// which same-property utility "wins" in the browser depends on each
// utility's position in the compiled stylesheet — not the order they
// appear in the className attribute. That mismatch is what caused the
// Button component's `className` overrides (e.g. on MobileNav's primary
// CTA) to sometimes lose to the variant's own classes. Always use `cn`,
// not raw `clsx`, anywhere a prop is meant to override a component's own
// Tailwind classes.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
