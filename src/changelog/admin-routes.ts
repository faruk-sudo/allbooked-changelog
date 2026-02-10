import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config";
import { appLogger, type Logger } from "../security/logger";
import { applyWhatsNewAdminGuards } from "./guards";
import { parseAdminTenantFilter, parseExpectedRevision, parseOptionalStatusFilter, parsePagination } from "./http";
import {
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

function handleAdminError(res: Response, error: unknown): void {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error instanceof ConflictError) {
    res.status(409).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: "Internal server error" });
}

export function createWhatsNewAdminRouter(
  config: AppConfig,
  repository: ChangelogRepository,
  logger: Logger = appLogger
): Router {
  const router = Router();
  applyWhatsNewAdminGuards(router, config);

  router.get("/posts", async (req: Request, res: Response) => {
    if (!req.tenantId) {
      res.status(400).json({ error: "Tenant context missing" });
      return;
    }

    try {
      const pagination = parsePagination(req);
      const status = parseOptionalStatusFilter(req);
      const tenantFilter = parseAdminTenantFilter(req);

      const posts = await repository.listAdminPosts({
        tenantScope: { tenantId: req.tenantId },
        pagination: {
          limit: pagination.limit,
          offset: pagination.offset
        },
        status,
        tenantFilter
      });

      logger.info("whats_new_admin_posts_listed", {
        actorId: req.auth?.userId,
        tenantId: req.tenantId,
        count: posts.length,
        status,
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
      handleAdminError(res, error);
    }
  });

  router.post("/posts", async (req: Request, res: Response) => {
    if (!req.tenantId || !req.auth?.userId) {
      res.status(400).json({ error: "Invalid request context" });
      return;
    }

    try {
      const body = (req.body ?? {}) as CreatePostBody;
      const title = normalizeOptionalString("title", body.title);
      const bodyMarkdown = normalizeOptionalString("body_markdown", body.body_markdown);
      const categoryValue = normalizeOptionalString("category", body.category);

      if (!title || !bodyMarkdown || !categoryValue) {
        throw new ValidationError("title, body_markdown, and category are required");
      }

      const createdPost = await repository.createDraftPost({
        actorId: req.auth.userId,
        tenantScope: { tenantId: req.tenantId },
        tenantId: normalizeOptionalTenantId(body.tenant_id),
        title,
        slug: body.slug === undefined ? undefined : sanitizeSlugOrThrow(normalizeOptionalString("slug", body.slug) ?? ""),
        category: assertValidCategory(categoryValue),
        bodyMarkdown
      });

      logger.info("whats_new_admin_post_created", {
        actorId: req.auth.userId,
        tenantId: req.tenantId,
        postId: createdPost.id
      });

      res.status(201).json(toAdminResponse(createdPost));
    } catch (error) {
      handleAdminError(res, error);
    }
  });

  router.put("/posts/:id", async (req: Request, res: Response) => {
    if (!req.tenantId || !req.auth?.userId) {
      res.status(400).json({ error: "Invalid request context" });
      return;
    }

    try {
      const idParam = req.params.id;
      const postId = Array.isArray(idParam) ? idParam[0] ?? "" : idParam ?? "";
      const body = (req.body ?? {}) as UpdatePostBody;

      const updatedPost = await repository.updatePost({
        actorId: req.auth.userId,
        tenantScope: { tenantId: req.tenantId },
        id: postId,
        title: normalizeOptionalString("title", body.title),
        slug:
          body.slug === undefined
            ? undefined
            : sanitizeSlugOrThrow(normalizeOptionalString("slug", body.slug) ?? ""),
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
        actorId: req.auth.userId,
        tenantId: req.tenantId,
        postId: updatedPost.id
      });

      res.status(200).json(toAdminResponse(updatedPost));
    } catch (error) {
      handleAdminError(res, error);
    }
  });

  router.post("/posts/:id/publish", async (req: Request, res: Response) => {
    if (!req.tenantId || !req.auth?.userId) {
      res.status(400).json({ error: "Invalid request context" });
      return;
    }

    try {
      const idParam = req.params.id;
      const postId = Array.isArray(idParam) ? idParam[0] ?? "" : idParam ?? "";
      const post = await repository.publishPost({
        actorId: req.auth.userId,
        tenantScope: { tenantId: req.tenantId },
        id: postId,
        expectedRevision: parseExpectedRevision(req)
      });

      if (!post) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      logger.info("whats_new_admin_post_published", {
        actorId: req.auth.userId,
        tenantId: req.tenantId,
        postId: post.id
      });

      res.status(200).json(toAdminResponse(post));
    } catch (error) {
      handleAdminError(res, error);
    }
  });

  router.post("/posts/:id/unpublish", async (req: Request, res: Response) => {
    if (!req.tenantId || !req.auth?.userId) {
      res.status(400).json({ error: "Invalid request context" });
      return;
    }

    try {
      const idParam = req.params.id;
      const postId = Array.isArray(idParam) ? idParam[0] ?? "" : idParam ?? "";
      const post = await repository.unpublishPost({
        actorId: req.auth.userId,
        tenantScope: { tenantId: req.tenantId },
        id: postId,
        expectedRevision: parseExpectedRevision(req)
      });

      if (!post) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      logger.info("whats_new_admin_post_unpublished", {
        actorId: req.auth.userId,
        tenantId: req.tenantId,
        postId: post.id
      });

      res.status(200).json(toAdminResponse(post));
    } catch (error) {
      handleAdminError(res, error);
    }
  });

  return router;
}
