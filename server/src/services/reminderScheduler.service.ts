import { prisma } from "@/db/prisma";
import { env } from "@/config/env";
import { sendReminderEmail, EmailProviderNotConfiguredError, currentEmailProviderName } from "@/services/notifications/emailService";
import { topUpReminders } from "@/services/schedule.service";

// The server-side reminder scheduler. This is the "real" delivery
// mechanism required by the brief — not a frontend timer, not a static
// dashboard. It is:
//
//   - Persistent: every reminder and every delivery attempt is a
//     PostgreSQL row (Reminder / ReminderDelivery). There is no in-memory
//     queue that would be lost on restart.
//   - Restart-safe: on boot, the very next tick re-scans for due
//     reminders from the database exactly as it would mid-session — there
//     is no "catch-up" logic to get wrong because there was never
//     anything to lose.
//   - Duplicate-safe: a `(reminderId, channel)` unique constraint on
//     ReminderDelivery means at most one delivery ROW can ever exist per
//     reminder per channel; once that row reaches SENT, every later tick
//     skips it.
//   - Retry-aware: a transient failure increments `attempts` and stays
//     PENDING (retried next tick) until REMINDER_EMAIL_MAX_ATTEMPTS is
//     reached, at which point it becomes a terminal FAILED row — visible
//     in history, never retried forever.
//   - Honest when unconfigured: EMAIL_PROVIDER=none causes every attempt
//     to resolve as SKIPPED_NOT_CONFIGURED, never SENT.
//
// It intentionally only ever reminds about a dose that is still PENDING
// (not yet marked taken/missed) on a schedule that is still ACTIVE — a
// paused/cancelled schedule's reminders were already marked SKIPPED by
// schedule.service.ts and won't be picked up here.

export interface ReminderSchedulerRunResult {
  attempted: number;
  sent: number;
  failed: number;
  skippedNotConfigured: number;
  skippedDisabled: number;
}

// A reminder more than this late is not worth sending: "take your 8 AM
// dose" arriving the next day is noise, not help. It also bounds how far
// back each tick has to look.
const MAX_DELIVERY_LATENESS_MS = 24 * 60 * 60 * 1000;

export async function processDueReminders(now: Date = new Date()): Promise<ReminderSchedulerRunResult> {
  const result: ReminderSchedulerRunResult = { attempted: 0, sent: 0, failed: 0, skippedNotConfigured: 0, skippedDisabled: 0 };

  const dueReminders = await prisma.reminder.findMany({
    where: {
      status: "PENDING",
      scheduledFor: { lte: now, gte: new Date(now.getTime() - MAX_DELIVERY_LATENESS_MS) },
      scheduleSlot: { schedule: { status: "ACTIVE" } },
    },
    include: {
      deliveries: true,
      scheduleSlot: {
        include: {
          schedule: {
            include: { medication: true, user: { select: { id: true, email: true, fullName: true } } },
          },
        },
      },
    },
  });

  for (const reminder of dueReminders) {
    const existingDelivery = reminder.deliveries.find((d) => d.channel === "EMAIL");

    // Terminal states are never retried. SKIPPED_NOT_CONFIGURED is
    // terminal too: re-checking a dose every tick for a channel that
    // doesn't exist only rewrites the same row, and if email is set up
    // later a reminder for an already-passed dose is no longer useful.
    if (
      existingDelivery?.status === "SENT" ||
      existingDelivery?.status === "FAILED" ||
      existingDelivery?.status === "SKIPPED_DISABLED" ||
      existingDelivery?.status === "SKIPPED_NOT_CONFIGURED"
    ) {
      continue;
    }

    const schedule = reminder.scheduleSlot.schedule;

    // A dose whose time had already passed when the schedule was created
    // (e.g. this morning's dose on a schedule set up this afternoon) is
    // listed so it can be marked taken, but is never notified.
    if (reminder.scheduledFor < schedule.createdAt) {
      continue;
    }

    // The user turned notifications off for this schedule: record that
    // explicitly, once, rather than sending — or pretending to.
    if (!schedule.remindersEnabled) {
      await prisma.reminderDelivery.upsert({
        where: { reminderId_channel: { reminderId: reminder.id, channel: "EMAIL" } },
        create: { reminderId: reminder.id, channel: "EMAIL", status: "SKIPPED_DISABLED", lastAttemptAt: now },
        update: { status: "SKIPPED_DISABLED", lastAttemptAt: now },
      });
      result.skippedDisabled += 1;
      continue;
    }

    result.attempted += 1;
    const medication = schedule.medication;
    const user = schedule.user;
    const attemptsSoFar = existingDelivery?.attempts ?? 0;

    // Atomic claim via upsert rather than find-then-create: this process
    // is the ONLY single scheduler instance in this deployment (see
    // startReminderScheduler — one process, one setInterval), so the race
    // this guards against is narrow (e.g. two ticks overlapping if a tick
    // somehow ran long), but upsert costs nothing extra and removes a
    // crash that a naive find-then-create would otherwise hit via the
    // (reminderId, channel) unique constraint. Running multiple scheduler
    // instances concurrently (horizontal scaling) would need a proper
    // claim/lock step beyond this — not needed for the current
    // single-instance design, but worth knowing before scaling out.
    const deliveryRow = await prisma.reminderDelivery.upsert({
      where: { reminderId_channel: { reminderId: reminder.id, channel: "EMAIL" } },
      create: { reminderId: reminder.id, channel: "EMAIL", status: "PENDING", attempts: 0 },
      update: {},
    });

    try {
      await sendReminderEmail({
        to: user.email,
        subject: `Reminder: ${medication.confirmedName ?? "medication"} is due`,
        text: buildReminderEmailText({
          fullName: user.fullName,
          medicationName: medication.confirmedName,
          doseAmount: schedule.doseAmount,
          dosageInstructions: medication.confirmedDosageInstructions,
          timeOfDay: reminder.scheduleSlot.timeOfDay,
        }),
      });

      await prisma.reminderDelivery.update({
        where: { id: deliveryRow.id },
        data: { status: "SENT", provider: currentEmailProviderName(), deliveredAt: new Date(), attempts: attemptsSoFar + 1, lastAttemptAt: new Date(), errorMessage: null },
      });
      result.sent += 1;
    } catch (err) {
      if (err instanceof EmailProviderNotConfiguredError) {
        await prisma.reminderDelivery.update({
          where: { id: deliveryRow.id },
          data: { status: "SKIPPED_NOT_CONFIGURED", provider: currentEmailProviderName(), lastAttemptAt: new Date() },
        });
        result.skippedNotConfigured += 1;
        continue;
      }

      const nextAttempts = attemptsSoFar + 1;
      const message = err instanceof Error ? err.message : "Unknown delivery error.";
      const giveUp = nextAttempts >= env.reminderEmailMaxAttempts;

      await prisma.reminderDelivery.update({
        where: { id: deliveryRow.id },
        data: {
          status: giveUp ? "FAILED" : "PENDING",
          provider: currentEmailProviderName(),
          attempts: nextAttempts,
          lastAttemptAt: new Date(),
          errorMessage: message,
        },
      });
      if (giveUp) result.failed += 1;
    }
  }

  return result;
}

function buildReminderEmailText(input: {
  fullName: string;
  medicationName: string | null;
  doseAmount: string | null;
  dosageInstructions: string | null;
  timeOfDay: string;
}): string {
  const lines = [
    `Hi ${input.fullName},`,
    "",
    `This is a reminder for your ${input.timeOfDay} dose of ${input.medicationName ?? "your medication"}` +
      (input.doseAmount ? ` (${input.doseAmount}).` : "."),
  ];
  if (input.dosageInstructions) {
    lines.push(`Instructions: ${input.dosageInstructions}`);
  }
  lines.push("", "This tool does not replace your doctor or pharmacist.");
  return lines.join("\n");
}

let schedulerHandle: ReturnType<typeof setInterval> | null = null;

/** Starts the periodic scan. Call once from server.ts — never during tests (call processDueReminders directly there instead). */
// The rolling window top-up only needs to run a few times a day.
const TOP_UP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastTopUpAt = 0;
let tickRunning = false;

async function tick() {
  // Never let two ticks overlap (a slow SMTP server could otherwise make
  // the next interval start before this one finished).
  if (tickRunning) return;
  tickRunning = true;
  try {
    if (Date.now() - lastTopUpAt >= TOP_UP_INTERVAL_MS) {
      await topUpReminders();
      lastTopUpAt = Date.now();
    }
    await processDueReminders();
  } finally {
    tickRunning = false;
  }
}

export function startReminderScheduler(): void {
  if (schedulerHandle) return;
  const intervalMs = env.reminderSchedulerIntervalSeconds * 1000;
  const run = () =>
    tick().catch((err) => {
      console.error("[reminder scheduler] tick failed:", err instanceof Error ? err.message : err);
    });
  run();
  schedulerHandle = setInterval(run, intervalMs);
  // Don't let this timer keep the process alive on its own during shutdown.
  schedulerHandle.unref?.();
}

export function stopReminderScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}
