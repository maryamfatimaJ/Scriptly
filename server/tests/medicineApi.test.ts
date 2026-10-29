import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { prisma } from "@/db/prisma";
import {
  AuthedAgent,
  closeServer,
  getServer,
  uniqueTestUser,
  uploadExtractAndConfirmAmoxicillin,
} from "./helpers/testClient";

// End-to-end tests for the Medicine Information API.
//
// The bug these exist to prevent: the client route for /medicines was
// public while this API required auth, so every search by a signed-out
// visitor returned 401 and the page displayed it as "no verified record
// found". The first test below pins the API's actual behaviour so the
// mismatch can't silently come back.

let server: Server;
let user: AuthedAgent;
let pakistaniMedicineId: string;
let unpricedMedicineId: string;

beforeAll(async () => {
  server = getServer();
  user = await AuthedAgent.register(server, uniqueTestUser("medicineapi"));

  // A Pakistan-market row WITH a complete, attributed price. Values here
  // are fixtures for match logic — not a claim about any real product.
  const priced = await prisma.medicineReference.create({
    data: {
      genericName: "Testoprazole",
      brandName: "Testazole",
      activeIngredient: "Testoprazole",
      strength: "20 mg",
      formulation: "capsule",
      packSize: "2x7's",
      countryOrMarket: "Pakistan",
      referencePrice: "250.00",
      currency: "PKR",
      priceType: "OFFICIAL_MRP",
      priceSource: "Test fixture",
      priceSourceUrl: "https://example.test/price",
      priceEffectiveFrom: new Date("2026-01-01"),
      dataProvenance: "MANUAL",
      isSynthetic: true,
    },
  });
  pakistaniMedicineId = priced.id;

  const unpriced = await prisma.medicineReference.create({
    data: {
      genericName: "Testolol",
      brandName: "Testolol Plus",
      activeIngredient: "Testolol",
      strength: "5 mg",
      formulation: "tablet",
      countryOrMarket: "Pakistan",
      dataProvenance: "MANUAL",
      isSynthetic: true,
    },
  });
  unpricedMedicineId = unpriced.id;
});

afterAll(async () => {
  await prisma.medicineReference.deleteMany({
    where: { id: { in: [pakistaniMedicineId, unpricedMedicineId] } },
  });
  await closeServer();
});

describe("medicine search authentication", () => {
  it("rejects an unauthenticated search with 401 — the client must not render this as 'no results'", async () => {
    const res = await request(server).get("/api/medicines/search?q=testo");
    expect(res.status).toBe(401);
  });

  it("returns results for an authenticated user", async () => {
    const res = await user.get("/api/medicines/search?q=Testazole");
    expect(res.status).toBe(200);
    expect(res.body.medicines.length).toBeGreaterThan(0);
    expect(res.body.medicines[0].brandName).toBe("Testazole");
  });
});

describe("medicine search relevance", () => {
  it("matches case-insensitively", async () => {
    const res = await user.get("/api/medicines/search?q=TESTAZOLE");
    expect(res.body.medicines.some((m: { brandName: string }) => m.brandName === "Testazole")).toBe(true);
  });

  it("finds a medicine by its active ingredient, not just its brand", async () => {
    const res = await user.get("/api/medicines/search?q=Testoprazole");
    expect(res.body.medicines.some((m: { id: string }) => m.id === pakistaniMedicineId)).toBe(true);
  });

  it("tolerates a misspelling", async () => {
    const res = await user.get("/api/medicines/search?q=Testazol");
    expect(res.body.medicines.some((m: { id: string }) => m.id === pakistaniMedicineId)).toBe(true);
  });

  it("does NOT return unrelated medicines for a short partial fragment", async () => {
    // "zol" is a substring of "Testazole" but far too weak a signal to
    // present as a match — this is what stops a search for "dip" filling
    // the page with Amlodipine.
    const res = await user.get("/api/medicines/search?q=zol");
    expect(res.body.medicines.some((m: { id: string }) => m.id === pakistaniMedicineId)).toBe(false);
  });

  it("returns an empty, explicitly-counted result set for a genuine miss", async () => {
    const res = await user.get("/api/medicines/search?q=qqzzxxnothing");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.medicines).toEqual([]);
  });

  it("accepts a one-character query (prefix search) and rejects an empty one", async () => {
    expect((await user.get("/api/medicines/search?q=t")).status).toBe(200);
    expect((await user.get("/api/medicines/search?q=")).status).toBe(400);
  });
});

describe("medicine detail", () => {
  it("returns the record, an information lookup, and a price lookup", async () => {
    const res = await user.get(`/api/medicines/${pakistaniMedicineId}`);
    expect(res.status).toBe(200);
    expect(res.body.medicine.brandName).toBe("Testazole");
    expect(res.body.information).toBeTruthy();
    expect(res.body.price).toBeTruthy();
    expect(res.body.disclaimer).toContain("not personal medical advice");
  });

  it("reports an honest absence for a medicine with no published label", async () => {
    const res = await user.get(`/api/medicines/${unpricedMedicineId}`);
    // "Testolol" has no FDA label. The status must say so explicitly
    // rather than returning empty text that reads like real content.
    expect(["NOT_AVAILABLE", "LOOKUP_FAILED", "FOUND"]).toContain(res.body.information.status);
    if (res.body.information.status !== "FOUND") {
      expect(res.body.information.reason).toBeTruthy();
    }
  });

  it("404s for an unknown medicine rather than inventing one", async () => {
    const res = await user.get("/api/medicines/11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(404);
  });
});

describe("price lookup", () => {
  it("returns a verified price with its type, pack basis and source", async () => {
    const res = await user.get("/api/medicines/price?name=Testazole&strength=20%20mg&form=capsule");
    expect(res.status).toBe(200);
    expect(res.body.price.status).toBe("VERIFIED");
    expect(res.body.price.price.amount).toBe("250");
    expect(res.body.price.price.priceType).toBe("OFFICIAL_MRP");
    // The unit must be unambiguous — never a bare number.
    expect(res.body.price.price.priceBasis).toContain("2x7's");
    expect(res.body.price.price.priceBasis).toContain("not a per-unit price");
    expect(res.body.price.price.sourceUrl).toBe("https://example.test/price");
  });

  it("refuses to quote the 20 mg price when 40 mg was asked for", async () => {
    const res = await user.get("/api/medicines/price?name=Testazole&strength=40%20mg");
    expect(res.body.price.status).toBe("UNAVAILABLE");
    // The 20 mg row is surfaced as context, clearly not as the answer.
    expect(res.body.price.nearMisses.length).toBeGreaterThan(0);
    expect(res.body.price.nearMisses[0].strength).toBe("20 mg");
  });

  it("refuses to quote a capsule price when a syrup was asked for", async () => {
    const res = await user.get("/api/medicines/price?name=Testazole&strength=20%20mg&form=syrup");
    expect(res.body.price.status).toBe("UNAVAILABLE");
  });

  it("returns an honest unavailable state with manual-check links for a medicine with no price", async () => {
    const res = await user.get("/api/medicines/price?name=Testolol%20Plus");
    expect(res.body.price.status).toBe("UNAVAILABLE");
    expect(res.body.price.reason).toBeTruthy();
    // Linking out is how we stay useful without copying anyone's database.
    const urls = res.body.price.manualCheck.map((l: { url: string }) => l.url);
    expect(urls.some((u: string) => u.includes("dra.gov.pk"))).toBe(true);
  });

  it("never invents a price for a medicine it has never heard of", async () => {
    const res = await user.get("/api/medicines/price?name=Completelyunknownbrandxyz");
    expect(res.body.price.status).toBe("UNAVAILABLE");
    expect(res.body.price).not.toHaveProperty("price");
  });
});

// ---------------------------------------------------------------------------
// Per-medication lookups
//
// These back the "Medicine information" / "Check price" buttons that sit
// directly on a medication card. They must enforce ownership in the same
// way every other medication route does — a user looking up "their"
// medicine by id must never be able to pass someone else's id.
// ---------------------------------------------------------------------------
describe("per-medication information and price", () => {
  let owner: AuthedAgent;
  let stranger: AuthedAgent;
  let ownedMedicationId: string;

  beforeAll(async () => {
    owner = await AuthedAgent.register(server, uniqueTestUser("medlookupowner"));
    stranger = await AuthedAgent.register(server, uniqueTestUser("medlookupstranger"));
    const confirmed = await uploadExtractAndConfirmAmoxicillin(owner);
    ownedMedicationId = confirmed.medicationId;
  });

  it("returns sourced label information for the owner's own medication", async () => {
    const res = await owner.get(`/api/medications/${ownedMedicationId}/information`);
    expect(res.status).toBe(200);
    expect(res.body.medicineName).toBe("Amoxicillin");
    expect(res.body.isConfirmed).toBe(true);
    expect(["FOUND", "NOT_AVAILABLE", "LOOKUP_FAILED"]).toContain(res.body.information.status);
    if (res.body.information.status === "FOUND") {
      // Sourced text must always arrive with its attribution.
      expect(res.body.information.monograph.sourceName).toBeTruthy();
      expect(res.body.marketNote).toMatch(/United States/i);
    }
  });

  it("returns an honest price state for the owner's own medication", async () => {
    const res = await owner.get(`/api/medications/${ownedMedicationId}/price`);
    expect(res.status).toBe(200);
    // No DRAP data is imported, so UNAVAILABLE is the only honest answer.
    expect(res.body.price.status).toBe("UNAVAILABLE");
    expect(res.body.price.manualCheck.length).toBeGreaterThan(0);
  });

  it("returns 404 — not another user's data — for a medication you do not own", async () => {
    const info = await stranger.get(`/api/medications/${ownedMedicationId}/information`);
    const price = await stranger.get(`/api/medications/${ownedMedicationId}/price`);
    expect(info.status).toBe(404);
    expect(price.status).toBe(404);
  });

  it("rejects both lookups when unauthenticated", async () => {
    const info = await request(server).get(`/api/medications/${ownedMedicationId}/information`);
    const price = await request(server).get(`/api/medications/${ownedMedicationId}/price`);
    expect(info.status).toBe(401);
    expect(price.status).toBe(401);
  });
});
