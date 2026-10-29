import { useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { Disclaimer } from "@/components/Disclaimer";
import { MedicationReviewCard } from "@/components/MedicationReviewCard";
import { ScriptyChat } from "@/components/scripty/ScriptyChat";
import { CreateScheduleForm } from "@/components/CreateScheduleForm";
import { PrescriptionSummary } from "@/components/PrescriptionSummary";
import { ApiError } from "@/api/client";
import * as prescriptionsApi from "@/api/prescriptions";

export function ReviewPrescription() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [zoom, setZoom] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["prescription", id],
    queryFn: () => prescriptionsApi.getPrescription(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.prescription.status === "EXTRACTING" ? 1500 : false),
  });

  // Saving is one server call that marks the prescription APPROVED after
  // checking every medicine has a decision. The "saved" state shown on
  // this page is read back from the server, so it appears only after the
  // save succeeded — and is still there after a refresh.
  const savingRef = useRef(false);
  const approveMutation = useMutation({
    mutationFn: () => prescriptionsApi.approvePrescription(id as string),
    // Stay on this page: the next steps (schedules, then the summary of
    // what was saved) happen here.
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["prescription", id] }),
        queryClient.invalidateQueries({ queryKey: ["medications"] }),
      ]);
    },
    onSettled: () => {
      savingRef.current = false;
    },
  });
  function save() {
    if (savingRef.current || approveMutation.isPending) return;
    savingRef.current = true;
    approveMutation.mutate();
  }

  // Re-runs the AI reading after a failure (provider busy, quota, a
  // timeout). The server only allows this while nothing has been reviewed.
  const retryMutation = useMutation({
    mutationFn: () => prescriptionsApi.extractPrescription(id as string),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["prescription", id] }),
  });

  const [schedulingId, setSchedulingId] = useState<string | null>(null);

  if (!id) return null;

  if (isLoading) {
    return <div className="mx-auto max-w-content px-6 py-24 text-center text-charcoal/70">Loading prescription…</div>;
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-content px-6 py-24 text-center">
        <p className="text-charcoal/70">We couldn't load this prescription.</p>
        <Button className="mt-6" onClick={() => navigate("/capture")}>
          Start over
        </Button>
      </div>
    );
  }

  const { prescription } = data;
  const medications = prescription.medications ?? [];
  const isApproved = prescription.status === "APPROVED";
  const undecided = medications.filter((m) => m.reviewStatus === "NEEDS_REVIEW").length;
  const confirmedCount = medications.filter((m) => m.reviewStatus === "CONFIRMED").length;
  const canSave = medications.length > 0 && undecided === 0 && confirmedCount > 0;
  // After saving, only medicines left as "uncertain" can still be edited.
  const visibleCards = isApproved ? medications.filter((m) => m.reviewStatus === "NEEDS_CLARIFICATION") : medications;
  const confirmedWithoutSchedule = medications.filter(
    (m) => m.reviewStatus === "CONFIRMED" && !(m.schedules ?? []).some((s) => s.status === "ACTIVE" || s.status === "PAUSED")
  );
  const extractionFailed = prescription.status === "NEEDS_CLARIFICATION" && medications.length === 0;

  return (
    <div className="mx-auto max-w-content px-6 py-16 sm:py-20">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-forest">Review</p>
          <h1 className="font-display text-4xl">{isApproved ? "Your prescription is saved" : "Check what we found"}</h1>
        </div>
        <StatusBadge status={prescription.status} />
      </header>

      {!isApproved && (
        <p className="mt-4 max-w-2xl text-charcoal/75">
          We read the following medicines from your prescription. Please review the names and instructions before
          continuing — correct anything that's wrong, mark anything you're unsure of as uncertain, and remove anything
          that isn't on your prescription.
        </p>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-gray">Original prescription</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-charcoal/20 text-sm hover:border-forest"
                aria-label="Zoom out"
              >
                −
              </button>
              <span className="w-10 text-center text-xs text-gray">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-charcoal/20 text-sm hover:border-forest"
                aria-label="Zoom in"
              >
                +
              </button>
            </div>
          </div>
          <div className="overflow-auto rounded-3xl border border-charcoal/15 bg-charcoal/5" style={{ maxHeight: 640 }}>
            <img
              src={prescriptionsApi.prescriptionImageUrl(prescription.id)}
              crossOrigin="use-credentials"
              alt="Original uploaded prescription"
              className="w-full origin-top-left object-contain transition-transform"
              style={{ transform: `scale(${zoom})` }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {prescription.status === "EXTRACTING" && (
            <div className="rounded-3xl bg-mint/40 p-6 text-charcoal/70">Extracting candidate medications…</div>
          )}

          {extractionFailed && (
            <div className="rounded-3xl bg-amber-50 p-6 text-sm text-amber-900">
              <p className="font-medium">We couldn't read this prescription.</p>
              {prescription.extractionError && <p className="mt-1">{prescription.extractionError}</p>}
              <div className="mt-4 flex flex-wrap gap-3">
                <Button onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
                  {retryMutation.isPending ? "Reading…" : "Try reading it again"}
                </Button>
                <Button variant="secondary" onClick={() => navigate("/capture")}>
                  Upload a clearer photo
                </Button>
              </div>
              {retryMutation.isError && (
                <p className="mt-3 text-red-700">
                  {retryMutation.error instanceof ApiError
                    ? retryMutation.error.message
                    : "That didn't work either. Please try again later."}
                </p>
              )}
            </div>
          )}

          {!isApproved && prescription.extractionLegibility && prescription.extractionLegibility !== "GOOD" && medications.length > 0 && (
            <div className="rounded-3xl bg-amber-50 p-5 text-sm text-amber-900">
              {prescription.extractionLegibility === "POOR"
                ? "Most of this prescription was hard to read. Check every medicine carefully against the paper, and ask your pharmacist about anything you can't read yourself."
                : "Parts of this prescription were hard to read. Fields marked \u201cunclear\u201d need a careful check."}
            </div>
          )}

          {(prescription.extractionOverallWarnings ?? []).length > 0 && (
            <div className="rounded-3xl border border-charcoal/10 bg-mint/30 p-5">
              <p className="text-sm font-medium">About this extraction</p>
              <ul className="mt-2 flex flex-col gap-1">
                {prescription.extractionOverallWarnings!.map((warning, i) => (
                  <li
                    key={i}
                    className={warning.severity === "critical" ? "text-xs font-medium text-red-700" : "text-xs text-charcoal/70"}
                  >
                    {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isApproved && (
            <div className="rounded-3xl border border-forest/30 bg-mint/40 p-5" role="status">
              <p className="font-medium text-forest">{"\u2713"} Medicines saved and confirmed</p>
              <p className="mt-1 text-sm text-charcoal/75">
                {confirmedCount} confirmed medicine{confirmedCount === 1 ? " is" : "s are"} saved to your account
                {medications.some((m) => m.reviewStatus === "NEEDS_CLARIFICATION")
                  ? ". Medicines you weren't sure about are kept out of reminders until you resolve them."
                  : "."}{" "}
                You'll find them under My medications.
              </p>
            </div>
          )}

          {isApproved && visibleCards.length > 0 && (
            <p className="text-sm text-charcoal/75">
              You marked these as uncertain. Once you've checked them with your prescriber or pharmacist, confirm or remove
              them here.
            </p>
          )}

          {visibleCards.map((medication) => (
            <MedicationReviewCard
              key={medication.id}
              medication={medication}
              prescriptionId={prescription.id}
              prescriptionApproved={isApproved}
            />
          ))}

          {isApproved && confirmedWithoutSchedule.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="font-display text-2xl">Set up reminders</h2>
              <p className="text-sm text-charcoal/75">
                Each schedule is prepared from the instructions you confirmed. Review the times before saving — nothing is
                scheduled until you do.
              </p>
              {confirmedWithoutSchedule.map((medication) =>
                schedulingId === medication.id ? (
                  <CreateScheduleForm
                    key={medication.id}
                    medication={medication}
                    onDone={() => {
                      setSchedulingId(null);
                      queryClient.invalidateQueries({ queryKey: ["prescription", id] });
                    }}
                  />
                ) : (
                  <div
                    key={medication.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-charcoal/10 p-5"
                  >
                    <span>{medication.confirmedName}</span>
                    <Button variant="secondary" onClick={() => setSchedulingId(medication.id)}>
                      Review schedule
                    </Button>
                  </div>
                )
              )}
            </section>
          )}

          {isApproved && <PrescriptionSummary prescriptionId={prescription.id} />}

          {medications.length === 0 && prescription.status !== "EXTRACTING" && (
            <div className="rounded-3xl border border-dashed border-charcoal/20 p-8 text-charcoal/70">
              No medications were extracted from this prescription yet.
            </div>
          )}

          {!isApproved && medications.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-charcoal/10 pt-6">
              <div className="flex flex-wrap items-center gap-4">
                <Button onClick={save} disabled={!canSave || approveMutation.isPending}>
                  {approveMutation.isPending ? "Saving…" : "Save confirmed medicines"}
                </Button>
                {canSave && !approveMutation.isPending && !approveMutation.isError && (
                  <p className="text-sm text-charcoal/75">
                    All medicines have a decision. Save to add the confirmed ones to your account.
                  </p>
                )}
                {undecided > 0 && (
                  <p className="text-sm text-gray">
                    {undecided} medicine{undecided === 1 ? " still needs" : "s still need"} a decision.
                  </p>
                )}
                {undecided === 0 && confirmedCount === 0 && (
                  <p className="text-sm text-gray">Confirm at least one medicine to save.</p>
                )}
              </div>
              <p className="text-xs text-charcoal/70">
                Only confirmed medicines are saved and can be scheduled. Medicines marked uncertain stay out of every
                schedule until you resolve them.
              </p>
              {approveMutation.isError && (
                <p className="text-sm text-red-700" role="alert">
                  Not saved: {(approveMutation.error as Error).message} Nothing was lost — press Save to try again.
                </p>
              )}
            </div>
          )}

          <Disclaimer />
        </div>
      </div>

      {/* Scripty appears only once there is a real extraction to talk
          about. Offering "what would you like help with?" over an empty
          or still-running extraction would be an invitation to answer
          questions we have no data for. */}
      {medications.length > 0 && (
        <section className="mt-16 border-t border-charcoal/10 pt-12">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-forest">Assistant</p>
            <h2 className="font-display text-3xl">Ask Scripty about this prescription</h2>
            <p className="mt-3 text-charcoal/75">
              Scripty can look up what each medicine is for, check Pakistani prices, and help you set up
              reminders. It answers from your actual prescription and from sourced medicine data — never from
              guesswork.
            </p>
          </div>
          <div className="mt-8 h-[640px] max-w-3xl">
            <ScriptyChat
              prescriptionId={prescription.id}
              greeting={
                "I've processed your prescription and can see " +
                medications.length +
                " medicine(s). What would you like help with?"
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}
