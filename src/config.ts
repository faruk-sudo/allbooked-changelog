import type { UserRole } from "./types/context";

export interface AppConfig {
  port: number;
  whatsNewKillSwitch: boolean;
  allowlistEnabled: boolean;
  allowlistedTenantIds: Set<string>;
  publisherAllowlistedUserIds: Set<string>;
  publisherAllowlistedEmails: Set<string>;
  devAuthBypassEnabled: boolean;
  devAuthBypassUserId: string;
  devAuthBypassUserRole: UserRole;
  devAuthBypassTenantId: string;
  devAuthBypassUserEmail?: string;
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

function parseUserRole(value: string | undefined, defaultValue: UserRole): UserRole {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "ADMIN") {
    return "ADMIN";
  }
  if (normalized === "USER") {
    return "USER";
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

  const inferredTenantId = [...allowlistedTenantIds][0] ?? "tenant-alpha";
  const requestedDevTenantId = (env.WHATS_NEW_DEV_TENANT_ID ?? "").trim();
  const devAuthBypassTenantId = requestedDevTenantId || inferredTenantId;

  const requestedDevEmail = env.WHATS_NEW_DEV_USER_EMAIL?.trim();
  const devAuthBypassUserEmail = requestedDevEmail && requestedDevEmail.length > 0 ? requestedDevEmail : undefined;
  const devAuthBypassUserId = (env.WHATS_NEW_DEV_USER_ID ?? "dev-admin-1").trim() || "dev-admin-1";
  const devAuthBypassUserRole = parseUserRole(env.WHATS_NEW_DEV_USER_ROLE, "ADMIN");

  const isProduction = (env.NODE_ENV ?? "").toLowerCase() === "production";
  const devBypassDefault = !isProduction;
  const requestedDevBypass = parseBoolean(env.WHATS_NEW_DEV_AUTH_BYPASS, devBypassDefault);
  const devAuthBypassEnabled = !isProduction && requestedDevBypass;
  const allowlistEnabled = parseBoolean(env.WHATS_NEW_ALLOWLIST_ENABLED, true);
  const publisherAllowlistedUserIds = parseCsvSet(env.WHATS_NEW_PUBLISHER_ALLOWLIST_USER_IDS);
  const publisherAllowlistedEmails = parseCsvSet(env.WHATS_NEW_PUBLISHER_ALLOWLIST_EMAILS, (item) =>
    item.toLowerCase()
  );

  // Local browser fallback must still satisfy allowlist middleware.
  if (devAuthBypassEnabled && allowlistEnabled) {
    allowlistedTenantIds.add(devAuthBypassTenantId);
  }

  // Local browser fallback should satisfy publisher gating in development when bypass user is admin.
  if (devAuthBypassEnabled && devAuthBypassUserRole === "ADMIN") {
    publisherAllowlistedUserIds.add(devAuthBypassUserId);
    if (devAuthBypassUserEmail) {
      publisherAllowlistedEmails.add(devAuthBypassUserEmail.toLowerCase());
    }
  }

  return {
    port: Number(env.PORT ?? 3000),
    whatsNewKillSwitch: parseBoolean(env.WHATS_NEW_KILL_SWITCH, false),
    allowlistEnabled,
    allowlistedTenantIds,
    publisherAllowlistedUserIds,
    publisherAllowlistedEmails,
    devAuthBypassEnabled,
    devAuthBypassUserId,
    devAuthBypassUserRole,
    devAuthBypassTenantId,
    devAuthBypassUserEmail
  };
}
