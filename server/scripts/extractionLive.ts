// LIVE prescription-reading test — real images, REAL vision model.
//
//   npm run extraction:live -- <anthropic|google> <folder with rx1..rx4 images>
//
// Runs the actual application in-process (real HTTP routes, real
// database) with the chosen provider and the keys in server/.env, uploads
// each image, and prints exactly what the model read. Mechanical checks
// are applied where a right answer is knowable; the readings themselves
// are printed for a human to judge. Every call costs real API usage.
//
// Expected images (see the generator in the report):
//   rx1-printed-multiple.png   printed, 4 medicines, BD/SOS/OD/TDS
//   rx2-handwritten-blurry.jpg handwriting font, blurred, stored sideways (EXIF 6)
//   rx3-uncertain-name.png     a medicine name partly covered by an ink blot
//   rx4-missing-info.png       medicines with frequency / duration missing

import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { createApp } from "@/app";
import { setVisionClientForTests } from "@/services/extraction/AnthropicVisionProvider";

const provider = process.argv[2] as "anthropic" | "google";
const folder = process.argv[3];
if (!["anthropic", "google"].includes(provider) || !folder) {
  console.error("Usage: npm run extraction:live -- <anthropic|google> <image folder>");
  process.exit(2);
}
env.aiProvider = provider;

let base = "";
let failures = 0;
const results: Record<string, unknown> = {};

function check(label: string, ok: boolean, detail = "") {
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

class Session {
  private cookies = new Map<string, string>();
  private absorb(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const [k, ...v] = pair.split("=");
      this.cookies.set(k.trim(), v.join("="));
    }
  }
  private header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async call(p: string, options: { method?: string; body?: unknown; form?: FormData } = {}) {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {};
    if (method !== "GET") {
      const csrf = await fetch(`${base}/auth/csrf-token`, { headers: { Cookie: this.header() } });
      this.absorb(csrf);
      headers["x-csrf-token"] = (await csrf.json()).csrfToken;
    }
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    headers.Cookie = this.header();
    const res = await fetch(`${base}${p}`, {
      method,
      headers,
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
    this.absorb(res);
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  }
}

async function register(label: string) {
  const s = new Session();
  const res = await s.call("/auth/register", {
    method: "POST",
    body: { email: `live_rx_${label}_${Date.now()}@example.test`, password: "LiveTestPassword123!", fullName: `Live ${label}`, timezone: "Asia/Karachi" },
  });
  if (res.status !== 201) throw new Error(`register failed ${res.status}`);
  return s;
}

async function upload(session: Session, file: string) {
  const bytes = fs.readFileSync(path.join(folder, file));
  const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
  const form = new FormData();
  form.append("prescriptionImage", new Blob([bytes], { type: mime }), file);
  const res = await session.call("/prescriptions", { method: "POST", form });
  if (res.status !== 201) throw new Error(`upload failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.prescription.id as string;
}

type Med = Record<string, any>;
function show(meds: Med[], legibility: string | null, ms: number, warnings: Array<{ message: string }>) {
  console.log(`   read in ${(ms / 1000).toFixed(1)}s · legibility ${legibility ?? "n/a"} · ${meds.length} medicine(s)`);
  for (const w of warnings) console.log(`   page warning: ${w.message}`);
  for (const m of meds) {
    const src = m.extractionFieldSource ?? {};
    const flagged = Object.entries(src).filter(([, v]) => v === "UNCERTAIN" || v === "INFERRED");
    console.log(
      `   • ${m.extractedName} | strength=${m.extractedStrength} | form=${m.extractedForm} | dose=${m.extractedDosageInstructions} | freq=${m.extractedFrequency} | timing=${m.extractedTiming} | days=${m.extractedDurationDays} | qty=${m.extractedQuantity} | generic=${m.extractedGenericName}`
    );
    if (flagged.length) console.log(`       flagged: ${flagged.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    for (const w of m.extractionWarnings ?? []) console.log(`       ${w.severity}: ${w.field ? `${w.field}: ` : ""}${w.message}`);
  }
}

async function extract(session: Session, id: string) {
  const started = Date.now();
  const res = await session.call(`/prescriptions/${id}/extract`, { method: "POST" });
  return { res, ms: Date.now() - started };
}

const find = (meds: Med[], re: RegExp) => meds.find((m) => re.test(`${m.extractedName ?? ""} ${m.extractedBrand ?? ""}`));

async function main() {
  const server: Server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  console.log(`Provider: ${provider} (${provider === "anthropic" ? env.anthropicVisionModel : env.googleModel})\n`);

  const user = await register("a");
  const other = await register("b");

  // 1. Readable printed prescription, several medicines
  console.log("=== 1. Printed prescription, four medicines");
  const rx1 = await upload(user, "rx1-printed-multiple.png");
  let { res, ms } = await extract(user, rx1);
  check("extracted", res.status === 200, res.status === 200 ? "" : JSON.stringify(res.body.error));
  const meds1: Med[] = res.body.prescription?.medications ?? [];
  if (res.status === 200) show(meds1, res.body.prescription.extractionLegibility, ms, res.body.prescription.extractionOverallWarnings ?? []);
  check("found exactly the 4 written medicines", meds1.length === 4, `${meds1.length}`);
  check("Augmentin 625 mg read", /625/.test(find(meds1, /augmentin/i)?.extractedStrength ?? ""));
  check("Risek frequency kept as written (OD)", /\bOD\b/i.test(find(meds1, /risek/i)?.extractedFrequency ?? ""));
  check("Hydryllin has no invented strength", !find(meds1, /hydryllin/i)?.extractedStrength, find(meds1, /hydryllin/i)?.extractedStrength ?? "none");
  check("diagnosis/patient text not turned into a medicine", !meds1.some((m) => /sinusitis|test patient/i.test(m.extractedName ?? "")));
  results.rx1 = meds1;

  // 2. Blurry, handwritten, stored sideways
  console.log("\n=== 2. Handwritten-style, blurred, stored sideways (EXIF orientation 6)");
  const rx2 = await upload(user, "rx2-handwritten-blurry.jpg");
  ({ res, ms } = await extract(user, rx2));
  const meds2: Med[] = res.body.prescription?.medications ?? [];
  if (res.status === 200) show(meds2, res.body.prescription.extractionLegibility, ms, res.body.prescription.extractionOverallWarnings ?? []);
  else console.log(`   error: ${JSON.stringify(res.body.error)}`);
  check("extracted", res.status === 200, res.status === 200 ? "" : res.body.error?.message);
  check("read all 3 medicines", meds2.length === 3, `${meds2.length}`);
  check("Flagyl dose positions kept as written (1+1+1)", /1\s*\+\s*1\s*\+\s*1/.test(find(meds2, /flagyl/i)?.extractedFrequency ?? ""));
  check("Omeprazole duration left empty (none written)", find(meds2, /omeprazole/i)?.extractedDurationDays == null);
  results.rx2 = meds2;

  // 3. Uncertain medicine name
  console.log("\n=== 3. Medicine name partly covered by an ink blot");
  const rx3 = await upload(user, "rx3-uncertain-name.png");
  ({ res, ms } = await extract(user, rx3));
  const meds3: Med[] = res.body.prescription?.medications ?? [];
  check("extracted", res.status === 200, res.status === 200 ? "" : res.body.error?.message);
  if (res.status === 200) show(meds3, res.body.prescription.extractionLegibility, ms, res.body.prescription.extractionOverallWarnings ?? []);
  const blotted = meds3.find((m) => /^kla/i.test(m.extractedName ?? "") || /klar/i.test(m.extractedName ?? ""));
  check("the obscured medicine is reported", Boolean(blotted), blotted?.extractedName ?? "missing");
  check(
    "its name is flagged UNCERTAIN, not confidently completed",
    blotted?.extractionFieldSource?.name === "UNCERTAIN" ||
      (blotted?.extractionWarnings ?? []).some((w: any) => w.severity === "critical" && (w.field === "name" || /name/i.test(w.message))),
    blotted ? `source=${blotted.extractionFieldSource?.name}` : ""
  );
  check("Zyrtec read normally", Boolean(find(meds3, /zyrtec/i)));
  results.rx3 = meds3;

  // 4. Missing frequency / duration
  console.log("\n=== 4. Missing frequency and duration");
  const rx4 = await upload(user, "rx4-missing-info.png");
  ({ res, ms } = await extract(user, rx4));
  const meds4: Med[] = res.body.prescription?.medications ?? [];
  check("extracted", res.status === 200, res.status === 200 ? "" : res.body.error?.message);
  if (res.status === 200) show(meds4, res.body.prescription.extractionLegibility, ms, res.body.prescription.extractionOverallWarnings ?? []);
  const glucophage = find(meds4, /glucophage/i);
  // Each check requires the medicine to have been read — an empty result
  // must never pass as "nothing invented".
  const ventolin = find(meds4, /ventolin/i);
  check("Glucophage: no frequency invented", Boolean(glucophage) && glucophage!.extractedFrequency == null, String(glucophage?.extractedFrequency));
  check("Ventolin: no frequency invented", Boolean(ventolin) && ventolin!.extractedFrequency == null, String(ventolin?.extractedFrequency));
  check("no durations invented", meds4.length === 3 && meds4.every((m) => m.extractedDurationDays == null));
  results.rx4 = meds4;

  // Missing frequency -> confirmed as written -> the planner refuses to schedule.
  if (glucophage) {
    await user.call(`/medications/${glucophage.id}`, {
      method: "PATCH",
      body: { reviewStatus: "CONFIRMED", confirmedName: "Glucophage", confirmedStrength: "500 mg", confirmedForm: "tablet", confirmedDosageInstructions: "1 tablet", confirmedFrequency: "as directed" },
    });
    const preview = await user.call(`/medications/${glucophage.id}/schedule-preview`);
    check("no schedule proposed for a missing/unclear frequency", preview.body.preview?.proposal?.status === "NEEDS_CLARIFICATION", preview.body.preview?.proposal?.issues?.[0]?.message);
  }

  // 6. Confirming prescription 1 creates the right records.
  console.log("\n=== 6. Confirm prescription 1 → schedules → database records");
  const augmentin = find(meds1, /augmentin/i);
  const risek = find(meds1, /risek/i);
  const panadol = find(meds1, /panadol/i);
  const hydryllin = find(meds1, /hydryllin/i);
  const confirmAsRead = (m: Med) =>
    user.call(`/medications/${m.id}`, {
      method: "PATCH",
      body: {
        reviewStatus: "CONFIRMED",
        confirmedName: m.extractedName,
        confirmedStrength: m.extractedStrength ?? undefined,
        confirmedForm: m.extractedForm ?? undefined,
        confirmedDosageInstructions: m.extractedDosageInstructions,
        confirmedFrequency: m.extractedFrequency,
        confirmedTiming: m.extractedTiming ?? undefined,
        confirmedDurationDays: m.extractedDurationDays ?? undefined,
      },
    });
  if (augmentin && risek && panadol && hydryllin) {
    await confirmAsRead(augmentin);
    await confirmAsRead(risek);
    await confirmAsRead(hydryllin);
    await user.call(`/medications/${panadol.id}`, { method: "PATCH", body: { reviewStatus: "NEEDS_CLARIFICATION", reviewNotes: "SOS — ask how many per day is safe" } });
    const approved = await user.call(`/prescriptions/${rx1}/approve`, { method: "POST" });
    check("prescription saved", approved.status === 200, approved.body?.error?.message);

    for (const m of [augmentin, risek, hydryllin]) {
      const preview = await user.call(`/medications/${m.id}/schedule-preview`);
      const p = preview.body.preview.proposal;
      console.log(`   ${m.extractedName}: ${p.status} · ${p.slots.map((s: any) => `${s.timeOfDay} ${s.label} [${s.basis}]`).join(", ")} · ${p.durationDays ?? "?"} days`);
      for (const i of p.issues) console.log(`     ${i.severity}: ${i.message}`);
      if (p.slots.length > 0 && p.durationDays) {
        const saved = await user.call("/schedule", {
          method: "POST",
          body: { medicationId: m.id, startDate: p.startDate, endDate: p.endDate, slots: p.slots.map((s: any) => ({ timeOfDay: s.timeOfDay, label: s.label })), doseAmount: p.doseAmount ?? undefined },
        });
        check(`schedule saved for ${m.extractedName}`, saved.status === 201, saved.body?.error?.message);
      }
    }
    const augmentinPlan = await user.call(`/medications/${augmentin.id}/schedule-preview`);
    check("Augmentin BD after meals → 2 meal-anchored doses for 5 days", augmentinPlan.body.preview.proposal.slots.length === 2 && augmentinPlan.body.preview.proposal.durationDays === 5);

    const summary = await user.call(`/prescriptions/${rx1}/summary`);
    console.log(`   summary: ${summary.body.medicines.length} confirmed, outstanding: ${summary.body.outstanding.map((o: any) => o.name).join(", ")}`);
    check("Panadol (SOS) listed as outstanding, not scheduled", summary.body.outstanding.some((o: any) => /panadol/i.test(o.name ?? "")));
    const dbSchedules = await prisma.schedule.findMany({
      where: { medication: { prescriptionId: rx1 } },
      include: { slots: true, medication: true, _count: { select: { slots: true } } },
    });
    const reminderCount = await prisma.reminder.count({ where: { scheduleSlot: { schedule: { medication: { prescriptionId: rx1 } } } } });
    console.log(`   database: ${dbSchedules.length} schedules, ${reminderCount} reminder rows`);
    const augmentinRows = await prisma.reminder.count({ where: { scheduleSlot: { schedule: { medicationId: augmentin.id } } } });
    check("Augmentin: 2 doses × 5 days = 10 reminder rows", augmentinRows === 10, `${augmentinRows}`);

    // 5. Price
    const augmentinPrice = summary.body.medicines.find((m: any) => /augmentin/i.test(m.name))?.price;
    console.log(`   price: ${augmentinPrice?.status} — ${augmentinPrice?.reason ?? ""}`);
    check("unverified price shown as unavailable, no figure", augmentinPrice?.status === "UNAVAILABLE" && !JSON.stringify(augmentinPrice).includes('"amount"'));
    results.summary = summary.body;
  } else {
    check("prescription 1 medicines available for the workflow", false);
  }

  // 10. Another user's prescription
  console.log("\n=== 10. Another user tries prescription 1");
  for (const [label, p] of [
    ["read it", `/prescriptions/${rx1}`],
    ["view its image", `/prescriptions/${rx1}/image`],
    ["read its summary", `/prescriptions/${rx1}/summary`],
  ] as const) {
    const r = await other.call(p);
    check(`cannot ${label}`, r.status === 404, `${r.status}`);
  }
  const otherExtract = await other.call(`/prescriptions/${rx2}/extract`, { method: "POST" });
  check("cannot re-run extraction on it", otherExtract.status === 404, `${otherExtract.status}`);

  // 9. Provider error (REAL request with a deliberately invalid credential)
  console.log("\n=== 9. Provider failure, then retry");
  const rx9 = await upload(user, "rx4-missing-info.png");
  const savedGoogleKey = env.googleApiKey;
  if (provider === "anthropic") setVisionClientForTests(new Anthropic({ apiKey: "invalid-test-key", maxRetries: 0 }));
  else env.googleApiKey = "invalid-test-key";
  const failed = await extract(user, rx9);
  console.log(`   HTTP ${failed.res.status} · ${failed.res.body.error?.details?.kind} · "${failed.res.body.error?.message}"`);
  check("honest error, not data", failed.res.status >= 400 && !failed.res.body.prescription);
  const afterFail = await user.call(`/prescriptions/${rx9}`);
  check("no medicines stored from the failed attempt", afterFail.body.prescription.medications.length === 0);
  setVisionClientForTests(null);
  env.googleApiKey = savedGoogleKey;
  const retried = await extract(user, rx9);
  check("retry succeeds once the provider works", retried.res.status === 200, `${retried.res.status}`);

  fs.writeFileSync(path.join(folder, `results-${provider}.json`), JSON.stringify(results, null, 2));
  console.log(`\n${failures === 0 ? "All live checks passed." : `${failures} live check(s) failed.`}`);
  server.close();
  await prisma.$disconnect();
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
