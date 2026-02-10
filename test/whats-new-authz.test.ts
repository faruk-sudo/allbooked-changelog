import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config";
import { requireAdmin, requirePublisher, requireWhatsNewEnabled } from "../src/changelog/authz";
import { hydrateWhatsNewRequestContext } from "../src/changelog/request-context";

const baseConfig: AppConfig = {
  port: 3000,
  whatsNewKillSwitch: false,
  allowlistEnabled: true,
  allowlistedTenantIds: new Set(["tenant-alpha"]),
  publisherAllowlistedUserIds: new Set(["publisher-1"]),
  publisherAllowlistedEmails: new Set(["publisher@example.com"]),
  devAuthBypassEnabled: false,
  devAuthBypassUserId: "dev-admin-1",
  devAuthBypassUserRole: "ADMIN",
  devAuthBypassTenantId: "tenant-alpha",
  devAuthBypassUserEmail: "dev-admin@example.com"
};

function createApp(configOverrides: Partial<AppConfig> = {}) {
  const config: AppConfig = {
    ...baseConfig,
    ...configOverrides
  };

  const app = express();
  app.use(hydrateWhatsNewRequestContext(config));
  app.get("/enabled", requireWhatsNewEnabled(config), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/admin", requireAdmin, (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/publisher", requireAdmin, requireWhatsNewEnabled(config), requirePublisher(config), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return app;
}

describe("What's New authz middleware", () => {
  it("returns 400 when tenant context is missing", async () => {
    const response = await request(createApp())
      .get("/enabled")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Tenant context missing");
  });

  it("returns 404 when tenant is not allowlisted", async () => {
    const response = await request(createApp())
      .get("/enabled")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-beta");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Not found");
  });

  it("returns 404 when kill switch is enabled", async () => {
    const response = await request(createApp({ whatsNewKillSwitch: true }))
      .get("/enabled")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Not found");
  });

  it("returns 200 when admin is allowlisted and feature enabled", async () => {
    const response = await request(createApp())
      .get("/enabled")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
  });

  it("returns 401 for anonymous admin route access", async () => {
    const response = await request(createApp()).get("/admin");
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin access", async () => {
    const response = await request(createApp())
      .get("/admin")
      .set("x-user-id", "user-1")
      .set("x-user-role", "USER");

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Admin access required");
  });

  it("allows publisher gate with allowlisted user id", async () => {
    const response = await request(createApp())
      .get("/publisher")
      .set("x-user-id", "publisher-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
  });

  it("allows publisher gate with allowlisted email fallback", async () => {
    const response = await request(createApp({ publisherAllowlistedUserIds: new Set() }))
      .get("/publisher")
      .set("x-user-id", "admin-2")
      .set("x-user-role", "ADMIN")
      .set("x-user-email", "publisher@example.com")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
  });

  it("returns 404 for non-allowlisted publisher", async () => {
    const response = await request(createApp())
      .get("/publisher")
      .set("x-user-id", "admin-2")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Not found");
  });
});
