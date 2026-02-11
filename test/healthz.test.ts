import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";
import { InMemoryChangelogRepository } from "../src/changelog/repository";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3000,
    whatsNewKillSwitch: false,
    allowlistEnabled: true,
    allowlistedTenantIds: new Set(["tenant-alpha"]),
    publisherAllowlistedUserIds: new Set(["publisher-1"]),
    publisherAllowlistedEmails: new Set(),
    devAuthBypassEnabled: false,
    devAuthBypassUserId: "dev-admin-1",
    devAuthBypassUserRole: "ADMIN",
    devAuthBypassTenantId: "tenant-alpha",
    ...overrides
  };
}

describe("GET /healthz", () => {
  it("returns ok when health dependencies pass", async () => {
    const app = createApp(createConfig(), {
      changelogRepository: new InMemoryChangelogRepository()
    });

    const response = await request(app).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("returns non-200 when health dependencies fail", async () => {
    const app = createApp(createConfig(), {
      changelogRepository: new InMemoryChangelogRepository(),
      healthCheck: async () => {
        throw new Error("db unavailable");
      }
    });

    const response = await request(app).get("/healthz");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ ok: false });
  });
});
