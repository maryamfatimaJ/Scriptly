import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/StatusBadge";
import * as scheduleApi from "@/api/schedule";
import type { ScheduleReminder } from "@/types";

const EMAIL_STATUS_LABEL: Record<string, string> = {
  NOT_ATTEMPTED: "",
  PENDING: "Email queued",
  SENT: "Emailed",
  FAILED: "Email delivery failed",
  SKIPPED_NOT_CONFIGURED: "Email reminders not yet configured",
  SKIPPED_DISABLED: "Notifications off for this medicine",
};

export function ReminderRow({ reminder, queryKey }: { reminder: ScheduleReminder; queryKey: unknown[] }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status: Parameters<typeof scheduleApi.updateReminder>[1]) => scheduleApi.updateReminder(reminder.id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const emailLabel = EMAIL_STATUS_LABEL[reminder.emailStatus] ?? "";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 ${
        reminder.due ? "border-forest/40 bg-mint/30" : "border-charcoal/10"
      }`}
    >
      <div>
        <p className="flex items-center gap-2 text-sm text-gray">
          {reminder.timeOfDay}
          {reminder.due && <span className="rounded-capsule bg-forest px-2 py-0.5 text-[11px] font-medium text-offwhite">Due now</span>}
          {reminder.overdue && <span className="text-[11px] font-medium text-charcoal/70">Not marked yet</span>}
          {reminder.beforeSchedule && <span className="text-[11px] text-gray">Before this schedule started</span>}
        </p>
        <p className="font-display text-lg">{reminder.medicationName ?? "Medication"}</p>
        {reminder.dosageInstructions && <p className="text-sm text-charcoal/70">{reminder.dosageInstructions}</p>}
        {emailLabel && <p className="mt-1 text-xs text-gray">{emailLabel}</p>}
      </div>

      <div className="flex items-center gap-3">
        <StatusBadge status={reminder.status} />
        {reminder.status === "PENDING" ? (
          <div className="flex gap-2">
            <Button onClick={() => mutation.mutate("TAKEN")} disabled={mutation.isPending}>
              Mark taken
            </Button>
            <Button variant="secondary" onClick={() => mutation.mutate("MISSED")} disabled={mutation.isPending}>
              Missed
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => mutation.mutate("PENDING")} disabled={mutation.isPending}>
            Undo
          </Button>
        )}
      </div>
    </div>
  );
}
