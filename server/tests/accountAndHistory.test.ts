import { afterAll, describe, expect, it } from "vitest";
import { AuthedAgent, closeServer, getServer, uniqueTestUser, uploadExtractAndConfirmAmoxicillin } from "./helpers/testClient";

describe("account profile (timezone)", () => {
  const server = getServer();
  afterAll(() => closeServer());

  it("defaults a new account to UTC", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("tzdefault"));
    const res = await user.get("/api/auth/me");
    expect(res.body.user.timezone).toBe("UTC");
  });

  it("lets a user set a valid IANA timezone", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("tzvalid"));
    const res = await user.patch("/api/auth/me", { timezone: "Asia/Karachi" });
    expect(res.status).toBe(200);
    expect(res.body.user.timezone).toBe("Asia/Karachi");
  });

  it("rejects an invalid timezone string", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("tzinvalid"));
    const res = await user.patch("/api/auth/me", { timezone: "Not/ARealZone" });
    expect(res.status).toBe(400);
  });

  it("accepts a timezone supplied at registration", async () => {
    const candidate = uniqueTestUser("tzregister");
    const user = await AuthedAgent.register(server, { ...candidate, timezone: "America/New_York" });
    const res = await user.get("/api/auth/me");
    expect(res.body.user.timezone).toBe("America/New_York");
  });
});

describe("prescription history / event log", () => {
  const server = getServer();

  it("records the expected events across the capture-to-approval flow", async () => {
    const user = await AuthedAgent.register(server, uniqueTestUser("historyflow"));
    const { prescriptionId } = await uploadExtractAndConfirmAmoxicillin(user);

    const events = await user.get(`/api/prescriptions/${prescriptionId}/events`);
    expect(events.status).toBe(200);
    const types = events.body.events.map((e: { eventType: string }) => e.eventType);
    expect(types).toEqual(
      expect.arrayContaining(["CREATED", "EXTRACTION_STARTED", "EXTRACTION_COMPLETED", "MEDICINE_MATCHING_COMPLETED", "MEDICATION_UPDATED"])
    );
    // Chronological order is part of what makes this usable as a history view.
    const timestamps = events.body.events.map((e: { createdAt: string }) => new Date(e.createdAt).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("does not let a user read another user's prescription event history", async () => {
    const owner = await AuthedAgent.register(server, uniqueTestUser("historyowner"));
    const intruder = await AuthedAgent.register(server, uniqueTestUser("historyintruder"));
    const { prescriptionId } = await uploadExtractAndConfirmAmoxicillin(owner);

    const res = await intruder.get(`/api/prescriptions/${prescriptionId}/events`);
    expect(res.status).toBe(404);
  });

  it("requires authentication to read event history", async () => {
    const request = (await import("supertest")).default;
    const owner = await AuthedAgent.register(server, uniqueTestUser("historyauth"));
    const { prescriptionId } = await uploadExtractAndConfirmAmoxicillin(owner);

    const res = await request(server).get(`/api/prescriptions/${prescriptionId}/events`);
    expect(res.status).toBe(401);
  });
});
