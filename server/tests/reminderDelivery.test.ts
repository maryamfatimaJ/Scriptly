import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import { processDueReminders } from "@/services/reminderScheduler.service";
import { AuthedAgent, closeServer, getServer, uniqueTestUser, uploadExtractAndConfirmAmoxicillin } from "./helpers/testClient";

// The scheduler itself is a background process with no HTTP endpoint, so
// these tests call `processDueReminders()` directly — exactly what the
// setInterval loop in reminderScheduler.service.ts calls on every tick.
// Reminders are always created in the future by the normal API flow, so a
// reminder is "backdated" directly via Prisma to simulate time having
// passed — this is the same thing a real server restart + elapsed time
// would produce, just without waiting for it.
describe("reminder scheduler (processDueReminders)", () => {
  const server = getServer();
  afterAll(() => closeServer());

  async function activateScheduleAndBackdateReminder(user: AuthedAgent, minutesAgo = 60) {
    const { medicationId } = await uploadExtractAndConfirmAmoxicillin(user);
    const today = new Date().toISOString().slice(0, 10);
    const createRes = await user.post("/api/schedule", {
      medicationId,
      startDate: today,
      slots: [{ timeOfDay: "08:00", label: "Morning" }],
    });
    const scheduleId = createRes.body.schedule.id as string;
    const reminder = createRes.body.schedule.slots[0].reminders[0];

    await prisma.reminder.update({
      where: { id: reminder.id },
      data: { scheduledFor: new Date(Date.now() - minutesAgo * 60 * 1000) },
    });
    // The scheduler never notifies a dose that was already past when its
    // schedule was created, so the schedule must predate the dose too.
    await prisma.schedule.update({ where: { id: scheduleId }, data: { createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });

    return { scheduleId, reminderId: reminder.id as string };
  }

  it("marks a due reminder's email delivery as SKIPPED_NOT_CONFIGURED when EMAIL_PROVIDER=none (never a false 'sent')", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("schedulernone"));
    const { reminderId } = await activateScheduleAndBackdateReminder(user);

    const result = await processDueReminders();
    expect(result.attempted).toBeGreaterThan(0);
    expect(result.sent).toBe(0);
    expect(result.skippedNotConfigured).toBeGreaterThan(0);

    const delivery = await prisma.reminderDelivery.findUnique({
      where: { reminderId_channel: { reminderId, channel: "EMAIL" } },
    });
    expect(delivery?.status).toBe("SKIPPED_NOT_CONFIGURED");
    expect(delivery?.deliveredAt).toBeNull();
  });

  it("is idempotent across repeated ticks — never creates a second delivery row for the same reminder", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("schedulerrepeat"));
    const { reminderId } = await activateScheduleAndBackdateReminder(user);

    await processDueReminders();
    await processDueReminders();
    await processDueReminders();

    const deliveries = await prisma.reminderDelivery.findMany({ where: { reminderId, channel: "EMAIL" } });
    expect(deliveries.length).toBe(1);
  });

  it("is restart-safe: a fresh call with no in-memory state still finds and processes the same due reminder", async () => {
    // There's no actual process restart to simulate here, but the point is
    // that processDueReminders() takes no state from a previous call — it
    // re-derives everything from the database every time, which is what
    // makes "restart-safe" true rather than aspirational.
    const user = await AuthedAgent.register(server, uniqueTestUser("schedulerrestart"));
    const { reminderId } = await activateScheduleAndBackdateReminder(user);

    const firstRun = await processDueReminders();
    expect(firstRun.attempted).toBeGreaterThan(0);

    const delivery = await prisma.reminderDelivery.findUnique({
      where: { reminderId_channel: { reminderId, channel: "EMAIL" } },
    });
    expect(delivery).not.toBeNull();
  });

  it("does not attempt delivery for a dose already marked TAKEN", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("schedulertaken"));
    const { reminderId } = await activateScheduleAndBackdateReminder(user);

    await user.patch(`/api/reminders/${reminderId}`, { status: "TAKEN" });
    await processDueReminders();

    const delivery = await prisma.reminderDelivery.findUnique({
      where: { reminderId_channel: { reminderId, channel: "EMAIL" } },
    });
    expect(delivery).toBeNull();
  });

  it("does not attempt delivery for a reminder on a paused schedule", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("schedulerpaused"));
    const { scheduleId, reminderId } = await activateScheduleAndBackdateReminder(user);

    // This reminder is already in the past, so pausing won't mark it
    // SKIPPED (pause only skips *future* pending reminders) — it stays
    // PENDING, and the scheduler must still leave it alone because its
    // schedule is no longer ACTIVE.
    await user.patch(`/api/schedule/${scheduleId}`, { status: "PAUSED" });
    await processDueReminders();

    const delivery = await prisma.reminderDelivery.findUnique({
      where: { reminderId_channel: { reminderId, channel: "EMAIL" } },
    });
    expect(delivery).toBeNull();
  });
});

describe("reminder status corrections", () => {
  const server = getServer();

  it("allows correcting a mistaken TAKEN mark back to PENDING, and logs the correction", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("correction"));
    const { medicationId, prescriptionId } = await uploadExtractAndConfirmAmoxicillin(user);
    const today = new Date().toISOString().slice(0, 10);
    const createRes = await user.post("/api/schedule", {
      medicationId,
      startDate: today,
      slots: [{ timeOfDay: "08:00" }],
    });
    const reminderId = createRes.body.schedule.slots[0].reminders[0].id;

    const takenRes = await user.patch(`/api/reminders/${reminderId}`, { status: "TAKEN" });
    expect(takenRes.status).toBe(200);
    expect(takenRes.body.reminder.respondedAt).not.toBeNull();

    const correctedRes = await user.patch(`/api/reminders/${reminderId}`, { status: "PENDING" });
    expect(correctedRes.status).toBe(200);
    expect(correctedRes.body.reminder.status).toBe("PENDING");
    expect(correctedRes.body.reminder.respondedAt).toBeNull();

    const events = await user.get(`/api/prescriptions/${prescriptionId}/events`);
    const reminderEvents = events.body.events.filter((e: { eventType: string }) => e.eventType === "REMINDER_UPDATED");
    expect(reminderEvents.length).toBe(2);
    expect(reminderEvents[1].metadata.previousStatus).toBe("TAKEN");
    expect(reminderEvents[1].metadata.newStatus).toBe("PENDING");
  });

  it("rejects correcting a reminder that belongs to another user", async () => {
    const owner = await AuthedAgent.register(server, uniqueTestUser("reminderowner"));
    const intruder = await AuthedAgent.register(server, uniqueTestUser("reminderintruder"));
    const { medicationId } = await uploadExtractAndConfirmAmoxicillin(owner);
    const createRes = await owner.post("/api/schedule", {
      medicationId,
      startDate: new Date().toISOString().slice(0, 10),
      slots: [{ timeOfDay: "08:00" }],
    });
    const reminderId = createRes.body.schedule.slots[0].reminders[0].id;

    const res = await intruder.patch(`/api/reminders/${reminderId}`, { status: "TAKEN" });
    expect(res.status).toBe(404);
  });
});
