import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getServer, closeServer, AuthedAgent, uniqueTestUser, TINY_JPEG } from "./helpers/testClient";

// End-to-end coverage of the capture -> extract -> review -> approve
// pipeline, run against the real app and a real Postgres database (see
// helpers/testClient.ts for why). Uses AI_PROVIDER=mock, so "extraction"
// here means the deterministic MockExtractionProvider output — these
// tests are about the PIPELINE's behavior (ownership, validation,
// idempotency, status transitions), not about real OCR accuracy.
describe("prescription capture -> extraction -> review -> approval workflow", () => {
  const server = getServer();

  afterAll(() => closeServer());

  it("rejects unauthenticated upload attempts", async () => {
    const res = await request(server).post("/api/prescriptions").attach("prescriptionImage", TINY_JPEG, "test.jpg");
    expect(res.status).toBe(401);
  });

  describe("upload validation", () => {
    it("rejects an unsupported file type", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("badmime"));
      const res = await user.uploadPrescription(Buffer.from("not an image"), "notes.txt", "text/plain");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
    });

    it("rejects an oversized upload", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("oversize"));
      // Default MAX_UPLOAD_SIZE_MB is 10 — 11MB of filler bytes exceeds it.
      const oversized = Buffer.alloc(11 * 1024 * 1024, 1);
      const res = await user.uploadPrescription(oversized, "huge.jpg", "image/jpeg");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toContain("UPLOAD_ERROR");
    });

    it("accepts a valid JPEG upload and stores it as UPLOADED", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("validupload"));
      const res = await user.uploadPrescription(TINY_JPEG, "prescription.jpg", "image/jpeg");
      expect(res.status).toBe(201);
      expect(res.body.prescription.status).toBe("UPLOADED");
      // The raw file path must never be exposed to the client.
      expect(res.body.prescription.imagePath).toBeUndefined();
    });
  });

  describe("extraction", () => {
    it("runs the mock provider and produces clearly-labeled, varied-confidence candidates", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("extract"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;

      const res = await user.post(`/api/prescriptions/${id}/extract`);
      expect(res.status).toBe(200);
      expect(res.body.prescription.status).toBe("EXTRACTED");
      expect(res.body.prescription.aiProvider).toBe("mock");

      const medications: any[] = res.body.prescription.medications;
      expect(medications.length).toBeGreaterThanOrEqual(3);
      expect(medications.every((m) => m.reviewStatus === "NEEDS_REVIEW")).toBe(true);

      // High-confidence candidate (Amoxicillin in the mock data).
      const clean = medications.find((m) => m.extractedName === "Amoxicillin");
      expect(clean).toBeTruthy();
      expect(clean.extractionConfidence).toBeGreaterThan(0.8);

      // Ambiguous/low-confidence candidate (Paracetamol) must carry warnings,
      // not a silently "cleaned up" value.
      const ambiguous = medications.find((m) => m.extractedName === "Paracetamol");
      expect(ambiguous).toBeTruthy();
      expect(ambiguous.extractionWarnings.length).toBeGreaterThan(0);

      // Missing/unreadable field (Cetirizine's frequency) must be left
      // unset with a critical warning — never guessed.
      const unreadable = medications.find((m) => m.extractedName === "Cetirizine");
      expect(unreadable).toBeTruthy();
      expect(unreadable.extractedFrequency ?? null).toBeNull();
      expect(
        unreadable.extractionWarnings.some((w: any) => w.severity === "critical" && w.field === "frequency")
      ).toBe(true);
    });

    it("is safe to retry before anything has been reviewed (no duplicate medications)", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("retry"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;

      const first = await user.post(`/api/prescriptions/${id}/extract`);
      const firstCount = first.body.prescription.medications.length;

      const second = await user.post(`/api/prescriptions/${id}/extract`);
      expect(second.status).toBe(200);
      expect(second.body.prescription.medications.length).toBe(firstCount);
    });

    it("blocks re-extraction once a medication has been reviewed, to protect the user's work", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("blockretry"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;
      await user.post(`/api/prescriptions/${id}/extract`);

      const prescription = await user.get(`/api/prescriptions/${id}`);
      const medicationId = prescription.body.prescription.medications[0].id;
      await user.patch(`/api/medications/${medicationId}`, { reviewStatus: "REJECTED" });

      const retry = await user.post(`/api/prescriptions/${id}/extract`);
      expect(retry.status).toBe(409);
    });

    it("blocks extraction on an already-finalized (approved) prescription", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("finalized"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;
      const extracted = await user.post(`/api/prescriptions/${id}/extract`);

      await resolveAndApprove(user, id, extracted.body.prescription.medications);

      const retry = await user.post(`/api/prescriptions/${id}/extract`);
      expect(retry.status).toBe(409);
    });

    it("returns 404, not someone else's data, when extracting a prescription you don't own", async () => {
      const owner = await AuthedAgent.register(server, uniqueTestUser("owner"));
      const intruder = await AuthedAgent.register(server, uniqueTestUser("intruder"));
      const upload = await owner.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;

      const res = await intruder.post(`/api/prescriptions/${id}/extract`);
      expect(res.status).toBe(404);
    });
  });

  describe("medicine reference matching", () => {
    it("auto-selects a verified match only when name, strength, and form all agree", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("matching"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;
      const extracted = await user.post(`/api/prescriptions/${id}/extract`);

      const amoxicillin = extracted.body.prescription.medications.find((m: any) => m.extractedName === "Amoxicillin");
      // The (synthetic) dev seed holds "Amoxicillin 500 mg capsule", an exact
      // match for the mock candidate. Real catalogue products with the same
      // ingredient but another strength/form (e.g. Amoxil Forte 250 mg/5 ml
      // suspension) may also be candidates — then nothing is auto-selected.
      const top = amoxicillin.referenceMatchCandidates[0];
      expect(top).toMatchObject({ genericName: "Amoxicillin", strength: "500 mg", formulation: "capsule" });
      if (amoxicillin.referenceMatchStatus === "VERIFIED_MATCH") {
        expect(amoxicillin.medicineReferenceId).toBe(top.id);
      } else {
        expect(amoxicillin.referenceMatchStatus).toBe("MULTIPLE_MATCHES");
        expect(amoxicillin.medicineReferenceId).toBeNull();
      }
    });
  });

  describe("review and approval gating", () => {
    it("rejects confirming a medication that's missing required fields", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("incompleteconfirm"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;
      const extracted = await user.post(`/api/prescriptions/${id}/extract`);
      const medicationId = extracted.body.prescription.medications[0].id;

      // No confirmedDosageInstructions/confirmedFrequency supplied.
      const res = await user.patch(`/api/medications/${medicationId}`, { reviewStatus: "CONFIRMED" });
      expect(res.status).toBe(400);
    });

    it("refuses to approve while any medication is still unresolved", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("incompleteapprove"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;
      await user.post(`/api/prescriptions/${id}/extract`);

      const res = await user.post(`/api/prescriptions/${id}/approve`);
      expect(res.status).toBe(422);
    });

    it("approves once every medication is confirmed or rejected, and records an audit trail", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("fullapprove"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;
      const extracted = await user.post(`/api/prescriptions/${id}/extract`);

      for (const medication of extracted.body.prescription.medications) {
        const confirmRes = await user.patch(`/api/medications/${medication.id}`, {
          reviewStatus: "CONFIRMED",
          confirmedName: medication.extractedName ?? "Unnamed",
          confirmedDosageInstructions: medication.extractedDosageInstructions ?? "Take as directed by a pharmacist",
          confirmedFrequency: medication.extractedFrequency ?? "once daily",
        });
        expect(confirmRes.status).toBe(200);
      }

      const approve = await user.post(`/api/prescriptions/${id}/approve`);
      expect(approve.status).toBe(200);
      expect(approve.body.prescription.status).toBe("APPROVED");
    });

    it("blocks editing a medication once its prescription has been finalized", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("editafterfinal"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;
      const extracted = await user.post(`/api/prescriptions/${id}/extract`);

      await resolveAndApprove(user, id, extracted.body.prescription.medications);

      // A medicine that was confirmed or removed at approval is frozen.
      const medicationId = extracted.body.prescription.medications[0].id;
      const res = await user.patch(`/api/medications/${medicationId}`, { reviewStatus: "REJECTED" });
      expect(res.status).toBe(409);
    });
  });

  describe("reject and request-clarification", () => {
    it("allows rejecting a prescription with a reason", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("reject"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;

      const res = await user.post(`/api/prescriptions/${id}/reject`, { reason: "Wrong patient" });
      expect(res.status).toBe(200);
      expect(res.body.prescription.status).toBe("REJECTED");
    });

    it("allows requesting professional clarification with a note", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("clarify"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;

      const res = await user.post(`/api/prescriptions/${id}/request-clarification`, {
        note: "Handwriting on the second line is illegible",
      });
      expect(res.status).toBe(200);
      expect(res.body.prescription.status).toBe("NEEDS_CLARIFICATION");
    });

    it("requires a non-empty clarification note", async () => {
      const user = await AuthedAgent.register(server, uniqueTestUser("emptyclarify"));
      const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const id = upload.body.prescription.id;

      const res = await user.post(`/api/prescriptions/${id}/request-clarification`, { note: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("ownership isolation", () => {
    it("does not let one user see another user's prescriptions in their list", async () => {
      const userA = await AuthedAgent.register(server, uniqueTestUser("listA"));
      const userB = await AuthedAgent.register(server, uniqueTestUser("listB"));
      await userA.uploadPrescription(TINY_JPEG, "a.jpg", "image/jpeg");

      const listB = await userB.get("/api/prescriptions");
      expect(listB.status).toBe(200);
      expect(listB.body.prescriptions).toEqual([]);
    });

    it("returns 404 for a PATCH on a medication you don't own", async () => {
      const owner = await AuthedAgent.register(server, uniqueTestUser("medowner"));
      const intruder = await AuthedAgent.register(server, uniqueTestUser("medintruder"));
      const upload = await owner.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
      const extracted = await owner.post(`/api/prescriptions/${upload.body.prescription.id}/extract`);
      const medicationId = extracted.body.prescription.medications[0].id;

      const res = await intruder.patch(`/api/medications/${medicationId}`, { reviewStatus: "REJECTED" });
      expect(res.status).toBe(404);
    });
  });
});


/**
 * Approval needs every medicine decided and at least one confirmed:
 * confirm the first medicine (with the fields a confirmation requires)
 * and remove the rest.
 */
async function resolveAndApprove(user: AuthedAgent, prescriptionId: string, medications: Array<{ id: string; extractedName: string }>) {
  const [first, ...rest] = medications;
  await user.patch(`/api/medications/${first.id}`, {
    reviewStatus: "CONFIRMED",
    confirmedName: first.extractedName,
    confirmedDosageInstructions: "1 tablet",
    confirmedFrequency: "twice daily",
  });
  for (const medication of rest) {
    await user.patch(`/api/medications/${medication.id}`, { reviewStatus: "REJECTED" });
  }
  const approved = await user.post(`/api/prescriptions/${prescriptionId}/approve`);
  expect(approved.status).toBe(200);
}
