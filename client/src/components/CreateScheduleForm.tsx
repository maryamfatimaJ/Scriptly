import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import * as scheduleApi from "@/api/schedule";
import type { Medication, SlotBasis } from "@/types";

interface SlotDraft {
  timeOfDay: string;
  label: string;
  basis: SlotBasis | "USER";
}

const BASIS_NOTE: Record<SlotDraft["basis"], string> = {
  WRITTEN_TIME: "time written on the prescription",
  WRITTEN_ANCHOR: "written on the prescription — clock time is a default, adjust to your routine",
  SUGGESTED: "suggestion — change to suit your day",
  USER: "your time",
};

// A medicine added by hand has no prescription to have been "written on".
const MANUAL_BASIS_NOTE: Record<SlotDraft["basis"], string> = {
  ...BASIS_NOTE,
  WRITTEN_TIME: "time you entered",
  WRITTEN_ANCHOR: "from the timing you entered — clock time is a default, adjust to your routine",
};

export const WEEKDAYS = [
  { iso: 1, short: "Mon" },
  { iso: 2, short: "Tue" },
  { iso: 3, short: "Wed" },
  { iso: 4, short: "Thu" },
  { iso: 5, short: "Fri" },
  { iso: 6, short: "Sat" },
  { iso: 7, short: "Sun" },
];

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

// Prepares a schedule from the medicine's CONFIRMED instructions and
// lets the user review every part of it before anything is saved:
//   - each time shows whether it was written on the prescription, anchored
//     to a written meal, or only a suggestion;
//   - a missing duration must be chosen explicitly (a number of days, or
//     "ongoing") — it is never defaulted;
//   - when the instructions are unclear, contradictory or as-needed, no
//     times are proposed and the reasons are shown instead.
// The server re-validates everything at save time.
export function CreateScheduleForm({ medication, onDone }: { medication: Medication; onDone: (saved: boolean) => void }) {
  const queryClient = useQueryClient();
  const previewQuery = useQuery({
    queryKey: ["schedule-preview", medication.id],
    queryFn: () => scheduleApi.getSchedulePreview(medication.id),
  });
  const proposal = previewQuery.data?.preview.proposal;

  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [durationMode, setDurationMode] = useState<"days" | "ongoing" | null>(null);
  const [durationDays, setDurationDays] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [doseAmount, setDoseAmount] = useState("");
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [manualOverride, setManualOverride] = useState(false);

  useEffect(() => {
    if (!proposal) return;
    setStartDate(proposal.startDate);
    setSlots(proposal.slots.map((s) => ({ timeOfDay: s.timeOfDay, label: s.label, basis: s.basis })));
    setDoseAmount(proposal.doseAmount ?? "");
    if (proposal.durationDays) {
      setDurationMode("days");
      setDurationDays(String(proposal.durationDays));
    }
  }, [proposal]);

  const mutation = useMutation({
    mutationFn: () =>
      scheduleApi.createSchedule({
        medicationId: medication.id,
        startDate,
        endDate: durationMode === "days" ? addDays(startDate, Number(durationDays) - 1) : undefined,
        slots: slots.map((s) => ({ timeOfDay: s.timeOfDay, label: s.label || undefined })),
        doseAmount: doseAmount.trim() || undefined,
        daysOfWeek: days,
        remindersEnabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      queryClient.invalidateQueries({ queryKey: ["medications"] });
      queryClient.invalidateQueries({ queryKey: ["prescription-summary"] });
      onDone(true);
    },
  });

  const name = medication.confirmedName ?? medication.extractedName;
  const needsClarification = proposal?.status === "NEEDS_CLARIFICATION";
  const showTimes = !needsClarification || manualOverride;
  const durationValid = durationMode === "ongoing" || (durationMode === "days" && Number(durationDays) >= 1);
  const canSave = showTimes && slots.length > 0 && slots.every((s) => s.timeOfDay) && durationValid;

  return (
    <div className="rounded-2xl border border-charcoal/10 bg-mint/30 p-5">
      <p className="font-medium">Reminder schedule for {name}</p>
      <p className="mt-1 text-xs text-charcoal/70">
        As confirmed: {[medication.confirmedDosageInstructions, medication.confirmedFrequency, medication.confirmedTiming]
          .filter(Boolean)
          .join(" · ") || "—"}
        {medication.confirmedDurationDays ? ` · ${medication.confirmedDurationDays} days` : ""}
      </p>

      {previewQuery.isLoading && <p className="mt-4 text-sm text-charcoal/70">Preparing a schedule from your confirmed instructions…</p>}
      {previewQuery.isError && (
        <p className="mt-4 text-sm text-red-700">{(previewQuery.error as Error).message || "Couldn't prepare a schedule."}</p>
      )}

      {proposal && (
        <>
          {proposal.issues.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5 rounded-xl bg-offwhite px-4 py-3">
              {proposal.issues.map((issue, i) => (
                <li
                  key={i}
                  className={`text-sm ${issue.severity === "critical" ? "font-medium text-red-700" : issue.severity === "warning" ? "text-amber-800" : "text-charcoal/75"}`}
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          )}

          {needsClarification && !manualOverride && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="text-sm text-charcoal/75">No times have been proposed.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setManualOverride(true);
                  setSlots([{ timeOfDay: "", label: "", basis: "USER" }]);
                }}
              >
                I've checked — enter times myself
              </Button>
            </div>
          )}

          {showTimes && (
            <div className="mt-5 flex flex-col gap-5">
              <div className="flex flex-col gap-2 text-sm">
                <span className="font-medium">Reminder times</span>
                {slots.map((slot, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-3">
                    <input
                      type="time"
                      value={slot.timeOfDay}
                      onChange={(e) =>
                        setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, timeOfDay: e.target.value, basis: s.basis === "WRITTEN_TIME" ? "USER" : s.basis } : s)))
                      }
                      className="field w-32"
                      aria-label={slot.label || `Reminder time ${i + 1}`}
                    />
                    <span className="text-sm">{slot.label}</span>
                    <span className="text-xs text-gray">{(medication.source === "MANUAL" ? MANUAL_BASIS_NOTE : BASIS_NOTE)[slot.basis]}</span>
                    {slots.length > 1 && (
                      <button
                        type="button"
                        className="text-xs text-charcoal/70 underline hover:text-red-700"
                        onClick={() => setSlots((prev) => prev.filter((_, j) => j !== i))}
                      >
                        remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="self-start rounded-xl border border-dashed border-charcoal/25 px-3 py-1.5 text-sm text-charcoal/70 hover:border-forest hover:text-forest"
                  onClick={() => setSlots((prev) => [...prev, { timeOfDay: "", label: "", basis: "USER" }])}
                >
                  + add time
                </button>
                {proposal.dosesPerDay && slots.length !== proposal.dosesPerDay && (
                  <p className="text-xs font-medium text-amber-800">
                    Your prescription says {proposal.dosesPerDay} dose(s) a day; this schedule has {slots.length}.
                  </p>
                )}
                {proposal.passedToday.length > 0 && (
                  <p className="text-xs text-charcoal/70">
                    Today's {proposal.passedToday.join(", ")} has already passed. It will appear in today's list so you can mark
                    it taken, but no reminder will be sent for it.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-6 text-sm">
                <label className="flex flex-col gap-1">
                  Start date
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="field" />
                </label>
                <label className="flex flex-col gap-1">
                  Dose each time
                  <input
                    value={doseAmount}
                    onChange={(e) => setDoseAmount(e.target.value)}
                    className="field w-40"
                    placeholder="e.g. 1 tablet"
                  />
                </label>
              </div>

              <fieldset className="flex flex-col gap-2 text-sm">
                <legend className="mb-1 font-medium">How long</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={durationMode === "days"} onChange={() => setDurationMode("days")} />
                  For
                  <input
                    type="number"
                    min={1}
                    value={durationDays}
                    onChange={(e) => {
                      setDurationMode("days");
                      setDurationDays(e.target.value);
                    }}
                    className="field w-20 py-1.5"
                    aria-label="Number of days"
                  />
                  days
                  {durationMode === "days" && Number(durationDays) >= 1 && (
                    <span className="text-xs text-gray">— last day {addDays(startDate, Number(durationDays) - 1)}</span>
                  )}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={durationMode === "ongoing"} onChange={() => setDurationMode("ongoing")} />
                  Ongoing — my prescriber said to continue until told to stop
                </label>
              </fieldset>

              <fieldset className="text-sm">
                <legend className="mb-2 font-medium">Days</legend>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((day) => {
                    const selected = days.length === 0 || days.includes(day.iso);
                    return (
                      <button
                        type="button"
                        key={day.iso}
                        aria-pressed={selected}
                        onClick={() => {
                          const current = days.length === 0 ? WEEKDAYS.map((d) => d.iso) : days;
                          const next = current.includes(day.iso) ? current.filter((d) => d !== day.iso) : [...current, day.iso];
                          setDays(next.length === 7 ? [] : next);
                        }}
                        className={`rounded-capsule px-3 py-1 text-xs ${selected ? "bg-forest text-offwhite" : "border border-charcoal/20 text-charcoal/70"}`}
                      >
                        {day.short}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-gray">{days.length === 0 ? "Every day" : "Only the highlighted days"}</p>
              </fieldset>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={remindersEnabled} onChange={(e) => setRemindersEnabled(e.target.checked)} />
                Send reminder notifications for this schedule
              </label>
            </div>
          )}
        </>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {showTimes && proposal && (
          <Button onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save schedule"}
          </Button>
        )}
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
        {showTimes && proposal && !durationValid && <p className="text-xs text-gray">Choose how long to continue.</p>}
      </div>

      {mutation.isError && <p className="mt-3 text-sm text-red-700">{(mutation.error as Error).message}</p>}
    </div>
  );
}
