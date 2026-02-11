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
    securityHeaders: {
      isProduction: false,
      cspReportOnly: true,
      cspFrameAncestors: ["'none'"],
      cspConnectSrc: ["'self'"],
      cspImgSrc: ["'self'", "data:", "https:"]
    },
    ...overrides
  };
}

function withAdminHeaders(req: request.Test, userId = "admin-1") {
  return req.set("x-user-id", userId).set("x-user-role", "ADMIN").set("x-tenant-id", "tenant-alpha");
}

describe("What's New HTML security headers", () => {
  it("applies report-only CSP and baseline headers on /whats-new in non-production mode", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(request(app).get("/whats-new"));

    expect(response.status).toBe(200);

    const reportOnlyCsp = response.headers["content-security-policy-report-only"];
    expect(reportOnlyCsp).toBeTypeOf("string");
    expect(reportOnlyCsp).toContain("default-src 'none'");
    expect(reportOnlyCsp).toContain("object-src 'none'");
    expect(reportOnlyCsp).toContain("base-uri 'none'");
    expect(reportOnlyCsp).toContain("frame-ancestors 'none'");
    expect(reportOnlyCsp).toContain("script-src 'self'");

    expect(response.headers["content-security-policy"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers["permissions-policy"]).toContain("geolocation=()");
    expect(response.headers["permissions-policy"]).toContain("microphone=()");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    expect(response.headers["permissions-policy"]).toContain("payment=()");
    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });

  it("enforces CSP and HSTS on /admin/whats-new when configured for production", async () => {
    const app = createApp(
      createConfig({
        securityHeaders: {
          isProduction: true,
          cspReportOnly: false,
          cspFrameAncestors: ["'self'", "https://www.example.com"],
          cspConnectSrc: ["'self'", "https://api.example.com"],
          cspImgSrc: ["'self'", "data:", "https:"]
        }
      }),
      { changelogRepository: new InMemoryChangelogRepository() }
    );

    const response = await withAdminHeaders(request(app).get("/admin/whats-new"), "publisher-1");

    expect(response.status).toBe(200);

    const enforcedCsp = response.headers["content-security-policy"];
    expect(enforcedCsp).toBeTypeOf("string");
    expect(enforcedCsp).toContain("default-src 'none'");
    expect(enforcedCsp).toContain("object-src 'none'");
    expect(enforcedCsp).toContain("base-uri 'none'");
    expect(enforcedCsp).toContain("frame-ancestors 'self' https://www.example.com");
    expect(enforcedCsp).toContain("script-src 'self'");
    expect(enforcedCsp).toContain("upgrade-insecure-requests");
    expect(response.headers["content-security-policy-report-only"]).toBeUndefined();
    expect(response.headers["strict-transport-security"]).toContain("max-age=31536000");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });

  it("does not attach CSP headers to JSON API routes", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/posts"));

    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toBeUndefined();
    expect(response.headers["content-security-policy-report-only"]).toBeUndefined();
  });
});
