import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";

const config: AppConfig = {
  port: 3000,
  whatsNewKillSwitch: false,
  allowlistEnabled: true,
  allowlistedTenantIds: new Set(["tenant-alpha"]),
  publisherAllowlistedUserIds: new Set(["publisher-1"]),
  publisherAllowlistedEmails: new Set()
};

describe("GET /whats-new", () => {
  it("serves route for allowlisted admin", async () => {
    const app = createApp(config);
    const response = await request(app)
      .get("/whats-new")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain("What's New");
  });

  it("returns 404 for non-allowlisted tenant", async () => {
    const app = createApp(config);
    const response = await request(app)
      .get("/whats-new")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-beta");

    expect(response.status).toBe(404);
  });
});
