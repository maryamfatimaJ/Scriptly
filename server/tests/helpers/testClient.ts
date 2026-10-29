// Shared helper for integration tests that need an authenticated session.
//
// These tests run against the real app + a real Postgres database (the
// same one `docker-compose.yml` starts for local dev — see README §2.1).
// That's a deliberate choice for this stage of the project: it catches
// real Prisma/constraint issues that mocking the client would hide, at
// the cost of needing a live DB to run `npm test`. Each test registers
// its own uniquely-emailed user so tests don't collide with each other or
// with manually-created dev data; nothing here truncates shared tables.
import request from "supertest";
import type { Server } from "node:http";
import { createApp } from "@/app";

// supertest's `request.agent(app)` form (passing the bare Express app, not
// a listening server) was observed to intermittently throw
// "Cannot read properties of null (reading 'address')" once an agent made
// more than ~2 sequential calls — a race in how supertest lazily spins up
// an ephemeral server per agent. Starting one real server up front and
// handing supertest the already-listening `Server` instead avoids that
// entirely. One server is shared by every test in this file (vitest
// isolates module state per test file by default, so this doesn't leak
// across files) and torn down in a `globalSetup`-free way via `afterAll`
// in each test file that uses it.
let sharedServer: Server | null = null;

export function getServer(): Server {
  if (!sharedServer) {
    sharedServer = createApp().listen(0);
  }
  return sharedServer;
}

export function closeServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!sharedServer) return resolve();
    sharedServer.close((err) => (err ? reject(err) : resolve()));
    sharedServer = null;
  });
}

export interface TestUser {
  email: string;
  password: string;
  fullName: string;
  /** Optional — omit to exercise the default-to-UTC path. */
  timezone?: string;
}

export function uniqueTestUser(label: string): TestUser {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `test_${label}_${suffix}@example.test`,
    password: "TestPassword123!",
    fullName: `Test ${label}`,
  };
}

/**
 * A supertest agent that persists cookies across requests (so the httpOnly
 * auth cookies set on register/login are sent on subsequent calls), plus a
 * `csrf()` helper that fetches a fresh CSRF token for a mutating request —
 * mirroring exactly what the frontend's api/client.ts does.
 */
export class AuthedAgent {
  private agent: ReturnType<typeof request.agent>;

  private constructor(server: Server) {
    this.agent = request.agent(server);
  }

  static async register(server: Server, user: TestUser): Promise<AuthedAgent> {
    const instance = new AuthedAgent(server);
    const res = await instance.agent.post("/api/auth/register").send(user);
    if (res.status !== 201) {
      throw new Error(`Failed to register test user: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return instance;
  }

  get raw() {
    return this.agent;
  }

  /** Fetches a fresh CSRF token and returns the header object to spread into a mutating request. */
  async csrfHeader(): Promise<Record<string, string>> {
    const res = await this.agent.get("/api/auth/csrf-token");
    return { "x-csrf-token": res.body.csrfToken };
  }

  // IMPORTANT: always resolve csrfHeader() to a plain object BEFORE
  // constructing the supertest Request (i.e. `const headers = await
  // this.csrfHeader()` on its own line, then `this.agent.post(path).set
  // (headers)...` after). Chaining it inline as `.set(await
  // this.csrfHeader())` was tried first and intermittently failed an
  // agent's very first mutating call: supertest/superagent's cookie-jar
  // agent snapshots the jar's cookies when the Request object is
  // constructed (`this.agent.post(path)`), which happens *before* an
  // argument expression like `await this.csrfHeader()` is evaluated — so
  // if that call is also the agent's first-ever CSRF fetch, the freshly
  // set csrf_token cookie isn't in the jar yet at construction time and
  // silently never makes it onto the request. Resolving the header first
  // avoids the whole class of bug. (The real frontend's api/client.ts
  // doesn't have this problem — it resolves the token before ever calling
  // fetch() — this was purely an artifact of how these test helpers were
  // first written.)
  async post(path: string, body?: unknown) {
    const headers = await this.csrfHeader();
    return this.agent.post(path).set(headers).send(body);
  }

  async patch(path: string, body?: unknown) {
    const headers = await this.csrfHeader();
    return this.agent.patch(path).set(headers).send(body);
  }

  async get(path: string) {
    return this.agent.get(path);
  }

  async delete(path: string) {
    const headers = await this.csrfHeader();
    return this.agent.delete(path).set(headers);
  }

  /** Multipart upload with CSRF header attached. */
  async uploadPrescription(buffer: Buffer, filename: string, mimetype: string) {
    const headers = await this.csrfHeader();
    return this.agent
      .post("/api/prescriptions")
      .set(headers)
      .attach("prescriptionImage", buffer, { filename, contentType: mimetype });
  }
}

/**
 * Upload a prescription, run the mock extraction, and confirm the
 * "Amoxicillin" candidate (clean, high-confidence, frequency "3x daily" in
 * MockExtractionProvider) with the fields required to pass CONFIRMED
 * validation. Used by every test that just needs *a* confirmed medication
 * to schedule against, without re-deriving the extract+confirm dance each
 * time.
 */
export async function uploadExtractAndConfirmAmoxicillin(user: AuthedAgent) {
  const upload = await user.uploadPrescription(TINY_JPEG, "rx.jpg", "image/jpeg");
  const prescriptionId = upload.body.prescription.id as string;
  const extracted = await user.post(`/api/prescriptions/${prescriptionId}/extract`);
  const amoxicillin = extracted.body.prescription.medications.find((m: { extractedName: string }) => m.extractedName === "Amoxicillin");

  const confirmRes = await user.patch(`/api/medications/${amoxicillin.id}`, {
    reviewStatus: "CONFIRMED",
    confirmedName: "Amoxicillin",
    confirmedDosageInstructions: "Take one capsule by mouth three times daily after meals",
    confirmedFrequency: "3x daily",
  });

  return { prescriptionId, medicationId: amoxicillin.id as string, medication: confirmRes.body.medication };
}

/** A minimal valid JPEG (just the file-signature bytes) — enough to pass MIME/size validation in tests. */
export const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0xff, 0xd9,
]);
