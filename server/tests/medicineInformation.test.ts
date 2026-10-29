import { afterEach, describe, expect, it, vi } from "vitest";
import { strengthsMatch } from "@/services/medicineInfo/price.service";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function labelResponse(results: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ results }),
  };
}

describe("openFDA label lookup", () => {
  it("picks the single-ingredient label over a combination product", async () => {
    // A phrase search for "amoxicillin" also matches "amoxicillin and
    // clavulanate potassium" — a DIFFERENT medicine. Showing a patient
    // the wrong leaflet is the failure mode this guards.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        labelResponse([
          {
            set_id: "combo",
            openfda: { generic_name: ["AMOXICILLIN AND CLAVULANATE POTASSIUM"] },
            indications_and_usage: ["Combination product."],
          },
          {
            set_id: "plain",
            openfda: { generic_name: ["AMOXICILLIN"] },
            indications_and_usage: ["Single ingredient."],
          },
        ])
      )
    );

    const { fetchLabelByIngredient } = await import("@/services/medicineInfo/openFdaClient");
    const label = await fetchLabelByIngredient("amoxicillin");

    expect(label?.displayName).toBe("AMOXICILLIN");
    expect(label?.uses).toContain("Single ingredient");
    expect(label?.sourceUrl).toContain("plain");
  });

  it("accepts a salt-form variant of the same single ingredient", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        labelResponse([{ set_id: "s", openfda: { generic_name: ["METFORMIN HYDROCHLORIDE"] }, indications_and_usage: ["x"] }])
      )
    );
    const { fetchLabelByIngredient } = await import("@/services/medicineInfo/openFdaClient");
    expect((await fetchLabelByIngredient("metformin"))?.displayName).toBe("METFORMIN HYDROCHLORIDE");
  });

  it("returns nothing rather than the wrong leaflet when only combinations match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        labelResponse([{ set_id: "c", openfda: { generic_name: ["ASPIRIN AND OMEPRAZOLE"] }, indications_and_usage: ["x"] }])
      )
    );
    const { fetchLabelByIngredient } = await import("@/services/medicineInfo/openFdaClient");
    expect(await fetchLabelByIngredient("omeprazole")).toBeNull();
  });

  it("treats a 404 as 'no label published', not as an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    const { fetchLabelByIngredient } = await import("@/services/medicineInfo/openFdaClient");
    expect(await fetchLabelByIngredient("nonexistent")).toBeNull();
  });

  it("raises a distinct error when the source is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    const { fetchLabelByIngredient } = await import("@/services/medicineInfo/openFdaClient");
    // "We could not check" must stay distinguishable from "there is no label".
    await expect(fetchLabelByIngredient("omeprazole")).rejects.toThrow(/returned HTTP 503/);
  });

  it("raises a rate-limit error rather than silently showing nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429 })));
    const { fetchLabelByIngredient } = await import("@/services/medicineInfo/openFdaClient");
    await expect(fetchLabelByIngredient("omeprazole")).rejects.toThrow(/rate-limiting/i);
  });

  it("neutralises query characters that would alter the upstream search", async () => {
    const fetchMock = vi.fn(async () => labelResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchLabelByIngredient } = await import("@/services/medicineInfo/openFdaClient");
    await fetchLabelByIngredient('omeprazole" OR generic_name:"aspirin');

    const url = fetchMock.mock.calls[0][0] as unknown as string;
    expect(url).not.toContain("OR+generic_name");
    expect(url.match(/"/g)?.length).toBe(4); // exactly the two quoted phrases we build
  });
});

describe("strength matching", () => {
  it("treats differently-spaced identical strengths as equal", () => {
    expect(strengthsMatch("500mg", "500 mg")).toBe(true);
    expect(strengthsMatch("500 MG", "500mg")).toBe(true);
  });

  it("treats a different strength as NOT a match", () => {
    // The core pricing safety rule: same brand, different strength is a
    // different product at a different price.
    expect(strengthsMatch("500 mg", "250 mg")).toBe(false);
  });

  it("compares across mass units rather than by string", () => {
    expect(strengthsMatch("1 g", "1000 mg")).toBe(true);
    expect(strengthsMatch("500 mcg", "0.5 mg")).toBe(true);
  });

  it("returns null — not a match — when a strength cannot be parsed", () => {
    // Callers must treat null as "cannot confirm", never as agreement.
    expect(strengthsMatch("as directed", "500 mg")).toBeNull();
    expect(strengthsMatch(null, "500 mg")).toBeNull();
  });
});

describe("dosage-form mismatch detection", () => {
  it("flags a capsule product whose label text describes tablets", async () => {
    // Real case: the omeprazole CAPSULE record attaches to a US label
    // whose dosing section says "swallow 1 tablet whole, do not chew or
    // crush tablets". The user must be told, not quietly shown it.
    const { detectFormMismatch } = await import("@/services/medicine.service");
    const result = detectFormMismatch("capsule", "Swallow 1 tablet whole. Do not chew or crush tablets.");
    expect(result).toEqual({ productForm: "capsule", labelForms: ["tablet"] });
  });

  it("does not flag when the label mentions the product's own form", async () => {
    const { detectFormMismatch } = await import("@/services/medicine.service");
    expect(detectFormMismatch("capsule", "Take one capsule daily.")).toBeNull();
  });

  it("does not flag when there is nothing to compare", async () => {
    const { detectFormMismatch } = await import("@/services/medicine.service");
    expect(detectFormMismatch(null, "Take one tablet.")).toBeNull();
    expect(detectFormMismatch("tablet", null)).toBeNull();
    expect(detectFormMismatch("tablet", "Take as directed.")).toBeNull();
  });
});

describe("over-the-counter label coverage", () => {
  it("reads side effects from the OTC Drug Facts fields when there is no adverse_reactions section", async () => {
    // OTC labels have no adverse_reactions/precautions sections at all.
    // Without these fallbacks a consumer medicine renders with NO side
    // effect information, which a patient reads as "it has none".
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              set_id: "otc",
              openfda: { generic_name: ["OMEPRAZOLE"] },
              indications_and_usage: ["treats frequent heartburn"],
              stop_use: ["Stop use and ask a doctor if your heartburn continues."],
              do_not_use: ["Do not use if you are allergic to omeprazole."],
              ask_doctor_or_pharmacist: ["Ask a doctor before use if you are taking warfarin."],
            },
          ],
        }),
      }))
    );

    const { fetchLabelByIngredient } = await import("@/services/medicineInfo/openFdaClient");
    const label = await fetchLabelByIngredient("omeprazole");

    // "Stop use and ask a doctor if" is treatment-failure criteria, NOT
    // adverse reactions — it must never be labelled "side effects".
    expect(label?.sideEffects).toBeUndefined();
    expect(label?.whenToStop).toContain("Stop use and ask a doctor");
    expect(label?.contraindications).toContain("allergic to omeprazole");
    expect(label?.precautions).toContain("warfarin");
  });
});

describe("avoiding duplicated label text", () => {
  it("drops the monolithic warnings blob when the granular sections already contain all of it", async () => {
    // On an OTC Drug Facts label, `warnings` is the whole Warnings block
    // and the granular fields are its own sub-sections. Rendering both
    // showed a patient the same sentences three times on one page.
    const doNotUse = "Do not use if you have trouble swallowing.";
    const stopUse = "Stop use and ask a doctor if your heartburn continues.";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              set_id: "otc",
              openfda: { generic_name: ["OMEPRAZOLE"] },
              warnings: [`Allergy alert. ${doNotUse} ${stopUse}`],
              do_not_use: [doNotUse],
              stop_use: [stopUse],
            },
          ],
        }),
      }))
    );

    const { fetchLabelByIngredient } = await import("@/services/medicineInfo/openFdaClient");
    const label = await fetchLabelByIngredient("omeprazole");

    expect(label?.warnings).toBeUndefined();
    expect(label?.contraindications).toBe(doNotUse);
    expect(label?.whenToStop).toBe(stopUse);
  });

  it("keeps the warnings blob when it carries content the granular sections do not", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              set_id: "rx",
              openfda: { generic_name: ["OMEPRAZOLE"] },
              warnings: ["Unique warning text found nowhere else."],
              stop_use: ["Stop use and ask a doctor if symptoms persist."],
            },
          ],
        }),
      }))
    );

    const { fetchLabelByIngredient } = await import("@/services/medicineInfo/openFdaClient");
    const label = await fetchLabelByIngredient("omeprazole");

    expect(label?.warnings).toContain("Unique warning text");
    expect(label?.whenToStop).toContain("symptoms persist");
  });
});

describe("INN to USAN ingredient synonyms", () => {
  it("maps Paracetamol to the name its US label is published under", async () => {
    // Pakistan prescribes Paracetamol; openFDA indexes it as
    // Acetaminophen. Without this, the single most common medicine in
    // the market showed "no information available".
    const { ingredientKeyFor } = await import("@/services/medicineInfo/monograph.service");
    expect(ingredientKeyFor("Paracetamol")).toBe("acetaminophen");
    expect(ingredientKeyFor("Paracetamol (Acetaminophen)")).toBe("acetaminophen");
  });

  it("maps other common INN/BAN spellings used in Pakistan", async () => {
    const { ingredientKeyFor } = await import("@/services/medicineInfo/monograph.service");
    expect(ingredientKeyFor("Salbutamol")).toBe("albuterol");
    expect(ingredientKeyFor("Frusemide")).toBe("furosemide");
    expect(ingredientKeyFor("Rifampicin")).toBe("rifampin");
  });

  it("leaves a name alone when no synonym applies, including salt stripping", async () => {
    const { ingredientKeyFor } = await import("@/services/medicineInfo/monograph.service");
    expect(ingredientKeyFor("Amoxicillin")).toBe("amoxicillin");
    expect(ingredientKeyFor("Metformin hydrochloride")).toBe("metformin");
  });
});
