import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config";
import { appLogger, type Logger } from "../security/logger";
import { type ChangelogRepository, ValidationError } from "./repository";
import {
  applyPublicCachingHeaders,
  enforcePublicChangelogPolicy,
  getPublicChangelogPolicy,
  requirePublicChangelogEnabled
} from "./public-surface";
import { DEFAULT_RSS_LIMIT, MAX_RSS_LIMIT, buildPublicChangelogRss } from "./rss";

function parsePositiveIntegerValue(name: string, rawValue: unknown): number | undefined {
  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }

  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${name} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseRssLimit(req: Request): number {
  const queryKeys = Object.keys(req.query);
  const unsupportedKey = queryKeys.find((key) => key.toLowerCase() !== "limit");
  if (unsupportedKey) {
    throw new ValidationError("Unsupported query parameter");
  }

  const requested = parsePositiveIntegerValue("limit", req.query.limit);
  return Math.min(Math.max(requested ?? DEFAULT_RSS_LIMIT, 1), MAX_RSS_LIMIT);
}

function handlePublicRssError(res: Response, error: unknown): void {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: "Internal server error" });
}

export function createPublicRssRouter(
  config: AppConfig,
  repository: ChangelogRepository,
  logger: Logger = appLogger
): Router {
  const router = Router();
  router.use(requirePublicChangelogEnabled(config));
  router.use(enforcePublicChangelogPolicy);

  router.get("/", async (req: Request, res: Response) => {
    try {
      if (!config.publicSiteUrl) {
        throw new Error("publicSiteUrl is required");
      }

      const limit = parseRssLimit(req);
      const policy = getPublicChangelogPolicy(req);
      const posts = await repository.listPublicPosts({
        pagination: {
          limit,
          offset: 0
        }
      });

      logger.info("public_changelog_rss_viewed", {
        status: policy.status,
        visibility: policy.visibility,
        tenantId: policy.tenantId,
        count: posts.length,
        limit
      });

      const xml = buildPublicChangelogRss({
        publicSiteUrl: config.publicSiteUrl,
        posts
      });

      applyPublicCachingHeaders(res);
      res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      res.status(200).send(xml);
    } catch (error) {
      handlePublicRssError(res, error);
    }
  });

  return router;
}
