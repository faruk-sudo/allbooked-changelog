import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("adds dev fallback tenant to allowlist when bypass is enabled", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      WHATS_NEW_ALLOWLIST_ENABLED: "true",
      WHATS_NEW_DEV_AUTH_BYPASS: "true",
      WHATS_NEW_DEV_TENANT_ID: "tenant-dev"
    });

    expect(config.devAuthBypassEnabled).toBe(true);
    expect(config.allowlistedTenantIds.has("tenant-dev")).toBe(true);
  });

  it("adds dev bypass admin user to publisher allowlist in non-production", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      WHATS_NEW_DEV_AUTH_BYPASS: "true",
      WHATS_NEW_DEV_USER_ID: "dev-browser-admin",
      WHATS_NEW_DEV_USER_ROLE: "ADMIN",
      WHATS_NEW_PUBLISHER_ALLOWLIST_USER_IDS: "publisher-1",
      WHATS_NEW_DEV_USER_EMAIL: "Dev-Browser-Admin@example.com",
      WHATS_NEW_PUBLISHER_ALLOWLIST_EMAILS: ""
    });

    expect(config.publisherAllowlistedUserIds.has("publisher-1")).toBe(true);
    expect(config.publisherAllowlistedUserIds.has("dev-browser-admin")).toBe(true);
    expect(config.publisherAllowlistedEmails.has("dev-browser-admin@example.com")).toBe(true);
  });

  it("does not auto-allowlist dev bypass user in production", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      WHATS_NEW_DEV_AUTH_BYPASS: "true",
      WHATS_NEW_DEV_USER_ID: "dev-browser-admin",
      WHATS_NEW_PUBLISHER_ALLOWLIST_USER_IDS: "publisher-1"
    });

    expect(config.devAuthBypassEnabled).toBe(false);
    expect(config.publisherAllowlistedUserIds.has("publisher-1")).toBe(true);
    expect(config.publisherAllowlistedUserIds.has("dev-browser-admin")).toBe(false);
  });

  it("forces dev auth bypass off in production", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      WHATS_NEW_DEV_AUTH_BYPASS: "true"
    });

    expect(config.devAuthBypassEnabled).toBe(false);
  });

  it("defaults CSP to report-only outside production with strict ancestors", () => {
    const config = loadConfig({
      NODE_ENV: "development"
    });

    expect(config.securityHeaders?.isProduction).toBe(false);
    expect(config.securityHeaders?.cspReportOnly).toBe(true);
    expect(config.securityHeaders?.cspFrameAncestors).toEqual(["'none'"]);
  });

  it("parses CSP source list overrides from env", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      WHATS_NEW_CSP_REPORT_ONLY: "false",
      CSP_FRAME_ANCESTORS: "'self', https://www.example.com",
      CSP_CONNECT_SRC: "'self', https://api.example.com",
      CSP_IMG_SRC: "'self', data:, https:"
    });

    expect(config.securityHeaders?.isProduction).toBe(true);
    expect(config.securityHeaders?.cspReportOnly).toBe(false);
    expect(config.securityHeaders?.cspFrameAncestors).toEqual(["'self'", "https://www.example.com"]);
    expect(config.securityHeaders?.cspConnectSrc).toEqual(["'self'", "https://api.example.com"]);
    expect(config.securityHeaders?.cspImgSrc).toEqual(["'self'", "data:", "https:"]);
  });
});
