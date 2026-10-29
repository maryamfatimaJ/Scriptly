import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/Button";
import * as medicationsApi from "@/api/medications";
import { medicationReviewSchema, type MedicationReviewInput } from "@/lib/validation/medication";
import type { ExtractableField, FieldConfidenceMap, FieldSource, FieldSourceMap, Medication } from "@/types";

// Small inline "uncertainty" marker next to a field label, driven by the
// provider's per-field confidence — a quieter signal than a full warning
// banner, for fields that are fine but not rock-solid.
function FieldConfidenceDot({ field, map }: { field: keyof FieldConfidenceMap; map?: FieldConfidenceMap | null }) {
  const score = map?.[field];
  if (typeof score !== "number") return null;
  const tone = score >= 0.8 ? "bg-forest" : score >= 0.5 ? "bg-amber-500" : "bg-red-600";
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${tone}`}
      title={`${Math.round(score * 100)}% confidence on this field`}
    />
  );
}

// Where the value came from, in words. "Read" is the unremarkable case and
// shows nothing; everything else is something the user should know before
// confirming.
const SOURCE_TAG: Partial<Record<FieldSource, { text: string; tone: string }>> = {
  UNCERTAIN: { text: "unclear — check the paper", tone: "text-red-700" },
  NOT_VISIBLE: { text: "not written", tone: "text-gray" },
  INFERRED: { text: "identified from the brand, not written", tone: "text-amber-700" },
};

function FieldSourceTag({ field, map }: { field: ExtractableField; map?: FieldSourceMap | null }) {
  const tag = map?.[field] ? SOURCE_TAG[map[field]!] : undefined;
  if (!tag) return null;
  return <span className={`text-[11px] ${tag.tone}`}>· {tag.text}</span>;
}

function FieldLabel({
  children,
  field,
  confidence,
  sources,
}: {
  children: React.ReactNode;
  field: ExtractableField;
  confidence?: FieldConfidenceMap | null;
  sources?: FieldSourceMap | null;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {children} <FieldConfidenceDot field={field} map={confidence} />
      <FieldSourceTag field={field} map={sources} />
    </span>
  );
}

export function MedicationReviewCard({
  medication,
  prescriptionId,
  prescriptionApproved = false,
}: {
  medication: Medication;
  prescriptionId: string;
  /** After saving, only uncertain medicines are shown; they can still be resolved. */
  prescriptionApproved?: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<MedicationReviewInput>({
    resolver: zodResolver(medicationReviewSchema),
    defaultValues: {
      confirmedName: medication.confirmedName ?? medication.extractedName ?? "",
      confirmedBrand: medication.confirmedBrand ?? medication.extractedBrand ?? "",
      confirmedGenericName: medication.confirmedGenericName ?? medication.extractedGenericName ?? "",
      confirmedStrength: medication.confirmedStrength ?? medication.extractedStrength ?? "",
      confirmedForm: medication.confirmedForm ?? medication.extractedForm ?? "",
      confirmedRoute: medication.confirmedRoute ?? medication.extractedRoute ?? "",
      confirmedDosageInstructions: medication.confirmedDosageInstructions ?? medication.extractedDosageInstructions ?? "",
      confirmedInstructions: medication.confirmedInstructions ?? medication.extractedInstructions ?? "",
      confirmedFrequency: medication.confirmedFrequency ?? medication.extractedFrequency ?? "",
      confirmedDurationDays: medication.confirmedDurationDays ?? medication.extractedDurationDays ?? ("" as unknown as number),
      confirmedTiming: medication.confirmedTiming ?? medication.extractedTiming ?? "",
      confirmedQuantity: medication.confirmedQuantity ?? medication.extractedQuantity ?? "",
      reviewStatus: medication.reviewStatus,
      reviewNotes: medication.reviewNotes ?? "",
    },
  });

  // The card's status comes from the server's record only: a decision is
  // shown as made after the save succeeded and the prescription refetched.
  const mutation = useMutation({
    mutationFn: (payload: MedicationReviewInput) => medicationsApi.updateMedication(medication.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["prescription", prescriptionId] });
      setEditing(false);
    },
  });
  // Blocks a second submit fired before React re-renders with isPending
  // (a fast double click), so one decision is one request.
  const inFlight = useRef(false);
  const [invalidHint, setInvalidHint] = useState<string | null>(null);

  const reviewStatus = medication.reviewStatus;
  const warnings = medication.extractionWarnings ?? [];
  const fieldConfidence = medication.extractionFieldConfidence;
  const fieldSources = medication.extractionFieldSource;

  function submitWithStatus(status: MedicationReviewInput["reviewStatus"]) {
    if (inFlight.current || mutation.isPending) return;
    inFlight.current = true;
    setInvalidHint(null);
    setValue("reviewStatus", status);
    handleSubmit(
      (data) => mutation.mutate({ ...data, reviewStatus: status }, { onSettled: () => (inFlight.current = false) }),
      () => {
        // The name is missing. Open the form so the problem is visible
        // instead of the click doing nothing.
        inFlight.current = false;
        setEditing(true);
        setInvalidHint("Enter the medicine name, then confirm.");
      }
    )();
  }

  const name = watch("confirmedName");
  const sourceOf = (field: ExtractableField) => fieldSources?.[field];
  const unclear = (field: ExtractableField) => sourceOf(field) === "UNCERTAIN";
  // What the person must look at before confirming. Never hidden: a name
  // or timing the AI could not read is exactly what must not be guessed.
  const checks: string[] = [];
  if (!name?.trim()) checks.push("The medicine name couldn't be read. Tap Edit and type it from your prescription.");
  else if (unclear("name")) checks.push(`The name is unclear on the paper — we read "${name}". Check it carefully or correct it.`);
  if (unclear("timing") || unclear("frequency")) checks.push("When to take it is unclear. Check the timing against your prescription.");
  // Every warning the reader raised (an ambiguous limit, a missing
  // duration…) is something to check, not only the critical ones.
  for (const warning of warnings) checks.push(warning.message);

  const summary: Array<{ label: string; value: string | null | undefined; field: ExtractableField }> = [
    {
      label: "When to take",
      value: [watch("confirmedFrequency"), watch("confirmedTiming")].filter(Boolean).join(" · ") || null,
      field: unclear("timing") ? "timing" : "frequency",
    },
    { label: "Dose", value: watch("confirmedDosageInstructions"), field: "dosageInstructions" },
    {
      label: "For how long",
      value: watch("confirmedDurationDays") ? `${watch("confirmedDurationDays")} days` : null,
      field: "durationDays",
    },
    { label: "Other instructions", value: watch("confirmedInstructions"), field: "instructions" },
  ];
  const decided = medication.reviewStatus !== "NEEDS_REVIEW";
  // From the saved record, not the form: what was actually confirmed.
  const noDose = !medication.confirmedDosageInstructions?.trim();
  const noFrequency = !medication.confirmedFrequency?.trim();
  const missingInstructions =
    noDose && noFrequency
      ? "The dose and how often to take it aren't"
      : noDose
        ? "The dose isn't"
        : noFrequency
          ? "How often to take it isn't"
          : null;

  return (
    <div className="rounded-3xl border border-charcoal/10 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-xl">{name?.trim() || "Name not readable"}</h3>
          <p className="mt-0.5 text-sm text-charcoal/70">
            {[watch("confirmedStrength"), watch("confirmedForm")].filter(Boolean).join(" · ") || "Strength and form not written"}
          </p>
        </div>
        <StatusBadge status={reviewStatus} />
      </div>

      {checks.length > 0 && !decided && (
        <div className="mt-4 rounded-2xl border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
          <p className="font-medium">Please check before confirming</p>
          <ul className="mt-1 list-disc pl-5">
            {checks.map((check, i) => (
              <li key={i}>{check}</li>
            ))}
          </ul>
        </div>
      )}

      {!editing ? (
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          {summary.map((row) => (
            <div key={row.label}>
              <dt className="text-xs uppercase tracking-wide text-gray">
                {row.label} <FieldSourceTag field={row.field} map={fieldSources} />
              </dt>
              <dd className={`mt-0.5 ${row.value ? "text-charcoal" : "text-gray"}`}>{row.value || "Not written"}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <FieldLabel field="name" confidence={fieldConfidence} sources={fieldSources}>
              Medicine name
            </FieldLabel>
            <input {...register("confirmedName")} className="field" />
            {errors.confirmedName && <span className="text-xs text-red-700">{errors.confirmedName.message}</span>}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel field="frequency" confidence={fieldConfidence} sources={fieldSources}>
              How often
            </FieldLabel>
            <input {...register("confirmedFrequency")} className="field" placeholder="e.g. twice a day, BD" />
            {errors.confirmedFrequency && <span className="text-xs text-red-700">{errors.confirmedFrequency.message}</span>}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel field="timing" confidence={fieldConfidence} sources={fieldSources}>
              When
            </FieldLabel>
            <input {...register("confirmedTiming")} className="field" placeholder="e.g. after breakfast and dinner" />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel field="dosageInstructions" confidence={fieldConfidence} sources={fieldSources}>
              Dose
            </FieldLabel>
            <input {...register("confirmedDosageInstructions")} className="field" placeholder="e.g. 1 tablet" />
            {errors.confirmedDosageInstructions && (
              <span className="text-xs text-red-700">{errors.confirmedDosageInstructions.message}</span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel field="durationDays" confidence={fieldConfidence} sources={fieldSources}>
              For how many days
            </FieldLabel>
            <input type="number" min={1} {...register("confirmedDurationDays")} className="field" />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <FieldLabel field="instructions" confidence={fieldConfidence} sources={fieldSources}>
              Other instructions
            </FieldLabel>
            <input {...register("confirmedInstructions")} className="field" placeholder="e.g. avoid alcohol" />
          </label>

          <details className="sm:col-span-2">
            <summary className="cursor-pointer text-sm text-forest">More details (strength, form, brand…)</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel field="strength" confidence={fieldConfidence} sources={fieldSources}>
                  Strength
                </FieldLabel>
                <input {...register("confirmedStrength")} className="field" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel field="form" confidence={fieldConfidence} sources={fieldSources}>
                  Form
                </FieldLabel>
                <input {...register("confirmedForm")} className="field" placeholder="e.g. tablet, syrup" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel field="brand" confidence={fieldConfidence} sources={fieldSources}>
                  Brand
                </FieldLabel>
                <input {...register("confirmedBrand")} className="field" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel field="genericName" confidence={fieldConfidence} sources={fieldSources}>
                  Generic name
                </FieldLabel>
                <input {...register("confirmedGenericName")} className="field" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel field="route" confidence={fieldConfidence} sources={fieldSources}>
                  Route
                </FieldLabel>
                <input {...register("confirmedRoute")} className="field" placeholder="e.g. oral" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel field="quantity" confidence={fieldConfidence} sources={fieldSources}>
                  Quantity
                </FieldLabel>
                <input {...register("confirmedQuantity")} className="field" />
              </label>
            </div>
          </details>
        </form>
      )}

      {decided && !editing ? (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <p
            className={`text-sm font-medium ${reviewStatus === "CONFIRMED" ? "text-forest" : "text-charcoal/70"}`}
            role="status"
          >
            {reviewStatus === "CONFIRMED"
              ? "\u2713 Confirmed"
              : reviewStatus === "REJECTED"
                ? "Removed \u2014 not on your prescription"
                : "Marked as not sure \u2014 left out of reminders"}
          </p>
          {(!prescriptionApproved || reviewStatus === "NEEDS_CLARIFICATION") && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-sm text-forest underline-offset-2 hover:underline"
            >
              Change
            </button>
          )}
          {reviewStatus === "CONFIRMED" && missingInstructions && (
            <p className="w-full text-sm text-amber-800">
              {missingInstructions} written on the prescription, so nothing was filled in. Ask your doctor or
              pharmacist before taking this medicine.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={() => submitWithStatus("CONFIRMED")} disabled={mutation.isPending || !name?.trim()}>
            {mutation.isPending ? "Saving\u2026" : editing ? "Save and confirm" : "Confirm"}
          </Button>
          {(!decided || editing) && (
            <Button
              variant="secondary"
              onClick={() => {
                setEditing((e) => !e);
                setInvalidHint(null);
              }}
              disabled={mutation.isPending}
            >
              {editing ? "Cancel editing" : "Edit"}
            </Button>
          )}
          <span className="flex flex-wrap gap-4 text-sm">
            <button
              type="button"
              onClick={() => submitWithStatus("NEEDS_CLARIFICATION")}
              disabled={mutation.isPending}
              className="text-charcoal/70 underline-offset-2 hover:underline"
            >
              I'm not sure
            </button>
            <button
              type="button"
              onClick={() => submitWithStatus("REJECTED")}
              disabled={mutation.isPending}
              className="text-charcoal/70 underline-offset-2 hover:underline"
            >
              Not on my prescription
            </button>
          </span>
        </div>
      )}

      {invalidHint && <p className="mt-3 text-sm text-red-700">{invalidHint}</p>}
      {mutation.isError && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          Not saved: {(mutation.error as Error).message} Please try again.
        </p>
      )}
    </div>
  );
}
