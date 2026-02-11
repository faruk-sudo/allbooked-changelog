import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config";
import { appLogger, type Logger } from "../security/logger";
import {
  createRateLimitMiddleware,
  InMemoryRateLimitStore,
  resolveRateLimitConfig,
  type RateLimitStore
} from "../security/rate-limit";
import { renderMarkdownSafe } from "../security/markdown";
import { getGuardedWhatsNewContext } from "./authz";
import { applyWhatsNewAdminGuards } from "./guards";
import {
  parseAdminTenantFilter,
  parseExpectedRevision,
  parseOptionalAdminSearchQuery,
  parseOptionalStatusFilter,
  parsePagination
} from "./http";
import {
  BODY_MAX_LENGTH,
  ConflictError,
  ValidationError,
  assertValidCategory,
  sanitizeSlugOrThrow,
  type ChangelogRepository
} from "./repository";

interface CreatePostBody {
  title?: unknown;
  slug?: unknown;
  body_markdown?: unknown;
  category?: unknown;
  tenant_id?: unknown;
}

interface UpdatePostBody {
  title?: unknown;
  slug?: unknown;
  body_markdown?: unknown;
  category?: unknown;
  tenant_id?: unknown;
  expected_revision?: unknown;
}

interface PreviewBody {
  body_markdown?: unknown;
}

function normalizeOptionalString(field: string, value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }

  return value;
}

function normalizeOptionalTenantId(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ValidationError("tenant_id must be a string or null");
  }

  return value;
}

function toAdminResponse(post: {
  id: string;
  tenantId: string | null;
  visibility: string;
  status: string;
  category: string;
  title: string;
  slug: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}) {
  return {
    id: post.id,
    tenant_id: post.tenantId,
    visibility: post.visibility,
    status: post.status,
    category: post.category,
    title: post.title,
    slug: post.slug,
    published_at: post.publishedAt,
    created_at: post.createdAt,
    updated_at: post.updatedAt,
    revision: post.revision
  };
}

function toAdminDetailResponse(post: {
  id: string;
  tenantId: string | null;
  visibility: string;
  status: string;
  category: string;
  title: string;
  slug: string;
  bodyMarkdown: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}) {
  return {
    ...toAdminResponse(post),
    body_markdown: post.bodyMarkdown
  };
}

function handleAdminError(
  res: Response,
  error: unknown,
  logger: Logger,
  metadata: { route: string; actorId?: string; tenantId?: string; postId?: string }
): void {
  if (error instanceof ValidationError) {
    logger.info("whats_new_admin_request_failed", {
      ...metadata,
      statusCode: 400,
      errorType: "validation"
    });
    res.status(400).json({ error: error.message });
    return;
  }

  if (error instanceof ConflictError) {
    logger.info("whats_new_admin_request_failed", {
      ...metadata,
      statusCode: 409,
      errorType: "conflict"
    });
    res.status(409).json({ error: error.message });
    return;
  }

  logger.info("whats_new_admin_request_failed", {
    ...metadata,
    statusCode: 500,
    errorType: "internal"
  });
  res.status(500).json({ error: "Internal server error" });
}

export function createWhatsNewAdminRouter(
  config: AppConfig,
  repository: ChangelogRepository,
  logger: Logger = appLogger,
  rateLimitStore: RateLimitStore = new InMemoryRateLimitStore()
): Router {
  const router = Router();
  applyWhatsNewAdminGuards(router, config);
  const rateLimitConfig = resolveRateLimitConfig(config);
  const writeRateLimiter = createRateLimitMiddleware({
    enabled: rateLimitConfig.enabled,
    keyPrefix: "whats-new-write",
    limit: rateLimitConfig.writePerMinute,
    store: rateLimitStore
  });

  router.get("/posts", async (req: Request, res: Response) => {
    let actorId: string | undefined;
    let tenantId: string | undefined;

    try {
      const context = getGuardedWhatsNewContext(req);
      actorId = context.userId;
      tenantId = context.tenantId;
      const pagination = parsePagination(req);
      const status = parseOptionalStatusFilter(req);
      const tenantFilter = parseAdminTenantFilter(req);
      const search = parseOptionalAdminSearchQuery(req);

      const posts = await repository.listAdminPosts({
        tenantScope: { tenantId: context.tenantId },
        pagination: {
          limit: pagination.limit,
          offset: pagination.offset
        },
        status,
        tenantFilter,
        search
      });

      logger.info("whats_new_admin_posts_listed", {
        actorId: context.userId,
        tenantId: context.tenantId,
        count: posts.length,
        status,
        hasSearchQuery: Boolean(search),
        offset: pagination.offset,
        limit: pagination.limit
      });

      res.status(200).json({
        items: posts.map(toAdminResponse),
        pagination: {
          limit: pagination.limit,
          offset: pagination.offset,
          next_cursor: posts.length === pagination.limit ? pagination.nextCursor : null
        }
      });
    } catch (error) {
      handleAdminError(res, error, logger, {
        route: "list_posts",
        actorId,
        tenantId
      });
    }
  });

  router.post("/posts", writeRateLimiter, async (req: Request, res: Response) => {
    let actorId: string | undefined;
    let tenantId: string | undefined;

    try {
      const context = getGuardedWhatsNewContext(req);
      actorId = context.userId;
      tenantId = context.tenantId;
      const body = (req.body ?? {}) as CreatePostBody;
      const title = normalizeOptionalString("title", body.title);
      const bodyMarkdown = normalizeOptionalString("body_markdown", body.body_markdown);
      const categoryValue = normalizeOptionalString("category", body.category);
      const slugValue = normalizeOptionalString("slug", body.slug);

      if (!categoryValue) {
        throw new ValidationError("category is required");
      }

      const createdPost = await repository.createDraftPost({
        actorId: context.userId,
        tenantScope: { tenantId: context.tenantId },
        tenantId: normalizeOptionalTenantId(body.tenant_id),
        title: title ?? "",
        slug:
          slugValue === undefined || slugValue.trim().length === 0 ? undefined : sanitizeSlugOrThrow(slugValue),
        category: assertValidCategory(categoryValue),
        bodyMarkdown: bodyMarkdown ?? ""
      });

      logger.info("whats_new_admin_post_created", {
        actorId: context.userId,
        tenantId: context.tenantId,
        postId: createdPost.id
      });

      res.status(201).json(toAdminResponse(createdPost));
    } catch (error) {
      handleAdminError(res, error, logger, {
        route: "create_post",
        actorId,
        tenantId
      });
    }
  });

  router.put("/posts/:id", writeRateLimiter, async (req: Request, res: Response) => {
    let actorId: string | undefined;
    let tenantId: string | undefined;
    const idParam = req.params.id;
    const postId = Array.isArray(idParam) ? idParam[0] ?? "" : idParam ?? "";

    try {
      const context = getGuardedWhatsNewContext(req);
      actorId = context.userId;
      tenantId = context.tenantId;
      const body = (req.body ?? {}) as UpdatePostBody;
      const slugValue = normalizeOptionalString("slug", body.slug);

      const updatedPost = await repository.updatePost({
        actorId: context.userId,
        tenantScope: { tenantId: context.tenantId },
        id: postId,
        title: normalizeOptionalString("title", body.title),
        slug:
          slugValue === undefined || slugValue.trim().length === 0
            ? undefined
            : sanitizeSlugOrThrow(slugValue),
        category:
          body.category === undefined
            ? undefined
            : assertValidCategory(normalizeOptionalString("category", body.category) ?? ""),
        bodyMarkdown: normalizeOptionalString("body_markdown", body.body_markdown),
        tenantId: normalizeOptionalTenantId(body.tenant_id),
        expectedRevision: parseExpectedRevision(req)
      });

      if (!updatedPost) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      logger.info("whats_new_admin_post_updated", {
        actorId: context.userId,
        tenantId: context.tenantId,
        postId: updatedPost.id
      });

      res.status(200).json(toAdminResponse(updatedPost));
    } catch (error) {
      handleAdminError(res, error, logger, {
        route: "update_post",
        actorId,
        tenantId,
        postId
      });
    }
  });

  router.get("/posts/:id", async (req: Request, res: Response) => {
    let actorId: string | undefined;
    let tenantId: string | undefined;
    const idParam = req.params.id;
    const postId = Array.isArray(idParam) ? idParam[0] ?? "" : idParam ?? "";

    try {
      const context = getGuardedWhatsNewContext(req);
      actorId = context.userId;
      tenantId = context.tenantId;
      const post = await repository.findAdminPostById({
        tenantScope: { tenantId: context.tenantId },
        id: postId
      });

      if (!post) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      res.status(200).json(toAdminDetailResponse(post));
    } catch (error) {
      handleAdminError(res, error, logger, {
        route: "get_post_detail",
        actorId,
        tenantId,
        postId
      });
    }
  });

  router.post("/preview", writeRateLimiter, async (req: Request, res: Response) => {
    let actorId: string | undefined;
    let tenantId: string | undefined;

    try {
      const context = getGuardedWhatsNewContext(req);
      actorId = context.userId;
      tenantId = context.tenantId;
      const payload = (req.body ?? {}) as PreviewBody;
      const bodyMarkdown = normalizeOptionalString("body_markdown", payload.body_markdown) ?? "";

      if (bodyMarkdown.length > BODY_MAX_LENGTH) {
        throw new ValidationError(`body_markdown must be ${BODY_MAX_LENGTH} characters or less`);
      }

      res.status(200).json({ safe_html: renderMarkdownSafe(bodyMarkdown) });
    } catch (error) {
      handleAdminError(res, error, logger, {
        route: "preview_markdown",
        actorId,
        tenantId
      });
    }
  });

  router.post("/posts/:id/publish", writeRateLimiter, async (req: Request, res: Response) => {
    let actorId: string | undefined;
    let tenantId: string | undefined;
    const idParam = req.params.id;
    const postId = Array.isArray(idParam) ? idParam[0] ?? "" : idParam ?? "";

    try {
      const context = getGuardedWhatsNewContext(req);
      actorId = context.userId;
      tenantId = context.tenantId;
      const post = await repository.publishPost({
        actorId: context.userId,
        tenantScope: { tenantId: context.tenantId },
        id: postId,
        expectedRevision: parseExpectedRevision(req)
      });

      if (!post) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      logger.info("whats_new_admin_post_published", {
        actorId: context.userId,
        tenantId: context.tenantId,
        postId: post.id
      });

      res.status(200).json(toAdminResponse(post));
    } catch (error) {
      handleAdminError(res, error, logger, {
        route: "publish_post",
        actorId,
        tenantId,
        postId
      });
    }
  });

  router.post("/posts/:id/unpublish", writeRateLimiter, async (req: Request, res: Response) => {
    let actorId: string | undefined;
    let tenantId: string | undefined;
    const idParam = req.params.id;
    const postId = Array.isArray(idParam) ? idParam[0] ?? "" : idParam ?? "";

    try {
      const context = getGuardedWhatsNewContext(req);
      actorId = context.userId;
      tenantId = context.tenantId;
      const post = await repository.unpublishPost({
        actorId: context.userId,
        tenantScope: { tenantId: context.tenantId },
        id: postId,
        expectedRevision: parseExpectedRevision(req)
      });

      if (!post) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      logger.info("whats_new_admin_post_unpublished", {
        actorId: context.userId,
        tenantId: context.tenantId,
        postId: post.id
      });

      res.status(200).json(toAdminResponse(post));
    } catch (error) {
      handleAdminError(res, error, logger, {
        route: "unpublish_post",
        actorId,
        tenantId,
        postId
      });
    }
  });

  return router;
}
