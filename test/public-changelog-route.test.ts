import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";
import { InMemoryChangelogRepository } from "../src/changelog/repository";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base: AppConfig = {
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
    securityHeaders: {
      isProduction: false,
      cspReportOnly: true,
      cspFrameAncestors: ["'none'"],
      cspConnectSrc: ["'self'"],
      cspImgSrc: ["'self'", "data:", "https:"]
    },
    publicSurface: {
      enabled: false,
      noindex: true,
      cspEnabled: true
    }
  };

  return {
    ...base,
    ...overrides,
    securityHeaders: {
      ...base.securityHeaders,
      ...overrides.securityHeaders
    },
    publicSurface: {
      ...base.publicSurface,
      ...overrides.publicSurface
    }
  };
}

describe("public changelog readiness route", () => {
  it("returns 404 when PUBLIC_CHANGELOG_ENABLED is false", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });

    const response = await request(app).get("/changelog");

    expect(response.status).toBe(404);
  });

  it("serves placeholder with public headers when enabled", async () => {
    const app = createApp(
      createConfig({
        publicSurface: {
          enabled: true,
          noindex: true,
          cspEnabled: true
        }
      }),
      { changelogRepository: new InMemoryChangelogRepository() }
    );

    const response = await request(app).get("/changelog");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Public changelog placeholder");
    expect(response.text).toContain('<meta name="robots" content="noindex,nofollow" />');
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers["cache-control"]).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    expect(response.headers["content-security-policy-report-only"]).toContain("default-src 'none'");
  });

  it("omits noindex header when PUBLIC_CHANGELOG_NOINDEX is false", async () => {
    const app = createApp(
      createConfig({
        publicSurface: {
          enabled: true,
          noindex: false,
          cspEnabled: true
        }
      }),
      { changelogRepository: new InMemoryChangelogRepository() }
    );

    const response = await request(app).get("/changelog");

    expect(response.status).toBe(200);
    expect(response.text).not.toContain('<meta name="robots" content="noindex,nofollow" />');
    expect(response.headers["x-robots-tag"]).toBeUndefined();
  });

  it("rejects public policy override query parameters", async () => {
    const app = createApp(
      createConfig({
        publicSurface: {
          enabled: true,
          noindex: true,
          cspEnabled: true
        }
      }),
      { changelogRepository: new InMemoryChangelogRepository() }
    );

    const response = await request(app).get("/changelog?status=draft");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Unsupported query parameter" });
  });
});
