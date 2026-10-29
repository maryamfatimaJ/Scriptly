import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/Button";
import { MedicineActions } from "@/components/MedicineActions";
import * as medicationsApi from "@/api/medications";

export function MyMedications() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["medications"],
    queryFn: medicationsApi.listMedications,
  });

  // The list updates only after the server confirms the delete; schedules
  // and prescriptions are refetched because their contents changed too.
  async function remove(id: string) {
    await medicationsApi.deleteMedication(id);
    queryClient.setQueryData<typeof data>(["medications"], (old) =>
      old ? { ...old, medications: old.medications.filter((m) => m.id !== id) } : old
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["medications"] }),
      queryClient.invalidateQueries({ queryKey: ["schedule"] }),
      queryClient.invalidateQueries({ queryKey: ["schedules"] }),
      queryClient.invalidateQueries({ queryKey: ["prescriptions"] }),
      queryClient.invalidateQueries({ queryKey: ["prescription"] }),
    ]);
  }

  const medications = data?.medications ?? [];

  return (
    <div className="mx-auto max-w-content px-6 py-16 sm:py-20">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="t-eyebrow">Your records</p>
          <h1 className="mt-4 t-h2">My medications</h1>
        </div>
        <Link to="/capture">
          <Button>Scan a new prescription</Button>
        </Link>
      </header>

      {isLoading && <p className="mt-12 text-charcoal/70">Loading…</p>}
      {isError && <p className="mt-12 text-red-700">Couldn't load your medications. Please refresh the page.</p>}

      {!isLoading && medications.length === 0 && (
        <div className="mt-12 rounded-3xl border border-dashed border-charcoal/20 p-10 text-charcoal/70">
          No medications yet. Scan a prescription to get started.
        </div>
      )}

      <div className="mt-10 flex flex-col divide-y divide-charcoal/10 border-t border-charcoal/10">
        {medications.map((medication) => (
          <div key={medication.id} className="py-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="t-h3 text-lg">
                  {medication.confirmedName ?? medication.extractedName ?? "Unnamed medication"}
                </h2>
                <p className="mt-1 t-body">
                  {[
                    medication.confirmedStrength ?? medication.extractedStrength,
                    medication.confirmedForm ?? medication.extractedForm,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No strength/form recorded"}
                </p>
                <p className="mt-1 t-meta">
                  {medication.confirmedDosageInstructions ??
                    medication.extractedDosageInstructions ??
                    "No instructions recorded"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <StatusBadge status={medication.reviewStatus} />
                {medication.prescriptionId ? (
                  <Link
                    to={`/review/${medication.prescriptionId}`}
                    className="border-b border-forest/40 pb-0.5 text-forest t-nav transition-colors hover:border-forest"
                  >
                    View prescription
                  </Link>
                ) : (
                  <Link
                    to="/schedule"
                    className="border-b border-forest/40 pb-0.5 text-forest t-nav transition-colors hover:border-forest"
                  >
                    Added by you · edit schedule
                  </Link>
                )}
              </div>
            </div>

            {/* Same lookups as on the review screen, so a medicine can be
                checked at any time, not only while reviewing it. */}
            <MedicineActions
              medicationId={medication.id}
              isConfirmed={medication.reviewStatus === "CONFIRMED"}
            />

            <div className="mt-4">
              <ConfirmDeleteButton
                label="Remove this medicine"
                confirmText="Remove it and all of its reminders?"
                onConfirm={() => remove(medication.id)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
