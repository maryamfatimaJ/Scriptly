import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import { matchMedicineReference } from "@/services/medicineMatching.service";

// All seeded rows here use a "ZZTEST_" prefix so they're trivially
// distinguishable from real dev seed data and safe to clean up without
// touching anything else in the (shared, local) database — see
// helpers/testClient.ts for why these tests run against a live DB.
const PREFIX = "ZZTEST_";

describe("medicineMatching.service", () => {
  beforeAll(async () => {
    await prisma.medicineReference.createMany({
      data: [
        {
          genericName: `${PREFIX}Ibuprofen`,
          brandName: null,
          activeIngredient: "Ibuprofen",
          strength: "400 mg",
          formulation: "tablet",
          dataProvenance: "MANUAL",
          verificationStatus: "UNVERIFIED",
          isSynthetic: true,
        },
        // Two rows with the identical generic name/strength/form but
        // different manufacturers/provenance — a real case where name
        // alone can't disambiguate which product is meant.
        {
          genericName: `${PREFIX}DupMed`,
          brandName: "BrandOne",
          activeIngredient: "Test Ingredient",
          strength: "100 mg",
          formulation: "tablet",
          manufacturer: "Manufacturer One",
          dataProvenance: "MANUAL",
          verificationStatus: "UNVERIFIED",
          isSynthetic: true,
        },
        {
          genericName: `${PREFIX}DupMed`,
          brandName: "BrandTwo",
          activeIngredient: "Test Ingredient",
          strength: "100 mg",
          formulation: "tablet",
          manufacturer: "Manufacturer Two",
          dataProvenance: "OPENFDA",
          verificationStatus: "UNVERIFIED",
          isSynthetic: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.medicineReference.deleteMany({ where: { genericName: { startsWith: PREFIX } } });
  });

  it("returns NO_VERIFIED_RECORD for a name with nothing resembling it in the reference table", async () => {
    const result = await matchMedicineReference({ name: `${PREFIX}CompletelyFictionalDrugXyz` });
    expect(result.status).toBe("NO_VERIFIED_RECORD");
    expect(result.candidates).toEqual([]);
    expect(result.selectedId).toBeUndefined();
  });

  it("returns VERIFIED_MATCH and auto-selects only when name, strength, and form all agree", async () => {
    const result = await matchMedicineReference({
      name: `${PREFIX}Ibuprofen`,
      strength: "400 mg",
      form: "tablet",
    });
    expect(result.status).toBe("VERIFIED_MATCH");
    expect(result.selectedId).toBeTruthy();
  });

  it("returns POSSIBLE_MATCH (and does NOT auto-select) when the name matches but strength/form don't", async () => {
    const result = await matchMedicineReference({
      name: `${PREFIX}Ibuprofen`,
      strength: "200 mg", // seeded row is 400 mg
      form: "gel",
    });
    expect(result.status).toBe("POSSIBLE_MATCH");
    expect(result.selectedId).toBeUndefined();
    expect(result.candidates.length).toBe(1);
  });

  it("returns MULTIPLE_MATCHES (and does NOT auto-select) when more than one reference row is equally plausible", async () => {
    const result = await matchMedicineReference({
      name: `${PREFIX}DupMed`,
      strength: "100 mg",
      form: "tablet",
    });
    expect(result.status).toBe("MULTIPLE_MATCHES");
    expect(result.selectedId).toBeUndefined();
    expect(result.candidates.length).toBe(2);
  });

  it("treats a name-only input (no strength/form) as insufficient for VERIFIED_MATCH", async () => {
    const result = await matchMedicineReference({ name: `${PREFIX}Ibuprofen` });
    // Name matches, but with no strength/form to corroborate it, this must
    // not be auto-selected as verified.
    expect(result.status).not.toBe("VERIFIED_MATCH");
  });

  it("never fabricates a result when given no usable name at all", async () => {
    const result = await matchMedicineReference({ strength: "400 mg", form: "tablet" });
    expect(result.status).toBe("NO_VERIFIED_RECORD");
  });
});
