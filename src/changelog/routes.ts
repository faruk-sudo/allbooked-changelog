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
  const PAGE_SIZE = 12;
  const MARK_SEEN_DEBOUNCE_MS = 60_000;
  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const appRoot = document.getElementById("whats-new-app");
  if (!appRoot) {
    return;
  }

  const headers = {
    "x-user-id": appRoot.dataset.userId || "",
    "x-user-role": appRoot.dataset.userRole || "ADMIN",
    "x-tenant-id": appRoot.dataset.tenantId || ""
  };
  const csrfToken = appRoot.dataset.csrfToken || "csrf-token-123456";

  const statusEl = document.getElementById("whats-new-status");
  const unreadLinkEl = document.getElementById("whats-new-entry-link");
  const unreadDotEl = document.getElementById("whats-new-unread-dot");
  const unreadTextEl = document.getElementById("whats-new-unread-text");
  const overlayEl = document.getElementById("whats-new-panel-overlay");
  const panelEl = document.getElementById("whats-new-panel");
  const panelCloseEl = document.getElementById("whats-new-panel-close");
  const panelStatusEl = document.getElementById("whats-new-panel-status") || statusEl;
  const feedListEl = document.getElementById("whats-new-feed-list");
  const loadingEl = document.getElementById("whats-new-feed-loading");
  const emptyEl = document.getElementById("whats-new-feed-empty");
  const errorEl = document.getElementById("whats-new-feed-error");
  const errorMessageEl = document.getElementById("whats-new-feed-error-message");
  const retryEl = document.getElementById("whats-new-feed-retry");
  const loadMoreEl = document.getElementById("whats-new-feed-load-more");
  const loadMoreLabelEl = document.getElementById("whats-new-feed-load-more-label");
  const loadMoreSpinnerEl = document.getElementById("whats-new-feed-load-more-spinner");
  const detailBasePath = appRoot.dataset.detailBase || "/whats-new/";
  const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  let hasUnreadState = appRoot.dataset.initialHasUnread === "true";
  let lastSeenWriteAtMs = 0;
  let markSeenPromise = null;

  const setUnreadIndicator = (hasUnread) => {
    hasUnreadState = hasUnread;
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

  const setPanelStatus = (message) => {
    if (!panelStatusEl) {
      return;
    }
    panelStatusEl.textContent = message;
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

  const requestPostJson = async (path) => {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        ...headers,
        "x-csrf-token": csrfToken
      }
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    return response.json();
  };

  const formatPublishedDate = (isoDate) => {
    const parsed = new Date(isoDate);
    if (Number.isNaN(parsed.valueOf())) {
      return isoDate || "";
    }
    return dateFormatter.format(parsed);
  };

  const getCategoryPresentation = (rawCategory) => {
    if (rawCategory === "improvement") {
      return { label: "Improvement", tone: "improvement" };
    }
    if (rawCategory === "fix") {
      return { label: "Fix", tone: "fix" };
    }
    return { label: "New", tone: "new" };
  };

  const getSafeExcerpt = (post) => {
    const rawExcerpt = typeof post.excerpt === "string" ? post.excerpt : "";
    const normalized = rawExcerpt.replace(/\s+/g, " ").trim();
    if (normalized.length > 0) {
      return normalized;
    }
    return "Details available in the full update.";
  };

  const renderWhatsNewFeedItem = (post) => {
    const itemEl = document.createElement("li");
    itemEl.className = "wn-feed-item ds-surface ds-surface--raised";

    const category = getCategoryPresentation(post.category);
    const categoryEl = document.createElement("span");
    categoryEl.className = "wn-category-badge wn-category-badge--" + category.tone;
    categoryEl.textContent = category.label;
    itemEl.appendChild(categoryEl);

    const titleEl = document.createElement("h3");
    titleEl.className = "wn-feed-title";

    const slug = typeof post.slug === "string" ? post.slug.trim() : "";
    const canNavigate = detailBasePath.length > 0 && slug.length > 0;
    if (canNavigate) {
      const linkEl = document.createElement("a");
      linkEl.className = "wn-post-link";
      linkEl.href = detailBasePath + encodeURIComponent(slug);
      linkEl.textContent =
        typeof post.title === "string" && post.title.trim().length > 0 ? post.title : "Untitled update";
      titleEl.appendChild(linkEl);
    } else {
      const textEl = document.createElement("span");
      textEl.className = "ds-text ds-text--body";
      textEl.textContent =
        typeof post.title === "string" && post.title.trim().length > 0 ? post.title : "Untitled update";
      titleEl.appendChild(textEl);
    }

    itemEl.appendChild(titleEl);

    const publishedAt = typeof post.published_at === "string" ? post.published_at : "";
    const dateEl = document.createElement("time");
    dateEl.className = "ds-text ds-text--muted";
    dateEl.dateTime = publishedAt;
    dateEl.textContent = formatPublishedDate(publishedAt);
    itemEl.appendChild(dateEl);

    const excerptEl = document.createElement("p");
    excerptEl.className = "ds-text ds-text--body";
    excerptEl.textContent = getSafeExcerpt(post);
    itemEl.appendChild(excerptEl);

    return itemEl;
  };

  const feedState = {
    items: [],
    cursor: null,
    hasMore: false,
    hasLoadedOnce: false,
    loadingInitial: false,
    loadingMore: false,
    error: null,
    lastFailedMode: null
  };

  let panelTriggerEl = null;

  const readNextCursor = (payload) => {
    const nextCursor = payload && payload.pagination ? payload.pagination.next_cursor : null;
    if (nextCursor === null || nextCursor === undefined || nextCursor === "") {
      return null;
    }
    return String(nextCursor);
  };

  const updatePanelLoadMoreUi = () => {
    if (!loadMoreEl) {
      return;
    }

    const shouldShowLoadMore = feedState.items.length > 0 && feedState.hasMore && !feedState.error;
    loadMoreEl.hidden = !shouldShowLoadMore;
    loadMoreEl.disabled = feedState.loadingMore;

    if (loadMoreLabelEl) {
      loadMoreLabelEl.textContent = feedState.loadingMore ? "Loading..." : "Load more";
    }

    if (loadMoreSpinnerEl) {
      loadMoreSpinnerEl.hidden = !feedState.loadingMore;
    }
  };

  const renderFeedState = () => {
    if (!feedListEl || !loadingEl || !emptyEl || !errorEl) {
      return;
    }

    feedListEl.innerHTML = "";
    for (const post of feedState.items) {
      feedListEl.appendChild(renderWhatsNewFeedItem(post));
    }

    loadingEl.hidden = !feedState.loadingInitial;
    emptyEl.hidden = feedState.loadingInitial || feedState.items.length > 0 || Boolean(feedState.error);
    errorEl.hidden = !feedState.error;

    if (errorMessageEl) {
      errorMessageEl.textContent = feedState.error || "";
    }

    updatePanelLoadMoreUi();

    if (feedState.loadingInitial) {
      setPanelStatus("Loading updates...");
      return;
    }

    if (feedState.error) {
      setPanelStatus("Unable to load updates.");
      return;
    }

    if (feedState.items.length === 0) {
      setPanelStatus("No updates yet.");
      return;
    }

    setPanelStatus("");
  };

  const buildFeedPath = () => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    if (feedState.cursor) {
      params.set("cursor", feedState.cursor);
    }
    return "/api/whats-new/posts?" + params.toString();
  };

  const loadFeedPage = async (mode) => {
    if (mode === "initial" && feedState.loadingInitial) {
      return;
    }

    if (mode === "more" && (feedState.loadingMore || !feedState.hasMore)) {
      return;
    }

    if (mode === "initial") {
      feedState.items = [];
      feedState.cursor = null;
      feedState.hasMore = false;
      feedState.loadingInitial = true;
    } else {
      feedState.loadingMore = true;
    }

    feedState.error = null;
    feedState.lastFailedMode = null;
    renderFeedState();

    try {
      const payload = await requestJson(buildFeedPath());
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (mode === "initial") {
        feedState.items = items;
      } else {
        feedState.items = feedState.items.concat(items);
      }
      feedState.cursor = readNextCursor(payload);
      feedState.hasMore = Boolean(feedState.cursor);
      feedState.hasLoadedOnce = true;
      feedState.error = null;
    } catch {
      feedState.error = "Unable to load updates. Please try again.";
      feedState.lastFailedMode = mode;
    } finally {
      feedState.loadingInitial = false;
      feedState.loadingMore = false;
      renderFeedState();
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
      return true;
    } catch {
      return false;
    }
  };

  const markSeen = async () => {
    const now = Date.now();
    const shouldDebounce = !hasUnreadState && now - lastSeenWriteAtMs < MARK_SEEN_DEBOUNCE_MS;
    if (shouldDebounce) {
      return;
    }

    if (markSeenPromise) {
      return markSeenPromise;
    }

    markSeenPromise = (async () => {
      try {
        await requestPostJson("/api/whats-new/seen");
        lastSeenWriteAtMs = Date.now();
        setUnreadIndicator(false);
        await refreshUnreadIndicator();
      } catch {
        // Fail-safe: keep current unread state when mark-seen fails.
      } finally {
        markSeenPromise = null;
      }
    })();

    return markSeenPromise;
  };

  const getFocusableElements = () => {
    if (!panelEl) {
      return [];
    }

    return Array.from(panelEl.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      return !element.hasAttribute("hidden");
    });
  };

  const focusInitialPanelTarget = () => {
    if (panelCloseEl instanceof HTMLElement) {
      panelCloseEl.focus();
      return;
    }

    if (panelEl instanceof HTMLElement) {
      panelEl.focus();
    }
  };

  const closePanel = () => {
    if (!panelEl || panelEl.hidden) {
      return;
    }

    panelEl.hidden = true;
    if (overlayEl) {
      overlayEl.hidden = true;
    }

    document.body.classList.remove("wn-panel-open");

    if (unreadLinkEl) {
      unreadLinkEl.setAttribute("aria-expanded", "false");
    }

    document.removeEventListener("keydown", onPanelKeydown);

    if (panelTriggerEl && typeof panelTriggerEl.focus === "function") {
      panelTriggerEl.focus();
    }

    panelTriggerEl = null;
  };

  const openPanel = () => {
    if (!panelEl || !overlayEl || panelEl.hidden === false) {
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      panelTriggerEl = document.activeElement;
    } else {
      panelTriggerEl = unreadLinkEl;
    }

    overlayEl.hidden = false;
    panelEl.hidden = false;
    document.body.classList.add("wn-panel-open");

    if (unreadLinkEl) {
      unreadLinkEl.setAttribute("aria-expanded", "true");
    }

    document.addEventListener("keydown", onPanelKeydown);
    focusInitialPanelTarget();

    if (!feedState.hasLoadedOnce) {
      void loadFeedPage("initial");
    }

    void markSeen();
  };

  const onPanelKeydown = (event) => {
    if (!panelEl || panelEl.hidden) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = getFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      if (panelEl instanceof HTMLElement) {
        panelEl.focus();
      }
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      if (last instanceof HTMLElement) {
        last.focus();
      }
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      if (first instanceof HTMLElement) {
        first.focus();
      }
    }
  };

  if (unreadLinkEl) {
    unreadLinkEl.addEventListener("click", (event) => {
      if (!panelEl || !overlayEl) {
        return;
      }
      event.preventDefault();
      if (panelEl.hidden) {
        openPanel();
      } else {
        closePanel();
      }
    });
  }

  if (panelCloseEl) {
    panelCloseEl.addEventListener("click", () => {
      closePanel();
    });
  }

  if (overlayEl) {
    overlayEl.addEventListener("click", () => {
      closePanel();
    });
  }

  if (loadMoreEl) {
    loadMoreEl.addEventListener("click", () => {
      void loadFeedPage("more");
    });
  }

  if (retryEl) {
    retryEl.addEventListener("click", () => {
      const mode = feedState.lastFailedMode || (feedState.items.length > 0 ? "more" : "initial");
      void loadFeedPage(mode);
    });
  }

  (async () => {
    setUnreadIndicator(hasUnreadState);
    const unreadRefreshPromise = refreshUnreadIndicator();
    const markSeenOnListPromise = appRoot.dataset.view === "list" ? markSeen() : Promise.resolve();
    const loadFeedOnListPromise =
      appRoot.dataset.view === "list" ? loadFeedPage("initial") : Promise.resolve();

    try {
      if (appRoot.dataset.view === "detail") {
        await renderDetail();
      }
    } catch {
      setStatus("Unable to load What's New content.");
    }

    await unreadRefreshPromise;
    await markSeenOnListPromise;
    await loadFeedOnListPromise;
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
        aria-controls="whats-new-panel"
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-label="${escapeHtml(ariaLabel)}"
      >
        <span>What's New</span>
        ${renderNavBadgeDot(hasUnread)}
      </a>
    </nav>`;
}

function renderWhatsNewFeedBody(contentClassName: string, footerClassName: string): string {
  return `<div class="${contentClassName}">
        <div id="whats-new-feed-loading" class="wn-feed-loading" role="status" aria-live="polite" hidden>
          <span class="wn-spinner" aria-hidden="true"></span>
          <span class="ds-text ds-text--muted">Loading updates...</span>
        </div>
        <p id="whats-new-feed-empty" class="ds-text ds-text--muted" hidden>No updates yet.</p>
        <div id="whats-new-feed-error" class="wn-feed-error ds-surface ds-surface--sunken" role="status" hidden>
          <p id="whats-new-feed-error-message" class="ds-text ds-text--muted">Unable to load updates.</p>
          <button id="whats-new-feed-retry" class="ds-button ds-button--secondary" type="button">Retry</button>
        </div>
        <ul id="whats-new-feed-list" class="wn-feed-list"></ul>
      </div>
      <footer class="${footerClassName}">
        <button
          id="whats-new-feed-load-more"
          class="ds-button ds-button--secondary wn-feed-load-more"
          type="button"
          hidden
        >
          <span id="whats-new-feed-load-more-spinner" class="wn-spinner" aria-hidden="true" hidden></span>
          <span id="whats-new-feed-load-more-label">Load more</span>
        </button>
      </footer>`;
}

function renderWhatsNewPanel(): string {
  return `<div id="whats-new-panel-overlay" class="wn-panel-overlay" hidden></div>
    <aside
      id="whats-new-panel"
      class="wn-panel ds-surface ds-surface--raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-panel-title"
      tabindex="-1"
      hidden
    >
      <header class="wn-panel-header">
        <div class="wn-panel-heading ds-stack ds-stack--vertical">
          <h2 id="whats-new-panel-title" class="ds-text ds-text--heading">What's New</h2>
          <p id="whats-new-panel-status" class="ds-text ds-text--muted" aria-live="polite"></p>
        </div>
        <div class="wn-panel-header-actions ds-stack ds-stack--horizontal">
          <a
            id="whats-new-panel-open-full-page"
            class="ds-button ds-button--secondary wn-panel-open-link"
            href="/whats-new"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open full page in a new tab"
          >
            Open full page (new tab)
          </a>
          <button
            id="whats-new-panel-close"
            class="ds-button ds-button--ghost"
            type="button"
            aria-label="Close What's New panel"
          >
            Close
          </button>
        </div>
      </header>
      ${renderWhatsNewFeedBody("wn-panel-content", "wn-panel-footer")}
    </aside>`;
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
      <header class="wn-page-heading ds-stack ds-stack--vertical">
        <h1 class="ds-text ds-text--heading">What's New</h1>
        <p class="ds-text ds-text--muted">Tenant: ${escapeHtml(context.tenantId ?? "unknown")}</p>
        <p id="whats-new-status" class="ds-text ds-text--muted" aria-live="polite"></p>
      </header>
      <section class="wn-list-feed ds-surface ds-surface--raised" aria-labelledby="whats-new-feed-heading">
        <div class="wn-list-feed-heading ds-stack ds-stack--vertical">
          <h2 id="whats-new-feed-heading" class="ds-text ds-text--heading">Latest updates</h2>
          <p class="ds-text ds-text--muted">Recent product updates for your workspace.</p>
        </div>
        ${renderWhatsNewFeedBody("wn-list-feed-content", "wn-list-feed-footer")}
      </section>
    </main>
    <div
      id="whats-new-app"
      data-view="list"
      data-user-id="${escapeHtml(context.userId ?? "")}"
      data-user-role="${escapeHtml(context.role ?? "ADMIN")}"
      data-tenant-id="${escapeHtml(context.tenantId ?? "")}"
      data-csrf-token="csrf-token-123456"
      data-initial-has-unread="${String(hasUnread)}"
      data-detail-base="/whats-new/"
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
    ${renderWhatsNewPanel()}
    ${renderBottomBar(hasUnread)}
    <div
      id="whats-new-app"
      data-view="detail"
      data-slug="${escapeHtml(slug)}"
      data-user-id="${escapeHtml(context.userId ?? "")}"
      data-user-role="${escapeHtml(context.role ?? "ADMIN")}"
      data-tenant-id="${escapeHtml(context.tenantId ?? "")}"
      data-csrf-token="csrf-token-123456"
      data-initial-has-unread="${String(hasUnread)}"
      data-detail-base="/whats-new/"
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
