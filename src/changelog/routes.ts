import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config";
import { appLogger, type Logger } from "../security/logger";
import { getGuardedWhatsNewContext } from "./authz";
import { applyWhatsNewReadGuards } from "./guards";
import type { ChangelogRepository } from "./repository";
import type { WhatsNewRequestContext } from "./request-context";

const STYLESHEET = [
  readFileSync(resolve(__dirname, "../../src/styles/tokens.css"), "utf8"),
  readFileSync(resolve(__dirname, "../../src/styles/primitives.css"), "utf8"),
  readFileSync(resolve(__dirname, "../../src/styles/whats-new.css"), "utf8")
].join("\n");

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const CLIENT_SCRIPT = `(() => {
  const appRoot = document.getElementById("whats-new-app");
  if (!appRoot) {
    return;
  }

  const headers = {
    "x-user-id": appRoot.dataset.userId || "",
    "x-user-role": appRoot.dataset.userRole || "ADMIN",
    "x-tenant-id": appRoot.dataset.tenantId || ""
  };

  const statusEl = document.getElementById("whats-new-status");
  const unreadLinkEl = document.getElementById("whats-new-entry-link");
  const unreadDotEl = document.getElementById("whats-new-unread-dot");
  const unreadTextEl = document.getElementById("whats-new-unread-text");

  const setUnreadIndicator = (hasUnread) => {
    if (!unreadLinkEl || !unreadDotEl || !unreadTextEl) {
      return;
    }

    unreadDotEl.hidden = !hasUnread;
    unreadTextEl.hidden = !hasUnread;
    unreadLinkEl.setAttribute(
      "aria-label",
      hasUnread ? "What's New. New updates available" : "What's New"
    );
  };

  const setStatus = (message) => {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
  };

  const requestJson = async (path) => {
    const response = await fetch(path, {
      method: "GET",
      headers
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    return response.json();
  };

  const renderList = async () => {
    const listEl = document.getElementById("whats-new-list");
    if (!listEl) {
      return;
    }

    setStatus("Loading posts...");
    const payload = await requestJson("/api/whats-new/posts?limit=20");
    listEl.innerHTML = "";

    const items = payload.items || [];
    if (items.length === 0) {
      setStatus("No published posts yet.");
      return;
    }

    setStatus("");

    for (const post of items) {
      const li = document.createElement("li");
      li.className = "wn-post-list-item";
      const link = document.createElement("a");
      link.className = "wn-post-link";
      link.href = "/whats-new/" + encodeURIComponent(post.slug);
      link.textContent = post.title;

      const meta = document.createElement("small");
      meta.className = "ds-text ds-text--muted";
      meta.textContent = " " + post.published_at;

      const excerpt = document.createElement("p");
      excerpt.className = "ds-text ds-text--body";
      excerpt.textContent = post.excerpt;

      li.appendChild(link);
      li.appendChild(meta);
      li.appendChild(excerpt);
      listEl.appendChild(li);
    }
  };

  const renderDetail = async () => {
    const detailEl = document.getElementById("whats-new-detail");
    const titleEl = document.getElementById("whats-new-title");
    if (!detailEl || !titleEl) {
      return;
    }

    const slug = appRoot.dataset.slug || "";
    setStatus("Loading post...");

    const payload = await requestJson("/api/whats-new/posts/" + encodeURIComponent(slug));
    titleEl.textContent = payload.title;
    detailEl.innerHTML = payload.safe_html;
    setStatus("");
  };

  const refreshUnreadIndicator = async () => {
    try {
      const payload = await requestJson("/api/whats-new/unread");
      setUnreadIndicator(Boolean(payload.has_unread));
    } catch {
      setUnreadIndicator(false);
    }
  };

  (async () => {
    setUnreadIndicator(appRoot.dataset.initialHasUnread === "true");
    const unreadRefreshPromise = refreshUnreadIndicator();

    try {
      if (appRoot.dataset.view === "detail") {
        await renderDetail();
      } else {
        await renderList();
      }
    } catch {
      setStatus("Unable to load What's New content.");
    }

    await unreadRefreshPromise;
  })();
})();`;

function renderNavBadgeDot(hasUnread: boolean): string {
  const hiddenAttribute = hasUnread ? "" : " hidden";
  return `<span id="whats-new-unread-dot" class="wn-nav-badge-dot"${hiddenAttribute} aria-hidden="true"></span>
      <span id="whats-new-unread-text" class="wn-sr-only"${hiddenAttribute}>New updates available</span>`;
}

function renderBottomBar(hasUnread: boolean): string {
  const ariaLabel = hasUnread ? "What's New. New updates available" : "What's New";
  return `<nav class="wn-bottom-bar" aria-label="App navigation">
      <a
        id="whats-new-entry-link"
        class="ds-button ds-button--ghost wn-bottom-link"
        href="/whats-new"
        aria-current="page"
        aria-label="${escapeHtml(ariaLabel)}"
      >
        <span>What's New</span>
        ${renderNavBadgeDot(hasUnread)}
      </a>
    </nav>`;
}

function renderListPage(context: WhatsNewRequestContext, hasUnread: boolean): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>What's New</title>
    <link rel="stylesheet" href="/whats-new/assets/styles.css" />
  </head>
  <body class="ds-root wn-page">
    <main class="wn-main">
      <h1 class="ds-text ds-text--heading">What's New</h1>
      <p class="ds-text ds-text--muted">Tenant: ${escapeHtml(context.tenantId ?? "unknown")}</p>
      <p id="whats-new-status" aria-live="polite"></p>
      <ul id="whats-new-list" class="wn-post-list"></ul>
    </main>
    ${renderBottomBar(hasUnread)}
    <div
      id="whats-new-app"
      data-view="list"
      data-user-id="${escapeHtml(context.userId ?? "")}"
      data-user-role="${escapeHtml(context.role ?? "ADMIN")}"
      data-tenant-id="${escapeHtml(context.tenantId ?? "")}"
      data-initial-has-unread="${String(hasUnread)}"
    ></div>
    <script src="/whats-new/assets/client.js" defer></script>
  </body>
</html>`;
}

function renderDetailPage(context: WhatsNewRequestContext, slug: string, hasUnread: boolean): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>What's New</title>
    <link rel="stylesheet" href="/whats-new/assets/styles.css" />
  </head>
  <body class="ds-root wn-page">
    <main class="wn-main">
      <nav><a class="wn-back-link" href="/whats-new">Back</a></nav>
      <h1 id="whats-new-title" class="ds-text ds-text--heading">Loading…</h1>
      <p id="whats-new-status" aria-live="polite"></p>
      <article id="whats-new-detail" class="wn-detail"></article>
    </main>
    ${renderBottomBar(hasUnread)}
    <div
      id="whats-new-app"
      data-view="detail"
      data-slug="${escapeHtml(slug)}"
      data-user-id="${escapeHtml(context.userId ?? "")}"
      data-user-role="${escapeHtml(context.role ?? "ADMIN")}"
      data-tenant-id="${escapeHtml(context.tenantId ?? "")}"
      data-initial-has-unread="${String(hasUnread)}"
    ></div>
    <script src="/whats-new/assets/client.js" defer></script>
  </body>
</html>`;
}

async function resolveInitialUnreadState(
  repository: ChangelogRepository,
  context: WhatsNewRequestContext
): Promise<boolean> {
  if (!context.userId || !context.tenantId) {
    return false;
  }

  return repository.hasUnreadPosts({
    tenantScope: { tenantId: context.tenantId },
    userId: context.userId
  });
}

export function createWhatsNewRouter(
  config: AppConfig,
  repository: ChangelogRepository,
  logger: Logger = appLogger
): Router {
  const router = Router();

  router.get("/assets/client.js", (_req: Request, res: Response) => {
    res.status(200).type("application/javascript").send(CLIENT_SCRIPT);
  });

  router.get("/assets/styles.css", (_req: Request, res: Response) => {
    res.status(200).type("text/css").send(STYLESHEET);
  });

  applyWhatsNewReadGuards(router, config);

  router.get("/", async (req: Request, res: Response) => {
    const context = getGuardedWhatsNewContext(req);
    let hasUnread = false;

    try {
      hasUnread = await resolveInitialUnreadState(repository, context);
    } catch {
      hasUnread = false;
    }

    logger.info("whats_new_page_viewed", {
      userId: context.userId,
      tenantId: context.tenantId
    });

    res.status(200).type("html").send(renderListPage(context, hasUnread));
  });

  router.get("/:slug", async (req: Request, res: Response) => {
    const context = getGuardedWhatsNewContext(req);
    const slugParam = req.params.slug;
    const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;
    if (!slug || slug.trim().length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    let hasUnread = false;
    try {
      hasUnread = await resolveInitialUnreadState(repository, context);
    } catch {
      hasUnread = false;
    }

    logger.info("whats_new_detail_page_viewed", {
      userId: context.userId,
      tenantId: context.tenantId,
      slug
    });

    res.status(200).type("html").send(renderDetailPage(context, slug, hasUnread));
  });

  return router;
}
