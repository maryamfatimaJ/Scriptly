import { afterAll, describe, expect, it } from "vitest";
import { AuthedAgent, closeServer, getServer, TINY_JPEG, uniqueTestUser, uploadExtractAndConfirmAmoxicillin } from "./helpers/testClient";

// Covers the schedule preview -> explicit activation -> pause/resume/cancel
// lifecycle, and the core safety rule re-verified at every layer: no
// schedule or reminder may ever be created from an unconfirmed medication.
describe("schedule preview, activation, and lifecycle", () => {
  const server = getServer();
  afterAll(() => closeServer());

  describe("schedule preview", () => {
    it("blocks previewing a schedule for an unconfirmed medication", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("previewblock"));
      const upload = await user.uploadPrescription(TINY_JPEG, "x.jpg", "image/jpeg");
      const extracted = await user.post(`/api/prescriptions/${upload.body.prescription.id}/extract`);
      const medicationId = extracted.body.prescription.medications[0].id;

      const res = await user.get(`/api/medications/${medicationId}/schedule-preview`);
      expect(res.status).toBe(422);
    });

    it("suggests a slot count derived from the confirmed frequency, never inventing exact times", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("previewok"));
      const { medicationId } = await uploadExtractAndConfirmAmoxicillin(user);

      const res = await user.get(`/api/medications/${medicationId}/schedule-preview`);
      expect(res.status).toBe(200);
      expect(res.body.preview.suggestedSlotCount).toBe(3); // "3x daily"
      expect(res.body.preview.requiresManualTiming).toBe(false);
      // The preview is a structural hint, never actual clock times.
      expect(res.body.preview).not.toHaveProperty("scheduledFor");
      expect(res.body.preview).not.toHaveProperty("times");
    });

    it("flags an as-needed (PRN) frequency as requiring manual timing, not a guessed routine", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("previewprn"));
      const upload = await user.uploadPrescription(TINY_JPEG, "x.jpg", "image/jpeg");
      const extracted = await user.post(`/api/prescriptions/${upload.body.prescription.id}/extract`);
      const paracetamol = extracted.body.prescription.medications.find((m: { extractedName: string }) => m.extractedName === "Paracetamol");

      await user.patch(`/api/medications/${paracetamol.id}`, {
        reviewStatus: "CONFIRMED",
        confirmedName: "Paracetamol",
        confirmedDosageInstructions: "Take 1-2 tablets as needed for pain",
        confirmedFrequency: "as needed",
      });

      const res = await user.get(`/api/medications/${paracetamol.id}/schedule-preview`);
      expect(res.status).toBe(200);
      expect(res.body.preview.suggestedSlotCount).toBeNull();
      expect(res.body.preview.requiresManualTiming).toBe(true);
    });
  });

  describe("activation", () => {
    it("still refuses to activate a schedule for an unconfirmed medication, even calling the API directly", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("directactivate"));
      const upload = await user.uploadPrescription(TINY_JPEG, "x.jpg", "image/jpeg");
      const extracted = await user.post(`/api/prescriptions/${upload.body.prescription.id}/extract`);
      const medicationId = extracted.body.prescription.medications[0].id;

      const res = await user.post("/api/schedule", {
        medicationId,
        startDate: new Date().toISOString().slice(0, 10),
        slots: [{ timeOfDay: "08:00", label: "Morning" }],
      });
      expect(res.status).toBe(422);
    });

    it("does not create any reminders at extraction time — only explicit activation does", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("noreminderatextract"));
      await uploadExtractAndConfirmAmoxicillin(user);

      // Nothing has been activated yet; today's schedule must be empty.
      const today = new Date().toISOString().slice(0, 10);
      const res = await user.get(`/api/schedule?date=${today}`);
      expect(res.status).toBe(200);
      expect(res.body.reminders).toEqual([]);
    });

    it("activates a schedule with user-supplied times and creates reminders", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("activate"));
      const { medicationId } = await uploadExtractAndConfirmAmoxicillin(user);

      const today = new Date().toISOString().slice(0, 10);
      const res = await user.post("/api/schedule", {
        medicationId,
        startDate: today,
        slots: [
          { timeOfDay: "08:00", label: "Morning" },
          { timeOfDay: "14:00", label: "Afternoon" },
          { timeOfDay: "20:00", label: "Evening" },
        ],
      });
      expect(res.status).toBe(201);
      expect(res.body.schedule.status).toBe("ACTIVE");

      const scheduleRes = await user.get(`/api/schedule?date=${today}`);
      expect(scheduleRes.body.reminders.length).toBe(3);
      expect(scheduleRes.body.reminders.every((r: { status: string }) => r.status === "PENDING")).toBe(true);
    });
  });

  describe("pause / resume / cancel", () => {
    async function activateSchedule(user: AuthedAgent) {
      const { medicationId } = await uploadExtractAndConfirmAmoxicillin(user);
      const today = new Date().toISOString().slice(0, 10);
      const res = await user.post("/api/schedule", {
        medicationId,
        startDate: today,
        slots: [{ timeOfDay: "08:00", label: "Morning" }],
      });
      return res.body.schedule.id as string;
    }

    it("pausing cancels future pending reminders but keeps them visible (SKIPPED, not deleted)", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("pause"));
      const scheduleId = await activateSchedule(user);

      const res = await user.patch(`/api/schedule/${scheduleId}`, { status: "PAUSED" });
      expect(res.status).toBe(200);
      expect(res.body.schedule.status).toBe("PAUSED");

      const futureReminders = res.body.schedule.slots.flatMap((s: { reminders: { scheduledFor: string; status: string }[] }) => s.reminders);
      const future = futureReminders.filter((r: { scheduledFor: string }) => new Date(r.scheduledFor) > new Date());
      expect(future.length).toBeGreaterThan(0);
      expect(future.every((r: { status: string }) => r.status === "SKIPPED")).toBe(true);
    });

    it("cancelling is terminal — cannot be reactivated", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("cancel"));
      const scheduleId = await activateSchedule(user);

      await user.patch(`/api/schedule/${scheduleId}`, { status: "CANCELLED" });
      const reactivate = await user.patch(`/api/schedule/${scheduleId}`, { status: "ACTIVE" });
      expect(reactivate.status).toBe(422);
    });

    it("resuming a paused schedule regenerates future reminders without duplicating existing ones", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("resume"));
      const scheduleId = await activateSchedule(user);

      await user.patch(`/api/schedule/${scheduleId}`, { status: "PAUSED" });
      const resumed = await user.patch(`/api/schedule/${scheduleId}`, { status: "ACTIVE" });
      expect(resumed.status).toBe(200);
      expect(resumed.body.schedule.status).toBe("ACTIVE");

      const allReminders = resumed.body.schedule.slots.flatMap((s: { reminders: unknown[] }) => s.reminders);
      // One per slot per day across the generation window — just assert
      // there are no exact-duplicate (scheduledFor) entries, which would
      // indicate double-booking.
      //
      // Regression test: this caught a real bug where resuming after the
      // slot's time-of-day had already passed today (e.g. an "08:00" slot,
      // resumed at 2pm) recreated an exact duplicate of today's original
      // reminder — the dedup check was wrongly scoped to `scheduledFor >=
      // now`, which excludes the original (now-past) reminder from the
      // "already exists" set. Fixed in schedule.service.ts::updateScheduleStatus.
      const scheduledTimes = allReminders.map((r: { scheduledFor: string }) => r.scheduledFor);
      expect(new Set(scheduledTimes).size).toBe(scheduledTimes.length);

      // The actual point of "resume": future reminders that pausing marked
      // SKIPPED must come back as PENDING, not stay permanently skipped.
      // This specifically failed before the fix — the dedup-by-existence
      // approach counted an existing SKIPPED row as "already there" and
      // never un-skipped it, so every future day stayed stuck as skipped
      // forever even after resuming.
      const now = new Date();
      const futureReminders = allReminders.filter((r: { scheduledFor: string }) => new Date(r.scheduledFor) > now);
      expect(futureReminders.length).toBeGreaterThan(0);
      expect(futureReminders.every((r: { status: string }) => r.status === "PENDING")).toBe(true);
    });

    it("rejects an unauthorized user's attempt to change someone else's schedule", async () => {
      const owner = await AuthedAgent.register(server, uniqueTestUser("scheduleowner"));
      const intruder = await AuthedAgent.register(server, uniqueTestUser("scheduleintruder"));
      const scheduleId = await activateSchedule(owner);

      const res = await intruder.patch(`/api/schedule/${scheduleId}`, { status: "CANCELLED" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/schedule/list", () => {
    it("lists only the current user's schedules", async () => {
      const userA = await AuthedAgent.register(server, uniqueTestUser("listSchedA"));
      const userB = await AuthedAgent.register(server, uniqueTestUser("listSchedB"));
      const { medicationId } = await uploadExtractAndConfirmAmoxicillin(userA);
      await userA.post("/api/schedule", {
        medicationId,
        startDate: new Date().toISOString().slice(0, 10),
        slots: [{ timeOfDay: "09:00" }],
      });

      const listB = await userB.get("/api/schedule/list");
      expect(listB.body.schedules).toEqual([]);

      const listA = await userA.get("/api/schedule/list");
      expect(listA.body.schedules.length).toBe(1);
    });
  });
});
