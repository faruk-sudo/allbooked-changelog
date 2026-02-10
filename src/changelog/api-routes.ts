import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config";
import { appLogger, type Logger } from "../security/logger";
import { getGuardedWhatsNewContext } from "./authz";
import { renderMarkdownSafe } from "../security/markdown";
import { applyWhatsNewReadGuards } from "./guards";
import { parsePagination } from "./http";
import { type ChangelogRepository, ValidationError, sanitizeSlugOrThrow } from "./repository";

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
  logger: Logger = appLogger
): Router {
  const router = Router();
  applyWhatsNewReadGuards(router, config);

  router.get("/posts", async (req: Request, res: Response) => {
    try {
      const context = getGuardedWhatsNewContext(req);
      const pagination = parsePagination(req);
      const posts = await repository.listPublishedPosts({
        tenantScope: { tenantId: context.tenantId },
        pagination: {
          limit: pagination.limit,
          offset: pagination.offset
        }
      });

      logger.info("whats_new_api_posts_listed", {
        userId: context.userId,
        tenantId: context.tenantId,
        count: posts.length,
        offset: pagination.offset,
        limit: pagination.limit
      });

      res.status(200).json({
        items: posts.map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          category: post.category,
          published_at: post.publishedAt,
          excerpt: post.excerpt
        })),
        pagination: {
          limit: pagination.limit,
          offset: pagination.offset,
          next_cursor: posts.length === pagination.limit ? pagination.nextCursor : null
        }
      });
    } catch (error) {
      handleReadError(res, error);
    }
  });

  router.get("/unread", async (req: Request, res: Response) => {
    try {
      const context = getGuardedWhatsNewContext(req);
      const hasUnread = await repository.hasUnreadPosts({
        tenantScope: { tenantId: context.tenantId },
        userId: context.userId
      });

      res.status(200).json({ has_unread: hasUnread });
    } catch (error) {
      handleReadError(res, error);
    }
  });

  router.get("/posts/:slug", async (req: Request, res: Response) => {
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

      res.status(200).json({
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
