import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { StatusBadge } from "@/components/StatusBadge";
import { PrescriptionHistoryPanel } from "@/components/PrescriptionHistoryPanel";
import * as prescriptionsApi from "@/api/prescriptions";

export function History() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["prescriptions"],
    queryFn: prescriptionsApi.listPrescriptions,
  });

  async function remove(id: string) {
    await prescriptionsApi.deletePrescription(id);
    queryClient.setQueryData<typeof data>(["prescriptions"], (old) =>
      old ? { ...old, prescriptions: old.prescriptions.filter((p) => p.id !== id) } : old
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["prescriptions"] }),
      queryClient.invalidateQueries({ queryKey: ["medications"] }),
      queryClient.invalidateQueries({ queryKey: ["schedule"] }),
      queryClient.invalidateQueries({ queryKey: ["schedules"] }),
    ]);
  }

  const prescriptions = data?.prescriptions ?? [];

  return (
    <div className="mx-auto max-w-content px-6 py-16 sm:py-20">
      <header>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-forest">Your records</p>
        <h1 className="font-display text-4xl">History</h1>
        <p className="mt-4 max-w-2xl text-charcoal/75">
          Every prescription you've uploaded, its review/approval status, and the full event trail behind it —
          extraction, edits, schedule changes, and reminder outcomes.
        </p>
      </header>

      {isLoading && <p className="mt-12 text-charcoal/70">Loading…</p>}
      {isError && <p className="mt-12 text-red-700">Couldn't load your history. Please refresh the page.</p>}

      {!isLoading && prescriptions.length === 0 && (
        <div className="mt-12 rounded-3xl border border-dashed border-charcoal/20 p-10 text-charcoal/70">
          No prescriptions yet.
        </div>
      )}

      <div className="mt-10 flex flex-col gap-4">
        {prescriptions.map((prescription) => {
          const expanded = expandedId === prescription.id;
          return (
            <div key={prescription.id} className="rounded-3xl border border-charcoal/10 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display text-lg">{prescription.originalFilename}</p>
                  <p className="text-sm text-charcoal/70">Uploaded {new Date(prescription.createdAt).toLocaleString()}</p>
                </div>
                <StatusBadge status={prescription.status} />
              </div>

              {(prescription.medications ?? []).length > 0 && (
                <ul className="mt-4 flex flex-col gap-1 text-sm text-charcoal/75">
                  {prescription.medications!.map((m) => (
                    <li key={m.id} className="flex items-center gap-2">
                      <span>{m.confirmedName ?? m.extractedName ?? "Unnamed medication"}</span>
                      <StatusBadge status={m.reviewStatus} />
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <button
                  className="text-sm font-medium text-forest hover:underline"
                  onClick={() => setExpandedId(expanded ? null : prescription.id)}
                >
                  {expanded ? "Hide event history" : "View event history"}
                </button>
                <ConfirmDeleteButton
                  label="Delete prescription"
                  confirmText="Delete this prescription, its medicines and their reminders?"
                  onConfirm={() => remove(prescription.id)}
                />
              </div>

              {expanded && (
                <div className="mt-4 border-t border-charcoal/10 pt-4">
                  <PrescriptionHistoryPanel prescriptionId={prescription.id} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
