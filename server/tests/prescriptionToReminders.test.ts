import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { Prisma } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { env } from "@/config/env";
import { setVisionClientForTests } from "@/services/extraction/AnthropicVisionProvider";
import { validateExtractionConfig } from "@/services/extraction/extractionService";
import { processDueReminders } from "@/services/reminderScheduler.service";
import { topUpReminders } from "@/services/schedule.service";
import { planSchedule } from "@/utils/schedulePlanner";
import { lookupPrice } from "@/services/medicineInfo/price.service";
import { parseCsv, validateRow } from "../scripts/importPrices";
import { AuthedAgent, closeServer, getServer, uniqueTestUser } from "./helpers/testClient";

// ===========================================================================
// MOCKED VISION MODEL — nothing in this file calls a real AI provider.
//
// The Claude vision client is replaced with a scripted fake so the
// pipeline AROUND the model can be tested offline and deterministically:
// image preparation, the model-capability check, schema validation and
// the parser's provenance rules, error classification and retry, what is
// persisted, and everything downstream (review, approval, schedules,
// reminders, prices). Real-image extraction against the real API is
// scripts/extractionLive.ts, reported separately.
// ===========================================================================

const server = getServer();
afterAll(() => closeServer());

type VisionPayload = Record<string, unknown>;
function fakeVisionClient(options: {
  imageInput?: boolean;
  respond?: () => VisionPayload;
  fail?: () => Error;
}) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    models: {
      retrieve: async () => ({ capabilities: { image_input: { supported: options.imageInput ?? true } } }),
    },
    messages: {
      create: async (params: Record<string, unknown>) => {
        calls.push(params);
        if (options.fail) throw options.fail();
        return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(options.respond!()) }] };
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const fieldMap = (value: unknown) =>
  Object.fromEntries(
    ["name", "brand", "genericName", "strength", "form", "route", "dosageInstructions", "frequency", "timing", "durationDays", "quantity", "instructions"].map(
      (f) => [f, value]
    )
  );

function medication(overrides: Record<string, unknown> = {}, sources: Record<string, string> = {}) {
  return {
    name: "Augmentin",
    brand: "Augmentin",
    genericName: "amoxicillin and clavulanic acid",
    strength: "625 mg",
    form: "tablet",
    route: null,
    dosageInstructions: "1 tab",
    frequency: "BD",
    timing: "after meals",
    durationDays: 5,
    quantity: "10 tabs",
    instructions: null,
    confidence: 0.92,
    // Real models report 0 confidence for fields that aren't written.
    fieldConfidence: { ...fieldMap(0.9), route: 0, instructions: 0 },
    fieldSource: { ...fieldMap("READ"), route: "NOT_VISIBLE", instructions: "NOT_VISIBLE", genericName: "INFERRED", ...sources },
    warnings: [],
    ...overrides,
  };
}

let realImage: Buffer;
beforeAll(async () => {
  // A real, decodable image (blank page) — the TINY_JPEG fixture is only
  // a file signature and can't be opened by an image library.
  realImage = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#ffffff" } }).png().toBuffer();
});

const savedProvider = env.aiProvider;
afterEach(() => {
  env.aiProvider = savedProvider;
  setVisionClientForTests(null);
});

async function uploadAndExtractWith(user: AuthedAgent, fake: ReturnType<typeof fakeVisionClient>) {
  env.aiProvider = "anthropic";
  setVisionClientForTests(fake.client);
  const upload = await user.uploadPrescription(realImage, "rx.png", "image/png");
  const id = upload.body.prescription.id as string;
  const extracted = await user.post(`/api/prescriptions/${id}/extract`);
  return { id, extracted };
}

describe("[mocked model] configuration", () => {
  it("refuses the mock provider outside automated tests", () => {
    const savedNodeEnv = env.nodeEnv;
    env.nodeEnv = "development";
    env.aiProvider = "mock";
    try {
      expect(() => validateExtractionConfig()).toThrow(/automated tests/);
    } finally {
      env.nodeEnv = savedNodeEnv;
    }
  });

  it("refuses to start with no provider chosen", () => {
    env.aiProvider = "";
    expect(() => validateExtractionConfig()).toThrow(/AI_PROVIDER is not set/);
  });
});

describe("[mocked model] Claude vision extraction", () => {
  it("sends the actual image to the model and persists every extracted field with its provenance", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("visionok"));
    const fake = fakeVisionClient({
      respond: () => ({ medications: [medication()], legibility: "GOOD", overallConfidence: 0.9, overallWarnings: [], rawNotes: null }),
    });
    const { extracted } = await uploadAndExtractWith(user, fake);

    expect(extracted.status).toBe(200);
    // The request carried the uploaded image, base64, with a schema.
    const content = (fake.calls[0].messages as Array<{ content: Array<{ type: string; source?: { data: string } }> }>)[0].content;
    const image = content.find((block) => block.type === "image")!;
    expect(Buffer.from(image.source!.data, "base64").subarray(1, 4).toString()).toBe("PNG");
    expect((fake.calls[0].output_config as { format: { type: string } }).format.type).toBe("json_schema");

    const med = extracted.body.prescription.medications[0];
    expect(extracted.body.prescription.aiProvider).toBe("anthropic");
    expect(extracted.body.prescription.extractionLegibility).toBe("GOOD");
    expect(med.extractedName).toBe("Augmentin");
    expect(med.extractedTiming).toBe("after meals");
    expect(med.extractedQuantity).toBe("10 tabs");
    expect(med.extractedDurationDays).toBe(5);
    // Active ingredient inferred from the written brand: allowed, and labelled as such.
    expect(med.extractedGenericName).toBe("amoxicillin and clavulanic acid");
    expect(med.extractionFieldSource.genericName).toBe("INFERRED");
    expect(med.reviewStatus).toBe("NEEDS_REVIEW");
    // Fields correctly reported as not written are not "low-confidence
    // reads" — regression for the noise found in live testing.
    expect(med.extractionWarnings).toEqual([]);
  });

  it("discards an INFERRED dose instruction — only the active ingredient may be inferred", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("visioninfer"));
    const fake = fakeVisionClient({
      respond: () => ({
        medications: [medication({ frequency: "twice daily" }, { frequency: "INFERRED" })],
        legibility: "GOOD",
        overallConfidence: 0.9,
        overallWarnings: [],
        rawNotes: null,
      }),
    });
    const { extracted } = await uploadAndExtractWith(user, fake);
    const med = extracted.body.prescription.medications[0];
    expect(med.extractedFrequency).toBeNull();
    expect(med.extractionWarnings.some((w: { field: string; severity: string }) => w.field === "frequency" && w.severity === "critical")).toBe(true);
  });

  it("keeps an UNCERTAIN name as the visible text, flagged critical, never 'corrected'", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("visionuncertain"));
    const fake = fakeVisionClient({
      respond: () => ({
        medications: [
          medication(
            { name: "Amox...", brand: null, genericName: null, confidence: 0.4, warnings: [{ field: "name", severity: "critical", message: "Second half of the name is smudged." }] },
            { name: "UNCERTAIN", brand: "NOT_VISIBLE", genericName: "NOT_VISIBLE" }
          ),
        ],
        legibility: "POOR",
        overallConfidence: 0.35,
        overallWarnings: [],
        rawNotes: null,
      }),
    });
    const { extracted } = await uploadAndExtractWith(user, fake);
    const prescription = extracted.body.prescription;
    expect(prescription.medications[0].extractedName).toBe("Amox...");
    expect(prescription.medications[0].extractionWarnings[0].message).toMatch(/smudged/);
    // A mostly unreadable page earns its own critical, page-level warning.
    expect(prescription.extractionOverallWarnings[0].severity).toBe("critical");
  });

  it("refuses a model without image input before sending the image", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("visiontextonly"));
    const fake = fakeVisionClient({ imageInput: false, respond: () => ({}) });
    const { extracted } = await uploadAndExtractWith(user, fake);
    expect(extracted.status).toBe(503);
    expect(extracted.body.error.details.kind).toBe("NOT_CONFIGURED");
    expect(fake.calls).toHaveLength(0);
  });

  it("reports quota exhaustion honestly and lets the user retry the same prescription", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("visionquota"));
    const billing = () =>
      new Anthropic.BadRequestError(400, { type: "error", error: { type: "billing_error" } }, "credit balance too low", new Headers(), "billing_error" as never);
    const { id, extracted } = await uploadAndExtractWith(user, fakeVisionClient({ fail: billing }));

    expect(extracted.status).toBe(503);
    expect(extracted.body.error.details.kind).toBe("QUOTA_EXHAUSTED");
    expect(extracted.body.error.message).toMatch(/quota|credit/i);
    expect(extracted.body.error.message).not.toMatch(/credit balance too low/); // upstream text never forwarded
    const after = await user.get(`/api/prescriptions/${id}`);
    expect(after.body.prescription.status).toBe("NEEDS_CLARIFICATION");
    expect(after.body.prescription.medications).toHaveLength(0); // no demo or partial data

    // Retry once the provider is healthy again.
    setVisionClientForTests(
      fakeVisionClient({ respond: () => ({ medications: [medication()], legibility: "GOOD", overallConfidence: 0.9, overallWarnings: [], rawNotes: null }) }).client
    );
    const retry = await user.post(`/api/prescriptions/${id}/extract`);
    expect(retry.status).toBe(200);
    expect(retry.body.prescription.medications).toHaveLength(1);
  });

  it("maps a rate limit to a retryable 429", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("visionrate"));
    const { extracted } = await uploadAndExtractWith(
      user,
      fakeVisionClient({ fail: () => new Anthropic.RateLimitError(429, {}, "rate limited", new Headers()) })
    );
    expect(extracted.status).toBe(429);
    expect(extracted.body.error.details).toEqual({ kind: "RATE_LIMITED", retryable: true });
  });

  it("rejects a file that is not really the image type it claims", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("signature"));
    const res = await user.uploadPrescription(Buffer.from("%PDF-1.7 not an image"), "rx.png", "image/png");
    expect(res.status).toBe(400);
  });
});

describe("schedule planner (no model involved)", () => {
  const plan = (frequency: string | null, timing: string | null = null, dosage: string | null = "1 tablet", days: number | null = 5) =>
    planSchedule({ frequency, timing, dosageInstructions: dosage, durationDays: days });

  it("reads BD + 'after breakfast and dinner' as two meal-anchored doses", () => {
    const p = plan("BD", "after breakfast and dinner");
    expect(p.status).toBe("READY");
    expect(p.slots.map((s) => s.label)).toEqual(["After breakfast", "After dinner"]);
    expect(p.slots.every((s) => s.basis === "WRITTEN_ANCHOR")).toBe(true);
    expect(p.doseAmount).toBe("1 tablet");
  });

  it("reads the 1+0+1 dose-position notation as morning and night", () => {
    const p = plan("1+0+1");
    expect(p.slots.map((s) => s.label)).toEqual(["Morning", "Night"]);
    expect(p.slots.every((s) => s.basis === "WRITTEN_ANCHOR")).toBe(true);
  });

  it("labels evenly spaced times as suggestions when only TDS is written", () => {
    const p = plan("TDS");
    expect(p.dosesPerDay).toBe(3);
    expect(p.status).toBe("NEEDS_TIME_CONFIRMATION");
    expect(p.slots.every((s) => s.basis === "SUGGESTED")).toBe(true);
  });

  it("uses clock times exactly when they are written", () => {
    const p = plan("twice daily", "at 7 am and 7 pm");
    expect(p.slots.map((s) => s.timeOfDay)).toEqual(["07:00", "19:00"]);
    expect(p.slots.every((s) => s.basis === "WRITTEN_TIME")).toBe(true);
  });

  it("refuses to schedule contradictory instructions", () => {
    const p = plan("once daily", null, "1 tab three times a day");
    expect(p.status).toBe("NEEDS_CLARIFICATION");
    expect(p.slots).toHaveLength(0);
    expect(p.issues[0].message).toMatch(/disagree/);
  });

  it("refuses when the meal timing names more meals than the frequency allows", () => {
    expect(plan("OD", "after breakfast and dinner").status).toBe("NEEDS_CLARIFICATION");
  });

  it("never schedules an as-needed medicine", () => {
    expect(plan("SOS").status).toBe("NEEDS_CLARIFICATION");
  });

  it("asks rather than guessing when no frequency is written", () => {
    const p = plan(null, null, null);
    expect(p.status).toBe("NEEDS_CLARIFICATION");
  });

  it("never invents a duration — it asks for one", () => {
    const p = plan("BD", "after breakfast and dinner", "1 tablet", null);
    expect(p.status).toBe("NEEDS_TIME_CONFIRMATION");
    expect(p.durationDays).toBeNull();
    expect(p.issues.some((i) => /No duration/.test(i.message))).toBe(true);
  });
});

describe("[mocked model] review, approval and the completion summary", () => {
  it("saves confirmed medicines, leaves an uncertain one out of everything, and reports it as outstanding", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("summary"));
    const fake = fakeVisionClient({
      respond: () => ({
        medications: [medication(), medication({ name: "Pana...", brand: null, genericName: null }, { name: "UNCERTAIN" })],
        legibility: "PARTIAL",
        overallConfidence: 0.7,
        overallWarnings: [],
        rawNotes: null,
      }),
    });
    const { id, extracted } = await uploadAndExtractWith(user, fake);
    // Same-transaction rows tie on createdAt and are ordered by a random
    // id, so pick them out by name rather than position.
    const meds = extracted.body.prescription.medications as Array<{ id: string; extractedName: string }>;
    const augmentin = meds.find((m) => m.extractedName === "Augmentin")!;
    const uncertain = meds.find((m) => m.extractedName === "Pana...")!;

    // Nothing can be approved while a medicine is undecided.
    expect((await user.post(`/api/prescriptions/${id}/approve`)).status).toBe(422);

    await user.patch(`/api/medications/${augmentin.id}`, {
      reviewStatus: "CONFIRMED",
      confirmedName: "Augmentin",
      confirmedStrength: "625 mg",
      confirmedForm: "tablet",
      confirmedDosageInstructions: "1 tab",
      confirmedFrequency: "BD",
      confirmedTiming: "after meals",
      confirmedDurationDays: 5,
    });
    await user.patch(`/api/medications/${uncertain.id}`, { reviewStatus: "NEEDS_CLARIFICATION", reviewNotes: "Ask pharmacist" });
    expect((await user.post(`/api/prescriptions/${id}/approve`)).status).toBe(200);

    // The planner's proposal for the confirmed medicine.
    const preview = await user.get(`/api/medications/${augmentin.id}/schedule-preview`);
    expect(preview.body.preview.proposal.dosesPerDay).toBe(2);
    expect(preview.body.preview.proposal.endDate).toBeTruthy();

    await user.post("/api/schedule", {
      medicationId: augmentin.id,
      startDate: preview.body.preview.proposal.startDate,
      endDate: preview.body.preview.proposal.endDate,
      slots: preview.body.preview.proposal.slots.map((s: { timeOfDay: string; label: string }) => ({ timeOfDay: s.timeOfDay, label: s.label })),
      doseAmount: "1 tab",
    });
    // The uncertain one can't be scheduled.
    const blocked = await user.post("/api/schedule", { medicationId: uncertain.id, startDate: "2026-01-01", slots: [{ timeOfDay: "09:00" }] });
    expect(blocked.status).toBe(422);

    const summary = await user.get(`/api/prescriptions/${id}/summary`);
    expect(summary.status).toBe(200);
    expect(summary.body.medicines).toHaveLength(1);
    expect(summary.body.medicines[0].schedules[0].times).toHaveLength(2);
    expect(summary.body.medicines[0].price.status).toBe("UNAVAILABLE");
    expect(summary.body.outstanding[0].name).toBe("Pana...");
    expect(summary.body.outstanding[0].reason).toMatch(/Ask pharmacist/);
    expect(summary.body.reminderDelivery.emailConfigured).toBe(false);

    // The uncertain medicine can still be resolved after approval; a confirmed one is frozen.
    expect((await user.patch(`/api/medications/${uncertain.id}`, { reviewStatus: "REJECTED" })).status).toBe(200);
    expect((await user.patch(`/api/medications/${augmentin.id}`, { reviewStatus: "REJECTED" })).status).toBe(409);

    // Another user sees nothing.
    const other = await AuthedAgent.register(server, uniqueTestUser("summaryother"));
    expect((await other.get(`/api/prescriptions/${id}/summary`)).status).toBe(404);
  });
});

describe("manual medicines and schedule editing", () => {
  async function manualSchedule(user: AuthedAgent, slots: string[]) {
    const created = await user.post("/api/medications", {
      name: "Metformin",
      strength: "500 mg",
      form: "tablet",
      dosageInstructions: "1 tablet",
      frequency: "twice daily",
    });
    expect(created.status).toBe(201);
    expect(created.body.medication.source).toBe("MANUAL");
    expect(created.body.medication.prescriptionId).toBeNull();
    const today = new Date().toISOString().slice(0, 10);
    const schedule = await user.post("/api/schedule", {
      medicationId: created.body.medication.id,
      startDate: today,
      slots: slots.map((timeOfDay) => ({ timeOfDay })),
      doseAmount: "1 tablet",
    });
    expect(schedule.status).toBe(201);
    return { medicationId: created.body.medication.id as string, scheduleId: schedule.body.schedule.id as string };
  }

  const countReminders = (scheduleId: string) => prisma.reminder.count({ where: { scheduleSlot: { scheduleId } } });

  it("creates a medicine and schedule without any prescription", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("manual"));
    const { scheduleId } = await manualSchedule(user, ["08:00", "20:00"]);
    expect(await countReminders(scheduleId)).toBeGreaterThan(0);
  });

  it("requires the same minimum as a review confirmation", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("manualinvalid"));
    const res = await user.post("/api/medications", { name: "Metformin" });
    expect(res.status).toBe(400);
  });

  it("edits times without duplicates, keeps past doses, and deactivates the removed time", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("edit"));
    const { scheduleId } = await manualSchedule(user, ["08:00", "20:00"]);

    // A past dose the user already took must survive the edit untouched.
    const past = await prisma.reminder.findFirst({ where: { scheduleSlot: { scheduleId } }, orderBy: { scheduledFor: "asc" } });
    await prisma.reminder.update({ where: { id: past!.id }, data: { scheduledFor: new Date(Date.now() - 3600_000), status: "TAKEN", respondedAt: new Date() } });

    const edited = await user.raw.put(`/api/schedule/${scheduleId}`).set(await user.csrfHeader()).send({
      slots: [{ timeOfDay: "09:00" }, { timeOfDay: "20:00" }],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.schedule.slots.map((s: { timeOfDay: string }) => s.timeOfDay).sort()).toEqual(["09:00", "20:00"]);

    // Edit again (and run the top-up twice) — no (slot, time) pair may ever repeat.
    await user.raw.put(`/api/schedule/${scheduleId}`).set(await user.csrfHeader()).send({ slots: [{ timeOfDay: "09:00" }, { timeOfDay: "20:00" }] });
    await topUpReminders();
    await topUpReminders();
    const rows = await prisma.reminder.findMany({ where: { scheduleSlot: { scheduleId } }, select: { scheduleSlotId: true, scheduledFor: true } });
    const keys = rows.map((r) => `${r.scheduleSlotId}|${r.scheduledFor.toISOString()}`);
    expect(new Set(keys).size).toBe(keys.length);

    const kept = await prisma.reminder.findUnique({ where: { id: past!.id } });
    expect(kept!.status).toBe("TAKEN");
    const removedSlot = await prisma.scheduleSlot.findFirst({ where: { scheduleId, timeOfDay: "08:00" } });
    expect(removedSlot!.active).toBe(false);
    const futureAtRemovedTime = await prisma.reminder.count({
      where: { scheduleSlotId: removedSlot!.id, scheduledFor: { gt: new Date() }, status: "PENDING" },
    });
    expect(futureAtRemovedTime).toBe(0);
    // topUpReminders scans every active schedule in the shared test
    // database, twice — slower than the default per-test budget.
  }, 60_000);

  it("limits doses to the selected days of the week", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("weekdays"));
    const { scheduleId } = await manualSchedule(user, ["08:00"]);
    await user.raw.put(`/api/schedule/${scheduleId}`).set(await user.csrfHeader()).send({ daysOfWeek: [1] });
    const future = await prisma.reminder.findMany({
      where: { scheduleSlot: { scheduleId }, scheduledFor: { gt: new Date() }, status: "PENDING" },
    });
    expect(future.length).toBeGreaterThan(0);
    // 08:00 in the user's timezone (UTC for a new account) on Mondays only.
    expect(future.every((r) => r.scheduledFor.getUTCDay() === 1)).toBe(true);
  });

  it("records SKIPPED_DISABLED — never a send — when reminders are turned off", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("disabled"));
    const { scheduleId } = await manualSchedule(user, ["08:00"]);
    await user.raw.put(`/api/schedule/${scheduleId}`).set(await user.csrfHeader()).send({ remindersEnabled: false });
    const reminder = await prisma.reminder.findFirst({ where: { scheduleSlot: { scheduleId }, status: "PENDING" } });
    await prisma.reminder.update({ where: { id: reminder!.id }, data: { scheduledFor: new Date(Date.now() - 60_000) } });
    await prisma.schedule.update({ where: { id: scheduleId }, data: { createdAt: new Date(Date.now() - 86_400_000) } });

    await processDueReminders();
    const delivery = await prisma.reminderDelivery.findUnique({ where: { reminderId_channel: { reminderId: reminder!.id, channel: "EMAIL" } } });
    expect(delivery!.status).toBe("SKIPPED_DISABLED");
    expect(delivery!.deliveredAt).toBeNull();
  });

  it("never notifies a dose that had already passed when the schedule was created", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("pastdose"));
    const { scheduleId } = await manualSchedule(user, ["08:00"]);
    const reminder = await prisma.reminder.findFirst({ where: { scheduleSlot: { scheduleId } } });
    await prisma.reminder.update({ where: { id: reminder!.id }, data: { scheduledFor: new Date(Date.now() - 60_000) } });
    // createdAt is now — after the dose time.
    await processDueReminders();
    const delivery = await prisma.reminderDelivery.findUnique({ where: { reminderId_channel: { reminderId: reminder!.id, channel: "EMAIL" } } });
    expect(delivery).toBeNull();
  });

  it("won't let another user schedule, edit or read someone's manual medicine", async () => {
    const owner = await AuthedAgent.register(server, uniqueTestUser("manualowner"));
    const { medicationId, scheduleId } = await manualSchedule(owner, ["08:00"]);
    const other = await AuthedAgent.register(server, uniqueTestUser("manualintruder"));
    expect((await other.post("/api/schedule", { medicationId, startDate: "2026-01-01", slots: [{ timeOfDay: "09:00" }] })).status).toBe(404);
    expect((await other.raw.put(`/api/schedule/${scheduleId}`).set(await other.csrfHeader()).send({ remindersEnabled: false })).status).toBe(404);
    expect((await other.patch(`/api/medications/${medicationId}`, { reviewStatus: "REJECTED" })).status).toBe(404);
  });
});

describe("price matching is exact", () => {
  const brand = `Testprofen${Date.now()}`;
  beforeAll(async () => {
    const base = {
      genericName: "testprofen",
      activeIngredient: "testprofen",
      countryOrMarket: "Pakistan",
      currency: "PKR",
      priceType: "OFFICIAL_MRP" as const,
      priceSource: "Test fixture",
      priceSourceUrl: "https://example.test/source",
      priceEffectiveFrom: new Date("2026-07-01"),
      priceLastVerifiedAt: new Date("2026-10-01"),
      dataProvenance: "OTHER" as const,
    };
    await prisma.medicineReference.createMany({
      data: [
        { ...base, brandName: brand, strength: "400 mg", formulation: "tablet", packSize: "20 tablets", referencePrice: new Prisma.Decimal("150.00") },
        { ...base, brandName: `${brand} Extra`, strength: "400 mg", formulation: "tablet", packSize: "20 tablets", referencePrice: new Prisma.Decimal("210.00") },
      ],
    });
  });
  afterAll(async () => {
    await prisma.medicineReference.deleteMany({ where: { brandName: { startsWith: brand } } });
  });

  it("quotes only the exact brand, strength and form, with source and dates", async () => {
    const result = await lookupPrice({ name: brand, strength: "400mg", form: "Tab." });
    expect(result.status).toBe("VERIFIED");
    if (result.status !== "VERIFIED") return;
    expect(result.price.amount).toBe("150");
    expect(result.price.brandName).toBe(brand); // never the "Extra" product
    expect(result.price.sourceName).toBe("Test fixture");
    expect(result.price.lastVerifiedAt).toBeTruthy();
    expect(result.price.packSize).toBe("20 tablets");
  });

  it("won't price a different strength", async () => {
    expect((await lookupPrice({ name: brand, strength: "200 mg", form: "tablet" })).status).toBe("UNAVAILABLE");
  });

  it("won't pick a product when the strength or form is unknown", async () => {
    const result = await lookupPrice({ name: brand, form: "tablet" });
    expect(result.status).toBe("UNAVAILABLE");
    if (result.status === "UNAVAILABLE") expect(result.reason).toMatch(/strength/);
  });
});

describe("price importer validation", () => {
  const good = {
    brand_name: "Brand",
    generic_name: "generic",
    active_ingredient: "generic",
    strength: "500 mg",
    dosage_form: "tablet",
    pack_size: "20 tablets",
    price_pkr: "123.45",
    price_type: "OFFICIAL_MRP",
    source_name: "DRAP Drug Pricing Index",
    source_url: "https://e.dra.gov.pk/public/price",
    effective_from: "2026-07-01",
    verified_on: "2026-10-01",
  };

  it("accepts a complete row", () => {
    expect(validateRow(good)).toEqual([]);
  });

  it("rejects a row missing its source, an estimated-looking price, or a bad price type", () => {
    expect(validateRow({ ...good, source_url: "" })).toContain("missing source_url");
    expect(validateRow({ ...good, price_pkr: "about 120" }).length).toBeGreaterThan(0);
    expect(validateRow({ ...good, price_type: "ESTIMATE" }).length).toBeGreaterThan(0);
    expect(validateRow({ ...good, verified_on: "2999-01-01" })).toContain("verified_on is in the future");
  });

  it("parses quoted CSV fields", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
});

describe("provider HTTP error classification (Google / Ollama transport)", () => {
  it("maps Google's invalid-key 400 to AUTH and never echoes the upstream body", async () => {
    const { classifyHttpFailure } = await import("@/services/extraction/visionTransport");
    const body = JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } });
    const err = classifyHttpFailure(400, body);
    expect(err.kind).toBe("AUTH");
    expect(err.retryable).toBe(false);
    expect(err.message).not.toMatch(/INVALID_ARGUMENT|API_KEY_INVALID|\{/);
  });

  it("treats an overloaded 503 as a retryable outage, not a network fault", async () => {
    const { classifyHttpFailure } = await import("@/services/extraction/visionTransport");
    const err = classifyHttpFailure(503, '{"error":{"status":"UNAVAILABLE","message":"The model is overloaded."}}');
    expect(err.kind).toBe("MODEL_UNAVAILABLE");
    expect(err.retryable).toBe(true);
  });

  it("separates a per-minute rate limit from an exhausted daily quota", async () => {
    const { classifyHttpFailure } = await import("@/services/extraction/visionTransport");
    expect(classifyHttpFailure(429, '{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel"}').kind).toBe("RATE_LIMITED");
    const daily = classifyHttpFailure(429, '{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}');
    expect(daily.kind).toBe("QUOTA_EXHAUSTED");
    expect(daily.retryable).toBe(false);
  });
});
