import { DateTime } from "luxon";
import { prisma } from "@/db/prisma";
import { AppError } from "@/utils/AppError";
import { suggestScheduleFromFrequency } from "@/utils/frequencyParser";
import { planSchedule } from "@/utils/schedulePlanner";
import type { CreateScheduleInput, EditScheduleInput } from "@/validation/schedule.schema";
import type { ScheduleStatus } from "@prisma/client";

// Reminders are materialized up to this many days ahead at creation,
// resume and edit time. topUpReminders() (run by the reminder scheduler)
// rolls the window forward for long-running and open-ended schedules.
const MAX_GENERATED_DAYS = 30;

async function getUserTimezone(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return user?.timezone ?? "UTC";
}

// ---------------------------------------------------------------------------
// Schedule preview — derived from CONFIRMED instructions only, never a
// guess. Returns a suggested slot *count*/labels, not exact times; the
// user always supplies the actual clock times before activation.
// ---------------------------------------------------------------------------

export async function getScheduleSuggestion(userId: string, medicationId: string) {
  const medication = await prisma.medication.findFirst({ where: { id: medicationId, userId } });
  if (!medication) throw AppError.notFound("Medication not found.");

  if (medication.reviewStatus !== "CONFIRMED") {
    throw AppError.unprocessable(
      "This medication's instructions must be confirmed before a schedule can be previewed."
    );
  }

  const suggestion = suggestScheduleFromFrequency(medication.confirmedFrequency);
  // The full proposal: times with their basis, dose, duration and every
  // reason the user must decide something before saving.
  const proposal = planSchedule({
    frequency: medication.confirmedFrequency,
    timing: medication.confirmedTiming,
    dosageInstructions: medication.confirmedDosageInstructions,
    durationDays: medication.confirmedDurationDays,
  });

  const timezone = await getUserTimezone(userId);
  const today = DateTime.now().setZone(timezone);
  const startDate = today.toISODate()!;
  // A course of N days runs today plus N-1 more days, inclusive.
  const endDate = proposal.durationDays ? today.plus({ days: proposal.durationDays - 1 }).toISODate()! : null;
  const nowTime = today.toFormat("HH:mm");
  const passedToday = proposal.slots.filter((slot) => slot.timeOfDay <= nowTime).map((slot) => slot.timeOfDay);

  return {
    medicationId: medication.id,
    confirmedName: medication.confirmedName,
    confirmedFrequency: medication.confirmedFrequency,
    confirmedTiming: medication.confirmedTiming,
    confirmedDosageInstructions: medication.confirmedDosageInstructions,
    confirmedDurationDays: medication.confirmedDurationDays,
    ...suggestion,
    proposal: {
      ...proposal,
      startDate,
      endDate,
      timezone,
      // Times already past when the schedule starts today: they appear in
      // today's list so a dose already taken can be marked, but no
      // notification is ever sent for them.
      passedToday,
    },
  };
}

// ---------------------------------------------------------------------------
// Activation — the explicit, separate step. Re-validates the confirmed
// status server-side (never trusts that the preview step having been
// shown means the medication is still confirmed/unchanged).
// ---------------------------------------------------------------------------

export async function createSchedule(userId: string, input: CreateScheduleInput) {
  const medication = await prisma.medication.findFirst({ where: { id: input.medicationId, userId } });
  if (!medication) throw AppError.notFound("Medication not found.");

  // Hard rule: never schedule/remind for instructions that haven't been
  // confirmed by a human reviewer. This is enforced here, not just in the
  // UI, so no client bug or direct API call can bypass it. Re-checked here
  // even though the preview step already checked it — activation is a
  // separate request and the medication's status could have changed
  // between the two (e.g. another tab rejected it).
  if (medication.reviewStatus !== "CONFIRMED") {
    throw AppError.unprocessable(
      "This medication's instructions must be confirmed before a schedule can be created."
    );
  }

  if (input.endDate && input.endDate < input.startDate) {
    throw AppError.badRequest("The end date can't be before the start date.");
  }

  const timezone = await getUserTimezone(userId);
  const daysOfWeek = normalizeDays(input.daysOfWeek);

  const schedule = await prisma.schedule.create({
    data: {
      medicationId: medication.id,
      userId,
      startDate: input.startDate,
      endDate: input.endDate,
      notes: input.notes,
      doseAmount: input.doseAmount,
      daysOfWeek,
      remindersEnabled: input.remindersEnabled ?? true,
      slots: {
        create: dedupeSlots(input.slots).map((slot) => ({ timeOfDay: slot.timeOfDay, label: slot.label })),
      },
    },
    include: { slots: true },
  });

  const windowEnd =
    input.endDate && input.endDate < addDays(new Date(), MAX_GENERATED_DAYS) ? input.endDate : addDays(new Date(), MAX_GENERATED_DAYS);

  const reminderRows = buildReminderRows(schedule.slots, input.startDate, windowEnd, timezone, daysOfWeek);

  if (reminderRows.length > 0) {
    await prisma.reminder.createMany({ data: reminderRows, skipDuplicates: true });
  }

  if (medication.prescriptionId) {
    await prisma.prescriptionEvent.create({
      data: {
        prescriptionId: medication.prescriptionId,
        userId,
        eventType: "SCHEDULE_CREATED",
        metadata: { scheduleId: schedule.id, reminderCount: reminderRows.length, timezone } as object,
      },
    });
  }

  return getScheduleById(userId, schedule.id);
}

/** ISO weekdays, sorted and unique. All seven (or none) means every day. */
function normalizeDays(days: number[] | undefined): number[] {
  const unique = [...new Set(days ?? [])].filter((d) => d >= 1 && d <= 7).sort();
  return unique.length === 7 ? [] : unique;
}

/** Two slots at the same time would mean two reminders for one dose. */
function dedupeSlots<T extends { timeOfDay: string }>(slots: T[]): T[] {
  const seen = new Set<string>();
  return slots.filter((slot) => (seen.has(slot.timeOfDay) ? false : (seen.add(slot.timeOfDay), true)));
}

/**
 * Edits an existing schedule: its times, days, end date, dose, notes, and
 * whether notifications are sent.
 *
 * Doses already in the past are never touched — taken, missed and skipped
 * doses stay in the history exactly as they were. Only FUTURE, still-open
 * doses are replaced: they are deleted and regenerated from the edited
 * schedule. Future doses have not been delivered (delivery happens when a
 * dose comes due), so this cannot discard a sent notification, and the
 * (slot, time) unique constraint plus skipDuplicates means regeneration
 * can never create a second dose for the same time.
 *
 * A removed time's slot is deactivated, not deleted, so its past doses
 * keep their history.
 */
export async function editSchedule(userId: string, scheduleId: string, input: EditScheduleInput) {
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, userId },
    include: { slots: true, medication: true },
  });
  if (!schedule) throw AppError.notFound("Schedule not found.");
  if (schedule.status === "CANCELLED" || schedule.status === "COMPLETED") {
    throw AppError.unprocessable(`A ${schedule.status.toLowerCase()} schedule can't be edited. Create a new one instead.`);
  }

  const endDate = input.endDate === undefined ? schedule.endDate : input.endDate;
  if (endDate && endDate < schedule.startDate) {
    throw AppError.badRequest("The end date can't be before the schedule's start date.");
  }

  const now = new Date();
  const timezone = await getUserTimezone(userId);
  const daysOfWeek = input.daysOfWeek === undefined ? schedule.daysOfWeek : normalizeDays(input.daysOfWeek);
  // While paused, regenerated future doses are created as SKIPPED — the
  // state pausing leaves them in — so resuming restores them.
  const openStatus = schedule.status === "PAUSED" ? "SKIPPED" : "PENDING";

  await prisma.$transaction(async (tx) => {
    if (input.slots) {
      const wanted = dedupeSlots(input.slots);
      const wantedTimes = new Set(wanted.map((s) => s.timeOfDay));

      for (const slot of schedule.slots) {
        if (slot.active && !wantedTimes.has(slot.timeOfDay)) {
          await tx.scheduleSlot.update({ where: { id: slot.id }, data: { active: false } });
        }
      }
      for (const { timeOfDay, label } of wanted) {
        const existing = schedule.slots.find((s) => s.timeOfDay === timeOfDay);
        if (existing) {
          await tx.scheduleSlot.update({ where: { id: existing.id }, data: { active: true, label: label ?? existing.label } });
        } else {
          await tx.scheduleSlot.create({ data: { scheduleId, timeOfDay, label } });
        }
      }
    }

    await tx.schedule.update({
      where: { id: scheduleId },
      data: {
        endDate,
        daysOfWeek,
        doseAmount: input.doseAmount === undefined ? schedule.doseAmount : input.doseAmount,
        notes: input.notes === undefined ? schedule.notes : input.notes,
        remindersEnabled: input.remindersEnabled ?? schedule.remindersEnabled,
      },
    });

    // Replace the future, still-open doses with ones built from the edit.
    await tx.reminder.deleteMany({
      where: { scheduleSlot: { scheduleId }, scheduledFor: { gt: now }, status: openStatus, respondedAt: null },
    });

    const activeSlots = await tx.scheduleSlot.findMany({ where: { scheduleId, active: true } });
    const windowEnd = endDate && endDate < addDays(now, MAX_GENERATED_DAYS) ? endDate : addDays(now, MAX_GENERATED_DAYS);
    const from = schedule.startDate > now ? schedule.startDate : now;
    const rows = buildReminderRows(activeSlots, from, windowEnd, timezone, daysOfWeek)
      .filter((row) => row.scheduledFor > now)
      .map((row) => ({ ...row, status: openStatus as "PENDING" | "SKIPPED" }));
    if (rows.length > 0) await tx.reminder.createMany({ data: rows, skipDuplicates: true });
  });

  if (schedule.medication.prescriptionId) {
    await prisma.prescriptionEvent.create({
      data: {
        prescriptionId: schedule.medication.prescriptionId,
        userId,
        eventType: "SCHEDULE_UPDATED",
        metadata: { scheduleId, changed: Object.keys(input) } as object,
      },
    });
  }

  return getScheduleById(userId, scheduleId);
}

/**
 * Rolls every ACTIVE schedule's generated window forward to
 * MAX_GENERATED_DAYS ahead, and marks schedules whose end date has passed
 * as COMPLETED. Idempotent: it only ever adds missing doses
 * (skipDuplicates on the unique (slot, time) key), so it can run as often
 * as the scheduler likes.
 */
export async function topUpReminders(now: Date = new Date()) {
  const completed = await prisma.schedule.updateMany({
    where: { status: "ACTIVE", endDate: { lt: addDays(now, -1) } },
    data: { status: "COMPLETED" },
  });

  const schedules = await prisma.schedule.findMany({
    where: { status: "ACTIVE", OR: [{ endDate: null }, { endDate: { gte: addDays(now, -1) } }] },
    include: { slots: { where: { active: true } }, user: { select: { timezone: true } } },
  });

  let created = 0;
  for (const schedule of schedules) {
    const windowEnd =
      schedule.endDate && schedule.endDate < addDays(now, MAX_GENERATED_DAYS) ? schedule.endDate : addDays(now, MAX_GENERATED_DAYS);
    const from = schedule.startDate > now ? schedule.startDate : now;
    const rows = buildReminderRows(schedule.slots, from, windowEnd, schedule.user.timezone ?? "UTC", schedule.daysOfWeek).filter(
      (row) => row.scheduledFor > now
    );
    if (rows.length > 0) {
      const result = await prisma.reminder.createMany({ data: rows, skipDuplicates: true });
      created += result.count;
    }
  }
  return { completedSchedules: completed.count, remindersCreated: created };
}

export async function getScheduleById(userId: string, scheduleId: string) {
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, userId },
    include: {
      slots: { where: { active: true }, include: { reminders: { include: { deliveries: true } } } },
      medication: true,
    },
  });
  if (!schedule) throw AppError.notFound("Schedule not found.");
  return schedule;
}

export async function listSchedules(userId: string) {
  return prisma.schedule.findMany({
    where: { userId },
    include: { medication: true, slots: { where: { active: true }, orderBy: { timeOfDay: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

// Allowed manual transitions. COMPLETED is a system/terminal status, not
// something a user sets directly.
const ALLOWED_TRANSITIONS: Record<ScheduleStatus, ScheduleStatus[]> = {
  ACTIVE: ["PAUSED", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  CANCELLED: [],
  COMPLETED: [],
};

export async function updateScheduleStatus(userId: string, scheduleId: string, nextStatus: "ACTIVE" | "PAUSED" | "CANCELLED") {
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, userId },
    include: { slots: true, medication: true },
  });
  if (!schedule) throw AppError.notFound("Schedule not found.");

  if (schedule.status === nextStatus) {
    return getScheduleById(userId, scheduleId);
  }

  if (!ALLOWED_TRANSITIONS[schedule.status].includes(nextStatus)) {
    throw AppError.unprocessable(`Cannot change a ${schedule.status.toLowerCase()} schedule to ${nextStatus.toLowerCase()}.`);
  }

  const now = new Date();
  let affectedReminders = 0;

  if (nextStatus === "PAUSED" || nextStatus === "CANCELLED") {
    // Discontinuing a schedule must not leave future reminders pending —
    // they're marked SKIPPED (preserved for history), not deleted.
    const result = await prisma.reminder.updateMany({
      where: {
        scheduleSlotId: { in: schedule.slots.map((s) => s.id) },
        status: "PENDING",
        scheduledFor: { gt: now },
      },
      data: { status: "SKIPPED" },
    });
    affectedReminders = result.count;
  }

  if (nextStatus === "ACTIVE" && schedule.status === "PAUSED") {
    // Resuming reverses exactly what pausing did: pausing only ever
    // changed a future PENDING reminder's status to SKIPPED (it never
    // deleted or created rows), so resuming un-skips those same rows
    // rather than inserting new ones alongside them — which would
    // otherwise show as two entries for the same time on the Schedule
    // page (one SKIPPED, one freshly PENDING). An earlier version of this
    // did exactly that (regenerate-and-dedup-by-existence), which
    // silently left every previously-skipped future day stuck as
    // permanently skipped, since "a reminder already exists for this
    // slot+day" was true regardless of its SKIPPED status — caught via
    // manual QA of the actual Schedule page, not a unit test.
    const unskipped = await prisma.reminder.updateMany({
      where: {
        scheduleSlotId: { in: schedule.slots.map((s) => s.id) },
        status: "SKIPPED",
        scheduledFor: { gt: now },
      },
      data: { status: "PENDING" },
    });

    // Separately, extend coverage for any slot/day in the forward window
    // that has no reminder row at all yet — e.g. the pause lasted long
    // enough that the original generation window (capped at
    // MAX_GENERATED_DAYS from creation time) no longer reaches
    // MAX_GENERATED_DAYS from "now". This only adds rows where none
    // exist; it never duplicates the ones just un-skipped above.
    const timezone = await getUserTimezone(userId);
    const windowEnd =
      schedule.endDate && schedule.endDate < addDays(now, MAX_GENERATED_DAYS) ? schedule.endDate : addDays(now, MAX_GENERATED_DAYS);
    const activeSlots = schedule.slots.filter((s) => s.active);
    const candidateRows = buildReminderRows(activeSlots, now, windowEnd, timezone, schedule.daysOfWeek).filter(
      (r) => r.scheduledFor >= now
    );

    // skipDuplicates against the (slot, time) unique key: rows that
    // already exist (including the ones just un-skipped) are left alone.
    const inserted =
      candidateRows.length > 0 ? await prisma.reminder.createMany({ data: candidateRows, skipDuplicates: true }) : { count: 0 };
    affectedReminders = unskipped.count + inserted.count;
  }

  await prisma.schedule.update({ where: { id: scheduleId }, data: { status: nextStatus } });

  if (schedule.medication.prescriptionId) {
    await prisma.prescriptionEvent.create({
      data: {
        prescriptionId: schedule.medication.prescriptionId,
        userId,
        eventType: "SCHEDULE_STATUS_CHANGED",
        metadata: { scheduleId, from: schedule.status, to: nextStatus, affectedReminders } as object,
      },
    });
  }

  return getScheduleById(userId, scheduleId);
}

// ---------------------------------------------------------------------------
// Reading reminders for the dashboard — day or week view, always computed
// in the user's own timezone (day boundaries differ by timezone, so this
// cannot be done with the server's local time or raw UTC midnight).
// ---------------------------------------------------------------------------

function summarizeDelivery(deliveries: { channel: string; status: string; deliveredAt: Date | null }[]) {
  const email = deliveries.find((d) => d.channel === "EMAIL");
  if (!email) return { emailStatus: "NOT_ATTEMPTED" as const, emailDeliveredAt: null };
  return { emailStatus: email.status, emailDeliveredAt: email.deliveredAt };
}

type ReminderWithContext = Awaited<ReturnType<typeof fetchReminders>>[number];

const DUE_WINDOW_MS = 2 * 60 * 60 * 1000;

function toReminderView(reminder: ReminderWithContext) {
  const now = new Date();
  const beforeSchedule = reminder.scheduledFor < reminder.scheduleSlot.schedule.createdAt;
  const isOpen = reminder.status === "PENDING" && !beforeSchedule;
  return {
    id: reminder.id,
    scheduledFor: reminder.scheduledFor,
    status: reminder.status,
    respondedAt: reminder.respondedAt,
    // "due" = time has passed and the dose hasn't been marked either way yet.
    // This is distinct from delivery: it's true even with no email channel
    // configured at all, since it reflects the in-app view, not a push.
    // Only a recent dose is "due now"; an older unmarked one is overdue.
    // A dose whose time had already passed when the schedule was created
    // is neither — the person was never asked to take it.
    due: isOpen && reminder.scheduledFor <= now && now.getTime() - reminder.scheduledFor.getTime() <= DUE_WINDOW_MS,
    overdue: isOpen && !beforeSchedule && now.getTime() - reminder.scheduledFor.getTime() > DUE_WINDOW_MS,
    beforeSchedule,
    timeOfDay: reminder.scheduleSlot.timeOfDay,
    label: reminder.scheduleSlot.label,
    medicationId: reminder.scheduleSlot.schedule.medicationId,
    medicationName: reminder.scheduleSlot.schedule.medication.confirmedName,
    dosageInstructions: reminder.scheduleSlot.schedule.medication.confirmedDosageInstructions,
    scheduleId: reminder.scheduleSlot.schedule.id,
    scheduleStatus: reminder.scheduleSlot.schedule.status,
    ...summarizeDelivery(reminder.deliveries),
  };
}

export async function getScheduleForDate(userId: string, date: string | undefined) {
  const timezone = await getUserTimezone(userId);
  const target = date ? DateTime.fromISO(date, { zone: timezone }) : DateTime.now().setZone(timezone);
  const dayStart = target.startOf("day").toUTC().toJSDate();
  const dayEnd = target.endOf("day").toUTC().toJSDate();

  const reminders = await fetchReminders(userId, dayStart, dayEnd);
  return reminders.map(toReminderView);
}

export async function getScheduleForWeek(userId: string, date: string | undefined) {
  const timezone = await getUserTimezone(userId);
  const target = date ? DateTime.fromISO(date, { zone: timezone }) : DateTime.now().setZone(timezone);
  const weekStart = target.startOf("week");
  const weekEnd = target.endOf("week");

  const reminders = await fetchReminders(userId, weekStart.toUTC().toJSDate(), weekEnd.toUTC().toJSDate());
  const byDate: Record<string, ReturnType<typeof toReminderView>[]> = {};
  for (const reminder of reminders) {
    const view = toReminderView(reminder);
    const localDate = DateTime.fromJSDate(reminder.scheduledFor, { zone: "utc" }).setZone(timezone).toISODate()!;
    (byDate[localDate] ??= []).push(view);
  }
  return byDate;
}

async function fetchReminders(userId: string, from: Date, to: Date) {
  return prisma.reminder.findMany({
    where: {
      scheduledFor: { gte: from, lte: to },
      scheduleSlot: { schedule: { userId } },
    },
    include: {
      deliveries: true,
      scheduleSlot: {
        include: { schedule: { include: { medication: true } } },
      },
    },
    orderBy: { scheduledFor: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Date/time helpers
// ---------------------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function* eachCalendarDay(start: Date, end: Date, timezone: string) {
  let cursor = DateTime.fromJSDate(start, { zone: "utc" }).setZone(timezone).startOf("day");
  const last = DateTime.fromJSDate(end, { zone: "utc" }).setZone(timezone).startOf("day");
  while (cursor <= last) {
    yield cursor;
    cursor = cursor.plus({ days: 1 });
  }
}

/** Combines a calendar day with an "HH:mm" time-of-day IN THE USER'S TIMEZONE, returning the correct UTC instant (DST-aware via Luxon). */
function combineDateAndTime(day: DateTime, timeOfDay: string, timezone: string): Date {
  const [hour, minute] = timeOfDay.split(":").map(Number);
  return day.setZone(timezone).set({ hour, minute, second: 0, millisecond: 0 }).toUTC().toJSDate();
}

function buildReminderRows(
  slots: { id: string; timeOfDay: string }[],
  start: Date,
  end: Date,
  timezone: string,
  /** ISO weekdays (1 = Monday … 7 = Sunday); empty means every day. */
  daysOfWeek: number[] = []
): { scheduleSlotId: string; scheduledFor: Date }[] {
  const rows: { scheduleSlotId: string; scheduledFor: Date }[] = [];
  for (const slot of slots) {
    for (const day of eachCalendarDay(start, end, timezone)) {
      if (daysOfWeek.length > 0 && !daysOfWeek.includes(day.weekday)) continue;
      rows.push({ scheduleSlotId: slot.id, scheduledFor: combineDateAndTime(day, slot.timeOfDay, timezone) });
    }
  }
  return rows;
}
