import type { Pool, PoolClient } from "pg";

export type ChangelogVisibility = "authenticated" | "public";
export type ChangelogPostStatus = "draft" | "published";
export type ChangelogPostCategory = "new" | "improvement" | "fix";
export type ChangelogAuditAction = "create" | "update" | "publish" | "unpublish" | "delete";

export const TITLE_MAX_LENGTH = 180;
export const BODY_MAX_LENGTH = 50_000;
export const EXCERPT_MAX_LENGTH = 220;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORY_VALUES = new Set<ChangelogPostCategory>(["new", "improvement", "fix"]);
const STATUS_VALUES = new Set<ChangelogPostStatus>(["draft", "published"]);

interface PgErrorLike {
  code?: string;
}

export class ValidationError extends Error {}
export class ConflictError extends Error {}

export interface PaginationInput {
  limit: number;
  offset: number;
}

export interface TenantScope {
  tenantId: string;
}

export interface TenantFilter {
  kind: "all" | "tenant" | "global";
  tenantId?: string;
}

export interface PublicPostSummary {
  id: string;
  title: string;
  slug: string;
  category: ChangelogPostCategory;
  publishedAt: string;
  excerpt: string;
}

export interface PublicPostDetail {
  id: string;
  title: string;
  slug: string;
  category: ChangelogPostCategory;
  publishedAt: string;
  tenantId: string | null;
  bodyMarkdown: string;
}

export interface AdminPostSummary {
  id: string;
  tenantId: string | null;
  visibility: ChangelogVisibility;
  status: ChangelogPostStatus;
  category: ChangelogPostCategory;
  title: string;
  slug: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface CreatePostInput {
  actorId: string;
  tenantScope: TenantScope;
  tenantId?: string | null;
  title: string;
  slug?: string;
  category: ChangelogPostCategory;
  bodyMarkdown: string;
}

export interface UpdatePostInput {
  actorId: string;
  tenantScope: TenantScope;
  id: string;
  title?: string;
  slug?: string;
  category?: ChangelogPostCategory;
  bodyMarkdown?: string;
  tenantId?: string | null;
  expectedRevision?: number;
}

export interface TransitionPostInput {
  actorId: string;
  tenantScope: TenantScope;
  id: string;
  expectedRevision?: number;
}

export interface ListPublishedInput {
  tenantScope: TenantScope;
  pagination: PaginationInput;
}

export interface ListAdminPostsInput {
  tenantScope: TenantScope;
  pagination: PaginationInput;
  status?: ChangelogPostStatus;
  tenantFilter?: TenantFilter;
}

export interface ChangelogRepository {
  listPublishedPosts(input: ListPublishedInput): Promise<PublicPostSummary[]>;
  findPublishedPostBySlug(tenantScope: TenantScope, slug: string): Promise<PublicPostDetail | null>;
  listAdminPosts(input: ListAdminPostsInput): Promise<AdminPostSummary[]>;
  createDraftPost(input: CreatePostInput): Promise<AdminPostSummary>;
  updatePost(input: UpdatePostInput): Promise<AdminPostSummary | null>;
  publishPost(input: TransitionPostInput): Promise<AdminPostSummary | null>;
  unpublishPost(input: TransitionPostInput): Promise<AdminPostSummary | null>;
}

interface PostRow {
  id: string;
  tenant_id: string | null;
  visibility: ChangelogVisibility;
  status: ChangelogPostStatus;
  category: ChangelogPostCategory;
  title: string;
  slug: string;
  body_markdown: string;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
  revision: number;
}

interface AdminSummaryRow {
  id: string;
  tenant_id: string | null;
  visibility: ChangelogVisibility;
  status: ChangelogPostStatus;
  category: ChangelogPostCategory;
  title: string;
  slug: string;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
  revision: number;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function createExcerpt(markdown: string, maxLength = EXCERPT_MAX_LENGTH): string {
  const withoutCodeBlocks = markdown.replace(/```[\s\S]*?```/g, " ");
  const withoutInlineMarkdown = withoutCodeBlocks
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_#>`~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (withoutInlineMarkdown.length <= maxLength) {
    return withoutInlineMarkdown;
  }

  return `${withoutInlineMarkdown.slice(0, maxLength - 1).trim()}…`;
}

export function sanitizeTitle(input: string): string {
  const value = normalizeWhitespace(input);
  if (value.length === 0 || value.length > TITLE_MAX_LENGTH) {
    throw new ValidationError(`title must be between 1 and ${TITLE_MAX_LENGTH} characters`);
  }
  return value;
}

export function sanitizeBodyMarkdown(input: string): string {
  const value = input.trim();
  if (value.length === 0 || value.length > BODY_MAX_LENGTH) {
    throw new ValidationError(`body_markdown must be between 1 and ${BODY_MAX_LENGTH} characters`);
  }
  return value;
}

export function assertValidCategory(input: string): ChangelogPostCategory {
  if (!CATEGORY_VALUES.has(input as ChangelogPostCategory)) {
    throw new ValidationError("category must be one of: new, improvement, fix");
  }
  return input as ChangelogPostCategory;
}

export function assertValidStatus(input: string): ChangelogPostStatus {
  if (!STATUS_VALUES.has(input as ChangelogPostStatus)) {
    throw new ValidationError("status must be one of: draft, published");
  }
  return input as ChangelogPostStatus;
}

export function sanitizeSlugOrThrow(input: string): string {
  const slug = input.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    throw new ValidationError("slug must be lowercase letters, numbers, and hyphens only");
  }
  return slug;
}

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (!slug) {
    return "post";
  }

  return slug;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as PgErrorLike).code === "23505";
}

function isScopedToTenant(postTenantId: string | null, tenantScope: TenantScope): boolean {
  return postTenantId === null || postTenantId === tenantScope.tenantId;
}

function normalizeTenantIdOrThrow(
  tenantId: string | null | undefined,
  tenantScope: TenantScope
): string | null | undefined {
  if (tenantId === undefined) {
    return undefined;
  }

  if (tenantId === null) {
    return null;
  }

  const normalized = tenantId.trim();
  if (normalized.length === 0) {
    throw new ValidationError("tenant_id cannot be empty");
  }

  if (normalized !== tenantScope.tenantId) {
    throw new ValidationError("tenant_id must match the request tenant context or be null");
  }

  return normalized;
}

function toAdminSummary(row: AdminSummaryRow): AdminPostSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    visibility: row.visibility,
    status: row.status,
    category: row.category,
    title: row.title,
    slug: row.slug,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    revision: row.revision
  };
}

async function recordAuditLog(
  client: PoolClient,
  input: {
    tenantId: string | null;
    actorId: string;
    action: ChangelogAuditAction;
    postId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO changelog_audit_log (tenant_id, actor_id, action, post_id, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [input.tenantId, input.actorId, input.action, input.postId, input.metadata ? JSON.stringify(input.metadata) : null]
  );
}

export class PostgresChangelogRepository implements ChangelogRepository {
  constructor(private readonly pool: Pool) {}

  async listPublishedPosts(input: ListPublishedInput): Promise<PublicPostSummary[]> {
    const result = await this.pool.query<PostRow>(
      `
        SELECT
          id,
          tenant_id,
          visibility,
          status,
          category,
          title,
          slug,
          body_markdown,
          published_at,
          created_at,
          updated_at,
          revision
        FROM changelog_posts
        WHERE status = 'published'
          AND visibility = 'authenticated'
          AND (tenant_id = $1 OR tenant_id IS NULL)
        ORDER BY published_at DESC, id DESC
        LIMIT $2 OFFSET $3
      `,
      [input.tenantScope.tenantId, input.pagination.limit, input.pagination.offset]
    );

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      category: row.category,
      publishedAt: row.published_at ? row.published_at.toISOString() : row.updated_at.toISOString(),
      excerpt: createExcerpt(row.body_markdown)
    }));
  }

  async findPublishedPostBySlug(tenantScope: TenantScope, slug: string): Promise<PublicPostDetail | null> {
    const result = await this.pool.query<PostRow>(
      `
        SELECT
          id,
          tenant_id,
          visibility,
          status,
          category,
          title,
          slug,
          body_markdown,
          published_at,
          created_at,
          updated_at,
          revision
        FROM changelog_posts
        WHERE slug = $1
          AND status = 'published'
          AND visibility = 'authenticated'
          AND (tenant_id = $2 OR tenant_id IS NULL)
        LIMIT 1
      `,
      [slug, tenantScope.tenantId]
    );

    const row = result.rows[0];
    if (!row || !row.published_at) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      category: row.category,
      publishedAt: row.published_at.toISOString(),
      tenantId: row.tenant_id,
      bodyMarkdown: row.body_markdown
    };
  }

  async listAdminPosts(input: ListAdminPostsInput): Promise<AdminPostSummary[]> {
    const values: unknown[] = [input.tenantScope.tenantId];
    const where: string[] = ["(tenant_id = $1 OR tenant_id IS NULL)"];

    if (input.status) {
      values.push(input.status);
      where.push(`status = $${values.length}`);
    }

    if (input.tenantFilter?.kind === "tenant") {
      values.push(input.tenantFilter.tenantId ?? input.tenantScope.tenantId);
      where.push(`tenant_id = $${values.length}`);
    }

    if (input.tenantFilter?.kind === "global") {
      where.push("tenant_id IS NULL");
    }

    values.push(input.pagination.limit);
    values.push(input.pagination.offset);

    const result = await this.pool.query<AdminSummaryRow>(
      `
        SELECT
          id,
          tenant_id,
          visibility,
          status,
          category,
          title,
          slug,
          published_at,
          created_at,
          updated_at,
          revision
        FROM changelog_posts
        WHERE ${where.join(" AND ")}
        ORDER BY updated_at DESC, id DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values
    );

    return result.rows.map(toAdminSummary);
  }

  async createDraftPost(input: CreatePostInput): Promise<AdminPostSummary> {
    const title = sanitizeTitle(input.title);
    const bodyMarkdown = sanitizeBodyMarkdown(input.bodyMarkdown);
    const category = assertValidCategory(input.category);
    const requestedTenantId = normalizeTenantIdOrThrow(input.tenantId, input.tenantScope);
    const actorId = input.actorId.trim();

    if (!actorId) {
      throw new ValidationError("actor_id is required");
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const slug = await this.resolveSlug(client, input.slug, title);

      const insertResult = await client.query<AdminSummaryRow>(
        `
          INSERT INTO changelog_posts (
            tenant_id,
            visibility,
            status,
            category,
            title,
            slug,
            body_markdown,
            created_by_actor_id,
            updated_by_actor_id,
            revision
          )
          VALUES (
            $1,
            'authenticated',
            'draft',
            $2,
            $3,
            $4,
            $5,
            $6,
            $6,
            1
          )
          RETURNING
            id,
            tenant_id,
            visibility,
            status,
            category,
            title,
            slug,
            published_at,
            created_at,
            updated_at,
            revision
        `,
        [requestedTenantId ?? null, category, title, slug, bodyMarkdown, actorId]
      );

      const post = insertResult.rows[0];

      await recordAuditLog(client, {
        tenantId: post.tenant_id,
        actorId,
        action: "create",
        postId: post.id,
        metadata: {
          changed_fields: ["title", "slug", "category", "body_markdown", "tenant_id", "status", "visibility"]
        }
      });

      await client.query("COMMIT");
      return toAdminSummary(post);
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) {
        throw new ConflictError("slug already exists");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePost(input: UpdatePostInput): Promise<AdminPostSummary | null> {
    const actorId = input.actorId.trim();
    if (!actorId) {
      throw new ValidationError("actor_id is required");
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const existingResult = await client.query<PostRow>(
        `
          SELECT
            id,
            tenant_id,
            visibility,
            status,
            category,
            title,
            slug,
            body_markdown,
            published_at,
            created_at,
            updated_at,
            revision
          FROM changelog_posts
          WHERE id = $1
          FOR UPDATE
        `,
        [input.id]
      );

      const existing = existingResult.rows[0];
      if (!existing || !isScopedToTenant(existing.tenant_id, input.tenantScope)) {
        await client.query("ROLLBACK");
        return null;
      }

      if (input.expectedRevision !== undefined && existing.revision !== input.expectedRevision) {
        throw new ConflictError("revision mismatch");
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      const changedFields: string[] = [];

      if (input.title !== undefined) {
        const title = sanitizeTitle(input.title);
        if (title !== existing.title) {
          values.push(title);
          updates.push(`title = $${values.length}`);
          changedFields.push("title");
        }
      }

      if (input.slug !== undefined) {
        const slug = await this.resolveSlug(client, input.slug, existing.title, true);
        if (slug !== existing.slug) {
          values.push(slug);
          updates.push(`slug = $${values.length}`);
          changedFields.push("slug");
        }
      }

      if (input.category !== undefined) {
        const category = assertValidCategory(input.category);
        if (category !== existing.category) {
          values.push(category);
          updates.push(`category = $${values.length}`);
          changedFields.push("category");
        }
      }

      if (input.bodyMarkdown !== undefined) {
        const bodyMarkdown = sanitizeBodyMarkdown(input.bodyMarkdown);
        if (bodyMarkdown !== existing.body_markdown) {
          values.push(bodyMarkdown);
          updates.push(`body_markdown = $${values.length}`);
          changedFields.push("body_markdown");
        }
      }

      if (input.tenantId !== undefined) {
        const tenantId = normalizeTenantIdOrThrow(input.tenantId, input.tenantScope);
        if (tenantId !== existing.tenant_id) {
          values.push(tenantId);
          updates.push(`tenant_id = $${values.length}`);
          changedFields.push("tenant_id");
        }
      }

      if (updates.length === 0) {
        await client.query("ROLLBACK");
        return toAdminSummary(existing);
      }

      values.push(actorId);
      updates.push(`updated_by_actor_id = $${values.length}`);
      updates.push("updated_at = now()");
      updates.push("revision = revision + 1");
      values.push(input.id);

      const updateResult = await client.query<AdminSummaryRow>(
        `
          UPDATE changelog_posts
          SET ${updates.join(", ")}
          WHERE id = $${values.length}
          RETURNING
            id,
            tenant_id,
            visibility,
            status,
            category,
            title,
            slug,
            published_at,
            created_at,
            updated_at,
            revision
        `,
        values
      );

      const updated = updateResult.rows[0];

      await recordAuditLog(client, {
        tenantId: updated.tenant_id,
        actorId,
        action: "update",
        postId: updated.id,
        metadata: {
          changed_fields: changedFields
        }
      });

      await client.query("COMMIT");
      return toAdminSummary(updated);
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) {
        throw new ConflictError("slug already exists");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async publishPost(input: TransitionPostInput): Promise<AdminPostSummary | null> {
    return this.transitionStatus(input, "published", "publish");
  }

  async unpublishPost(input: TransitionPostInput): Promise<AdminPostSummary | null> {
    return this.transitionStatus(input, "draft", "unpublish");
  }

  private async transitionStatus(
    input: TransitionPostInput,
    targetStatus: ChangelogPostStatus,
    action: Extract<ChangelogAuditAction, "publish" | "unpublish">
  ): Promise<AdminPostSummary | null> {
    const actorId = input.actorId.trim();
    if (!actorId) {
      throw new ValidationError("actor_id is required");
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const existingResult = await client.query<PostRow>(
        `
          SELECT
            id,
            tenant_id,
            visibility,
            status,
            category,
            title,
            slug,
            body_markdown,
            published_at,
            created_at,
            updated_at,
            revision
          FROM changelog_posts
          WHERE id = $1
          FOR UPDATE
        `,
        [input.id]
      );

      const existing = existingResult.rows[0];
      if (!existing || !isScopedToTenant(existing.tenant_id, input.tenantScope)) {
        await client.query("ROLLBACK");
        return null;
      }

      if (input.expectedRevision !== undefined && existing.revision !== input.expectedRevision) {
        throw new ConflictError("revision mismatch");
      }

      if (existing.status === targetStatus) {
        throw new ConflictError(`post already ${targetStatus}`);
      }

      const updateResult = await client.query<AdminSummaryRow>(
        `
          UPDATE changelog_posts
          SET
            status = $1,
            published_at = CASE
              WHEN $1 = 'published' THEN COALESCE(published_at, now())
              ELSE NULL
            END,
            updated_at = now(),
            updated_by_actor_id = $2,
            revision = revision + 1
          WHERE id = $3
          RETURNING
            id,
            tenant_id,
            visibility,
            status,
            category,
            title,
            slug,
            published_at,
            created_at,
            updated_at,
            revision
        `,
        [targetStatus, actorId, input.id]
      );

      const updated = updateResult.rows[0];

      await recordAuditLog(client, {
        tenantId: updated.tenant_id,
        actorId,
        action,
        postId: updated.id,
        metadata: {
          previous_status: existing.status,
          new_status: updated.status
        }
      });

      await client.query("COMMIT");
      return toAdminSummary(updated);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async resolveSlug(
    client: PoolClient,
    requestedSlug: string | undefined,
    title: string,
    skipUniquenessProbe = false
  ): Promise<string> {
    if (requestedSlug !== undefined) {
      return sanitizeSlugOrThrow(requestedSlug);
    }

    const base = slugifyTitle(title);
    if (skipUniquenessProbe) {
      return base;
    }

    for (let index = 0; index < 100; index += 1) {
      const candidate = index === 0 ? base : `${base}-${index + 1}`;
      const existing = await client.query<{ id: string }>(
        `
          SELECT id
          FROM changelog_posts
          WHERE slug = $1
          LIMIT 1
        `,
        [candidate]
      );

      if (existing.rowCount === 0) {
        return candidate;
      }
    }

    throw new ConflictError("unable to generate unique slug");
  }
}

export interface InMemoryAuditRecord {
  tenantId: string | null;
  actorId: string;
  action: ChangelogAuditAction;
  postId: string;
  metadata?: Record<string, unknown>;
}

interface InMemoryPost extends AdminPostSummary {
  bodyMarkdown: string;
}

export class InMemoryChangelogRepository implements ChangelogRepository {
  private posts: InMemoryPost[] = [];
  private nextId = 1;
  public readonly auditRecords: InMemoryAuditRecord[] = [];

  constructor(initialPosts: Array<Omit<InMemoryPost, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }> = []) {
    const now = new Date().toISOString();
    this.posts = initialPosts.map((post) => ({
      ...post,
      createdAt: post.createdAt ?? now,
      updatedAt: post.updatedAt ?? now
    }));
  }

  async listPublishedPosts(input: ListPublishedInput): Promise<PublicPostSummary[]> {
    return this.posts
      .filter(
        (post) =>
          post.status === "published" &&
          post.visibility === "authenticated" &&
          (post.tenantId === null || post.tenantId === input.tenantScope.tenantId)
      )
      .sort((left, right) => right.publishedAt!.localeCompare(left.publishedAt!))
      .slice(input.pagination.offset, input.pagination.offset + input.pagination.limit)
      .map((post) => ({
        id: post.id,
        title: post.title,
        slug: post.slug,
        category: post.category,
        publishedAt: post.publishedAt ?? new Date(0).toISOString(),
        excerpt: createExcerpt(post.bodyMarkdown)
      }));
  }

  async findPublishedPostBySlug(tenantScope: TenantScope, slug: string): Promise<PublicPostDetail | null> {
    const post = this.posts.find(
      (candidate) =>
        candidate.slug === slug &&
        candidate.status === "published" &&
        candidate.visibility === "authenticated" &&
        (candidate.tenantId === null || candidate.tenantId === tenantScope.tenantId)
    );

    if (!post || !post.publishedAt) {
      return null;
    }

    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      category: post.category,
      publishedAt: post.publishedAt,
      tenantId: post.tenantId,
      bodyMarkdown: post.bodyMarkdown
    };
  }

  async listAdminPosts(input: ListAdminPostsInput): Promise<AdminPostSummary[]> {
    return this.posts
      .filter((post) => isScopedToTenant(post.tenantId, input.tenantScope))
      .filter((post) => !input.status || post.status === input.status)
      .filter((post) => {
        if (!input.tenantFilter || input.tenantFilter.kind === "all") {
          return true;
        }
        if (input.tenantFilter.kind === "global") {
          return post.tenantId === null;
        }
        return post.tenantId === input.tenantFilter.tenantId;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(input.pagination.offset, input.pagination.offset + input.pagination.limit)
      .map(({ bodyMarkdown: _ignored, ...post }) => post);
  }

  async createDraftPost(input: CreatePostInput): Promise<AdminPostSummary> {
    const createdAt = new Date().toISOString();
    const post: InMemoryPost = {
      id: String(this.nextId++),
      tenantId: normalizeTenantIdOrThrow(input.tenantId, input.tenantScope) ?? null,
      visibility: "authenticated",
      status: "draft",
      category: assertValidCategory(input.category),
      title: sanitizeTitle(input.title),
      slug: sanitizeSlugOrThrow(input.slug ?? slugifyTitle(input.title)),
      bodyMarkdown: sanitizeBodyMarkdown(input.bodyMarkdown),
      publishedAt: null,
      createdAt,
      updatedAt: createdAt,
      revision: 1
    };

    if (this.posts.some((candidate) => candidate.slug === post.slug)) {
      throw new ConflictError("slug already exists");
    }

    this.posts.push(post);
    this.auditRecords.push({
      tenantId: post.tenantId,
      actorId: input.actorId,
      action: "create",
      postId: post.id,
      metadata: {
        changed_fields: ["title", "slug", "category", "body_markdown", "tenant_id", "status", "visibility"]
      }
    });

    const { bodyMarkdown: _ignored, ...summary } = post;
    return summary;
  }

  async updatePost(input: UpdatePostInput): Promise<AdminPostSummary | null> {
    const index = this.posts.findIndex((post) => post.id === input.id);
    if (index === -1) {
      return null;
    }

    const existing = this.posts[index];
    if (!isScopedToTenant(existing.tenantId, input.tenantScope)) {
      return null;
    }

    if (input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) {
      throw new ConflictError("revision mismatch");
    }

    const changedFields: string[] = [];
    const nextPost: InMemoryPost = { ...existing };

    if (input.title !== undefined) {
      const title = sanitizeTitle(input.title);
      if (title !== existing.title) {
        changedFields.push("title");
        nextPost.title = title;
      }
    }

    if (input.slug !== undefined) {
      const slug = sanitizeSlugOrThrow(input.slug);
      if (slug !== existing.slug) {
        if (this.posts.some((candidate, postIndex) => postIndex !== index && candidate.slug === slug)) {
          throw new ConflictError("slug already exists");
        }
        changedFields.push("slug");
        nextPost.slug = slug;
      }
    }

    if (input.category !== undefined) {
      const category = assertValidCategory(input.category);
      if (category !== existing.category) {
        changedFields.push("category");
        nextPost.category = category;
      }
    }

    if (input.bodyMarkdown !== undefined) {
      const bodyMarkdown = sanitizeBodyMarkdown(input.bodyMarkdown);
      if (bodyMarkdown !== existing.bodyMarkdown) {
        changedFields.push("body_markdown");
        nextPost.bodyMarkdown = bodyMarkdown;
      }
    }

    if (input.tenantId !== undefined) {
      const tenantId = normalizeTenantIdOrThrow(input.tenantId, input.tenantScope) ?? null;
      if (tenantId !== existing.tenantId) {
        changedFields.push("tenant_id");
        nextPost.tenantId = tenantId;
      }
    }

    if (changedFields.length === 0) {
      const { bodyMarkdown: _ignored, ...summary } = nextPost;
      return summary;
    }

    nextPost.updatedAt = new Date().toISOString();
    nextPost.revision += 1;
    this.posts[index] = nextPost;

    this.auditRecords.push({
      tenantId: nextPost.tenantId,
      actorId: input.actorId,
      action: "update",
      postId: nextPost.id,
      metadata: {
        changed_fields: changedFields
      }
    });

    const { bodyMarkdown: _ignored, ...summary } = nextPost;
    return summary;
  }

  async publishPost(input: TransitionPostInput): Promise<AdminPostSummary | null> {
    return this.transitionStatus(input, "published", "publish");
  }

  async unpublishPost(input: TransitionPostInput): Promise<AdminPostSummary | null> {
    return this.transitionStatus(input, "draft", "unpublish");
  }

  private async transitionStatus(
    input: TransitionPostInput,
    status: ChangelogPostStatus,
    action: Extract<ChangelogAuditAction, "publish" | "unpublish">
  ): Promise<AdminPostSummary | null> {
    const index = this.posts.findIndex((post) => post.id === input.id);
    if (index === -1) {
      return null;
    }

    const existing = this.posts[index];
    if (!isScopedToTenant(existing.tenantId, input.tenantScope)) {
      return null;
    }

    if (input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) {
      throw new ConflictError("revision mismatch");
    }

    if (existing.status === status) {
      throw new ConflictError(`post already ${status}`);
    }

    const nextPost: InMemoryPost = {
      ...existing,
      status,
      publishedAt: status === "published" ? existing.publishedAt ?? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
      revision: existing.revision + 1
    };

    this.posts[index] = nextPost;
    this.auditRecords.push({
      tenantId: nextPost.tenantId,
      actorId: input.actorId,
      action,
      postId: nextPost.id,
      metadata: {
        previous_status: existing.status,
        new_status: nextPost.status
      }
    });

    const { bodyMarkdown: _ignored, ...summary } = nextPost;
    return summary;
  }
}
