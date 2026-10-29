import { cn } from "@/lib/cn";
import type { MedicationReviewStatus, PrescriptionStatus, ReminderStatus } from "@/types";

type Status = MedicationReviewStatus | PrescriptionStatus | ReminderStatus;

const STYLES: Record<string, string> = {
  NEEDS_REVIEW: "bg-mint text-forest",
  CONFIRMED: "bg-forest text-offwhite",
  NEEDS_CLARIFICATION: "bg-amber-100 text-amber-800",
  REJECTED: "bg-charcoal/10 text-charcoal",
  UPLOADED: "bg-mint text-forest",
  EXTRACTING: "bg-mint text-forest",
  EXTRACTED: "bg-sage/40 text-forest",
  APPROVED: "bg-forest text-offwhite",
  PENDING: "bg-mint text-forest",
  TAKEN: "bg-forest text-offwhite",
  MISSED: "bg-red-100 text-red-700",
  SKIPPED: "bg-charcoal/10 text-charcoal",
};

const LABELS: Record<string, string> = {
  NEEDS_REVIEW: "Needs review",
  CONFIRMED: "Confirmed",
  NEEDS_CLARIFICATION: "Needs clarification",
  REJECTED: "Rejected",
  UPLOADED: "Uploaded",
  EXTRACTING: "Extracting…",
  EXTRACTED: "Extracted",
  APPROVED: "Approved",
  PENDING: "Pending",
  TAKEN: "Taken",
  MISSED: "Missed",
  SKIPPED: "Skipped",
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-capsule px-3 py-1 text-xs font-medium",
        STYLES[status] ?? "bg-charcoal/10 text-charcoal",
        className
      )}
    >
      {LABELS[status] ?? status}
    </span>
  );
}
