import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import request from "supertest";
import type { Server } from "node:http";
import { prisma } from "@/db/prisma";
import { AuthedAgent, closeServer, getServer, uniqueTestUser, uploadExtractAndConfirmAmoxicillin } from "./helpers/testClient";

// Deleting medicines and prescriptions: ownership, cascades to schedules
// and reminders, persistence (a deleted record stays deleted on re-fetch),
// and nothing unrelated removed.

let server: Server;
let owner: AuthedAgent;
let stranger: AuthedAgent;

beforeAll(async () => {
  server = getServer();
  owner = await AuthedAgent.register(server, uniqueTestUser("delete_owner"));
  stranger = await AuthedAgent.register(server, uniqueTestUser("delete_stranger"));
});

afterAll(async () => {
  await closeServer();
});

async function addManualMedicineWithSchedule(user: AuthedAgent, name: string) {
  const created = await user.post("/api/medications", {
    name,
    dosageInstructions: "1 tablet",
    frequency: "twice daily",
  });
  expect(created.status).toBe(201);
  const medicationId = created.body.medication.id as string;
  const schedule = await user.post("/api/schedule", {
    medicationId,
    startDate: new Date().toISOString().slice(0, 10),
    slots: [{ timeOfDay: "08:00" }, { timeOfDay: "20:00" }],
  });
  expect(schedule.status).toBe(201);
  return medicationId;
}

describe("deleting a medicine", () => {
  it("requires authentication", async () => {
    const res = await request(server).delete("/api/medications/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(401);
  });

  it("refuses another user's medicine and leaves it untouched", async () => {
    const medicationId = await addManualMedicineWithSchedule(owner, "Ownership Check");
    const res = await stranger.delete(`/api/medications/${medicationId}`);
    expect(res.status).toBe(404);
    expect(await prisma.medication.count({ where: { id: medicationId } })).toBe(1);
  });

  it("removes the medicine with its schedules and reminders, and it stays removed", async () => {
    const keepId = await addManualMedicineWithSchedule(owner, "Keep Me");
    const medicationId = await addManualMedicineWithSchedule(owner, "Delete Me");
    const scheduleIds = (await prisma.schedule.findMany({ where: { medicationId }, select: { id: true } })).map((s) => s.id);
    expect(await prisma.reminder.count({ where: { scheduleSlot: { scheduleId: { in: scheduleIds } } } })).toBeGreaterThan(0);

    const res = await owner.delete(`/api/medications/${medicationId}`);
    expect(res.status).toBe(204);

    // As a page refresh would see it.
    const list = await owner.get("/api/medications");
    const ids = list.body.medications.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(medicationId);
    expect(ids).toContain(keepId);
    expect(await prisma.schedule.count({ where: { id: { in: scheduleIds } } })).toBe(0);
    expect(await prisma.reminder.count({ where: { scheduleSlot: { scheduleId: { in: scheduleIds } } } })).toBe(0);
    // The unrelated medicine and its reminders are untouched.
    expect(await prisma.reminder.count({ where: { scheduleSlot: { schedule: { medicationId: keepId } } } })).toBeGreaterThan(0);

    // Deleting again is a clear 404, not a silent success.
    expect((await owner.delete(`/api/medications/${medicationId}`)).status).toBe(404);
  });
});

describe("deleting a prescription", () => {
  it("refuses another user's prescription", async () => {
    const { prescriptionId } = await uploadExtractAndConfirmAmoxicillin(owner);
    expect((await stranger.delete(`/api/prescriptions/${prescriptionId}`)).status).toBe(404);
    expect(await prisma.prescription.count({ where: { id: prescriptionId } })).toBe(1);
  });

  it("removes the prescription, its medicines, events and image file, and it stays removed", async () => {
    const { prescriptionId } = await uploadExtractAndConfirmAmoxicillin(owner);
    const { imagePath } = await prisma.prescription.findUniqueOrThrow({ where: { id: prescriptionId } });
    expect(fs.existsSync(imagePath)).toBe(true);
    expect(await prisma.medication.count({ where: { prescriptionId } })).toBeGreaterThan(0);

    const res = await owner.delete(`/api/prescriptions/${prescriptionId}`);
    expect(res.status).toBe(204);

    expect((await owner.get(`/api/prescriptions/${prescriptionId}`)).status).toBe(404);
    const list = await owner.get("/api/prescriptions");
    expect(list.body.prescriptions.map((p: { id: string }) => p.id)).not.toContain(prescriptionId);
    expect(await prisma.medication.count({ where: { prescriptionId } })).toBe(0);
    expect(await prisma.prescriptionEvent.count({ where: { prescriptionId } })).toBe(0);
    expect(fs.existsSync(imagePath)).toBe(false);
  });
});
