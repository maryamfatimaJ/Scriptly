import { useQuery } from "@tanstack/react-query";
import * as prescriptionsApi from "@/api/prescriptions";

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Prescription uploaded",
  EXTRACTION_STARTED: "Extraction started",
  EXTRACTION_COMPLETED: "Extraction completed",
  EXTRACTION_FAILED: "Extraction failed",
  EXTRACTION_RETRY_BLOCKED: "Re-extraction blocked",
  MEDICINE_MATCHING_COMPLETED: "Medicine reference matching ran",
  APPROVED: "Prescription approved",
  REJECTED: "Prescription rejected",
  CLARIFICATION_REQUESTED: "Professional clarification requested",
  MEDICATION_UPDATED: "Medication edited",
  SCHEDULE_CREATED: "Schedule activated",
  SCHEDULE_STATUS_CHANGED: "Schedule status changed",
  REMINDER_UPDATED: "Reminder status changed",
};

function describeMetadata(eventType: string, metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  if (eventType === "MEDICATION_UPDATED" && Array.isArray(metadata.changedFields) && metadata.changedFields.length > 0) {
    return (metadata.changedFields as { field: string }[]).map((c) => c.field).join(", ");
  }
  if (eventType === "SCHEDULE_STATUS_CHANGED") {
    return `${metadata.from} → ${metadata.to}`;
  }
  if (eventType === "REMINDER_UPDATED") {
    return `${metadata.previousStatus} → ${metadata.newStatus}${metadata.isCorrection ? " (correction)" : ""}`;
  }
  if (eventType === "EXTRACTION_RETRY_BLOCKED") {
    return String(metadata.reason ?? "");
  }
  if (eventType === "REJECTED" && metadata.reason) {
    return String(metadata.reason);
  }
  if (eventType === "CLARIFICATION_REQUESTED" && metadata.note) {
    return String(metadata.note);
  }
  return null;
}

export function PrescriptionHistoryPanel({ prescriptionId }: { prescriptionId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["prescription-events", prescriptionId],
    queryFn: () => prescriptionsApi.getPrescriptionEvents(prescriptionId),
  });

  if (isLoading) return <p className="text-sm text-charcoal/70">Loading history…</p>;

  const events = data?.events ?? [];
  if (events.length === 0) return <p className="text-sm text-charcoal/70">No events recorded yet.</p>;

  return (
    <ol className="flex flex-col gap-3 border-l border-charcoal/15 pl-4">
      {events.map((event) => {
        const detail = describeMetadata(event.eventType, event.metadata);
        return (
          <li key={event.id} className="text-sm">
            <p className="font-medium">{EVENT_LABELS[event.eventType] ?? event.eventType}</p>
            <p className="text-xs text-gray">{new Date(event.createdAt).toLocaleString()}</p>
            {detail && <p className="mt-0.5 text-xs text-charcoal/70">{detail}</p>}
          </li>
        );
      })}
    </ol>
  );
}
