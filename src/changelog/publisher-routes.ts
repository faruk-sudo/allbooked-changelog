import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config";
import { createWhatsNewHtmlSecurityHeaders } from "../security/headers";
import { appLogger, type Logger } from "../security/logger";
import { getGuardedWhatsNewContext } from "./authz";
import { applyWhatsNewPublisherGuards } from "./guards";
import type { ChangelogRepository } from "./repository";

const STYLESHEET = [
  readFileSync(resolve(__dirname, "../../src/styles/tokens.css"), "utf8"),
  readFileSync(resolve(__dirname, "../../src/styles/primitives.css"), "utf8"),
  readFileSync(resolve(__dirname, "../../src/styles/whats-new-admin.css"), "utf8")
].join("\n");

const DEFAULT_CSRF_TOKEN = "csrf-token-123456";

const LIST_CLIENT_SCRIPT = `(() => {
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

const EDITOR_CLIENT_SCRIPT = `(() => {
  const PREVIEW_DEBOUNCE_MS = 300;
  const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const CATEGORY_VALUES = new Set(["new", "improvement", "fix"]);
  const SLUG_MAX_LENGTH = 100;
  const TITLE_MAX_LENGTH = 140;
  const BODY_MAX_LENGTH = 50000;
  const EMPTY_PREVIEW_HTML = '<p class="ds-text ds-text--muted">Nothing to preview yet.</p>';

  const appRoot = document.getElementById("whats-new-admin-editor-app");
  if (!appRoot) {
    return;
  }

  const mode = appRoot.dataset.mode === "edit" ? "edit" : "create";
  const postId = appRoot.dataset.postId || "";
  const tenantId = appRoot.dataset.tenantId || "";
  const csrfToken = appRoot.dataset.csrfToken || "";

  const headers = {
    "x-user-id": appRoot.dataset.userId || "",
    "x-user-role": appRoot.dataset.userRole || "ADMIN",
    "x-tenant-id": tenantId
  };

  const formEl = document.getElementById("whats-new-editor-form");
  const titleInputEl = document.getElementById("whats-new-editor-title");
  const categorySelectEl = document.getElementById("whats-new-editor-category");
  const scopeSelectEl = document.getElementById("whats-new-editor-scope");
  const visibilityInputEl = document.getElementById("whats-new-editor-visibility");
  const statusInputEl = document.getElementById("whats-new-editor-status");
  const publishedAtInputEl = document.getElementById("whats-new-editor-published-at");
  const statusPillEl = document.getElementById("whats-new-editor-status-pill");
  const slugInputEl = document.getElementById("whats-new-editor-slug");
  const slugSuggestionEl = document.getElementById("whats-new-editor-slug-suggestion");
  const slugSuggestionButtonEl = document.getElementById("whats-new-editor-slug-suggestion-button");
  const bodyInputEl = document.getElementById("whats-new-editor-body");
  const previewPaneEl = document.getElementById("whats-new-editor-preview");
  const previewStatusEl = document.getElementById("whats-new-editor-preview-status");
  const warningListEl = document.getElementById("whats-new-editor-warning-list");
  const bannerEl = document.getElementById("whats-new-editor-banner");
  const validationSummaryEl = document.getElementById("whats-new-editor-validation-summary");
  const validationSummaryListEl = document.getElementById("whats-new-editor-validation-summary-list");
  const saveButtonEl = document.getElementById("whats-new-editor-save-button");
  const publishButtonEl = document.getElementById("whats-new-editor-publish-button");
  const viewReaderLinkEl = document.getElementById("whats-new-editor-view-link");
  const saveStatusEl = document.getElementById("whats-new-editor-save-status");

  const confirmOverlayEl = document.getElementById("whats-new-editor-confirm-overlay");
  const confirmDialogEl = document.getElementById("whats-new-editor-confirm-dialog");
  const confirmTitleEl = document.getElementById("whats-new-editor-confirm-title");
  const confirmMessageEl = document.getElementById("whats-new-editor-confirm-message");
  const confirmWarningEl = document.getElementById("whats-new-editor-confirm-warning");
  const confirmCancelButtonEl = document.getElementById("whats-new-editor-confirm-cancel");
  const confirmSubmitButtonEl = document.getElementById("whats-new-editor-confirm-submit");

  const titleErrorEl = document.getElementById("whats-new-editor-title-error");
  const categoryErrorEl = document.getElementById("whats-new-editor-category-error");
  const slugErrorEl = document.getElementById("whats-new-editor-slug-error");
  const bodyErrorEl = document.getElementById("whats-new-editor-body-error");

  if (
    !(formEl instanceof HTMLFormElement) ||
    !(titleInputEl instanceof HTMLInputElement) ||
    !(categorySelectEl instanceof HTMLSelectElement) ||
    !(scopeSelectEl instanceof HTMLSelectElement) ||
    !(visibilityInputEl instanceof HTMLInputElement) ||
    !(statusInputEl instanceof HTMLInputElement) ||
    !(publishedAtInputEl instanceof HTMLInputElement) ||
    !(statusPillEl instanceof HTMLElement) ||
    !(slugInputEl instanceof HTMLInputElement) ||
    !(slugSuggestionEl instanceof HTMLElement) ||
    !(slugSuggestionButtonEl instanceof HTMLButtonElement) ||
    !(bodyInputEl instanceof HTMLTextAreaElement) ||
    !(previewPaneEl instanceof HTMLElement) ||
    !(previewStatusEl instanceof HTMLElement) ||
    !(warningListEl instanceof HTMLElement) ||
    !(bannerEl instanceof HTMLElement) ||
    !(validationSummaryEl instanceof HTMLElement) ||
    !(validationSummaryListEl instanceof HTMLElement) ||
    !(saveButtonEl instanceof HTMLButtonElement) ||
    !(publishButtonEl instanceof HTMLButtonElement) ||
    !(viewReaderLinkEl instanceof HTMLAnchorElement) ||
    !(saveStatusEl instanceof HTMLElement) ||
    !(confirmOverlayEl instanceof HTMLElement) ||
    !(confirmDialogEl instanceof HTMLElement) ||
    !(confirmTitleEl instanceof HTMLElement) ||
    !(confirmMessageEl instanceof HTMLElement) ||
    !(confirmWarningEl instanceof HTMLElement) ||
    !(confirmCancelButtonEl instanceof HTMLButtonElement) ||
    !(confirmSubmitButtonEl instanceof HTMLButtonElement) ||
    !(titleErrorEl instanceof HTMLElement) ||
    !(categoryErrorEl instanceof HTMLElement) ||
    !(slugErrorEl instanceof HTMLElement) ||
    !(bodyErrorEl instanceof HTMLElement)
  ) {
    return;
  }

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });

  const state = {
    hasUnsavedChanges: false,
    lastSavedSnapshot: "",
    isSubmitting: false,
    isTransitioning: false,
    transitionAction: null,
    isLoading: mode === "edit",
    revision: null,
    status: "draft",
    publishedAt: null,
    persistedSlug: "",
    slugManuallyEdited: mode === "edit",
    previewTimer: null,
    previewRequestId: 0,
    suggestedSlug: null,
    confirmAction: null,
    confirmSaveFirst: false,
    lastFocusedBeforeConfirm: null
  };

  const clearElementText = (element) => {
    element.textContent = "";
  };

  const setElementText = (element, text) => {
    element.textContent = text;
  };

  const normalizeSlugInput = (value) => value.trim().toLowerCase();

  const slugifyTitle = (value) => {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");

    const bounded = normalized.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
    if (bounded.length > 0) {
      return bounded;
    }

    return "post";
  };

  const suggestNextSlug = (slug) => {
    const match = slug.match(/^(.*?)(?:-(\\d+))?$/);
    const base = (match && match[1] ? match[1] : slug).replace(/-+$/g, "") || "post";
    const currentNumber = match && match[2] ? Number(match[2]) : 1;
    const nextSuffix = "-" + String(currentNumber + 1);
    const maxBaseLength = Math.max(1, SLUG_MAX_LENGTH - nextSuffix.length);
    const nextBase = base.slice(0, maxBaseLength).replace(/-+$/g, "") || "post".slice(0, maxBaseLength);
    return nextBase + nextSuffix;
  };

  const formatTimestamp = (isoValue) => {
    if (typeof isoValue !== "string" || isoValue.trim().length === 0) {
      return "Not published";
    }

    const parsed = new Date(isoValue);
    if (Number.isNaN(parsed.valueOf())) {
      return "Not published";
    }

    return dateFormatter.format(parsed);
  };

  const getScopeTenantId = () => (scopeSelectEl.value === "global" ? null : tenantId);

  const toSnapshot = () =>
    JSON.stringify({
      title: titleInputEl.value,
      category: categorySelectEl.value,
      scope: scopeSelectEl.value,
      slug: slugInputEl.value,
      body_markdown: bodyInputEl.value
    });

  const clearValidationSummary = () => {
    validationSummaryEl.hidden = true;
    validationSummaryListEl.innerHTML = "";
  };

  const showValidationSummary = (messages) => {
    validationSummaryListEl.innerHTML = "";

    for (const message of messages) {
      const item = document.createElement("li");
      item.className = "ds-text ds-text--muted";
      item.textContent = message;
      validationSummaryListEl.appendChild(item);
    }

    validationSummaryEl.hidden = false;
  };

  const setBanner = (kind, message) => {
    bannerEl.className =
      "wn-admin-editor-banner ds-text " +
      (kind === "success"
        ? "wn-admin-editor-banner--success"
        : kind === "error"
          ? "wn-admin-editor-banner--error"
          : "wn-admin-editor-banner--warning");
    bannerEl.hidden = false;
    setElementText(bannerEl, message);
  };

  const clearBanner = () => {
    bannerEl.hidden = true;
    bannerEl.className = "wn-admin-editor-banner ds-text";
    clearElementText(bannerEl);
  };

  const clearFieldErrors = () => {
    clearElementText(titleErrorEl);
    clearElementText(categoryErrorEl);
    clearElementText(slugErrorEl);
    clearElementText(bodyErrorEl);
  };

  const setFieldError = (field, message) => {
    if (field === "title") {
      setElementText(titleErrorEl, message);
      return;
    }

    if (field === "category") {
      setElementText(categoryErrorEl, message);
      return;
    }

    if (field === "slug") {
      setElementText(slugErrorEl, message);
      return;
    }

    if (field === "body") {
      setElementText(bodyErrorEl, message);
    }
  };

  const hideSlugSuggestion = () => {
    state.suggestedSlug = null;
    slugSuggestionEl.hidden = true;
    slugSuggestionButtonEl.hidden = true;
    clearElementText(slugSuggestionEl);
  };

  const showSlugSuggestion = (slug) => {
    state.suggestedSlug = slug;
    slugSuggestionEl.hidden = false;
    slugSuggestionButtonEl.hidden = false;
    setElementText(slugSuggestionEl, "Try suggested slug: " + slug);
  };

  const setStatusPill = () => {
    statusPillEl.className =
      "wn-admin-pill wn-admin-pill--status " +
      (state.status === "published" ? "wn-admin-pill--published" : "wn-admin-pill--draft");
    statusPillEl.textContent = state.status === "published" ? "Published" : "Draft";
  };

  const updateViewReaderLink = () => {
    const canView = mode === "edit" && state.status === "published" && state.persistedSlug.length > 0;
    viewReaderLinkEl.hidden = !canView;

    if (canView) {
      viewReaderLinkEl.href = "/whats-new/" + encodeURIComponent(state.persistedSlug);
    }
  };

  const updateSaveStatus = () => {
    if (state.isLoading) {
      setElementText(saveStatusEl, "Loading draft...");
      return;
    }

    if (state.isTransitioning) {
      setElementText(saveStatusEl, state.transitionAction === "publish" ? "Publishing..." : "Unpublishing...");
      return;
    }

    if (state.isSubmitting) {
      setElementText(saveStatusEl, mode === "create" ? "Creating draft..." : "Saving draft...");
      return;
    }

    if (state.hasUnsavedChanges) {
      setElementText(saveStatusEl, "Unsaved changes");
      return;
    }

    if (mode === "create") {
      setElementText(saveStatusEl, "Ready to create draft");
      return;
    }

    setElementText(saveStatusEl, "All changes saved");
  };

  const updateActionButtons = () => {
    const isBusy = state.isLoading || state.isSubmitting || state.isTransitioning;
    saveButtonEl.disabled = isBusy;
    saveButtonEl.className = mode === "create" ? "ds-button ds-button--primary" : "ds-button ds-button--secondary";
    saveButtonEl.textContent = state.isSubmitting
      ? mode === "create"
        ? "Creating..."
        : "Saving..."
      : mode === "create"
        ? "Create draft"
        : "Save draft";

    if (mode !== "edit") {
      publishButtonEl.hidden = true;
      statusPillEl.hidden = true;
      updateSaveStatus();
      return;
    }

    publishButtonEl.hidden = false;
    statusPillEl.hidden = false;

    if (state.isTransitioning) {
      publishButtonEl.disabled = true;
      publishButtonEl.className =
        state.transitionAction === "publish" ? "ds-button ds-button--primary" : "ds-button ds-button--secondary";
      publishButtonEl.textContent = state.transitionAction === "publish" ? "Publishing..." : "Unpublishing...";
    } else {
      publishButtonEl.disabled = isBusy;
      publishButtonEl.className =
        state.status === "published" ? "ds-button ds-button--secondary" : "ds-button ds-button--primary";
      publishButtonEl.textContent = state.status === "published" ? "Unpublish" : "Publish";
    }

    publishButtonEl.dataset.action = state.status === "published" ? "unpublish" : "publish";
    updateSaveStatus();
  };

  const syncDirtyState = () => {
    state.hasUnsavedChanges = toSnapshot() !== state.lastSavedSnapshot;
    updateActionButtons();
    updateViewReaderLink();
  };

  const setFormDisabled = (isDisabled) => {
    titleInputEl.disabled = isDisabled;
    categorySelectEl.disabled = isDisabled;
    scopeSelectEl.disabled = isDisabled;
    slugInputEl.disabled = isDisabled;
    bodyInputEl.disabled = isDisabled;
    updateActionButtons();
  };

  const applyWarnings = () => {
    const warnings = [];
    if (titleInputEl.value.trim().length === 0) {
      warnings.push("Title is empty. You can keep drafting, but publishing requires a title.");
    }
    if (bodyInputEl.value.trim().length === 0) {
      warnings.push("Body is empty. You can keep drafting, but publishing requires content.");
    }

    warningListEl.innerHTML = "";
    if (warnings.length === 0) {
      warningListEl.hidden = true;
      return;
    }

    for (const warning of warnings) {
      const item = document.createElement("li");
      item.className = "ds-text ds-text--muted";
      item.textContent = warning;
      warningListEl.appendChild(item);
    }

    warningListEl.hidden = false;
  };

  const renderPreview = async () => {
    const requestId = ++state.previewRequestId;
    const markdown = bodyInputEl.value;

    if (markdown.trim().length === 0) {
      previewPaneEl.innerHTML = EMPTY_PREVIEW_HTML;
      setElementText(previewStatusEl, "Preview is empty");
      return;
    }

    setElementText(previewStatusEl, "Rendering preview...");

    try {
      const response = await fetch("/api/admin/whats-new/preview", {
        method: "POST",
        headers: {
          ...headers,
          "x-csrf-token": csrfToken,
          "content-type": "application/json"
        },
        body: JSON.stringify({ body_markdown: markdown })
      });

      if (!response.ok) {
        throw new Error("status:" + response.status);
      }

      const payload = await response.json();
      if (requestId !== state.previewRequestId) {
        return;
      }

      previewPaneEl.innerHTML =
        typeof payload.safe_html === "string" && payload.safe_html.length > 0 ? payload.safe_html : EMPTY_PREVIEW_HTML;
      setElementText(previewStatusEl, "Preview updated");
    } catch {
      if (requestId !== state.previewRequestId) {
        return;
      }

      previewPaneEl.innerHTML = EMPTY_PREVIEW_HTML;
      setElementText(previewStatusEl, "Preview unavailable. Try again.");
    }
  };

  const schedulePreview = () => {
    if (state.previewTimer) {
      window.clearTimeout(state.previewTimer);
    }

    state.previewTimer = window.setTimeout(() => {
      void renderPreview();
    }, PREVIEW_DEBOUNCE_MS);
  };

  const resolveEffectiveSlug = () => {
    const normalized = normalizeSlugInput(slugInputEl.value);
    if (normalized.length > 0) {
      return normalized;
    }

    return slugifyTitle(titleInputEl.value);
  };

  const validateForm = (options) => {
    clearFieldErrors();
    clearValidationSummary();
    hideSlugSuggestion();

    const requirePublishFields = Boolean(options && options.requirePublishFields);
    const summaryMessages = [];

    const titleRaw = titleInputEl.value;
    const title = titleRaw.trim();
    if (titleRaw.length > TITLE_MAX_LENGTH) {
      const message = "Title must be " + String(TITLE_MAX_LENGTH) + " characters or less.";
      setFieldError("title", message);
      summaryMessages.push(message);
    } else if (requirePublishFields && title.length === 0) {
      const message = "Title is required before publishing.";
      setFieldError("title", message);
      summaryMessages.push(message);
    }

    const category = categorySelectEl.value;
    if (!CATEGORY_VALUES.has(category)) {
      const message = "Category must be New, Improvement, or Fix.";
      setFieldError("category", message);
      summaryMessages.push(message);
    }

    const bodyMarkdown = bodyInputEl.value;
    if (bodyMarkdown.length > BODY_MAX_LENGTH) {
      const message = "Body must be " + String(BODY_MAX_LENGTH) + " characters or less.";
      setFieldError("body", message);
      summaryMessages.push(message);
    } else if (requirePublishFields && bodyMarkdown.trim().length === 0) {
      const message = "Body markdown is required before publishing.";
      setFieldError("body", message);
      summaryMessages.push(message);
    }

    const slug = resolveEffectiveSlug();
    if (slug.length > SLUG_MAX_LENGTH) {
      const message = "Slug must be " + String(SLUG_MAX_LENGTH) + " characters or less.";
      setFieldError("slug", message);
      summaryMessages.push(message);
    } else if (!SLUG_PATTERN.test(slug)) {
      const message = "Slug must use lowercase letters, numbers, and hyphens only.";
      setFieldError("slug", message);
      summaryMessages.push(message);
    }

    if (summaryMessages.length > 1) {
      showValidationSummary(summaryMessages);
    }

    if (summaryMessages.length > 0) {
      return null;
    }

    return {
      title,
      slug,
      category,
      tenant_id: getScopeTenantId(),
      body_markdown: bodyMarkdown
    };
  };

  const applyPostMeta = (post) => {
    const nextStatus = post.status === "published" ? "published" : "draft";
    state.status = nextStatus;
    state.publishedAt = typeof post.published_at === "string" ? post.published_at : null;
    state.revision = typeof post.revision === "number" ? post.revision : state.revision;
    state.persistedSlug = typeof post.slug === "string" ? normalizeSlugInput(post.slug) : state.persistedSlug;

    statusInputEl.value = nextStatus === "published" ? "Published" : "Draft";
    publishedAtInputEl.value = formatTimestamp(state.publishedAt);
    setStatusPill();
    updateViewReaderLink();
    updateActionButtons();
  };

  const applyPostToForm = (post) => {
    titleInputEl.value = typeof post.title === "string" ? post.title : "";
    categorySelectEl.value =
      post.category === "new" || post.category === "improvement" || post.category === "fix" ? post.category : "new";
    scopeSelectEl.value = post.tenant_id === null ? "global" : "tenant";
    slugInputEl.value = typeof post.slug === "string" ? post.slug : "";
    bodyInputEl.value = typeof post.body_markdown === "string" ? post.body_markdown : "";
    visibilityInputEl.value = post.visibility === "authenticated" ? "Authenticated (locked for v1)" : "Authenticated";
    state.slugManuallyEdited = true;
    applyPostMeta(post);
    applyWarnings();
    void renderPreview();
  };

  const parseErrorMessage = async (response) => {
    try {
      const payload = await response.json();
      return typeof payload.error === "string" ? payload.error : "";
    } catch {
      return "";
    }
  };

  const applyServerValidationMessage = (message) => {
    if (!message) {
      return false;
    }

    const lower = message.toLowerCase();
    const summaryMessages = [];
    let mapped = false;

    const addFieldMessage = (field, fieldMessage) => {
      mapped = true;
      setFieldError(field, fieldMessage);
      summaryMessages.push(fieldMessage);
    };

    if (lower.includes("title and body_markdown are required")) {
      addFieldMessage("title", "Title is required before publishing.");
      addFieldMessage("body", "Body markdown is required before publishing.");
    } else {
      if (lower.includes("title")) {
        addFieldMessage("title", message);
      }

      if (lower.includes("body_markdown")) {
        addFieldMessage("body", message);
      }

      if (lower.includes("slug")) {
        addFieldMessage("slug", message);
      }

      if (lower.includes("category")) {
        addFieldMessage("category", message);
      }
    }

    if (summaryMessages.length > 1) {
      showValidationSummary(summaryMessages);
    }

    return mapped;
  };

  const applySlugConflictFeedback = () => {
    const suggestion = suggestNextSlug(resolveEffectiveSlug());
    setFieldError("slug", "Slug already in use.");
    showSlugSuggestion(suggestion);
    clearValidationSummary();
  };

  const handleRequestError = async (response, options) => {
    const message = await parseErrorMessage(response);
    const lower = message.toLowerCase();

    if (response.status === 400) {
      clearFieldErrors();
      clearValidationSummary();
      hideSlugSuggestion();
      if (!applyServerValidationMessage(message)) {
        setBanner("error", "Validation failed. Please review the form.");
      }
      return false;
    }

    if (response.status === 409) {
      if (lower.includes("slug")) {
        applySlugConflictFeedback();
        setBanner("error", options && options.intent === "publish" ? "Publish failed. Update the slug and retry." : "Draft was not saved.");
        return false;
      }

      if (lower.includes("revision")) {
        setBanner("error", "This post changed elsewhere. Refresh and try again.");
        return false;
      }

      setBanner("error", "Unable to complete this action right now. Refresh and retry.");
      return false;
    }

    if (response.status === 401 || response.status === 403) {
      setBanner("error", "You do not have access to this action.");
      return false;
    }

    if (response.status === 404) {
      setBanner("error", "Post not found.");
      return false;
    }

    if (response.status >= 500) {
      setBanner("error", "Something went wrong. Try again.");
      return false;
    }

    setBanner("error", "Unable to complete this action. Try again.");
    return false;
  };

  const saveDraftInternal = async (options) => {
    const payload = validateForm({ requirePublishFields: false });
    if (!payload) {
      return null;
    }

    slugInputEl.value = payload.slug;
    clearBanner();
    state.isSubmitting = true;
    updateActionButtons();

    try {
      const requestBody = {
        title: payload.title,
        category: payload.category,
        slug: payload.slug,
        tenant_id: payload.tenant_id,
        body_markdown: payload.body_markdown
      };

      if (mode === "create") {
        const createResponse = await fetch("/api/admin/whats-new/posts", {
          method: "POST",
          headers: {
            ...headers,
            "x-csrf-token": csrfToken,
            "content-type": "application/json"
          },
          body: JSON.stringify(requestBody)
        });

        if (!createResponse.ok) {
          await handleRequestError(createResponse, { intent: "save" });
          return null;
        }

        const created = await createResponse.json();
        const nextUrl = "/admin/whats-new/" + encodeURIComponent(String(created.id || "")) + "/edit";
        window.location.assign(nextUrl);
        return null;
      }

      const updateResponse = await fetch("/api/admin/whats-new/posts/" + encodeURIComponent(postId), {
        method: "PUT",
        headers: {
          ...headers,
          "x-csrf-token": csrfToken,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          ...requestBody,
          expected_revision: state.revision
        })
      });

      if (!updateResponse.ok) {
        await handleRequestError(updateResponse, { intent: "save" });
        return null;
      }

      const updated = await updateResponse.json();
      applyPostMeta(updated);
      state.lastSavedSnapshot = toSnapshot();
      state.hasUnsavedChanges = false;
      applyWarnings();
      if (!options || options.showSuccessBanner !== false) {
        setBanner("success", "Draft saved.");
      }
      updateActionButtons();
      return updated;
    } catch {
      setBanner("error", "Unable to save draft. Please retry.");
      return null;
    } finally {
      state.isSubmitting = false;
      updateActionButtons();
    }
  };

  const closeConfirmDialog = () => {
    state.confirmAction = null;
    state.confirmSaveFirst = false;
    confirmOverlayEl.hidden = true;
    confirmSubmitButtonEl.disabled = false;
    confirmCancelButtonEl.disabled = false;
    document.body.classList.remove("wn-admin-dialog-open");

    if (state.lastFocusedBeforeConfirm instanceof HTMLElement) {
      state.lastFocusedBeforeConfirm.focus();
    }
  };

  const openConfirmDialog = (options) => {
    state.confirmAction = options.action;
    state.confirmSaveFirst = Boolean(options.saveFirst);
    state.lastFocusedBeforeConfirm = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    setElementText(confirmTitleEl, options.title);
    setElementText(confirmMessageEl, options.message);
    setElementText(confirmWarningEl, options.warning || "");
    confirmWarningEl.hidden = !options.warning;

    confirmSubmitButtonEl.className =
      options.action === "publish" ? "ds-button ds-button--primary" : "ds-button ds-button--secondary";
    setElementText(confirmSubmitButtonEl, options.confirmLabel);

    confirmOverlayEl.hidden = false;
    document.body.classList.add("wn-admin-dialog-open");
    confirmCancelButtonEl.focus();
  };

  const requestStatusTransition = async (action, saveFirst) => {
    if (mode !== "edit" || !postId || state.isLoading || state.isSubmitting || state.isTransitioning) {
      return;
    }

    clearBanner();
    state.isTransitioning = true;
    state.transitionAction = action;
    updateActionButtons();

    try {
      if (action === "publish") {
        const publishValidation = validateForm({ requirePublishFields: true });
        if (!publishValidation) {
          return;
        }
        slugInputEl.value = publishValidation.slug;

        if (saveFirst) {
          const saved = await saveDraftInternal({ showSuccessBanner: false });
          if (!saved) {
            setBanner("error", "Unable to publish until draft changes are saved.");
            return;
          }
        }
      }

      const transitionResponse = await fetch(
        "/api/admin/whats-new/posts/" + encodeURIComponent(postId) + "/" + (action === "publish" ? "publish" : "unpublish"),
        {
          method: "POST",
          headers: {
            ...headers,
            "x-csrf-token": csrfToken,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            expected_revision: state.revision
          })
        }
      );

      if (!transitionResponse.ok) {
        await handleRequestError(transitionResponse, { intent: action });
        return;
      }

      const updated = await transitionResponse.json();
      applyPostMeta(updated);
      setBanner("success", action === "publish" ? "Published." : "Unpublished.");
    } catch {
      setBanner("error", "Something went wrong. Try again.");
    } finally {
      state.isTransitioning = false;
      state.transitionAction = null;
      updateActionButtons();
    }
  };

  const promptForStatusTransition = () => {
    if (mode !== "edit") {
      return;
    }

    const action = state.status === "published" ? "unpublish" : "publish";

    if (action === "publish") {
      const validation = validateForm({ requirePublishFields: true });
      if (!validation) {
        setBanner("error", "Cannot publish until required fields are fixed.");
        return;
      }

      const hasGlobalScope = scopeSelectEl.value === "global";
      const saveFirst = state.hasUnsavedChanges;
      openConfirmDialog({
        action,
        saveFirst,
        title: saveFirst ? "Save and publish this post?" : "Publish this post?",
        message:
          "Visible to authenticated admins in allowlisted tenants." +
          (saveFirst ? " We will save your latest edits first." : ""),
        warning: hasGlobalScope ? "Global update will appear for all allowlisted tenants." : "",
        confirmLabel: saveFirst ? "Save & Publish" : "Publish"
      });
      return;
    }

    openConfirmDialog({
      action,
      saveFirst: false,
      title: "Unpublish this post?",
      message: "This moves the post back to draft and can remove visibility for readers.",
      warning: "",
      confirmLabel: "Unpublish"
    });
  };

  const loadPost = async () => {
    if (mode !== "edit") {
      state.isLoading = false;
      visibilityInputEl.value = "Authenticated (locked for v1)";
      state.status = "draft";
      state.publishedAt = null;
      statusInputEl.value = "Draft";
      publishedAtInputEl.value = "Not published";
      previewPaneEl.innerHTML = EMPTY_PREVIEW_HTML;
      state.lastSavedSnapshot = toSnapshot();
      syncDirtyState();
      setStatusPill();
      updateActionButtons();
      return;
    }

    if (!postId) {
      setBanner("error", "Missing post id.");
      setFormDisabled(true);
      return;
    }

    setFormDisabled(true);
    updateActionButtons();

    try {
      const response = await fetch("/api/admin/whats-new/posts/" + encodeURIComponent(postId), {
        headers
      });

      if (!response.ok) {
        state.isLoading = false;
        updateActionButtons();
        if (response.status === 404) {
          setBanner("error", "Post not found.");
        } else {
          setBanner("error", "Unable to load draft.");
        }
        setFormDisabled(true);
        return;
      }

      const payload = await response.json();
      applyPostToForm(payload);
      state.lastSavedSnapshot = toSnapshot();
      state.hasUnsavedChanges = false;
      state.isLoading = false;
      updateActionButtons();
      setFormDisabled(false);
    } catch {
      state.isLoading = false;
      updateActionButtons();
      setBanner("error", "Unable to load draft.");
      setFormDisabled(true);
    }
  };

  const applyAutoSlugFromTitle = () => {
    if (state.slugManuallyEdited) {
      return;
    }

    slugInputEl.value = slugifyTitle(titleInputEl.value);
  };

  titleInputEl.addEventListener("input", () => {
    applyAutoSlugFromTitle();
    applyWarnings();
    clearElementText(titleErrorEl);
    clearValidationSummary();
    syncDirtyState();
  });

  categorySelectEl.addEventListener("change", () => {
    clearElementText(categoryErrorEl);
    clearValidationSummary();
    syncDirtyState();
  });

  scopeSelectEl.addEventListener("change", () => {
    syncDirtyState();
  });

  slugInputEl.addEventListener("input", () => {
    state.slugManuallyEdited = true;
    hideSlugSuggestion();
    clearElementText(slugErrorEl);
    clearValidationSummary();
    syncDirtyState();
  });

  slugInputEl.addEventListener("blur", () => {
    const normalized = normalizeSlugInput(slugInputEl.value);
    if (normalized.length === 0) {
      state.slugManuallyEdited = false;
      slugInputEl.value = slugifyTitle(titleInputEl.value);
    } else {
      slugInputEl.value = normalized;
    }
    syncDirtyState();
  });

  bodyInputEl.addEventListener("input", () => {
    applyWarnings();
    schedulePreview();
    clearElementText(bodyErrorEl);
    clearValidationSummary();
    syncDirtyState();
  });

  slugSuggestionButtonEl.addEventListener("click", () => {
    if (!state.suggestedSlug) {
      return;
    }
    slugInputEl.value = state.suggestedSlug;
    state.slugManuallyEdited = true;
    hideSlugSuggestion();
    clearElementText(slugErrorEl);
    syncDirtyState();
  });

  publishButtonEl.addEventListener("click", (event) => {
    event.preventDefault();
    promptForStatusTransition();
  });

  confirmCancelButtonEl.addEventListener("click", () => {
    closeConfirmDialog();
  });

  confirmSubmitButtonEl.addEventListener("click", () => {
    const action = state.confirmAction;
    const saveFirst = state.confirmSaveFirst;
    closeConfirmDialog();
    if (!action) {
      return;
    }
    void requestStatusTransition(action, saveFirst);
  });

  confirmOverlayEl.addEventListener("click", (event) => {
    if (event.target === confirmOverlayEl) {
      closeConfirmDialog();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !confirmOverlayEl.hidden) {
      closeConfirmDialog();
    }
  });

  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveDraftInternal({ showSuccessBanner: true });
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.hasUnsavedChanges) {
      return;
    }

    event.preventDefault();
    event.returnValue = "";
  });

  document.addEventListener("click", (event) => {
    if (!state.hasUnsavedChanges) {
      return;
    }

    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(target instanceof HTMLAnchorElement)) {
      return;
    }

    if (target.target === "_blank") {
      return;
    }

    if (!window.confirm("You have unsaved changes. Leave this page?")) {
      event.preventDefault();
    }
  });

  hideSlugSuggestion();
  clearValidationSummary();
  applyWarnings();
  setStatusPill();
  updateActionButtons();
  updateViewReaderLink();
  void loadPost();
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

function renderEditorPage(
  mode: "create" | "edit",
  userId: string,
  role: string,
  tenantId: string,
  postId?: string
): string {
  const pageTitle = mode === "create" ? "Create Draft" : "Edit Draft";
  const heading = mode === "create" ? "Create draft" : "Edit draft";
  const description =
    mode === "create"
      ? "Start a draft post for internal review. You can keep drafting even when title/body are empty."
      : `Editing post ${postId ? `#${escapeHtml(postId)}` : ""}. Save frequently to avoid conflicts.`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pageTitle)}</title>
    <link rel="stylesheet" href="/admin/whats-new/assets/styles.css" />
  </head>
  <body class="ds-root wn-admin-page">
    <main class="wn-admin-main">
      <header class="wn-admin-header ds-stack ds-stack--vertical">
        <a class="ds-button ds-button--ghost wn-admin-editor-back" href="/admin/whats-new">Back to post list</a>
        <h1 class="ds-text ds-text--heading">${escapeHtml(heading)}</h1>
        <p class="ds-text ds-text--muted">${description}</p>
      </header>

      <section class="wn-admin-editor-shell ds-surface ds-surface--raised" aria-labelledby="whats-new-editor-heading">
        <div class="wn-admin-editor-shell__header">
          <h2 id="whats-new-editor-heading" class="ds-text ds-text--heading">Draft details</h2>
          <p id="whats-new-editor-save-status" class="ds-text ds-text--muted" aria-live="polite">Loading draft...</p>
        </div>

        <p id="whats-new-editor-banner" class="wn-admin-editor-banner ds-text" hidden></p>
        <section
          id="whats-new-editor-validation-summary"
          class="wn-admin-editor-validation-summary ds-surface ds-surface--sunken"
          aria-label="Validation summary"
          hidden
        >
          <p class="ds-text ds-text--body">Fix the following before continuing:</p>
          <ul id="whats-new-editor-validation-summary-list" class="wn-admin-editor-validation-summary-list"></ul>
        </section>
        <ul id="whats-new-editor-warning-list" class="wn-admin-editor-warning-list ds-surface ds-surface--sunken" hidden></ul>

        <form id="whats-new-editor-form" class="wn-admin-editor-form">
          <div class="wn-admin-editor-grid">
            <div class="wn-admin-field">
              <label class="wn-admin-field__label ds-text ds-text--muted" for="whats-new-editor-title">Title</label>
              <input
                id="whats-new-editor-title"
                class="wn-admin-input"
                name="title"
                type="text"
                maxlength="140"
                autocomplete="off"
                placeholder="Release title"
              />
              <p class="wn-admin-inline-hint ds-text ds-text--muted">Required for publishing.</p>
              <p id="whats-new-editor-title-error" class="wn-admin-inline-error ds-text" aria-live="polite"></p>
            </div>

            <div class="wn-admin-field">
              <label class="wn-admin-field__label ds-text ds-text--muted" for="whats-new-editor-category">Category</label>
              <select id="whats-new-editor-category" class="wn-admin-select" name="category" required>
                <option value="new">New</option>
                <option value="improvement">Improvement</option>
                <option value="fix">Fix</option>
              </select>
              <p id="whats-new-editor-category-error" class="wn-admin-inline-error ds-text" aria-live="polite"></p>
            </div>

            <div class="wn-admin-field">
              <label class="wn-admin-field__label ds-text ds-text--muted" for="whats-new-editor-scope">Scope</label>
              <select id="whats-new-editor-scope" class="wn-admin-select" name="scope">
                <option value="tenant">This tenant</option>
                <option value="global">Global</option>
              </select>
              <p class="wn-admin-inline-hint ds-text ds-text--muted">Global maps to <code>tenant_id=null</code>.</p>
            </div>

            <div class="wn-admin-field">
              <label class="wn-admin-field__label ds-text ds-text--muted" for="whats-new-editor-visibility">Visibility</label>
              <input
                id="whats-new-editor-visibility"
                class="wn-admin-input"
                name="visibility"
                type="text"
                value="Authenticated (locked for v1)"
                readonly
                aria-readonly="true"
              />
            </div>

            <div class="wn-admin-field">
              <label class="wn-admin-field__label ds-text ds-text--muted" for="whats-new-editor-status">Status</label>
              <input
                id="whats-new-editor-status"
                class="wn-admin-input"
                name="status"
                type="text"
                value="Draft"
                readonly
                aria-readonly="true"
              />
              <span id="whats-new-editor-status-pill" class="wn-admin-pill wn-admin-pill--status wn-admin-pill--draft">
                Draft
              </span>
            </div>

            <div class="wn-admin-field">
              <label class="wn-admin-field__label ds-text ds-text--muted" for="whats-new-editor-published-at">Published at</label>
              <input
                id="whats-new-editor-published-at"
                class="wn-admin-input"
                name="published_at"
                type="text"
                value="Not published"
                readonly
                aria-readonly="true"
              />
            </div>
          </div>

          <div class="wn-admin-field">
            <label class="wn-admin-field__label ds-text ds-text--muted" for="whats-new-editor-slug">Slug</label>
            <input
              id="whats-new-editor-slug"
              class="wn-admin-input"
              name="slug"
              type="text"
              maxlength="100"
              autocomplete="off"
              placeholder="auto-generated-from-title"
            />
            <p class="wn-admin-inline-hint ds-text ds-text--muted">
              Stable URL path segment. Lowercase letters, numbers, and hyphens only.
            </p>
            <p id="whats-new-editor-slug-error" class="wn-admin-inline-error ds-text" aria-live="polite"></p>
            <div id="whats-new-editor-slug-suggestion" class="wn-admin-inline-hint ds-text ds-text--muted" hidden></div>
            <button
              id="whats-new-editor-slug-suggestion-button"
              class="ds-button ds-button--secondary"
              type="button"
              hidden
            >
              Use suggestion
            </button>
          </div>

          <div class="wn-admin-editor-body-layout">
            <div class="wn-admin-field">
              <label class="wn-admin-field__label ds-text ds-text--muted" for="whats-new-editor-body">Body markdown</label>
              <textarea
                id="whats-new-editor-body"
                class="wn-admin-textarea"
                name="body_markdown"
                rows="18"
                placeholder="Write in markdown..."
              ></textarea>
              <p class="wn-admin-inline-hint ds-text ds-text--muted">Required for publishing.</p>
              <p id="whats-new-editor-body-error" class="wn-admin-inline-error ds-text" aria-live="polite"></p>
            </div>

            <section class="wn-admin-editor-preview-pane ds-surface ds-surface--sunken" aria-label="Preview">
              <div class="wn-admin-editor-preview-header">
                <h3 class="ds-text ds-text--body">Preview</h3>
                <p id="whats-new-editor-preview-status" class="ds-text ds-text--muted" aria-live="polite">Rendering preview...</p>
              </div>
              <div id="whats-new-editor-preview" class="wn-admin-editor-preview-body"></div>
            </section>
          </div>

          <div class="wn-admin-editor-actions">
            <a
              id="whats-new-editor-view-link"
              class="ds-button ds-button--ghost"
              href="#"
              target="_blank"
              rel="noopener noreferrer"
              hidden
            >
              View in reader
            </a>
            <button id="whats-new-editor-save-button" class="ds-button ds-button--secondary" type="submit">Save draft</button>
            <button
              id="whats-new-editor-publish-button"
              class="ds-button ds-button--primary"
              type="button"
              ${mode === "edit" ? "" : "hidden"}
            >
              Publish
            </button>
          </div>
        </form>
      </section>
    </main>

    <div
      id="whats-new-admin-editor-app"
      data-mode="${mode}"
      data-post-id="${escapeHtml(postId ?? "")}"
      data-user-id="${escapeHtml(userId)}"
      data-user-role="${escapeHtml(role)}"
      data-tenant-id="${escapeHtml(tenantId)}"
      data-csrf-token="${DEFAULT_CSRF_TOKEN}"
    ></div>

    <div id="whats-new-editor-confirm-overlay" class="wn-admin-confirm-overlay" hidden>
      <section
        id="whats-new-editor-confirm-dialog"
        class="wn-admin-confirm-dialog ds-surface ds-surface--raised"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-editor-confirm-title"
      >
        <div class="wn-admin-confirm-dialog__content">
          <h2 id="whats-new-editor-confirm-title" class="ds-text ds-text--heading">Confirm action</h2>
          <p id="whats-new-editor-confirm-message" class="ds-text ds-text--body"></p>
          <p id="whats-new-editor-confirm-warning" class="ds-text ds-text--muted" hidden></p>
        </div>
        <div class="wn-admin-confirm-dialog__actions">
          <button id="whats-new-editor-confirm-cancel" class="ds-button ds-button--ghost" type="button">Cancel</button>
          <button id="whats-new-editor-confirm-submit" class="ds-button ds-button--primary" type="button">Confirm</button>
        </div>
      </section>
    </div>

    <script src="/admin/whats-new/assets/editor-client.js" defer></script>
  </body>
</html>`;
}

export function createWhatsNewPublisherRouter(
  config: AppConfig,
  repository: ChangelogRepository,
  logger: Logger = appLogger
): Router {
  const router = Router();

  router.get("/assets/client.js", (_req: Request, res: Response) => {
    res.status(200).type("application/javascript").send(LIST_CLIENT_SCRIPT);
  });

  router.get("/assets/editor-client.js", (_req: Request, res: Response) => {
    res.status(200).type("application/javascript").send(EDITOR_CLIENT_SCRIPT);
  });

  router.get("/assets/styles.css", (_req: Request, res: Response) => {
    res.status(200).type("text/css").send(STYLESHEET);
  });

  router.use(createWhatsNewHtmlSecurityHeaders(config));
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

  router.get("/new", (req: Request, res: Response) => {
    const context = getGuardedWhatsNewContext(req);
    logger.info("whats_new_admin_create_page_viewed", {
      actorId: context.userId,
      tenantId: context.tenantId
    });

    res
      .status(200)
      .type("html")
      .send(renderEditorPage("create", context.userId, context.role, context.tenantId));
  });

  router.get("/:id/edit", async (req: Request, res: Response) => {
    const context = getGuardedWhatsNewContext(req);
    const postId = Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id ?? "";

    const post = await repository.findAdminPostById({
      tenantScope: { tenantId: context.tenantId },
      id: postId
    });

    if (!post) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    logger.info("whats_new_admin_edit_page_viewed", {
      actorId: context.userId,
      tenantId: context.tenantId,
      postId
    });

    res
      .status(200)
      .type("html")
      .send(renderEditorPage("edit", context.userId, context.role, context.tenantId, postId));
  });

  return router;
}
