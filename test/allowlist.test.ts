import { describe, expect, it } from "vitest";
import { isTenantAllowlisted } from "../src/security/allowlist";

describe("isTenantAllowlisted", () => {
  it("returns false when kill switch is enabled", () => {
    const allowed = isTenantAllowlisted("tenant-alpha", {
      whatsNewKillSwitch: true,
      allowlistEnabled: true,
      allowlistedTenantIds: new Set(["tenant-alpha"])
    });

    expect(allowed).toBe(false);
  });

  it("returns true when allowlist is disabled and tenant is present", () => {
    const allowed = isTenantAllowlisted("tenant-random", {
      whatsNewKillSwitch: false,
      allowlistEnabled: false,
      allowlistedTenantIds: new Set()
    });

    expect(allowed).toBe(true);
  });

  it("returns false when allowlist is enabled and tenant is missing from allowlist", () => {
    const allowed = isTenantAllowlisted("tenant-random", {
      whatsNewKillSwitch: false,
      allowlistEnabled: true,
      allowlistedTenantIds: new Set(["tenant-alpha"])
    });

    expect(allowed).toBe(false);
  });

  it("returns true when tenant is allowlisted", () => {
    const allowed = isTenantAllowlisted("tenant-alpha", {
      whatsNewKillSwitch: false,
      allowlistEnabled: true,
      allowlistedTenantIds: new Set(["tenant-alpha"])
    });

    expect(allowed).toBe(true);
  });
});
