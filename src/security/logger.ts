import type { Request } from "express";

type LogValue = unknown;

export interface LogMetadata {
  [key: string]: LogValue;
}

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key"
]);

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|passwd|secret|token|session|api[_-]?key|private[_-]?key|database[_-]?url|connection[_-]?string|credential|body|body_markdown|bodymarkdown|markdown|content|env)/i;

const SENSITIVE_ENV_KEY_PATTERN = /(key|token|secret|password|cookie|private|database_url|connection|credential|auth)/i;

const SENSITIVE_ENV_VALUES = collectSensitiveEnvValues();

function collectSensitiveEnvValues(): string[] {
  const values: string[] = [];

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) {
      continue;
    }

    if (!SENSITIVE_ENV_KEY_PATTERN.test(key.toLowerCase())) {
      continue;
    }

    const normalized = value.trim();
    if (normalized.length < 6) {
      continue;
    }

    values.push(normalized);
  }

  return values;
}

function shouldRedactValueByEnvMatch(value: string): boolean {
  return SENSITIVE_ENV_VALUES.some((secretValue) => value.includes(secretValue));
}

function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADER_KEYS.has(lower)) {
      result[key] = REDACTED;
      continue;
    }

    result[key] = sanitizeValue(value, lower, 1);
  }

  return result;
}

function sanitizeObject(input: Record<string, unknown>, depth: number): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const keyLower = key.toLowerCase();

    if (SENSITIVE_KEY_PATTERN.test(keyLower)) {
      output[key] = REDACTED;
      continue;
    }

    if (keyLower === "headers" && value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = sanitizeHeaders(value as Record<string, unknown>);
      continue;
    }

    output[key] = sanitizeValue(value, keyLower, depth + 1);
  }

  return output;
}

function sanitizeValue(value: unknown, key: string, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return "[Truncated]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return shouldRedactValueByEnvMatch(value) ? REDACTED : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, key, depth + 1));
  }

  if (typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>, depth + 1);
  }

  return String(value);
}

export function sanitizeLogMetadata(metadata: LogMetadata = {}): LogMetadata {
  return sanitizeObject(metadata, 0);
}

export function buildSafeRequestLogMetadata(req: Request): LogMetadata {
  return {
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
    headers: sanitizeHeaders(req.headers as Record<string, unknown>)
  };
}

export interface Logger {
  info: (event: string, metadata?: LogMetadata) => void;
}

export const appLogger: Logger = {
  info(event, metadata = {}) {
    const payload = {
      level: "info",
      timestamp: new Date().toISOString(),
      event,
      metadata: sanitizeLogMetadata(metadata)
    };

    console.info(JSON.stringify(payload));
  }
};
