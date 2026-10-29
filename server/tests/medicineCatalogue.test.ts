import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Server } from "node:http";
import { prisma } from "@/db/prisma";
import { env } from "@/config/env";
import { detectFormMismatch, interpretQuery, normalizeStrength } from "@/services/medicine.service";
import { medicineContextLines } from "@/services/scripty/scripty.service";
import { validateCatalogueFile } from "../scripts/importCatalogue";
import { validateImageRow } from "../scripts/importImages";
import { AuthedAgent, closeServer, getServer, uniqueTestUser } from "./helpers/testClient";

// Catalogue search, detail, images and demo-data separation.
//
// Every fixture below is SYNTHETIC (isSynthetic: true): invented names
// starting with "Qv" so they cannot be mistaken for real products, made
// visible to tests by CATALOGUE_INCLUDE_SYNTHETIC=true in vitest.config.ts
// and removed afterwards. Nothing here is a claim about a real medicine.

let server: Server;
let user: AuthedAgent;
const ids: Record<string, string> = {};
const createdIds: string[] = [];
let imageId: string;
let imageFile: string;

const base = {
  countryOrMarket: "Pakistan",
  dataProvenance: "OTHER" as const,
  isSynthetic: true,
};

beforeAll(async () => {
  server = getServer();
  user = await AuthedAgent.register(server, uniqueTestUser("catalogue"));

  const make = async (key: string, data: Record<string, unknown>) => {
    const row = await prisma.medicineReference.create({ data: { ...base, ...data } as never });
    ids[key] = row.id;
    createdIds.push(row.id);
  };

  await make("tab10", {
    brandName: "Qvanol",
    genericName: "Qvacetamol",
    activeIngredient: "Qvacetamol",
    strength: "500 mg",
    formulation: "tablet",
    packSize: "10's",
    manufacturer: "Qv Pharma (fixture)",
    verificationStatus: "VERIFIED",
    lastVerifiedAt: new Date("2026-10-01T00:00:00Z"),
  });
  await make("tab20", {
    brandName: "Qvanol",
    genericName: "Qvacetamol",
    activeIngredient: "Qvacetamol",
    strength: "500mg",
    formulation: "tablet",
    packSize: "20's",
    referencePrice: "123.45",
    currency: "PKR",
    priceType: "OFFICIAL_MRP",
    priceSource: "Fixture source",
    priceSourceUrl: "https://example.test/price",
    priceEffectiveFrom: new Date("2026-09-01T00:00:00Z"),
    priceLastVerifiedAt: new Date("2026-10-01T00:00:00Z"),
  });
  await make("syrup", {
    brandName: "Qvanol",
    genericName: "Qvacetamol",
    activeIngredient: "Qvacetamol",
    strength: "120 mg/5 ml",
    formulation: "syrup",
    packSize: "60 ml",
  });
  await make("extra", {
    brandName: "Qvanol Extra",
    genericName: "Qvacetamol + Qvaffeine",
    activeIngredient: "Qvacetamol, Qvaffeine",
    strength: "500 mg",
    formulation: "tablet",
  });
  // Enough rows starting with "Qv" to need a second page.
  const filler = await prisma.medicineReference.createManyAndReturn({
    data: Array.from({ length: 22 }, (_, i) => ({
      ...base,
      brandName: `Qvfill ${String(i).padStart(2, "0")}`,
      genericName: "Qvfillerine",
      activeIngredient: "Qvfillerine",
      strength: `${i + 1} mg`,
      formulation: "capsule",
    })),
  });
  createdIds.push(...filler.map((row) => row.id));

  await prisma.medicineReferenceSource.create({
    data: {
      medicineReferenceId: ids.tab10,
      sourceName: "Fixture source",
      sourceUrl: "https://example.test/source",
      fieldsProvided: ["brand_name", "strength"],
      retrievedAt: new Date("2026-10-01T00:00:00Z"),
      permissionBasis: "Test fixture — not real data",
    },
  });

  // A real image file, attached only to the 10-pack.
  const buffer = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
  const storagePath = `test-${crypto.randomUUID()}.jpg`;
  fs.mkdirSync(path.resolve(env.medicineImageDir), { recursive: true });
  imageFile = path.resolve(env.medicineImageDir, storagePath);
  fs.writeFileSync(imageFile, buffer);
  const image = await prisma.medicineImage.create({
    data: {
      medicineReferenceId: ids.tab10,
      kind: "PACK_BOX",
      storagePath,
      mimeType: "image/jpeg",
      width: 400,
      height: 300,
      sourceName: "Fixture photo",
      licence: "Test fixture",
      attribution: "Generated blank image (test)",
      permissionBasis: "Test fixture",
      verifiedAt: new Date("2026-10-02T00:00:00Z"),
    },
  });
  imageId = image.id;
});

afterAll(async () => {
  await prisma.medicineReference.deleteMany({ where: { id: { in: createdIds } } });
  if (imageFile) fs.rmSync(imageFile, { force: true });
  await closeServer();
});

type Hit = { id: string; brandName: string | null; genericName: string; activeIngredient: string; strength: string | null; formulation: string | null; matchedOn: string; image: { url: string } | null };
const search = async (query: string, extra = "") => {
  const res = await user.get(`/api/medicines/search?q=${encodeURIComponent(query)}${extra}`);
  expect(res.status).toBe(200);
  return res.body as { total: number; hasMore: boolean; page: number; interpreted: { name: string; strength: string | null; form: string | null }; medicines: Hit[] };
};

describe("catalogue search", () => {
  it("1. finds a brand name, ranking exact brand matches first", async () => {
    const body = await search("Qvanol");
    const top = body.medicines.slice(0, 3).map((m) => m.brandName);
    expect(top.every((b) => b === "Qvanol")).toBe(true);
    expect(body.medicines[0].matchedOn).toBe("brandName");
    expect(body.medicines.some((m) => m.brandName === "Qvanol Extra")).toBe(true);
  });

  it("2. finds a generic ingredient", async () => {
    const body = await search("qvacetamol");
    expect(body.medicines.map((m) => m.id)).toEqual(expect.arrayContaining([ids.tab10, ids.tab20, ids.syrup]));
  });

  it("3. a one-letter prefix returns every match, paginated, with no overlap between pages", async () => {
    const page1 = await search("q", "&pageSize=20");
    const page2 = await search("q", "&pageSize=20&page=2");
    expect(page1.total).toBeGreaterThanOrEqual(26);
    expect(page1.medicines).toHaveLength(20);
    expect(page1.hasMore).toBe(true);
    const overlap = page2.medicines.filter((m) => page1.medicines.some((n) => n.id === m.id));
    expect(overlap).toEqual([]);
    for (const m of [...page1.medicines, ...page2.medicines]) {
      const words = [m.brandName, m.genericName, m.activeIngredient].join(" ").toLowerCase().split(/[^a-z0-9]+/);
      expect(words.some((w) => w.startsWith("q"))).toBe(true);
    }
  });

  it("4. applies a strength and dosage form typed into the query", async () => {
    const body = await search("qvanol 500 mg tab");
    expect(body.interpreted).toEqual({ name: "qvanol", strength: "500 mg", form: "tablet" });
    const found = body.medicines.map((m) => m.id);
    expect(found).toEqual(expect.arrayContaining([ids.tab10, ids.tab20]));
    expect(found).not.toContain(ids.syrup);
    for (const m of body.medicines) {
      expect(normalizeStrength(m.strength ?? "")).toMatch(/^500mg/);
      expect(m.formulation).toBe("tablet");
    }
  });

  it("tolerates a misspelling of a longer name", async () => {
    const body = await search("qvacetmol");
    expect(body.medicines.some((m) => m.id === ids.tab10)).toBe(true);
  });

  it("9. reports a genuine miss as an empty, counted result", async () => {
    const body = await search("qqzzxxnothing");
    expect(body.total).toBe(0);
    expect(body.medicines).toEqual([]);
  });

  it("returns the product photo with search results when one is verified", async () => {
    const body = await search("qvanol 500 mg tab");
    expect(body.medicines.find((m) => m.id === ids.tab10)?.image?.url).toBe(`/medicines/${ids.tab10}/images/${imageId}`);
    expect(body.medicines.find((m) => m.id === ids.tab20)?.image).toBeNull();
  });
});

describe("medicine detail page", () => {
  it("5/8. shows the stored fields, other packs, sources and last-verified dates", async () => {
    const res = await user.get(`/api/medicines/${ids.tab10}`);
    expect(res.status).toBe(200);
    expect(res.body.medicine).toMatchObject({ brandName: "Qvanol", strength: "500 mg", formulation: "tablet", packSize: "10's" });
    expect(res.body.medicine.lastVerifiedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(res.body.packs).toEqual([
      expect.objectContaining({ id: ids.tab20, packSize: "20's", price: expect.objectContaining({ amount: "123.45", priceType: "OFFICIAL_MRP" }) }),
    ]);
    expect(res.body.sources[0]).toMatchObject({ sourceName: "Fixture source", permissionBasis: "Test fixture — not real data" });
  });

  it("6. serves the verified photo with its attribution, only for its own product", async () => {
    const detail = await user.get(`/api/medicines/${ids.tab10}`);
    expect(detail.body.images).toEqual([
      expect.objectContaining({ id: imageId, kind: "PACK_BOX", attribution: "Generated blank image (test)", licence: "Test fixture" }),
    ]);
    expect(detail.body.images[0].storagePath).toBeUndefined();

    const img = await user.get(`/api/medicines/${ids.tab10}/images/${imageId}`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");

    // The same image id requested under a different product is not found.
    expect((await user.get(`/api/medicines/${ids.tab20}/images/${imageId}`)).status).toBe(404);
    expect((await user.get(`/api/medicines/${ids.tab20}`)).body.images).toEqual([]);
  });

  it("7. shows an unavailable price honestly and a verified one with its source and date", async () => {
    const unpriced = await user.get(`/api/medicines/${ids.tab10}`);
    expect(unpriced.body.price.status).toBe("UNAVAILABLE");

    const priced = await user.get(`/api/medicines/${ids.tab20}`);
    expect(priced.body.price.status).toBe("VERIFIED");
    expect(priced.body.price.price).toMatchObject({ priceType: "OFFICIAL_MRP", sourceName: "Fixture source", lastVerifiedAt: "2026-10-01T00:00:00.000Z" });
  });
});

describe("synthetic (demo) data separation", () => {
  it("10. synthetic medicines never reach users outside the test configuration", async () => {
    const before = env.catalogueIncludeSynthetic;
    (env as { catalogueIncludeSynthetic: boolean }).catalogueIncludeSynthetic = false;
    try {
      expect((await search("Qvanol")).total).toBe(0);
      // The ten generic medicines an old seed created are synthetic too.
      const paracetamol = await search("Paracetamol");
      const syntheticIds = new Set(
        (await prisma.medicineReference.findMany({ where: { isSynthetic: true }, select: { id: true } })).map((r) => r.id)
      );
      expect(paracetamol.medicines.some((m) => syntheticIds.has(m.id))).toBe(false);
      expect((await user.get(`/api/medicines/${ids.tab10}`)).status).toBe(404);
      expect((await user.get(`/api/medicines/${ids.tab10}/images/${imageId}`)).status).toBe(404);
      expect(await medicineContextLines(ids.tab10)).toEqual([]);
    } finally {
      (env as { catalogueIncludeSynthetic: boolean }).catalogueIncludeSynthetic = before;
    }
  });
});

describe("Medicine Info suggestions", () => {
  it("suggests only medicines that exist, each opening its real detail page", async () => {
    const res = await user.get("/api/medicines/suggestions");
    expect(res.status).toBe(200);
    for (const suggestion of res.body.suggestions as Array<{ id: string; label: string }>) {
      const record = await prisma.medicineReference.findUniqueOrThrow({ where: { id: suggestion.id } });
      expect(record.isSynthetic).toBe(false);
      expect(record.brandName).toBe(suggestion.label);
      expect((await user.get(`/api/medicines/${suggestion.id}`)).status).toBe(200);
    }
  });
});

describe("Scripty medicine context", () => {
  it("states unverified records as unverified and unknown fields as unknown", async () => {
    const lines = (await medicineContextLines(ids.extra)).join("\n");
    expect(lines).toContain(`medicineId ${ids.extra}`);
    expect(lines).toContain("This record is NOT verified");
    expect(lines).toMatch(/Pack size: not recorded \(unknown/);
    expect(lines).toContain("no verified price");
  });

  it("passes a verified price with its type and date", async () => {
    const lines = (await medicineContextLines(ids.tab20)).join("\n");
    expect(lines).toContain("official DRAP maximum retail price");
    expect(lines).toContain("2026-10-01");
  });
});

describe("dosage-form mismatch warning", () => {
  it("matches whole words, so a gelcap label is not reported as a gel", () => {
    expect(detectFormMismatch("tablet", "adults take 2 gelcaps every 6 hours")).toEqual({ productForm: "tablet", labelForms: ["gelcap"] });
    expect(detectFormMismatch("capsule", "swallow 1 tablet whole")).toEqual({ productForm: "capsule", labelForms: ["tablet"] });
    expect(detectFormMismatch("tablet", "take 2 tablets with water")).toBeNull();
  });
});

describe("query interpretation", () => {
  it("separates name, strength and form", () => {
    expect(interpretQuery("Augmentin 625mg tabs")).toEqual({ name: "Augmentin", strength: "625mg", form: "tablet" });
    expect(interpretQuery("hydryllin syp")).toEqual({ name: "hydryllin", strength: null, form: "syrup" });
    // A lone form word is a name, not a filter.
    expect(interpretQuery("tab")).toEqual({ name: "tab", strength: null, form: null });
    expect(interpretQuery("p")).toEqual({ name: "p", strength: null, form: null });
  });
});

describe("catalogue import validation", () => {
  const row = {
    brand_name: "Brand",
    generic_name: "Generic",
    active_ingredient: "Generic",
    strength: "500 mg",
    dosage_form: "Tab.",
    pack_size: "10's",
    source_name: "Source",
    source_url: "https://example.test",
    permission_basis: "Written permission ref 1",
    verified_on: "2026-10-01",
  };

  it("accepts a complete row and rejects duplicates of the same pack", () => {
    expect(validateCatalogueFile([row])).toEqual([]);
    const dup = validateCatalogueFile([row, { ...row, dosage_form: "tablet", strength: "500mg" }]);
    expect(dup[0].problems.join()).toMatch(/duplicate of line 2/);
  });

  it("requires a permission basis and an all-or-nothing price with its pack", () => {
    expect(validateCatalogueFile([{ ...row, permission_basis: "" }])[0].problems.join()).toMatch(/permission_basis/);
    expect(validateCatalogueFile([{ ...row, price_pkr: "100" }])[0].problems.join()).toMatch(/all present or all empty/);
    expect(
      validateCatalogueFile([{ ...row, pack_size: "", price_pkr: "100", price_type: "OFFICIAL_MRP", effective_from: "2026-01-01" }])[0].problems.join()
    ).toMatch(/needs pack_size/);
  });

  it("refuses a product photo not confirmed as the exact product", () => {
    const image = {
      generic_name: "Generic",
      strength: "500 mg",
      dosage_form: "tablet",
      image_file: "a.jpg",
      kind: "PACK_BOX",
      source_name: "Own photo",
      licence: "Own photograph",
      attribution: "Scriptly",
      permission_basis: "Own photograph of a purchased pack",
      verified_on: "2026-10-01",
      exact_product_confirmed: "no",
    };
    expect(validateImageRow(image).join()).toMatch(/exact_product_confirmed must be yes/);
    expect(validateImageRow({ ...image, exact_product_confirmed: "yes" })).toEqual([]);
  });
});
