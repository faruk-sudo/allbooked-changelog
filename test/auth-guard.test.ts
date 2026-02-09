import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { hydrateAuthFromHeaders, requireAdmin, requireAuthenticated } from "../src/middleware/auth";

function createTestApp() {
  const app = express();
  app.use(hydrateAuthFromHeaders);
  app.get("/admin", requireAuthenticated, requireAdmin, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe("admin auth guard", () => {
  it("returns 401 when not authenticated", async () => {
    const response = await request(createTestApp()).get("/admin");
    expect(response.status).toBe(401);
  });

  it("returns 403 when user is not admin", async () => {
    const response = await request(createTestApp())
      .get("/admin")
      .set("x-user-id", "user-1")
      .set("x-user-role", "USER");

    expect(response.status).toBe(403);
  });

  it("returns 200 for admin user", async () => {
    const response = await request(createTestApp())
      .get("/admin")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN");

    expect(response.status).toBe(200);
  });
});
