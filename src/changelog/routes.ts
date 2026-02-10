import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config";
import { appLogger, type Logger } from "../security/logger";
import { getGuardedWhatsNewContext } from "./authz";
import { applyWhatsNewReadGuards } from "./guards";
import type { ChangelogRepository } from "./repository";
import type { WhatsNewRequestContext } from "./request-context";

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
      const link = document.createElement("a");
      link.href = "/whats-new/" + encodeURIComponent(post.slug);
      link.textContent = post.title;

      const meta = document.createElement("small");
      meta.textContent = " " + post.published_at;

      const excerpt = document.createElement("p");
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

  (async () => {
    try {
      if (appRoot.dataset.view === "detail") {
        await renderDetail();
      } else {
        await renderList();
      }
    } catch {
      setStatus("Unable to load What's New content.");
    }
  })();
})();`;

function renderListPage(context: WhatsNewRequestContext): string {
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
      <p>Tenant: ${escapeHtml(context.tenantId ?? "unknown")}</p>
      <p id="whats-new-status" aria-live="polite"></p>
      <ul id="whats-new-list"></ul>
      <div
        id="whats-new-app"
        data-view="list"
        data-user-id="${escapeHtml(context.userId ?? "")}"
        data-user-role="${escapeHtml(context.role ?? "ADMIN")}"
        data-tenant-id="${escapeHtml(context.tenantId ?? "")}"
      ></div>
    </main>
    <script src="/whats-new/assets/client.js" defer></script>
  </body>
</html>`;
}

function renderDetailPage(context: WhatsNewRequestContext, slug: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>What's New</title>
  </head>
  <body>
    <main>
      <nav><a href="/whats-new">Back</a></nav>
      <h1 id="whats-new-title">Loading…</h1>
      <p id="whats-new-status" aria-live="polite"></p>
      <article id="whats-new-detail"></article>
      <div
        id="whats-new-app"
        data-view="detail"
        data-slug="${escapeHtml(slug)}"
        data-user-id="${escapeHtml(context.userId ?? "")}"
        data-user-role="${escapeHtml(context.role ?? "ADMIN")}"
        data-tenant-id="${escapeHtml(context.tenantId ?? "")}"
      ></div>
    </main>
    <script src="/whats-new/assets/client.js" defer></script>
  </body>
</html>`;
}

export function createWhatsNewRouter(
  config: AppConfig,
  _repository: ChangelogRepository,
  logger: Logger = appLogger
): Router {
  const router = Router();

  router.get("/assets/client.js", (_req: Request, res: Response) => {
    res.status(200).type("application/javascript").send(CLIENT_SCRIPT);
  });

  applyWhatsNewReadGuards(router, config);

  router.get("/", (req: Request, res: Response) => {
    const context = getGuardedWhatsNewContext(req);

    logger.info("whats_new_page_viewed", {
      userId: context.userId,
      tenantId: context.tenantId
    });

    res.status(200).type("html").send(renderListPage(context));
  });

  router.get("/:slug", (req: Request, res: Response) => {
    const context = getGuardedWhatsNewContext(req);
    const slugParam = req.params.slug;
    const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;
    if (!slug || slug.trim().length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    logger.info("whats_new_detail_page_viewed", {
      userId: context.userId,
      tenantId: context.tenantId,
      slug
    });

    res.status(200).type("html").send(renderDetailPage(context, slug));
  });

  return router;
}
