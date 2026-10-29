import { prisma } from "@/db/prisma";
import { AppError } from "@/utils/AppError";
import type { UpdateReminderInput } from "@/validation/reminder.schema";

export async function updateReminder(userId: string, reminderId: string, input: UpdateReminderInput) {
  const reminder = await prisma.reminder.findFirst({
    where: { id: reminderId, scheduleSlot: { schedule: { userId } } },
    include: { scheduleSlot: { include: { schedule: { include: { medication: true } } } } },
  });
  if (!reminder) throw AppError.notFound("Reminder not found.");

  const previousStatus = reminder.status;

  const updated = await prisma.reminder.update({
    where: { id: reminderId },
    data: {
      status: input.status,
      // Resetting to PENDING is a correction ("I marked that by mistake")
      // — respondedAt is cleared to reflect that the dose is, once again,
      // not yet responded to. Any other status records when the user
      // responded.
      respondedAt: input.status === "PENDING" ? null : new Date(),
    },
  });

  // Every change is logged with its previous value — this is what makes
  // "allow corrections while maintaining a meaningful event history" true:
  // the correction itself becomes a visible event, not a silent overwrite.
  // The event log is per prescription; a manually added medication has
  // none, and its dose status on the reminder row is the record.
  const prescriptionId = reminder.scheduleSlot.schedule.medication.prescriptionId;
  if (prescriptionId) {
    await prisma.prescriptionEvent.create({
      data: {
        prescriptionId,
        userId,
        eventType: "REMINDER_UPDATED",
        metadata: {
          reminderId,
          previousStatus,
          newStatus: input.status,
          isCorrection: previousStatus !== "PENDING" && input.status !== previousStatus,
        } as object,
      },
    });
  }

  return updated;
}
