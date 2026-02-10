import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config";
import { appLogger, type Logger } from "../security/logger";
import { getGuardedWhatsNewContext } from "./authz";
import { applyWhatsNewPublisherGuards } from "./guards";
import type { ChangelogRepository } from "./repository";

const STYLESHEET = [
  readFileSync(resolve(__dirname, "../../src/styles/tokens.css"), "utf8"),
  readFileSync(resolve(__dirname, "../../src/styles/primitives.css"), "utf8"),
  readFileSync(resolve(__dirname, "../../src/styles/whats-new-admin.css"), "utf8")
].join("\n");

const CLIENT_SCRIPT = `(() => {
  const PAGE_SIZE = 20;
  const SEARCH_DEBOUNCE_MS = 300;

  const appRoot = document.getElementById("whats-new-admin-app");
  if (!appRoot) {
    return;
  }

  const tenantId = appRoot.dataset.tenantId || "";
  const headers = {
    "x-user-id": appRoot.dataset.userId || "",
    "x-user-role": appRoot.dataset.userRole || "ADMIN",
    "x-tenant-id": tenantId
  };

  const statusFilterEl = document.getElementById("whats-new-admin-status-filter");
  const scopeFilterEl = document.getElementById("whats-new-admin-scope-filter");
  const searchFormEl = document.getElementById("whats-new-admin-search-form");
  const searchInputEl = document.getElementById("whats-new-admin-search-input");

  const statusLineEl = document.getElementById("whats-new-admin-list-status");
  const loadingEl = document.getElementById("whats-new-admin-loading");
  const errorEl = document.getElementById("whats-new-admin-error");
  const errorMessageEl = document.getElementById("whats-new-admin-error-message");
  const retryEl = document.getElementById("whats-new-admin-retry");
  const emptyEl = document.getElementById("whats-new-admin-empty");
  const tableWrapEl = document.getElementById("whats-new-admin-table-wrap");
  const tableBodyEl = document.getElementById("whats-new-admin-table-body");
  const loadMoreEl = document.getElementById("whats-new-admin-load-more");

  if (
    !(statusFilterEl instanceof HTMLSelectElement) ||
    !(scopeFilterEl instanceof HTMLSelectElement) ||
    !(searchFormEl instanceof HTMLFormElement) ||
    !(searchInputEl instanceof HTMLInputElement) ||
    !(statusLineEl instanceof HTMLElement) ||
    !(loadingEl instanceof HTMLElement) ||
    !(errorEl instanceof HTMLElement) ||
    !(errorMessageEl instanceof HTMLElement) ||
    !(retryEl instanceof HTMLButtonElement) ||
    !(emptyEl instanceof HTMLElement) ||
    !(tableWrapEl instanceof HTMLElement) ||
    !(tableBodyEl instanceof HTMLTableSectionElement) ||
    !(loadMoreEl instanceof HTMLButtonElement)
  ) {
    return;
  }

  const formatDateTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });

  const state = {
    items: [],
    cursor: null,
    status: "all",
    scope: "all",
    query: "",
    isLoadingInitial: true,
    isLoadingMore: false,
    hasLoaded: false,
    errorMessage: null,
    requestId: 0
  };

  let searchDebounceTimer = null;

  const normalizeStatus = (value) => (value === "draft" || value === "published" ? value : "all");
  const normalizeScope = (value) => (value === "global" || value === "tenant" ? value : "all");

  const statusLabel = (value) => {
    if (value === "draft") {
      return "Draft";
    }
    if (value === "published") {
      return "Published";
    }
    return "All";
  };

  const categoryLabel = (value) => {
    if (value === "improvement") {
      return "Improvement";
    }
    if (value === "fix") {
      return "Fix";
    }
    return "New";
  };

  const safeDateLabel = (isoValue) => {
    if (typeof isoValue !== "string" || isoValue.trim().length === 0) {
      return "-";
    }

    const parsed = new Date(isoValue);
    if (Number.isNaN(parsed.valueOf())) {
      return "-";
    }

    return formatDateTime.format(parsed);
  };

  const emptyMessage = () => {
    if (state.status === "draft") {
      return "No drafts yet.";
    }

    if (state.status === "published") {
      return "No published posts yet.";
    }

    return "No changelog posts yet.";
  };

  const setStatusLine = () => {
    if (state.isLoadingInitial) {
      statusLineEl.textContent = "Loading posts...";
      return;
    }

    if (state.errorMessage && state.items.length === 0) {
      statusLineEl.textContent = "Unable to load posts.";
      return;
    }

    const searchSuffix = state.query.length > 0 ? " matching \\\"" + state.query + "\\\"" : "";
    statusLineEl.textContent =
      "Showing " + state.items.length + " " + statusLabel(state.status).toLowerCase() + " posts" + searchSuffix + ".";
  };

  const setVisibility = (element, isVisible) => {
    element.hidden = !isVisible;
  };

  const createCell = (content) => {
    const cell = document.createElement("td");
    cell.className = "wn-admin-table__cell";
    cell.appendChild(content);
    return cell;
  };

  const createStatusPill = (status) => {
    const pill = document.createElement("span");
    pill.className = "wn-admin-pill wn-admin-pill--status wn-admin-pill--" + status;
    pill.textContent = status === "published" ? "Published" : "Draft";
    return pill;
  };

  const createCategoryPill = (category) => {
    const pill = document.createElement("span");
    pill.className = "wn-admin-pill wn-admin-pill--category wn-admin-pill--category-" + category;
    pill.textContent = categoryLabel(category);
    return pill;
  };

  const createScopePill = (postTenantId) => {
    const pill = document.createElement("span");
    pill.className = "wn-admin-pill wn-admin-pill--scope";
    pill.textContent = typeof postTenantId === "string" && postTenantId.length > 0 ? postTenantId : "Global";
    return pill;
  };

  const createTitleCell = (post) => {
    const wrap = document.createElement("div");
    wrap.className = "wn-admin-title-cell";

    const title = document.createElement("p");
    title.className = "ds-text ds-text--body";
    title.textContent = typeof post.title === "string" && post.title.trim().length > 0 ? post.title : "Untitled";

    const slug = document.createElement("p");
    slug.className = "ds-text ds-text--muted";
    slug.textContent = typeof post.slug === "string" ? "/" + post.slug : "-";

    wrap.appendChild(title);
    wrap.appendChild(slug);

    return createCell(wrap);
  };

  const createActionsCell = (post) => {
    const cell = document.createElement("td");
    cell.className = "wn-admin-table__cell wn-admin-table__cell--actions";

    const actions = document.createElement("div");
    actions.className = "wn-admin-row-actions";

    const editLink = document.createElement("a");
    editLink.className = "ds-button ds-button--secondary";
    editLink.href = "/admin/whats-new/" + encodeURIComponent(String(post.id || "")) + "/edit";
    editLink.textContent = "Edit";

    actions.appendChild(editLink);

    if (post.status === "published" && typeof post.slug === "string" && post.slug.length > 0) {
      const viewLink = document.createElement("a");
      viewLink.className = "ds-button ds-button--ghost";
      viewLink.href = "/whats-new/" + encodeURIComponent(post.slug);
      viewLink.target = "_blank";
      viewLink.rel = "noopener noreferrer";
      viewLink.textContent = "View";
      actions.appendChild(viewLink);
    } else {
      const viewButton = document.createElement("button");
      viewButton.className = "ds-button ds-button--ghost";
      viewButton.type = "button";
      viewButton.disabled = true;
      viewButton.title = "Only published posts can be viewed.";
      viewButton.textContent = "View";
      actions.appendChild(viewButton);
    }

    cell.appendChild(actions);
    return cell;
  };

  const renderRows = () => {
    tableBodyEl.innerHTML = "";

    for (const post of state.items) {
      const row = document.createElement("tr");
      row.className = "wn-admin-table__row";

      row.appendChild(createCell(createStatusPill(post.status)));
      row.appendChild(createTitleCell(post));
      row.appendChild(createCell(createCategoryPill(post.category)));
      row.appendChild(createCell(createScopePill(post.tenant_id)));

      const publishedCellText = document.createElement("span");
      publishedCellText.className = "ds-text ds-text--muted";
      publishedCellText.textContent = post.status === "published" ? safeDateLabel(post.published_at) : "-";
      row.appendChild(createCell(publishedCellText));

      const updatedCellText = document.createElement("span");
      updatedCellText.className = "ds-text ds-text--muted";
      updatedCellText.textContent = safeDateLabel(post.updated_at);
      row.appendChild(createCell(updatedCellText));

      row.appendChild(createActionsCell(post));

      tableBodyEl.appendChild(row);
    }
  };

  const render = () => {
    setStatusLine();

    setVisibility(loadingEl, state.isLoadingInitial);
    setVisibility(errorEl, Boolean(state.errorMessage));
    setVisibility(emptyEl, !state.isLoadingInitial && !state.errorMessage && state.items.length === 0);
    setVisibility(tableWrapEl, state.items.length > 0);

    if (state.errorMessage) {
      errorMessageEl.textContent = state.errorMessage;
    }

    emptyEl.textContent = emptyMessage();

    loadMoreEl.hidden = !state.cursor || state.isLoadingInitial || state.items.length === 0;
    loadMoreEl.disabled = state.isLoadingMore;
    loadMoreEl.textContent = state.isLoadingMore ? "Loading..." : "Load more";

    renderRows();
  };

  const buildQueryParams = (cursor) => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));

    if (cursor) {
      params.set("cursor", cursor);
    }

    if (state.status !== "all") {
      params.set("status", state.status);
    }

    if (state.scope === "global") {
      params.set("tenant_id", "global");
    }

    if (state.scope === "tenant" && tenantId.length > 0) {
      params.set("tenant_id", tenantId);
    }

    if (state.query.length > 0) {
      params.set("q", state.query);
    }

    return params;
  };

  const loadPosts = async (mode) => {
    const requestId = ++state.requestId;

    if (mode === "initial") {
      state.isLoadingInitial = true;
      state.isLoadingMore = false;
      state.errorMessage = null;
      state.cursor = null;
      state.items = [];
    } else {
      if (!state.cursor || state.isLoadingMore) {
        return;
      }
      state.isLoadingMore = true;
      state.errorMessage = null;
    }

    render();

    const cursor = mode === "more" ? state.cursor : null;
    const params = buildQueryParams(cursor);

    try {
      const response = await fetch("/api/admin/whats-new/posts?" + params.toString(), {
        headers
      });

      if (!response.ok) {
        throw new Error("status:" + response.status);
      }

      const payload = await response.json();
      if (requestId !== state.requestId) {
        return;
      }

      const items = Array.isArray(payload.items) ? payload.items : [];
      const nextCursor = typeof payload.pagination?.next_cursor === "string" ? payload.pagination.next_cursor : null;

      state.items = mode === "more" ? state.items.concat(items) : items;
      state.cursor = nextCursor;
      state.errorMessage = null;
      state.hasLoaded = true;
    } catch {
      if (requestId !== state.requestId) {
        return;
      }

      state.errorMessage = "Unable to load posts. Please retry.";
    } finally {
      if (requestId === state.requestId) {
        state.isLoadingInitial = false;
        state.isLoadingMore = false;
        render();
      }
    }
  };

  const applyFiltersAndReload = () => {
    state.status = normalizeStatus(statusFilterEl.value);
    state.scope = normalizeScope(scopeFilterEl.value);
    state.query = searchInputEl.value.trim();
    void loadPosts("initial");
  };

  statusFilterEl.addEventListener("change", () => {
    applyFiltersAndReload();
  });

  scopeFilterEl.addEventListener("change", () => {
    applyFiltersAndReload();
  });

  searchInputEl.addEventListener("input", () => {
    if (searchDebounceTimer) {
      window.clearTimeout(searchDebounceTimer);
    }

    searchDebounceTimer = window.setTimeout(() => {
      applyFiltersAndReload();
    }, SEARCH_DEBOUNCE_MS);
  });

  searchFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    if (searchDebounceTimer) {
      window.clearTimeout(searchDebounceTimer);
    }
    applyFiltersAndReload();
  });

  loadMoreEl.addEventListener("click", () => {
    void loadPosts("more");
  });

  retryEl.addEventListener("click", () => {
    void loadPosts("initial");
  });

  statusFilterEl.value = state.status;
  scopeFilterEl.value = state.scope;

  render();
  void loadPosts("initial");
})();`;

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderAdminPage(userId: string, role: string, tenantId: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>What's New Publisher</title>
    <link rel="stylesheet" href="/admin/whats-new/assets/styles.css" />
  </head>
  <body class="ds-root wn-admin-page">
    <main class="wn-admin-main">
      <header class="wn-admin-header ds-stack ds-stack--vertical">
        <h1 class="ds-text ds-text--heading">What's New Publisher</h1>
        <p class="ds-text ds-text--muted">Manage drafts and published changelog updates for tenant <strong>${escapeHtml(
          tenantId
        )}</strong>.</p>
      </header>

      <section class="wn-admin-shell ds-surface ds-surface--raised" aria-labelledby="whats-new-admin-list-title">
        <div class="wn-admin-shell__header ds-stack ds-stack--vertical">
          <div class="wn-admin-shell__title-row">
            <div class="ds-stack ds-stack--vertical">
              <h2 id="whats-new-admin-list-title" class="ds-text ds-text--heading">Posts</h2>
              <p id="whats-new-admin-list-status" class="ds-text ds-text--muted" aria-live="polite">Loading posts...</p>
            </div>
            <a class="ds-button ds-button--primary" href="/admin/whats-new/new">Create new post</a>
          </div>

          <form id="whats-new-admin-search-form" class="wn-admin-filters" role="search">
            <div class="wn-admin-field">
              <label class="wn-admin-field__label ds-text ds-text--muted" for="whats-new-admin-status-filter">Status</label>
              <select id="whats-new-admin-status-filter" class="wn-admin-select" name="status">
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>

            <div class="wn-admin-field">
              <label class="wn-admin-field__label ds-text ds-text--muted" for="whats-new-admin-scope-filter">Scope</label>
              <select id="whats-new-admin-scope-filter" class="wn-admin-select" name="scope">
                <option value="all">All</option>
                <option value="global">Global</option>
                <option value="tenant">This tenant</option>
              </select>
            </div>

            <div class="wn-admin-field wn-admin-field--search">
              <label class="wn-admin-field__label ds-text ds-text--muted" for="whats-new-admin-search-input">Search</label>
              <div class="wn-admin-search-row">
                <input
                  id="whats-new-admin-search-input"
                  class="wn-admin-input"
                  name="q"
                  type="search"
                  autocomplete="off"
                  placeholder="Search title or slug"
                />
                <button class="ds-button ds-button--secondary" type="submit">Search</button>
              </div>
            </div>
          </form>
        </div>

        <div id="whats-new-admin-loading" class="wn-admin-loading" role="status" aria-live="polite">
          <p class="ds-text ds-text--muted">Loading posts...</p>
        </div>

        <div id="whats-new-admin-error" class="wn-admin-error ds-surface ds-surface--sunken" role="status" hidden>
          <p id="whats-new-admin-error-message" class="ds-text ds-text--muted">Unable to load posts.</p>
          <button id="whats-new-admin-retry" class="ds-button ds-button--secondary" type="button">Retry</button>
        </div>

        <p id="whats-new-admin-empty" class="ds-text ds-text--muted" hidden>No changelog posts yet.</p>

        <div id="whats-new-admin-table-wrap" class="wn-admin-table-wrap" hidden>
          <table class="wn-admin-table" aria-label="What's New posts">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Title / Slug</th>
                <th scope="col">Category</th>
                <th scope="col">Scope</th>
                <th scope="col">Published</th>
                <th scope="col">Updated</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody id="whats-new-admin-table-body"></tbody>
          </table>
        </div>

        <footer class="wn-admin-footer">
          <button id="whats-new-admin-load-more" class="ds-button ds-button--secondary" type="button" hidden>
            Load more
          </button>
        </footer>
      </section>
    </main>

    <div
      id="whats-new-admin-app"
      data-user-id="${escapeHtml(userId)}"
      data-user-role="${escapeHtml(role)}"
      data-tenant-id="${escapeHtml(tenantId)}"
    ></div>

    <script src="/admin/whats-new/assets/client.js" defer></script>
  </body>
</html>`;
}

function renderPlaceholderPage(title: string, description: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/admin/whats-new/assets/styles.css" />
  </head>
  <body class="ds-root wn-admin-page">
    <main class="wn-admin-main">
      <section class="wn-admin-placeholder ds-surface ds-surface--raised">
        <h1 class="ds-text ds-text--heading">${escapeHtml(title)}</h1>
        <p class="ds-text ds-text--muted">${escapeHtml(description)}</p>
        <a class="ds-button ds-button--secondary" href="/admin/whats-new">Back to post list</a>
      </section>
    </main>
  </body>
</html>`;
}

export function createWhatsNewPublisherRouter(
  config: AppConfig,
  _repository: ChangelogRepository,
  logger: Logger = appLogger
): Router {
  const router = Router();

  router.get("/assets/client.js", (_req: Request, res: Response) => {
    res.status(200).type("application/javascript").send(CLIENT_SCRIPT);
  });

  router.get("/assets/styles.css", (_req: Request, res: Response) => {
    res.status(200).type("text/css").send(STYLESHEET);
  });

  applyWhatsNewPublisherGuards(router, config);

  router.get("/", (req: Request, res: Response) => {
    const context = getGuardedWhatsNewContext(req);

    logger.info("whats_new_admin_list_page_viewed", {
      actorId: context.userId,
      tenantId: context.tenantId
    });

    res
      .status(200)
      .type("html")
      .send(renderAdminPage(context.userId, context.role, context.tenantId));
  });

  router.get("/new", (_req: Request, res: Response) => {
    res
      .status(200)
      .type("html")
      .send(renderPlaceholderPage("Create post", "Create flow lands in Phase 3B."));
  });

  router.get("/:id/edit", (req: Request, res: Response) => {
    const postId = Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id ?? "";

    res
      .status(200)
      .type("html")
      .send(renderPlaceholderPage(`Edit post ${postId}`, "Edit flow lands in Phase 3B."));
  });

  return router;
}
