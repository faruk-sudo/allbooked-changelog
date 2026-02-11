import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AppConfig, PublicSurfaceConfig } from "../config";

export interface PublicChangelogPolicy {
  status: "published";
  visibility: "public";
  tenantId: null;
}

const PUBLIC_CHANGELOG_POLICY: PublicChangelogPolicy = Object.freeze({
  status: "published",
  visibility: "public",
  tenantId: null
});

const FORBIDDEN_OVERRIDE_QUERY_KEYS = new Set(["status", "visibility", "tenant_id", "tenantid"]);
const PUBLIC_ROBOTS_NOINDEX_VALUE = "noindex, nofollow";

export const PUBLIC_CACHE_CONTROL_HEADER = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

function notFound(res: Response): void {
  res.status(404).json({ error: "Not found" });
}

export function resolvePublicSurfaceConfig(config: AppConfig): PublicSurfaceConfig {
  return {
    enabled: config.publicSurface?.enabled ?? false,
    noindex: config.publicSurface?.noindex ?? true,
    cspEnabled: config.publicSurface?.cspEnabled ?? true
  };
}

function hasForbiddenPolicyOverride(req: Request): boolean {
  return Object.keys(req.query).some((key) => FORBIDDEN_OVERRIDE_QUERY_KEYS.has(key.toLowerCase()));
}

export function requirePublicChangelogEnabled(config: AppConfig): RequestHandler {
  const resolved = resolvePublicSurfaceConfig(config);

  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!resolved.enabled) {
      notFound(res);
      return;
    }

    next();
  };
}

export function enforcePublicChangelogPolicy(req: Request, res: Response, next: NextFunction): void {
  if (hasForbiddenPolicyOverride(req)) {
    res.status(400).json({ error: "Unsupported query parameter" });
    return;
  }

  req.publicChangelogPolicy = PUBLIC_CHANGELOG_POLICY;
  next();
}

export function getPublicChangelogPolicy(req?: Request): PublicChangelogPolicy {
  return req?.publicChangelogPolicy ?? PUBLIC_CHANGELOG_POLICY;
}

export function applyPublicCachingHeaders(res: Response): void {
  res.setHeader("Cache-Control", PUBLIC_CACHE_CONTROL_HEADER);
}

export function applyPublicNoIndexHeaders(res: Response, config: AppConfig): void {
  if (resolvePublicSurfaceConfig(config).noindex) {
    res.setHeader("X-Robots-Tag", PUBLIC_ROBOTS_NOINDEX_VALUE);
  }
}

export function applyPublicSurfaceResponseHeaders(res: Response, config: AppConfig): void {
  applyPublicCachingHeaders(res);
  applyPublicNoIndexHeaders(res, config);
}

export function renderPublicNoIndexMetaTag(config: AppConfig): string {
  return resolvePublicSurfaceConfig(config).noindex ? '<meta name="robots" content="noindex,nofollow" />' : "";
}
