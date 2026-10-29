import { cn } from "@/lib/cn";

// Required disclaimer — kept as one shared component so it reads
// identically everywhere it appears (footer, review screen, schedule).
export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("text-sm text-gray", className)}>
      This tool does not replace your doctor or pharmacist.
    </p>
  );
}
