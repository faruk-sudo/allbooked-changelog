export interface AppConfig {
  port: number;
  whatsNewKillSwitch: boolean;
  allowlistEnabled: boolean;
  allowlistedTenantIds: Set<string>;
  publisherAllowlistedUserIds: Set<string>;
  publisherAllowlistedEmails: Set<string>;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return defaultValue;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parseCsvSet = (value: string | undefined, normalize?: (item: string) => string): Set<string> =>
    new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .map((item) => (normalize ? normalize(item) : item))
        .filter((item) => item.length > 0)
    );

  const allowlistedTenantIds = new Set(
    (env.WHATS_NEW_ALLOWLIST_TENANT_IDS ?? "")
      .split(",")
      .map((tenantId) => tenantId.trim())
      .filter((tenantId) => tenantId.length > 0)
  );

  return {
    port: Number(env.PORT ?? 3000),
    whatsNewKillSwitch: parseBoolean(env.WHATS_NEW_KILL_SWITCH, false),
    allowlistEnabled: parseBoolean(env.WHATS_NEW_ALLOWLIST_ENABLED, true),
    allowlistedTenantIds,
    publisherAllowlistedUserIds: parseCsvSet(env.WHATS_NEW_PUBLISHER_ALLOWLIST_USER_IDS),
    publisherAllowlistedEmails: parseCsvSet(env.WHATS_NEW_PUBLISHER_ALLOWLIST_EMAILS, (item) =>
      item.toLowerCase()
    )
  };
}
