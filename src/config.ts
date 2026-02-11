import type { UserRole } from "./types/context";
import { resolvePublicSiteUrl } from "./config/public-url";

export interface SecurityHeadersConfig {
  isProduction: boolean;
  cspReportOnly: boolean;
  cspFrameAncestors: string[];
  cspConnectSrc: string[];
  cspImgSrc: string[];
}

export interface RateLimitConfig {
  enabled: boolean;
  readPerMinute: number;
  writePerMinute: number;
}

export interface PublicSurfaceConfig {
  enabled: boolean;
  noindex: boolean;
  cspEnabled: boolean;
}

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
  publicSiteUrl?: string;
  publicSurface?: Partial<PublicSurfaceConfig>;
  rateLimit?: Partial<RateLimitConfig>;
  securityHeaders?: Partial<SecurityHeadersConfig>;
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

function parseCsvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
}

function normalizeCspSource(source: string): string {
  const trimmed = source.trim();
  const withoutQuotes = trimmed.replace(/^'(.*)'$/, "$1").toLowerCase();

  if (withoutQuotes === "none") {
    return "'none'";
  }
  if (withoutQuotes === "self") {
    return "'self'";
  }
  if (withoutQuotes === "unsafe-inline") {
    return "'unsafe-inline'";
  }
  if (withoutQuotes === "unsafe-eval") {
    return "'unsafe-eval'";
  }
  if (withoutQuotes === "strict-dynamic") {
    return "'strict-dynamic'";
  }

  return trimmed;
}

function parseCspSourceList(value: string | undefined, fallback: string[]): string[] {
  const parsed = parseCsvList(value).map(normalizeCspSource);
  return parsed.length > 0 ? parsed : fallback;
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
  const cspReportOnly = parseBoolean(env.WHATS_NEW_CSP_REPORT_ONLY, !isProduction);
  const cspFrameAncestors = parseCspSourceList(env.CSP_FRAME_ANCESTORS, ["'none'"]);
  const cspConnectSrc = parseCspSourceList(env.CSP_CONNECT_SRC, ["'self'"]);
  const cspImgSrc = parseCspSourceList(env.CSP_IMG_SRC, ["'self'", "data:", "https:"]);
  const devBypassDefault = !isProduction;
  const requestedDevBypass = parseBoolean(env.WHATS_NEW_DEV_AUTH_BYPASS, devBypassDefault);
  const devAuthBypassEnabled = !isProduction && requestedDevBypass;
  const allowlistEnabled = parseBoolean(env.WHATS_NEW_ALLOWLIST_ENABLED, true);
  const publisherAllowlistedUserIds = parseCsvSet(env.WHATS_NEW_PUBLISHER_ALLOWLIST_USER_IDS);
  const publisherAllowlistedEmails = parseCsvSet(env.WHATS_NEW_PUBLISHER_ALLOWLIST_EMAILS, (item) =>
    item.toLowerCase()
  );
  const rateLimitEnabled = parseBoolean(env.RATE_LIMIT_ENABLED, true);
  const rateLimitReadPerMinute = parsePositiveInteger(env.RATE_LIMIT_READ_PER_MIN, 120);
  const rateLimitWritePerMinute = parsePositiveInteger(env.RATE_LIMIT_WRITE_PER_MIN, 30);
  const publicChangelogEnabled = parseBoolean(env.PUBLIC_CHANGELOG_ENABLED, false);
  const publicChangelogNoindex = parseBoolean(env.PUBLIC_CHANGELOG_NOINDEX, true);
  const publicSurfaceCspEnabled = parseBoolean(env.PUBLIC_SURFACE_CSP_ENABLED, true);
  const publicSiteUrl = resolvePublicSiteUrl(env);

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
    devAuthBypassUserEmail,
    publicSiteUrl,
    publicSurface: {
      enabled: publicChangelogEnabled,
      noindex: publicChangelogNoindex,
      cspEnabled: publicSurfaceCspEnabled
    },
    rateLimit: {
      enabled: rateLimitEnabled,
      readPerMinute: rateLimitReadPerMinute,
      writePerMinute: rateLimitWritePerMinute
    },
    securityHeaders: {
      isProduction,
      cspReportOnly,
      cspFrameAncestors,
      cspConnectSrc,
      cspImgSrc
    }
  };
}
