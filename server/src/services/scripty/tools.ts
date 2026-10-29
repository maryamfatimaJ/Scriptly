import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { AppError } from "@/utils/AppError";
import * as medicineService from "@/services/medicine.service";
import * as scheduleService from "@/services/schedule.service";
import * as medicationService from "@/services/medication.service";
import { getMonographForIngredient } from "@/services/medicineInfo/monograph.service";
import { lookupPrice, manualCheckLinksFor } from "@/services/medicineInfo/price.service";
import { checkInteractions } from "@/services/medicineInfo/interaction.service";
import { suggestScheduleFromFrequency } from "@/utils/frequencyParser";

// Scripty's tool layer — the ONLY way the assistant reaches data.
//
// Claude never sees the database, never composes a query, and never
// executes anything. Through tool calling it chooses a tool NAME and
// proposes ARGUMENTS; this module validates those arguments with Zod (the
// JSON schema sent to Claude is a description, not a guarantee) and runs
// our own existing service functions, which carry the ownership checks and
// safety rules that were already written and tested for the rest of the
// app.
//
// Two rules enforced here, not in the prompt, because a prompt is a
// request and this is a guarantee:
//   1. Every tool receives userId from the authenticated SESSION. The
//      model cannot supply, influence, or override it, so it cannot reach
//      another user's records by asking nicely.
//   2. A tool that changes anything sets requiresConfirmation. Those
//      tools do not execute on the model's say-so at all — they return a
//      proposal that a human must explicitly confirm (see scripty.service
//      .ts). Model output alone never authorizes a write.

export interface ToolContext {
  userId: string;
  /** Prescription currently in focus, if the conversation started from one. */
  prescriptionId?: string;
}

export interface ToolDefinition<TArgs = unknown> {
  name: string;
  /** Shown to Claude when it picks a tool. Says what the tool returns and when to use it. */
  description: string;
  /** JSON Schema sent to Claude. Advisory only — `schema` below is what is enforced. */
  inputSchema: Anthropic.Tool.InputSchema;
  schema: z.ZodType<TArgs>;
  /** Whether the UI renders this tool's result as a card under Scripty's reply. */
  display: boolean;
  /** Mutating tools are proposed, confirmed by a human, and only then run. */
  requiresConfirmation: boolean;
  execute: (ctx: ToolContext, args: TArgs) => Promise<unknown>;
}

const EMPTY_INPUT: Anthropic.Tool.InputSchema = { type: "object", properties: {} };

// ---------------------------------------------------------------------------
// Read-only tools
// ---------------------------------------------------------------------------

const summarizePrescription: ToolDefinition<{ prescriptionId?: string }> = {
  name: "summarize_prescription",
  description:
    "Read one of the user's own prescriptions: each medicine with its id, name, strength, form, frequency, dosage " +
    "instructions, duration, whether the user has confirmed it (isConfirmed) and any extraction warnings. Use for " +
    "questions about 'this prescription' or about how to read its instructions. Unconfirmed rows are unverified " +
    "AI readings of a photo and must be described as such.",
  inputSchema: {
    type: "object",
    properties: {
      prescriptionId: { type: "string", description: "Omit to use the prescription this conversation was opened from." },
    },
  },
  schema: z.object({ prescriptionId: z.string().uuid().optional() }),
  display: true,
  requiresConfirmation: false,
  async execute(ctx, args) {
    const prescriptionId = args.prescriptionId ?? ctx.prescriptionId;
    if (!prescriptionId) {
      throw AppError.badRequest(
        "No prescription is in focus for this conversation. Use list_my_medications to see the user's medicines."
      );
    }

    // findFirst with userId — ownership enforced in the query itself.
    const prescription = await prisma.prescription.findFirst({
      where: { id: prescriptionId, userId: ctx.userId },
      include: { medications: true },
    });
    if (!prescription) throw AppError.notFound("Prescription not found.");

    return {
      prescriptionId: prescription.id,
      status: prescription.status,
      aiProvider: prescription.aiProvider,
      overallWarnings: prescription.extractionOverallWarnings ?? [],
      medications: prescription.medications.map((m) => ({
        id: m.id,
        name: m.confirmedName ?? m.extractedName,
        strength: m.confirmedStrength ?? m.extractedStrength,
        form: m.confirmedForm ?? m.extractedForm,
        frequency: m.confirmedFrequency ?? m.extractedFrequency,
        dosageInstructions: m.confirmedDosageInstructions ?? m.extractedDosageInstructions,
        durationDays: m.confirmedDurationDays ?? m.extractedDurationDays,
        reviewStatus: m.reviewStatus,
        // Surfaced so Scripty can say "this still needs your review"
        // instead of presenting an unconfirmed reading as settled fact.
        isConfirmed: m.reviewStatus === "CONFIRMED",
        warnings: m.extractionWarnings ?? [],
      })),
    };
  },
};

const listMedications: ToolDefinition<Record<string, never>> = {
  name: "list_my_medications",
  description:
    "List every medicine saved on the user's account, across all their prescriptions, with ids, review status and " +
    "the prescription each came from. Use it to find a medicationId, or when the user asks what they are taking.",
  inputSchema: EMPTY_INPUT,
  schema: z.object({}).strict(),
  display: true,
  requiresConfirmation: false,
  async execute(ctx) {
    const medications = await medicationService.listMedicationsForUser(ctx.userId);
    return {
      count: medications.length,
      medications: medications.map((m) => ({
        id: m.id,
        name: m.confirmedName ?? m.extractedName,
        strength: m.confirmedStrength ?? m.extractedStrength,
        form: m.confirmedForm ?? m.extractedForm,
        frequency: m.confirmedFrequency ?? m.extractedFrequency,
        dosageInstructions: m.confirmedDosageInstructions ?? m.extractedDosageInstructions,
        reviewStatus: m.reviewStatus,
        prescriptionId: m.prescription?.id ?? null,
        source: m.source,
      })),
    };
  },
};

const medicineInformation: ToolDefinition<{ medicationId?: string; name?: string }> = {
  name: "get_medicine_information",
  description:
    "Retrieve the published U.S. FDA label (via openFDA) for a medicine's active ingredient: uses, dosage and " +
    "administration as written, side effects, warnings, precautions, contraindications, storage. Use it before " +
    "answering what a medicine is for, its side effects, cautions, or what its label says about missed doses. " +
    "Pass medicationId for a medicine on the user's account, or name for any other. The label is the US one, not " +
    "the Pakistani leaflet, and the result may be NOT_AVAILABLE or LOOKUP_FAILED.",
  inputSchema: {
    type: "object",
    properties: {
      medicationId: { type: "string", description: "Id of a medicine on the user's account." },
      name: { type: "string", description: "Any medicine name, brand or generic, when it is not on the account." },
    },
  },
  schema: z
    .object({ medicationId: z.string().uuid().optional(), name: z.string().trim().min(2).max(200).optional() })
    .refine((v) => v.medicationId || v.name, { message: "Provide either medicationId or name." }),
  display: true,
  requiresConfirmation: false,
  async execute(ctx, args) {
    let ingredient: string | null = null;
    let displayName: string | null = null;

    if (args.medicationId) {
      const medication = await medicationService.getMedicationForUser(ctx.userId, args.medicationId);
      displayName = medication.confirmedName ?? medication.extractedName;
      ingredient = medication.confirmedGenericName ?? medication.extractedGenericName ?? displayName;
    } else if (args.name) {
      displayName = args.name;
      // Prefer a reference row's active ingredient when we have one — a
      // brand name is rarely what a drug label is indexed under.
      const hits = await medicineService.searchMedicines(args.name, 1);
      ingredient = hits[0]?.medicine.activeIngredient ?? args.name;
      if (hits[0]) displayName = hits[0].medicine.brandName ?? hits[0].medicine.genericName;
    }

    if (!ingredient) throw AppError.badRequest("Could not determine which medicine to look up.");

    const information = await getMonographForIngredient(ingredient);
    return {
      medicineName: displayName,
      activeIngredient: ingredient,
      information,
      marketNote:
        information.status === "FOUND" && information.monograph.market === "US"
          ? "This is United States FDA label information for the active ingredient. The Pakistani product " +
            "leaflet for this brand may differ in approved uses, pack sizes and wording."
          : undefined,
    };
  },
};

const medicinePrice: ToolDefinition<{ medicationId?: string; name?: string; strength?: string; form?: string }> = {
  name: "check_medicine_price",
  description:
    "Look up a VERIFIED retail price for a medicine in Pakistan. Pass medicationId for a medicine on the user's " +
    "account (its recorded strength and form are then used), or name plus strength and dosage form when known — " +
    "the same brand at a different strength or form is a different product with a different price. Usually " +
    "returns UNAVAILABLE with links to check manually: there is no permitted bulk source of Pakistani prices, and " +
    "a price must never be estimated.",
  inputSchema: {
    type: "object",
    properties: {
      medicationId: { type: "string" },
      name: { type: "string" },
      strength: { type: "string", description: "e.g. 500 mg" },
      form: { type: "string", description: "e.g. tablet, capsule, syrup" },
    },
  },
  schema: z
    .object({
      medicationId: z.string().uuid().optional(),
      name: z.string().trim().min(2).max(200).optional(),
      strength: z.string().trim().max(100).optional(),
      form: z.string().trim().max(100).optional(),
    })
    .refine((v) => v.medicationId || v.name, { message: "Provide either medicationId or name." }),
  display: true,
  requiresConfirmation: false,
  async execute(ctx, args) {
    let { name, strength, form } = args;
    if (args.medicationId) {
      const medication = await medicationService.getMedicationForUser(ctx.userId, args.medicationId);
      name = medication.confirmedName ?? medication.extractedName ?? name;
      strength = medication.confirmedStrength ?? medication.extractedStrength ?? strength;
      form = medication.confirmedForm ?? medication.extractedForm ?? form;
    }
    if (!name) throw AppError.badRequest("This medicine has no name recorded to look up.");
    const result = await lookupPrice({ name, strength: strength ?? undefined, form: form ?? undefined });
    return { price: result };
  },
};

const medicineInteractions: ToolDefinition<{ medicines: Array<{ medicationId?: string; name?: string }> }> = {
  name: "check_medicine_interactions",
  description:
    "Check two to five medicines against each other by searching each one's U.S. FDA label (drug interactions, " +
    "contraindications, warnings) for the others, returning verbatim excerpts. Each medicine is a medicationId " +
    "from the user's account or a name. NOT_MENTIONED does not mean safe — labels often describe interactions by " +
    "drug class — so a pharmacist should always confirm a combination.",
  inputSchema: {
    type: "object",
    properties: {
      medicines: {
        type: "array",
        minItems: 2,
        maxItems: 5,
        items: { type: "object", properties: { medicationId: { type: "string" }, name: { type: "string" } } },
      },
    },
    required: ["medicines"],
  },
  schema: z.object({
    medicines: z
      .array(
        z
          .object({ medicationId: z.string().uuid().optional(), name: z.string().trim().min(2).max(200).optional() })
          .refine((v) => v.medicationId || v.name, { message: "Each medicine needs a medicationId or a name." })
      )
      .min(2)
      .max(5),
  }),
  display: false,
  requiresConfirmation: false,
  async execute(ctx, args) {
    return checkInteractions(ctx.userId, args.medicines);
  },
};

const listSchedules: ToolDefinition<Record<string, never>> = {
  name: "list_my_schedules",
  description:
    "Read the user's medicine reminder schedules (id, medicine, status, start/end dates, times of day) and today's " +
    "reminders in their timezone, each with its status (pending, taken, missed, skipped) and whether it is due.",
  inputSchema: EMPTY_INPUT,
  schema: z.object({}).strict(),
  display: true,
  requiresConfirmation: false,
  async execute(ctx) {
    const [schedules, today] = await Promise.all([
      scheduleService.listSchedules(ctx.userId),
      scheduleService.getScheduleForDate(ctx.userId, undefined),
    ]);
    return {
      count: schedules.length,
      schedules: schedules.map((s) => ({
        id: s.id,
        medicationId: s.medicationId,
        medicationName: s.medication.confirmedName ?? s.medication.extractedName,
        status: s.status,
        startDate: s.startDate,
        endDate: s.endDate,
        times: s.slots.map((slot) => slot.timeOfDay).sort(),
      })),
      todaysReminders: today.map((r) => ({
        medicationName: r.medicationName,
        timeOfDay: r.timeOfDay,
        status: r.status,
        due: r.due,
        scheduleStatus: r.scheduleStatus,
      })),
    };
  },
};

const reminderDeliveryStatus: ToolDefinition<Record<string, never>> = {
  name: "check_reminder_delivery",
  description:
    "Report whether reminders can actually be delivered to the user by email, or whether they are in-app only.",
  inputSchema: EMPTY_INPUT,
  schema: z.object({}).strict(),
  display: true,
  requiresConfirmation: false,
  async execute(ctx) {
    const emailConfigured = env.emailProvider === "smtp";
    const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true, timezone: true } });

    // Report the real configuration. Claiming a reminder "was sent" when
    // EMAIL_PROVIDER is "none" would be a lie the user acts on.
    return {
      emailConfigured,
      channel: emailConfigured ? "email" : "in-app only",
      timezone: user?.timezone ?? "UTC",
      explanation: emailConfigured
        ? `Reminder emails are configured and will be sent to ${user?.email ?? "your account email"} at each dose time.`
        : "Email delivery is NOT configured on this server (EMAIL_PROVIDER=none). Reminders are created and " +
          "shown inside Scriptly on the Schedule page, but no email or push notification will be sent. Every " +
          "delivery attempt is recorded as 'skipped — not configured' rather than being treated as sent.",
    };
  },
};

// ---------------------------------------------------------------------------
// Mutating tools — proposed only, never executed on model output alone
// ---------------------------------------------------------------------------

const proposeSchedule: ToolDefinition<{
  medicationId: string;
  times: string[];
  startDate?: string;
  durationDays?: number;
  notes?: string;
}> = {
  name: "propose_schedule",
  description:
    "Propose a new reminder schedule for one of the user's medicines. This does NOT save anything: it shows the " +
    "user a proposal card with a Confirm button, and the schedule is created only if they press it. Only works " +
    "for a medicine whose instructions the user has confirmed. Times must be ones the user asked for.",
  inputSchema: {
    type: "object",
    properties: {
      medicationId: { type: "string" },
      times: {
        type: "array",
        items: { type: "string", description: "24-hour HH:mm, e.g. 21:00 for 9 PM" },
        description: "Clock times the USER asked for. Never invent them; ask if they were not given.",
      },
      startDate: { type: "string", description: "YYYY-MM-DD; omit to start today" },
      durationDays: { type: "integer" },
      notes: { type: "string" },
    },
    required: ["medicationId", "times"],
  },
  schema: z.object({
    medicationId: z.string().uuid(),
    times: z
      .array(z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Times must be in 24-hour HH:mm format."))
      .min(1, "At least one time is required.")
      .max(12),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD")
      .optional(),
    durationDays: z.number().int().positive().max(365).optional(),
    notes: z.string().trim().max(500).optional(),
  }),
  display: false,
  requiresConfirmation: true,
  async execute(ctx, args) {
    // This runs ONLY after a human has confirmed the proposal.
    // createSchedule re-checks ownership and the CONFIRMED-instructions
    // rule itself; we do not bypass it or pre-authorize anything here.
    const startDate = args.startDate ? new Date(`${args.startDate}T00:00:00`) : new Date();
    const endDate = args.durationDays
      ? // A course of N days is the start day plus N-1 more, inclusive.
        new Date(startDate.getTime() + (args.durationDays - 1) * 24 * 60 * 60 * 1000)
      : undefined;

    const schedule = await scheduleService.createSchedule(ctx.userId, {
      medicationId: args.medicationId,
      startDate,
      endDate,
      slots: args.times.map((timeOfDay) => ({ timeOfDay })),
      notes: args.notes,
    });

    return {
      created: true,
      scheduleId: schedule.id,
      times: schedule.slots.map((s) => s.timeOfDay).sort(),
      remindersCreated: schedule.slots.reduce((total, slot) => total + slot.reminders.length, 0),
    };
  },
};

const changeScheduleStatus: ToolDefinition<{ scheduleId: string; status: "ACTIVE" | "PAUSED" | "CANCELLED" }> = {
  name: "change_schedule_status",
  description:
    "Propose pausing, resuming (ACTIVE) or discontinuing (CANCELLED) one of the user's schedules. Like " +
    "propose_schedule it changes nothing by itself — the user must press Confirm on the card it shows.",
  inputSchema: {
    type: "object",
    properties: {
      scheduleId: { type: "string" },
      status: { type: "string", enum: ["ACTIVE", "PAUSED", "CANCELLED"] },
    },
    required: ["scheduleId", "status"],
  },
  schema: z.object({
    scheduleId: z.string().uuid(),
    status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]),
  }),
  display: false,
  requiresConfirmation: true,
  async execute(ctx, args) {
    const schedule = await scheduleService.updateScheduleStatus(ctx.userId, args.scheduleId, args.status);
    return { updated: true, scheduleId: schedule.id, status: schedule.status };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SCRIPTY_TOOLS: ToolDefinition<never>[] = [
  summarizePrescription,
  listMedications,
  medicineInformation,
  medicinePrice,
  medicineInteractions,
  listSchedules,
  reminderDeliveryStatus,
  proposeSchedule,
  changeScheduleStatus,
] as unknown as ToolDefinition<never>[];

export function getTool(name: string): ToolDefinition<never> | undefined {
  return SCRIPTY_TOOLS.find((tool) => tool.name === name);
}

/**
 * Builds the schedule proposal a human is asked to confirm.
 *
 * Deliberately NOT generated by the model: times come from the user or
 * from suggestScheduleFromFrequency (which derives slot COUNT from the
 * confirmed frequency and never invents clock times), and the dose text
 * is copied verbatim from the confirmed instructions. Scripty can phrase
 * the question; it cannot decide the answer.
 */
export async function buildScheduleProposal(
  userId: string,
  medicationId: string,
  times: string[]
): Promise<{
  medicationId: string;
  medicationName: string | null;
  dosageInstructions: string | null;
  frequency: string | null;
  durationDays: number | null;
  times: string[];
  suggestedSlotCount: number | null;
  missingInformation: string[];
}> {
  const medication = await medicationService.getMedicationForUser(userId, medicationId);

  if (medication.reviewStatus !== "CONFIRMED") {
    throw AppError.unprocessable(
      "This medicine's instructions have not been confirmed yet. Review and confirm them first — Scriptly " +
        "will not build a reminder schedule from an unverified reading of a prescription."
    );
  }

  const suggestion = suggestScheduleFromFrequency(medication.confirmedFrequency);
  const missingInformation: string[] = [];

  if (times.length === 0) missingInformation.push("What time(s) of day do you want to be reminded?");
  if (!medication.confirmedDurationDays) {
    missingInformation.push("How many days should this run for? (Leave it open-ended if your doctor didn't say.)");
  }
  if (suggestion.suggestedSlotCount && times.length > 0 && times.length !== suggestion.suggestedSlotCount) {
    missingInformation.push(
      `Your prescription says "${medication.confirmedFrequency}", which suggests ${suggestion.suggestedSlotCount} dose(s) a day, ` +
        `but ${times.length} time(s) were given. Please confirm this is what you want.`
    );
  }

  return {
    medicationId: medication.id,
    medicationName: medication.confirmedName,
    dosageInstructions: medication.confirmedDosageInstructions,
    frequency: medication.confirmedFrequency,
    durationDays: medication.confirmedDurationDays,
    times,
    suggestedSlotCount: suggestion.suggestedSlotCount ?? null,
    missingInformation,
  };
}

export { manualCheckLinksFor };
