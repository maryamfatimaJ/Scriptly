import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import { WEEKDAYS } from "@/components/CreateScheduleForm";
import * as scheduleApi from "@/api/schedule";
import type { Schedule } from "@/types";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-forest text-offwhite",
  PAUSED: "bg-amber-100 text-amber-800",
  CANCELLED: "bg-charcoal/10 text-charcoal",
  COMPLETED: "bg-sage/40 text-forest",
};

function daysLabel(days: number[] | undefined) {
  if (!days || days.length === 0) return "every day";
  return days.map((d) => WEEKDAYS.find((w) => w.iso === d)?.short).join(", ");
}

export function ScheduleCard({ schedule }: { schedule: Schedule }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [times, setTimes] = useState(schedule.slots.map((s) => s.timeOfDay));
  const [days, setDays] = useState<number[]>(schedule.daysOfWeek ?? []);
  const [endDate, setEndDate] = useState(schedule.endDate ? schedule.endDate.slice(0, 10) : "");
  const [doseAmount, setDoseAmount] = useState(schedule.doseAmount ?? "");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["schedules"] });
    queryClient.invalidateQueries({ queryKey: ["schedule"] });
    // Discontinuing frees the medication back up for "set up reminders".
    queryClient.invalidateQueries({ queryKey: ["medications"] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: "ACTIVE" | "PAUSED" | "CANCELLED") => scheduleApi.updateScheduleStatus(schedule.id, status),
    onSuccess: refresh,
  });

  const editMutation = useMutation({
    mutationFn: (payload: scheduleApi.EditSchedulePayload) => scheduleApi.editSchedule(schedule.id, payload),
    onSuccess: () => {
      refresh();
      setEditing(false);
    },
  });

  const editable = schedule.status === "ACTIVE" || schedule.status === "PAUSED";
  const busy = statusMutation.isPending || editMutation.isPending;

  return (
    <div className="rounded-2xl border border-charcoal/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-display text-lg">{schedule.medication?.confirmedName ?? "Medication"}</p>
          <p className="text-sm text-charcoal/70">
            {schedule.slots.map((s) => s.timeOfDay).join(", ")}
            {schedule.doseAmount ? ` · ${schedule.doseAmount}` : ""} · {daysLabel(schedule.daysOfWeek)} · from{" "}
            {new Date(schedule.startDate).toLocaleDateString()}
            {schedule.endDate ? ` to ${new Date(schedule.endDate).toLocaleDateString()}` : " · ongoing"}
          </p>
          {schedule.remindersEnabled === false && (
            <p className="text-xs text-amber-800">Notifications off — doses still show here.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-capsule px-3 py-1 text-xs font-medium ${STATUS_STYLE[schedule.status]}`}>{schedule.status}</span>
          {editable && !editing && (
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </Button>
          )}
          {schedule.status === "ACTIVE" && (
            <Button variant="secondary" onClick={() => statusMutation.mutate("PAUSED")} disabled={busy}>
              Pause
            </Button>
          )}
          {schedule.status === "PAUSED" && (
            <Button onClick={() => statusMutation.mutate("ACTIVE")} disabled={busy}>
              Resume
            </Button>
          )}
          {editable && (
            <Button variant="ghost" onClick={() => statusMutation.mutate("CANCELLED")} disabled={busy}>
              Discontinue
            </Button>
          )}
        </div>
      </div>

      {editable && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={schedule.remindersEnabled !== false}
            disabled={busy}
            onChange={(e) => editMutation.mutate({ remindersEnabled: e.target.checked })}
          />
          Send reminder notifications
        </label>
      )}

      {editing && (
        <div className="mt-4 flex flex-col gap-4 rounded-xl bg-mint/30 p-4 text-sm">
          <div className="flex flex-col gap-2">
            <span className="font-medium">Times</span>
            <div className="flex flex-wrap items-center gap-2">
              {times.map((time, i) => (
                <span key={i} className="flex items-center gap-1">
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTimes((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))}
                    className="field w-32"
                    aria-label={`Reminder time ${i + 1}`}
                  />
                  {times.length > 1 && (
                    <button type="button" className="text-xs underline" onClick={() => setTimes((prev) => prev.filter((_, j) => j !== i))}>
                      remove
                    </button>
                  )}
                </span>
              ))}
              <button
                type="button"
                className="rounded-xl border border-dashed border-charcoal/25 px-3 py-1.5 text-charcoal/70 hover:border-forest"
                onClick={() => setTimes((prev) => [...prev, ""])}
              >
                + add time
              </button>
            </div>
          </div>
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
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              Last day (empty = ongoing)
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="field" />
            </label>
            <label className="flex flex-col gap-1">
              Dose each time
              <input value={doseAmount} onChange={(e) => setDoseAmount(e.target.value)} className="field w-40" />
            </label>
          </div>
          <p className="text-xs text-charcoal/70">
            Saving changes upcoming doses only. Doses already taken, missed or skipped stay in your history.
          </p>
          <div className="flex gap-3">
            <Button
              disabled={busy || times.length === 0 || times.some((t) => !t)}
              onClick={() =>
                editMutation.mutate({
                  slots: times.map((timeOfDay) => ({ timeOfDay })),
                  daysOfWeek: days,
                  endDate: endDate || null,
                  doseAmount: doseAmount.trim() || null,
                })
              }
            >
              {editMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {(statusMutation.isError || editMutation.isError) && (
        <p className="mt-3 text-sm text-red-700">{((statusMutation.error ?? editMutation.error) as Error).message}</p>
      )}
    </div>
  );
}
