import type { NextFunction, Request, Response } from "express";
import type { AppConfig, RateLimitConfig } from "../config";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitStoreResult {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number, nowMs: number): RateLimitStoreResult;
}

export interface RateLimitMiddlewareOptions {
  enabled: boolean;
  keyPrefix: string;
  limit: number;
  windowMs?: number;
  store: RateLimitStore;
  resolveIdentity?: (req: Request) => string;
  now?: () => number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 5_000;
const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  enabled: true,
  readPerMinute: 120,
  writePerMinute: 30
};

function normalizeOptionalValue(input: string | undefined): string | undefined {
  const value = input?.trim();
  return value && value.length > 0 ? value : undefined;
}

function resolveIp(req: Request): string {
  const ips = req.ips;
  if (Array.isArray(ips) && ips.length > 0) {
    return ips[0] ?? req.ip ?? "unknown";
  }

  return req.ip ?? "unknown";
}

export function resolveRateLimitConfig(config: AppConfig): RateLimitConfig {
  return {
    enabled: config.rateLimit?.enabled ?? DEFAULT_RATE_LIMITS.enabled,
    readPerMinute: config.rateLimit?.readPerMinute ?? DEFAULT_RATE_LIMITS.readPerMinute,
    writePerMinute: config.rateLimit?.writePerMinute ?? DEFAULT_RATE_LIMITS.writePerMinute
  };
}

export function resolveTenantUserRateLimitIdentity(req: Request): string {
  const contextUserId = req.whatsNewContext?.userId;
  const contextTenantId = req.whatsNewContext?.tenantId;
  const headerUserId = normalizeOptionalValue(req.header("x-user-id") ?? undefined);
  const headerTenantId = normalizeOptionalValue(req.header("x-tenant-id") ?? undefined);

  const userId = normalizeOptionalValue(contextUserId ?? headerUserId);
  const tenantId = normalizeOptionalValue(contextTenantId ?? req.tenantId ?? headerTenantId);

  if (tenantId && userId) {
    return `tenant:${tenantId}:user:${userId}`;
  }

  return `ip:${resolveIp(req)}`;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly maxEntries: number;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = Math.max(100, maxEntries);
  }

  increment(key: string, windowMs: number, nowMs: number): RateLimitStoreResult {
    if (this.entries.size >= this.maxEntries) {
      this.prune(nowMs);
    }

    const existing = this.entries.get(key);
    const resetAt = existing && existing.resetAt > nowMs ? existing.resetAt : nowMs + windowMs;
    const nextCount = existing && existing.resetAt > nowMs ? existing.count + 1 : 1;
    const nextEntry = { count: nextCount, resetAt };

    this.entries.set(key, nextEntry);

    return nextEntry;
  }

  private prune(nowMs: number): void {
    for (const [entryKey, entry] of this.entries) {
      if (entry.resetAt <= nowMs) {
        this.entries.delete(entryKey);
      }
    }

    if (this.entries.size < this.maxEntries) {
      return;
    }

    const overflowCount = this.entries.size - this.maxEntries + 1;
    let removed = 0;
    for (const entryKey of this.entries.keys()) {
      this.entries.delete(entryKey);
      removed += 1;
      if (removed >= overflowCount) {
        break;
      }
    }
  }
}

export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions) {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const resolveIdentity = options.resolveIdentity ?? resolveTenantUserRateLimitIdentity;
  const now = options.now ?? (() => Date.now());

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!options.enabled || options.limit <= 0) {
      next();
      return;
    }

    const nowMs = now();
    const identity = resolveIdentity(req);
    const bucketKey = `${options.keyPrefix}:${identity}`;
    const currentWindow = options.store.increment(bucketKey, windowMs, nowMs);
    const remaining = Math.max(0, options.limit - currentWindow.count);
    const resetInSeconds = Math.max(1, Math.ceil((currentWindow.resetAt - nowMs) / 1000));

    res.setHeader("RateLimit-Limit", String(options.limit));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetInSeconds));

    if (currentWindow.count > options.limit) {
      res.setHeader("Retry-After", String(resetInSeconds));
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    next();
  };
}
