import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "@/app";

describe("GET /api/health", () => {
  it("returns ok without requiring auth or a database connection", async () => {
    const app = createApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("Unauthenticated access to protected routes", () => {
  it("rejects prescription listing without a session cookie", async () => {
    const app = createApp();
    const res = await request(app).get("/api/prescriptions");
    expect(res.status).toBe(401);
  });

  it("rejects schedule access without a session cookie", async () => {
    const app = createApp();
    const res = await request(app).get("/api/schedule");
    expect(res.status).toBe(401);
  });
});
