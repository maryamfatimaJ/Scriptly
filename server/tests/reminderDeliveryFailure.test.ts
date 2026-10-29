import { afterAll, describe, expect, it, vi } from "vitest";

// Mocked at the top of the file (vitest hoists vi.mock calls) so every
// call to sendReminderEmail in this file throws a generic, transient-style
// error — simulating a real SMTP failure (timeout, rejected recipient,
// auth hiccup) without needing a real mail server. Kept in its own file,
// separate from reminderDelivery.test.ts, so this mock doesn't affect the
// tests there that rely on the real NoopEmailProvider's
// EmailProviderNotConfiguredError behavior.
vi.mock("@/services/notifications/emailService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/notifications/emailService")>();
  return {
    ...actual,
    sendReminderEmail: vi.fn().mockRejectedValue(new Error("Simulated transient SMTP failure (connection timed out)")),
    currentEmailProviderName: () => "smtp-mock",
  };
});

import { prisma } from "@/db/prisma";
import { env } from "@/config/env";
import { processDueReminders } from "@/services/reminderScheduler.service";
import { AuthedAgent, closeServer, getServer, uniqueTestUser, uploadExtractAndConfirmAmoxicillin } from "./helpers/testClient";

describe("reminder scheduler — delivery failure and retry exhaustion", () => {
  const server = getServer();
  afterAll(() => closeServer());

  it("retries a failed send and gives up (terminal FAILED) only after REMINDER_EMAIL_MAX_ATTEMPTS", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("deliveryfail"));
    const { medicationId } = await uploadExtractAndConfirmAmoxicillin(user);
    const today = new Date().toISOString().slice(0, 10);
    const createRes = await user.post("/api/schedule", {
      medicationId,
      startDate: today,
      slots: [{ timeOfDay: "08:00" }],
    });
    const reminderId = createRes.body.schedule.slots[0].reminders[0].id;
    await prisma.reminder.update({ where: { id: reminderId }, data: { scheduledFor: new Date(Date.now() - 60_000) } });
    // The schedule must predate the dose — see reminderDelivery.test.ts.
    await prisma.schedule.update({
      where: { id: createRes.body.schedule.id },
      data: { createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    // Every call simulates one scheduler tick. Each failed attempt must
    // increment `attempts` and record the error, staying PENDING (so the
    // next tick retries) until the configured max is reached.
    //
    // NOTE: assertions below check this specific reminder's delivery row,
    // not processDueReminders()'s aggregate counts — the scheduler
    // correctly scans the *entire* reminders table (as it must in
    // production), and this suite's many test files share one persistent
    // dev database across repeated runs, so aggregate counts reflect
    // whatever else happens to be due at the moment, not just this test's
    // own data.
    for (let tick = 1; tick < env.reminderEmailMaxAttempts; tick++) {
      await processDueReminders();

      const delivery = await prisma.reminderDelivery.findUnique({
        where: { reminderId_channel: { reminderId, channel: "EMAIL" } },
      });
      expect(delivery?.status).toBe("PENDING");
      expect(delivery?.attempts).toBe(tick);
      expect(delivery?.errorMessage).toContain("Simulated transient SMTP failure");
    }

    // The attempt that reaches the configured max gives up permanently.
    await processDueReminders();

    const finalDelivery = await prisma.reminderDelivery.findUnique({
      where: { reminderId_channel: { reminderId, channel: "EMAIL" } },
    });
    expect(finalDelivery?.status).toBe("FAILED");
    expect(finalDelivery?.attempts).toBe(env.reminderEmailMaxAttempts);

    // A FAILED delivery is terminal — further ticks must not keep retrying
    // (no silent infinite-retry loop, and no attempts counter creeping
    // past the configured max).
    await processDueReminders();
    const afterGivingUp = await prisma.reminderDelivery.findUnique({
      where: { reminderId_channel: { reminderId, channel: "EMAIL" } },
    });
    expect(afterGivingUp?.attempts).toBe(env.reminderEmailMaxAttempts);
    expect(afterGivingUp?.status).toBe("FAILED");
  });
});
