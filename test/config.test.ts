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

  it("forces dev auth bypass off in production", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      WHATS_NEW_DEV_AUTH_BYPASS: "true"
    });

    expect(config.devAuthBypassEnabled).toBe(false);
  });
});
