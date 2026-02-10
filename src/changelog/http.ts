import type { Request } from "express";
import { ValidationError, assertValidStatus } from "./repository";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_SEARCH_LENGTH = 120;

function parseIntegerValue(name: string, rawValue: unknown): number | undefined {
  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }

  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${name} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`${name} must be a positive integer`);
  }

  return parsed;
}

export function parsePagination(req: Request): { limit: number; offset: number; nextCursor: string | null } {
  const requestedLimit = parseIntegerValue("limit", req.query.limit);
  const limit = Math.min(requestedLimit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const cursorOffset = parseIntegerValue("cursor", req.query.cursor);
  const explicitOffset = parseIntegerValue("offset", req.query.offset);
  const offset = explicitOffset ?? cursorOffset ?? 0;

  const nextCursor = String(offset + limit);

  return { limit, offset, nextCursor };
}

export function parseOptionalStatusFilter(req: Request): "draft" | "published" | undefined {
  const rawStatus = req.query.status;
  if (rawStatus === undefined) {
    return undefined;
  }

  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  if (typeof status !== "string") {
    throw new ValidationError("status must be draft or published");
  }

  return assertValidStatus(status);
}

export function parseExpectedRevision(req: Request): number | undefined {
  const payload = req.body as { expected_revision?: unknown };
  if (!payload || payload.expected_revision === undefined) {
    return undefined;
  }

  const revision = payload.expected_revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    throw new ValidationError("expected_revision must be a non-negative integer");
  }

  return revision;
}

export function parseAdminTenantFilter(req: Request):
  | { kind: "all" }
  | { kind: "tenant"; tenantId: string }
  | { kind: "global" } {
  const rawTenantId = req.query.tenant_id;
  if (rawTenantId === undefined) {
    return { kind: "all" };
  }

  const tenantId = Array.isArray(rawTenantId) ? rawTenantId[0] : rawTenantId;
  if (typeof tenantId !== "string") {
    throw new ValidationError("tenant_id filter is invalid");
  }

  const normalized = tenantId.trim();
  if (normalized === "global") {
    return { kind: "global" };
  }

  if (!req.tenantId || normalized !== req.tenantId) {
    throw new ValidationError("tenant_id filter must be current tenant or 'global'");
  }

  return {
    kind: "tenant",
    tenantId: normalized
  };
}

export function parseOptionalAdminSearchQuery(req: Request): string | undefined {
  const rawQuery = req.query.q;
  if (rawQuery === undefined) {
    return undefined;
  }

  const query = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;
  if (typeof query !== "string") {
    throw new ValidationError("q filter is invalid");
  }

  const normalized = query.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  if (normalized.length > MAX_SEARCH_LENGTH) {
    throw new ValidationError(`q must be ${MAX_SEARCH_LENGTH} characters or less`);
  }

  return normalized;
}
