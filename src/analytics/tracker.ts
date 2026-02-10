import { createHash } from "node:crypto";
import {
  WHATS_NEW_EVENT_NAMES,
  WHATS_NEW_EVENT_PROPERTY_ALLOWLIST,
  WHATS_NEW_EVENT_REQUIRED_PROPERTIES,
  WHATS_NEW_EVENTS_REQUIRING_POST_IDENTITY,
  WHATS_NEW_FORBIDDEN_PROPERTY_KEYS,
  WHATS_NEW_FORBIDDEN_PROPERTY_KEY_PATTERN,
  WHATS_NEW_ANALYTICS_PROPERTY_SCHEMA,
  type WhatsNewAnalyticsPropertyKey,
  type WhatsNewEventName
} from "./events";

type AnalyticsProperties = Record<string, unknown>;

export interface AnalyticsProvider {
  track: (eventName: WhatsNewEventName, properties: AnalyticsProperties) => void;
}

export const noopAnalyticsProvider: AnalyticsProvider = {
  track: () => undefined
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isWhatsNewEventName(value: string): value is WhatsNewEventName {
  return (WHATS_NEW_EVENT_NAMES as readonly string[]).includes(value);
}

function isForbiddenPropertyKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return (
    (WHATS_NEW_FORBIDDEN_PROPERTY_KEYS as readonly string[]).includes(normalized) ||
    WHATS_NEW_FORBIDDEN_PROPERTY_KEY_PATTERN.test(normalized)
  );
}

function sanitizeString(value: unknown, allowedValues?: readonly string[]): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  if (allowedValues && !allowedValues.includes(normalized)) {
    return undefined;
  }

  return normalized;
}

function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function sanitizeBoolean(value: unknown): boolean | undefined {
  if (typeof value !== "boolean") {
    return undefined;
  }

  return value;
}

function sanitizePagination(value: unknown): Record<string, number | boolean> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const schema = WHATS_NEW_ANALYTICS_PROPERTY_SCHEMA.pagination;
  const sanitized: Record<string, number | boolean> = {};

  for (const [key, definition] of Object.entries(schema.properties)) {
    const raw = value[key];
    if (raw === undefined) {
      continue;
    }

    if (definition.type === "number") {
      const parsed = sanitizeNumber(raw);
      if (parsed !== undefined) {
        sanitized[key] = parsed;
      }
      continue;
    }

    const parsed = sanitizeBoolean(raw);
    if (parsed !== undefined) {
      sanitized[key] = parsed;
    }
  }

  for (const [key, definition] of Object.entries(schema.properties)) {
    if ("required" in definition && definition.required && sanitized[key] === undefined) {
      return undefined;
    }
  }

  return sanitized;
}

function sanitizePropertyValue(key: WhatsNewAnalyticsPropertyKey, rawValue: unknown): unknown {
  const schema = WHATS_NEW_ANALYTICS_PROPERTY_SCHEMA[key];
  if (schema.type === "string") {
    const enumValues = "enum_values" in schema ? schema.enum_values : undefined;
    return sanitizeString(rawValue, enumValues);
  }

  if (schema.type === "object" && key === "pagination") {
    return sanitizePagination(rawValue);
  }

  return undefined;
}

function hasRequiredProperties(
  eventName: WhatsNewEventName,
  properties: AnalyticsProperties
): properties is AnalyticsProperties {
  for (const key of WHATS_NEW_EVENT_REQUIRED_PROPERTIES[eventName]) {
    if (properties[key] === undefined) {
      return false;
    }
  }

  if (WHATS_NEW_EVENTS_REQUIRING_POST_IDENTITY.includes(eventName)) {
    const hasPostId = typeof properties.post_id === "string" && properties.post_id.length > 0;
    const hasSlug = typeof properties.slug === "string" && properties.slug.length > 0;
    return hasPostId || hasSlug;
  }

  return true;
}

export function sanitizeEventProperties(
  eventName: string,
  rawProperties: unknown
): { eventName: WhatsNewEventName; properties: AnalyticsProperties } | null {
  if (!isWhatsNewEventName(eventName)) {
    return null;
  }

  const input = isRecord(rawProperties) ? rawProperties : {};
  const sanitized: AnalyticsProperties = {};

  for (const key of WHATS_NEW_EVENT_PROPERTY_ALLOWLIST[eventName]) {
    if (isForbiddenPropertyKey(key)) {
      continue;
    }

    const rawValue = input[key];
    if (rawValue === undefined) {
      continue;
    }

    const value = sanitizePropertyValue(key, rawValue);
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }

  if (!hasRequiredProperties(eventName, sanitized)) {
    return null;
  }

  return {
    eventName,
    properties: sanitized
  };
}

export function createAnalyticsTracker(provider: AnalyticsProvider = noopAnalyticsProvider): {
  trackEvent: (eventName: string, rawProperties?: unknown) => void;
} {
  return {
    trackEvent(eventName: string, rawProperties: unknown = {}): void {
      const sanitized = sanitizeEventProperties(eventName, rawProperties);
      if (!sanitized) {
        return;
      }

      try {
        provider.track(sanitized.eventName, sanitized.properties);
      } catch {
        // Fail silently when provider is unavailable/misconfigured.
      }
    }
  };
}

function parseHttpStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const status = error.status;
  if (typeof status === "number" && Number.isFinite(status)) {
    return status;
  }

  return undefined;
}

function parseSystemCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const code = error.code;
  if (typeof code !== "string") {
    return undefined;
  }

  const normalized = code.trim().toUpperCase();
  return normalized.length > 0 ? normalized : undefined;
}

export function mapSeenFailureToErrorCode(error: unknown): string {
  const status = parseHttpStatus(error);
  if (status === 401 || status === 403) {
    return "unauthorized";
  }

  if (status !== undefined && status >= 500) {
    return "server_error";
  }

  if (status !== undefined && status >= 400) {
    return "request_error";
  }

  const systemCode = parseSystemCode(error);
  if (systemCode && ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"].includes(systemCode)) {
    return "network_error";
  }

  if (error instanceof Error && (error.name === "AbortError" || error.name === "TypeError")) {
    return "network_error";
  }

  return "unknown_error";
}

export function hashAnalyticsTenantId(tenantId: string | undefined): string | undefined {
  const normalized = tenantId?.trim();
  if (!normalized) {
    return undefined;
  }

  return `sha256:${createHash("sha256").update(`whats-new:${normalized}`).digest("hex")}`;
}
