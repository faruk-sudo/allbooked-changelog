import { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "../config";
import { buildPublicAbsoluteUrl } from "../config/public-url";
import { createWhatsNewHtmlSecurityHeaders } from "../security/headers";
import { renderMarkdownSafe } from "../security/markdown";
import { appLogger, type Logger } from "../security/logger";
import {
  applyPublicCachingHeaders,
  applyPublicSurfaceResponseHeaders,
  enforcePublicChangelogPolicy,
  getPublicChangelogPolicy,
  renderPublicNoIndexMetaTag,
  requirePublicChangelogEnabled,
  resolvePublicSurfaceConfig
} from "./public-surface";
import {
  sanitizeSlugOrThrow,
  type ChangelogPostCategory,
  type ChangelogRepository,
  ValidationError
} from "./repository";

const STYLESHEET = [
  readFileSync(resolve(__dirname, "../../src/styles/tokens.css"), "utf8"),
  readFileSync(resolve(__dirname, "../../src/styles/primitives.css"), "utf8"),
  readFileSync(resolve(__dirname, "../../src/styles/public-changelog.css"), "utf8")
].join("\n");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

interface CategoryPresentation {
  tone: ChangelogPostCategory;
  key: string;
  label: string;
}

interface PublicListPagePost {
  title: string;
  slug: string;
  excerpt: string;
  category: ChangelogPostCategory;
  publishedAt: string;
}

interface PublicDetailPagePost {
  id: string;
  title: string;
  slug: string;
  category: ChangelogPostCategory;
  publishedAt: string;
  safeHtml: string;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPublishedDate(isoValue: string): string {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.valueOf())) {
    return isoValue;
  }

  return UTC_DATE_FORMATTER.format(parsed);
}

function getCategoryPresentation(category: ChangelogPostCategory): CategoryPresentation {
  if (category === "improvement") {
    return {
      tone: "improvement",
      key: "I",
      label: "Improvement"
    };
  }

  if (category === "fix") {
    return {
      tone: "fix",
      key: "F",
      label: "Fix"
    };
  }

  return {
    tone: "new",
    key: "N",
    label: "New"
  };
}

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

function parsePublicPagination(req: Request): { page: number; limit: number; offset: number } {
  const requestedPage = parsePositiveIntegerValue("page", req.query.page);
  const requestedLimit = parsePositiveIntegerValue("limit", req.query.limit);

  const page = requestedPage ?? 1;
  const limit = Math.min(Math.max(requestedLimit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = (page - 1) * limit;

  return {
    page,
    limit,
    offset
  };
}

function renderRobotsAndCanonicalTags(config: AppConfig, path: string): string {
  const canonicalUrl = buildPublicAbsoluteUrl(config.publicSiteUrl, path);
  const canonicalTag = canonicalUrl
    ? `\n    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`
    : "";
  const noIndexMetaTag = renderPublicNoIndexMetaTag(config);
  const robotsMetaTag = noIndexMetaTag ? `\n    ${noIndexMetaTag}` : "";

  return `${robotsMetaTag}${canonicalTag}`;
}

function buildPaginationLink(page: number, limit: number): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  return `/changelog?${params.toString()}`;
}

function renderPagination(page: number, limit: number, hasMore: boolean): string {
  if (page <= 1 && !hasMore) {
    return "";
  }

  const previousLink =
    page > 1
      ? `<a class="ds-button ds-button--secondary" href="${escapeHtml(buildPaginationLink(page - 1, limit))}">Newer updates</a>`
      : `<span class="pc-pagination-spacer" aria-hidden="true"></span>`;
  const nextLink = hasMore
    ? `<a class="ds-button ds-button--secondary" href="${escapeHtml(buildPaginationLink(page + 1, limit))}">Older updates</a>`
    : `<span class="pc-pagination-spacer" aria-hidden="true"></span>`;

  return `<nav class="pc-pagination" aria-label="Pagination">
        ${previousLink}
        ${nextLink}
      </nav>`;
}

function renderPublicListPage(
  config: AppConfig,
  posts: PublicListPagePost[],
  pagination: { page: number; limit: number; hasMore: boolean }
): string {
  const postList = posts
    .map((post) => {
      const category = getCategoryPresentation(post.category);

      return `<li class="pc-feed-row">
            <article class="pc-feed-item ds-surface ds-surface--raised">
              <header class="pc-feed-item-header ds-stack ds-stack--vertical">
                <span class="pc-category-badge pc-category-badge--${category.tone}">
                  <span class="pc-category-key pc-category-key--${category.tone}" aria-hidden="true">${category.key}</span>
                  ${category.label}
                </span>
                <h2 class="pc-feed-title">
                  <a class="pc-post-link" href="/changelog/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a>
                </h2>
                <p class="pc-feed-meta ds-text ds-text--muted">
                  <time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(formatPublishedDate(post.publishedAt))}</time>
                </p>
              </header>
              <p class="pc-feed-excerpt ds-text ds-text--body">${escapeHtml(post.excerpt)}</p>
            </article>
          </li>`;
    })
    .join("");

  const listContent =
    posts.length > 0
      ? `<ol class="pc-feed-list">${postList}</ol>`
      : '<p class="pc-empty-state ds-text ds-text--muted">No public updates yet.</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />${renderRobotsAndCanonicalTags(config, "/changelog")}
    <title>Changelog</title>
    <link rel="stylesheet" href="/changelog/assets/styles.css" />
  </head>
  <body class="ds-root pc-page">
    <main class="pc-main">
      <header class="pc-page-header ds-stack ds-stack--vertical">
        <h1 class="ds-text ds-text--heading">Changelog</h1>
        <p class="ds-text ds-text--muted">Public product updates from the AllBooked team.</p>
      </header>
      ${listContent}
      ${renderPagination(pagination.page, pagination.limit, pagination.hasMore)}
    </main>
  </body>
</html>`;
}

function renderPublicDetailPage(config: AppConfig, post: PublicDetailPagePost): string {
  const category = getCategoryPresentation(post.category);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />${renderRobotsAndCanonicalTags(config, `/changelog/${post.slug}`)}
    <title>${escapeHtml(post.title)} · Changelog</title>
    <link rel="stylesheet" href="/changelog/assets/styles.css" />
  </head>
  <body class="ds-root pc-page">
    <main class="pc-main pc-main--detail">
      <nav class="pc-detail-nav">
        <a class="pc-back-link" href="/changelog">Back to Changelog</a>
      </nav>
      <article class="pc-detail-shell ds-surface ds-surface--raised" aria-labelledby="public-changelog-title">
        <header class="pc-detail-header ds-stack ds-stack--vertical">
          <span class="pc-category-badge pc-category-badge--${category.tone}">
            <span class="pc-category-key pc-category-key--${category.tone}" aria-hidden="true">${category.key}</span>
            ${category.label}
          </span>
          <h1 id="public-changelog-title" class="ds-text ds-text--heading">${escapeHtml(post.title)}</h1>
          <p class="pc-detail-meta ds-text ds-text--muted">
            <time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(formatPublishedDate(post.publishedAt))}</time>
          </p>
        </header>
        <div id="public-changelog-detail" class="pc-detail">${post.safeHtml}</div>
      </article>
    </main>
  </body>
</html>`;
}

function handlePublicRouteError(res: Response, error: unknown): void {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: "Internal server error" });
}

export function createPublicChangelogRouter(
  config: AppConfig,
  repository: ChangelogRepository,
  logger: Logger = appLogger
): Router {
  const router = Router();
  const publicSurfaceConfig = resolvePublicSurfaceConfig(config);

  router.use(requirePublicChangelogEnabled(config));
  router.use(enforcePublicChangelogPolicy);

  if (publicSurfaceConfig.cspEnabled) {
    router.use(createWhatsNewHtmlSecurityHeaders(config));
  }

  router.get("/assets/styles.css", (_req: Request, res: Response) => {
    applyPublicCachingHeaders(res);
    res.status(200).type("text/css").send(STYLESHEET);
  });

  router.get("/", async (req: Request, res: Response) => {
    try {
      const policy = getPublicChangelogPolicy(req);
      const pagination = parsePublicPagination(req);
      const posts = await repository.listPublicPosts({
        pagination: {
          limit: pagination.limit + 1,
          offset: pagination.offset
        }
      });
      const hasMore = posts.length > pagination.limit;
      const visiblePosts = hasMore ? posts.slice(0, pagination.limit) : posts;

      logger.info("public_changelog_list_viewed", {
        status: policy.status,
        visibility: policy.visibility,
        tenantId: policy.tenantId,
        page: pagination.page,
        limit: pagination.limit,
        count: visiblePosts.length
      });

      applyPublicSurfaceResponseHeaders(res, config);
      res.status(200).type("html").send(
        renderPublicListPage(
          config,
          visiblePosts.map((post) => ({
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt,
            category: post.category,
            publishedAt: post.publishedAt
          })),
          {
            page: pagination.page,
            limit: pagination.limit,
            hasMore
          }
        )
      );
    } catch (error) {
      handlePublicRouteError(res, error);
    }
  });

  router.get("/:slug", async (req: Request, res: Response) => {
    try {
      const policy = getPublicChangelogPolicy(req);
      const rawSlug = Array.isArray(req.params.slug) ? req.params.slug[0] ?? "" : req.params.slug ?? "";
      const slug = sanitizeSlugOrThrow(rawSlug);
      const post = await repository.findPublicPostBySlug(slug);

      if (!post) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      logger.info("public_changelog_detail_viewed", {
        status: policy.status,
        visibility: policy.visibility,
        tenantId: policy.tenantId,
        slug,
        postId: post.id
      });

      applyPublicSurfaceResponseHeaders(res, config);
      res.status(200).type("html").send(
        renderPublicDetailPage(config, {
          id: post.id,
          title: post.title,
          slug: post.slug,
          category: post.category,
          publishedAt: post.publishedAt,
          safeHtml: renderMarkdownSafe(post.bodyMarkdown)
        })
      );
    } catch (error) {
      handlePublicRouteError(res, error);
    }
  });

  return router;
}
