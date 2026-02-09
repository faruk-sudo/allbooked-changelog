import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config";
import { hydrateAuthFromHeaders, requireAdmin, requireAuthenticated } from "../middleware/auth";
import { requireAllowlistedTenant } from "../middleware/allowlist";
import { hydrateTenantFromHeaders, requireTenantContext } from "../middleware/tenant";
import { whatsNewSecurityHeaders } from "../security/headers";
import { appLogger, type Logger } from "../security/logger";
import { renderMarkdownSafe } from "../security/markdown";
import { findPublishedPostBySlug, listPublishedPosts } from "./repository";

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderListPage(req: Request): string {
  const posts = listPublishedPosts();
  const listItems = posts
    .map(
      (post) =>
        `<li><a href="/whats-new/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a> <small>${escapeHtml(
          post.publishedAt ?? ""
        )}</small></li>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>What's New</title>
  </head>
  <body>
    <main>
      <h1>What's New</h1>
      <p>Tenant: ${escapeHtml(req.tenantId ?? "unknown")}</p>
      <ul>${listItems}</ul>
    </main>
  </body>
</html>`;
}

function renderDetailPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | What's New</title>
  </head>
  <body>
    <main>
      <nav><a href="/whats-new">Back</a></nav>
      <h1>${escapeHtml(title)}</h1>
      ${bodyHtml}
    </main>
  </body>
</html>`;
}

export function createWhatsNewRouter(config: AppConfig, logger: Logger = appLogger): Router {
  const router = Router();

  router.use(whatsNewSecurityHeaders);
  router.use(hydrateTenantFromHeaders);
  router.use(hydrateAuthFromHeaders);
  router.use(requireAuthenticated);
  router.use(requireAdmin);
  router.use(requireTenantContext);
  router.use(requireAllowlistedTenant(config));

  router.get("/", (req: Request, res: Response) => {
    const posts = listPublishedPosts();
    logger.info("whats_new_list_viewed", {
      userId: req.auth?.userId,
      tenantId: req.tenantId,
      postCount: posts.length
    });

    res.status(200).type("html").send(renderListPage(req));
  });

  router.get("/:slug", (req: Request, res: Response) => {
    const slugParam = req.params.slug;
    const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;
    const post = slug ? findPublishedPostBySlug(slug) : undefined;
    if (!post) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    logger.info("whats_new_post_viewed", {
      userId: req.auth?.userId,
      tenantId: req.tenantId,
      postId: post.id
    });

    const html = renderMarkdownSafe(post.bodyMarkdown);
    res.status(200).type("html").send(renderDetailPage(post.title, html));
  });

  return router;
}
