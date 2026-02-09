import type { AppConfig } from "../config";

export function isTenantAllowlisted(
  tenantId: string | undefined,
  config: Pick<AppConfig, "whatsNewKillSwitch" | "allowlistEnabled" | "allowlistedTenantIds">
): boolean {
  if (config.whatsNewKillSwitch) {
    return false;
  }

  if (!tenantId) {
    return false;
  }

  if (!config.allowlistEnabled) {
    return true;
  }

  return config.allowlistedTenantIds.has(tenantId);
}
