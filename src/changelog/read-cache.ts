import { createHash } from "node:crypto";
import type { Request, Response } from "express";

const PRIVATE_CACHE_CONTROL_HEADER = "private, max-age=30, stale-while-revalidate=60";
const PRIVATE_CACHE_VARY_HEADER = "Authorization, x-user-id, x-tenant-id";

function normalizeComparableEtag(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
}

function matchesIfNoneMatch(req: Request, currentEtag: string): boolean {
  const headerValue = req.header("if-none-match");
  if (!headerValue || headerValue.trim().length === 0) {
    return false;
  }

  if (headerValue.trim() === "*") {
    return true;
  }

  const expected = normalizeComparableEtag(currentEtag);
  const candidates = headerValue.split(",").map((value) => normalizeComparableEtag(value));
  return candidates.includes(expected);
}

function buildWeakEtag(payload: unknown): string {
  const serialized = JSON.stringify(payload);
  const digest = createHash("sha256").update(serialized).digest("base64url");
  return `W/"${digest}"`;
}

export function sendPrivateCachedReadJson(req: Request, res: Response, payload: unknown): void {
  const etag = buildWeakEtag(payload);

  res.setHeader("Cache-Control", PRIVATE_CACHE_CONTROL_HEADER);
  res.setHeader("Vary", PRIVATE_CACHE_VARY_HEADER);
  res.setHeader("ETag", etag);

  if (matchesIfNoneMatch(req, etag)) {
    res.status(304).end();
    return;
  }

  res.status(200).json(payload);
}
