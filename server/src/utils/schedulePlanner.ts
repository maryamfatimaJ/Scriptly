import { env } from "@/config/env";
import { parseDosePositions, suggestScheduleFromFrequency } from "./frequencyParser";

// Turns a medicine's CONFIRMED instructions into a proposed reminder
// schedule — a proposal the user reviews and edits before anything is
// saved. Never a dose, frequency or duration that was not written.
//
// Every proposed time carries its BASIS, so the UI can say exactly how
// much of it came from the prescription:
//
//   WRITTEN_TIME   a clock time written on the prescription ("at 9 pm")
//   WRITTEN_ANCHOR the time of day / meal is written ("after breakfast",
//                  "1+0+1" = morning and night); only the clock time is
//                  a configurable default
//   SUGGESTED      only the number of doses a day is written; the times
//                  are evenly spaced suggestions the user must accept or
//                  change
//
// When the instructions are missing, as-needed, unrecognised or
// contradictory, no times are proposed at all: the status is
// NEEDS_CLARIFICATION and the reasons are listed.

export type SlotBasis = "WRITTEN_TIME" | "WRITTEN_ANCHOR" | "SUGGESTED";

export interface ProposedSlot {
  timeOfDay: string;
  label: string;
  basis: SlotBasis;
}

export interface ScheduleIssue {
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface ScheduleProposal {
  /**
   * READY                    every time is anchored in what was written, and the duration is known
   * NEEDS_TIME_CONFIRMATION  a schedule can be proposed, but some times or the duration need the user's choice
   * NEEDS_CLARIFICATION      nothing is proposed — the instructions must be clarified first
   */
  status: "READY" | "NEEDS_TIME_CONFIRMATION" | "NEEDS_CLARIFICATION";
  dosesPerDay: number | null;
  slots: ProposedSlot[];
  /** Dose per reminder as written, e.g. "1 tablet". Null when not written. */
  doseAmount: string | null;
  durationDays: number | null;
  issues: ScheduleIssue[];
}

export interface PlannerInput {
  frequency: string | null | undefined;
  timing: string | null | undefined;
  dosageInstructions: string | null | undefined;
  durationDays: number | null | undefined;
}

/** Default clock times for meal-anchored doses. Configurable in .env. */
export function mealTimes() {
  return {
    breakfast: env.mealTimeBreakfast,
    lunch: env.mealTimeLunch,
    dinner: env.mealTimeDinner,
    bedtime: env.mealTimeBedtime,
  };
}

function shiftTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

type Meal = "breakfast" | "lunch" | "dinner";

/**
 * Reads meal / time-of-day anchors from written text. Returns the anchors
 * in day order, or an empty list when none are written.
 */
export function parseTimingAnchors(text: string): Array<{ label: string; timeOfDay: string }> {
  const t = text.toLowerCase();
  const meals = mealTimes();
  const relation = /\bbefore\b|\bac\b|empty stomach/.test(t) ? "before" : /\bafter\b|\bpc\b/.test(t) ? "after" : /\bwith\b/.test(t) ? "with" : null;
  const offset = relation === "before" ? -30 : relation === "after" ? 30 : 0;
  const prefix = relation === "before" ? "Before" : relation === "after" ? "After" : "With";

  const anchors: Array<{ label: string; timeOfDay: string; order: number }> = [];
  const add = (meal: Meal, order: number) =>
    anchors.push({ label: `${prefix} ${meal}`, timeOfDay: shiftTime(meals[meal], offset), order });

  if (/breakfast|nashta|morning meal/.test(t)) add("breakfast", 1);
  if (/lunch|midday meal/.test(t)) add("lunch", 2);
  if (/dinner|supper|evening meal/.test(t)) add("dinner", 3);

  if (anchors.length === 0) {
    if (/\bmorning\b|\bsubah\b/.test(t)) anchors.push({ label: "Morning", timeOfDay: meals.breakfast, order: 1 });
    if (/\b(evening|shaam)\b/.test(t)) anchors.push({ label: "Evening", timeOfDay: shiftTime(meals.dinner, -60), order: 3 });
  }
  if (/\b(bedtime|at night|h\.?s\.?|before sleep|raat)\b/.test(t)) {
    anchors.push({ label: "At bedtime", timeOfDay: meals.bedtime, order: 4 });
  }

  return anchors.sort((a, b) => a.order - b.order).map(({ label, timeOfDay }) => ({ label, timeOfDay }));
}

/** Explicit clock times written in the instructions, e.g. "at 8 am and 8 pm". */
export function parseWrittenClockTimes(text: string): string[] {
  const times: string[] = [];
  for (const match of text.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi)) {
    const [, h12, m12, meridiem, h24, m24] = match;
    if (meridiem) {
      let hour = Number(h12);
      if (hour < 1 || hour > 12) continue;
      if (meridiem.toLowerCase() === "pm" && hour !== 12) hour += 12;
      if (meridiem.toLowerCase() === "am" && hour === 12) hour = 0;
      times.push(`${String(hour).padStart(2, "0")}:${m12 ?? "00"}`);
    } else if (h24 !== undefined) {
      times.push(`${String(Number(h24)).padStart(2, "0")}:${m24}`);
    }
  }
  return [...new Set(times)].sort();
}

/** The dose per administration, only when written ("1 tablet", "5 ml", "two capsules"). */
export function parseDoseAmount(text: string): string | null {
  const match = text.match(
    /\b(\d+(?:\.\d+)?|\d\/\d|half|one|two|three|1\/2)\s*(tablets?|tabs?|capsules?|caps?|ml|teaspoons?|tsp|tablespoons?|tbsp|puffs?|drops?|sachets?|units?|iu)\b/i
  );
  return match ? `${match[1]} ${match[2]}`.toLowerCase() : null;
}

const EVENLY_SPACED: Record<number, string[]> = {
  1: ["09:00"],
  2: ["09:00", "21:00"],
  3: ["08:00", "14:00", "20:00"],
  4: ["08:00", "12:00", "16:00", "20:00"],
};

function evenlySpaced(count: number): string[] {
  if (EVENLY_SPACED[count]) return EVENLY_SPACED[count];
  const step = Math.floor(1440 / count);
  return Array.from({ length: count }, (_, i) => shiftTime("08:00", i * step));
}

export function planSchedule(input: PlannerInput): ScheduleProposal {
  const issues: ScheduleIssue[] = [];
  const frequency = (input.frequency ?? "").trim();
  const timing = (input.timing ?? "").trim();
  const dosage = (input.dosageInstructions ?? "").trim();
  const allText = [frequency, timing, dosage].filter(Boolean).join(" ; ");

  const doseAmount = parseDoseAmount(dosage) ?? parseDoseAmount(frequency);
  const durationDays = input.durationDays ?? null;

  const clarify = (message: string): ScheduleProposal => ({
    status: "NEEDS_CLARIFICATION",
    dosesPerDay: null,
    slots: [],
    doseAmount,
    durationDays,
    issues: [...issues, { severity: "critical", message }],
  });

  // 1. How many doses a day. The frequency field first; the dosage
  //    instructions only when no frequency was written. If BOTH state a
  //    count and they disagree, that is a contradiction, not a choice.
  const fromFrequency = frequency ? suggestScheduleFromFrequency(frequency) : null;
  const fromDosage = dosage ? suggestScheduleFromFrequency(dosage) : null;

  if (/\b(as needed|prn|when required|if needed|sos)\b/i.test(allText)) {
    return clarify(
      "This medicine is to be taken as needed, not on a fixed schedule, so no reminder times are proposed. You can still add times yourself if a reminder helps you."
    );
  }

  const freqCount = fromFrequency?.suggestedSlotCount ?? null;
  const dosageCount = fromDosage?.suggestedSlotCount ?? null;
  if (freqCount && dosageCount && freqCount !== dosageCount) {
    return clarify(
      `The instructions disagree: the frequency says ${freqCount} time(s) a day but the dose instructions say ${dosageCount}. Please check the prescription or ask your pharmacist before scheduling.`
    );
  }
  const dosesPerDay = freqCount ?? dosageCount;

  if (!dosesPerDay) {
    return clarify(
      frequency || dosage
        ? `"${frequency || dosage}" doesn't state a regular number of doses a day that Scriptly can read. Please check the prescription or ask your pharmacist, then enter the times yourself.`
        : "No frequency is recorded for this medicine, so a schedule can't be prepared. Add how often it is taken (as written on the prescription) first."
    );
  }

  // 2. When in the day. Written clock times win, then written
  //    anchors (meals, 1+0+1 positions), then evenly spaced suggestions.
  let slots: ProposedSlot[] = [];
  const written = parseWrittenClockTimes(allText);
  const positions = parseDosePositions(frequency) ?? parseDosePositions(dosage);
  const anchors = parseTimingAnchors([timing, frequency, dosage].join(" "));

  if (written.length > 0) {
    if (written.length !== dosesPerDay) {
      return clarify(
        `${written.length} clock time(s) are written but the instructions say ${dosesPerDay} dose(s) a day. Please check the prescription before scheduling.`
      );
    }
    slots = written.map((timeOfDay, i) => ({ timeOfDay, label: `Dose ${i + 1}`, basis: "WRITTEN_TIME" }));
  } else if (positions) {
    const meals = mealTimes();
    if (positions.morning) slots.push({ timeOfDay: meals.breakfast, label: "Morning", basis: "WRITTEN_ANCHOR" });
    if (positions.afternoon) slots.push({ timeOfDay: shiftTime(meals.lunch, 30), label: "Afternoon", basis: "WRITTEN_ANCHOR" });
    if (positions.night) slots.push({ timeOfDay: shiftTime(meals.dinner, 60), label: "Night", basis: "WRITTEN_ANCHOR" });
  } else if (anchors.length > 0) {
    if (anchors.length === dosesPerDay) {
      slots = anchors.map((a) => ({ ...a, basis: "WRITTEN_ANCHOR" as const }));
    } else if (anchors.length > dosesPerDay) {
      return clarify(
        `The timing mentions ${anchors.length} times of day (${anchors.map((a) => a.label.toLowerCase()).join(", ")}) but the frequency says ${dosesPerDay} dose(s) a day. Please check the prescription before scheduling.`
      );
    } else if (/\bmeals?\b|\bfood\b/i.test(timing || allText) && dosesPerDay <= 3) {
      // "Twice daily after meals": the meal relation is written, which
      // meals is not. Suggest, and say so.
      const meals: Meal[] = dosesPerDay === 1 ? ["breakfast"] : dosesPerDay === 2 ? ["breakfast", "dinner"] : ["breakfast", "lunch", "dinner"];
      const relationAnchors = parseTimingAnchors(`${timing} ${meals.join(" ")}`);
      slots = relationAnchors.map((a) => ({ ...a, basis: "SUGGESTED" as const }));
      issues.push({ severity: "warning", message: "The prescription says when to take it relative to meals but not which meals — the meals shown are suggestions." });
    } else {
      // Fewer anchors than doses: use the written anchors, suggest the rest.
      slots = anchors.map((a) => ({ ...a, basis: "WRITTEN_ANCHOR" as const }));
      for (const time of evenlySpaced(dosesPerDay)) {
        if (slots.length >= dosesPerDay) break;
        if (!slots.some((s) => s.timeOfDay === time)) slots.push({ timeOfDay: time, label: `Dose ${slots.length + 1}`, basis: "SUGGESTED" });
      }
      slots.sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay));
    }
  } else if (/\bmeals?\b|\bfood\b/i.test(allText) && dosesPerDay <= 3) {
    const meals: Meal[] = dosesPerDay === 1 ? ["breakfast"] : dosesPerDay === 2 ? ["breakfast", "dinner"] : ["breakfast", "lunch", "dinner"];
    slots = parseTimingAnchors(`${allText} ${meals.join(" ")}`).map((a) => ({ ...a, basis: "SUGGESTED" as const }));
    issues.push({ severity: "warning", message: "The prescription says when to take it relative to meals but not which meals — the meals shown are suggestions." });
  } else {
    const labels = fromFrequency?.suggestedLabels ?? fromDosage?.suggestedLabels ?? [];
    slots = evenlySpaced(dosesPerDay).map((timeOfDay, i) => ({ timeOfDay, label: labels[i] ?? `Dose ${i + 1}`, basis: "SUGGESTED" }));
    issues.push({
      severity: "info",
      message: `Only "${frequency || dosage}" is written, not the times. The times shown are evenly spaced suggestions — change them to fit your day.`,
    });
  }

  if (slots.length !== dosesPerDay) {
    return clarify("Scriptly couldn't line up the written timing with the number of doses a day. Please enter the times yourself.");
  }

  if (!doseAmount) {
    issues.push({ severity: "info", message: "The amount per dose isn't written in a form Scriptly can show on the reminder. Your confirmed instructions are shown instead." });
  }

  if (!durationDays) {
    issues.push({
      severity: "warning",
      message:
        "No duration is written. Choose how many days to continue — or 'ongoing' only if your prescriber said to keep taking it until told to stop.",
    });
  }

  const allAnchored = slots.every((s) => s.basis !== "SUGGESTED");
  return {
    status: allAnchored && durationDays ? "READY" : "NEEDS_TIME_CONFIRMATION",
    dosesPerDay,
    slots,
    doseAmount,
    durationDays,
    issues,
  };
}
