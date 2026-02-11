import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config";
import { appLogger, type Logger } from "../security/logger";
import {
  createRateLimitMiddleware,
  InMemoryRateLimitStore,
  resolveRateLimitConfig,
  type RateLimitStore
} from "../security/rate-limit";
import { getGuardedWhatsNewContext } from "./authz";
import { renderMarkdownSafe } from "../security/markdown";
import { applyWhatsNewReadGuards } from "./guards";
import { requireCsrfToken } from "../security/csrf";
import { encodeFeedCursor, parsePublishedFeedPagination } from "./http";
import { type ChangelogRepository, ValidationError, sanitizeSlugOrThrow } from "./repository";
import { sendPrivateCachedReadJson } from "./read-cache";

function handleReadError(res: Response, error: unknown): void {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: "Internal server error" });
}

export function createWhatsNewApiRouter(
  config: AppConfig,
  repository: ChangelogRepository,
  logger: Logger = appLogger,
  rateLimitStore: RateLimitStore = new InMemoryRateLimitStore()
): Router {
  const router = Router();
  applyWhatsNewReadGuards(router, config);
  const rateLimitConfig = resolveRateLimitConfig(config);
  const readRateLimiter = createRateLimitMiddleware({
    enabled: rateLimitConfig.enabled,
    keyPrefix: "whats-new-read",
    limit: rateLimitConfig.readPerMinute,
    store: rateLimitStore
  });
  const seenRateLimiter = createRateLimitMiddleware({
    enabled: rateLimitConfig.enabled,
    keyPrefix: "whats-new-seen",
    limit: rateLimitConfig.readPerMinute,
    store: rateLimitStore
  });

  router.get("/posts", readRateLimiter, async (req: Request, res: Response) => {
    try {
      const context = getGuardedWhatsNewContext(req);
      const pagination = parsePublishedFeedPagination(req);
      const posts = await repository.listPublishedPosts({
        tenantScope: { tenantId: context.tenantId },
        pagination: {
          limit: pagination.limit + 1,
          cursor: pagination.cursor ?? undefined
        }
      });
      const hasMore = posts.length > pagination.limit;
      const visiblePosts = hasMore ? posts.slice(0, pagination.limit) : posts;
      const lastPost = visiblePosts[visiblePosts.length - 1];
      const nextCursor =
        hasMore && lastPost
          ? encodeFeedCursor({
              publishedAt: lastPost.publishedAt,
              id: lastPost.id
            })
          : null;

      logger.info("whats_new_api_posts_listed", {
        userId: context.userId,
        tenantId: context.tenantId,
        count: visiblePosts.length,
        limit: pagination.limit,
        cursorPresent: Boolean(pagination.cursor)
      });

      sendPrivateCachedReadJson(req, res, {
        items: visiblePosts.map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          category: post.category,
          published_at: post.publishedAt,
          excerpt: post.excerpt
        })),
        pagination: {
          limit: pagination.limit,
          next_cursor: nextCursor
        }
      });
    } catch (error) {
      handleReadError(res, error);
    }
  });

  router.get("/unread", readRateLimiter, async (req: Request, res: Response) => {
    try {
      const context = getGuardedWhatsNewContext(req);
      const hasUnread = await repository.hasUnreadPosts({
        tenantScope: { tenantId: context.tenantId },
        userId: context.userId
      });

      sendPrivateCachedReadJson(req, res, { has_unread: hasUnread });
    } catch (error) {
      handleReadError(res, error);
    }
  });

  router.post("/seen", requireCsrfToken, seenRateLimiter, async (req: Request, res: Response) => {
    try {
      const context = getGuardedWhatsNewContext(req);
      const lastSeenAt = await repository.markSeen({
        tenantScope: { tenantId: context.tenantId },
        userId: context.userId
      });

      logger.info("whats_new_api_seen_updated", {
        userId: context.userId,
        tenantId: context.tenantId
      });

      res.status(200).json({ ok: true, last_seen_at: lastSeenAt });
    } catch (error) {
      handleReadError(res, error);
    }
  });

  router.get("/posts/:slug", readRateLimiter, async (req: Request, res: Response) => {
    try {
      const context = getGuardedWhatsNewContext(req);
      const slugParam = req.params.slug;
      const slug = sanitizeSlugOrThrow(Array.isArray(slugParam) ? slugParam[0] ?? "" : slugParam ?? "");
      const post = await repository.findPublishedPostBySlug({ tenantId: context.tenantId }, slug);

      if (!post) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      logger.info("whats_new_api_post_viewed", {
        userId: context.userId,
        tenantId: context.tenantId,
        postId: post.id
      });

      sendPrivateCachedReadJson(req, res, {
        id: post.id,
        title: post.title,
        slug: post.slug,
        category: post.category,
        published_at: post.publishedAt,
        safe_html: renderMarkdownSafe(post.bodyMarkdown)
      });
    } catch (error) {
      handleReadError(res, error);
    }
  });

  return router;
}
