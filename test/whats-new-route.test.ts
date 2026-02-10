import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadConfig, type AppConfig } from "../src/config";

const config: AppConfig = {
  port: 3000,
  whatsNewKillSwitch: false,
  allowlistEnabled: true,
  allowlistedTenantIds: new Set(["tenant-alpha"]),
  publisherAllowlistedUserIds: new Set(["publisher-1"]),
  publisherAllowlistedEmails: new Set(),
  devAuthBypassEnabled: false,
  devAuthBypassUserId: "dev-admin-1",
  devAuthBypassUserRole: "ADMIN",
  devAuthBypassTenantId: "tenant-alpha"
};

describe("GET /whats-new", () => {
  it("redirects root path to /whats-new", async () => {
    const app = createApp(config);
    const response = await request(app).get("/");

    expect(response.status).toBe(302);
    expect(response.header.location).toBe("/whats-new");
  });

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

  it("supports browser access without headers when dev auth fallback is enabled", async () => {
    const app = createApp({
      ...config,
      devAuthBypassEnabled: true
    });
    const response = await request(app).get("/whats-new");

    expect(response.status).toBe(200);
    expect(response.text).toContain("What's New");
  });

  it("supports browser access with loadConfig defaults when env allowlist is not set", async () => {
    const derivedConfig = loadConfig({
      NODE_ENV: "development",
      WHATS_NEW_KILL_SWITCH: "false",
      WHATS_NEW_ALLOWLIST_ENABLED: "true"
    });
    const app = createApp(derivedConfig);
    const response = await request(app).get("/whats-new");

    expect(response.status).toBe(200);
    expect(response.text).toContain("What's New");
  });
});
