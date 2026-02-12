import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router, type Request, type Response } from "express";
import { WHATS_NEW_ANALYTICS_TAXONOMY } from "../analytics/events";
import { hashAnalyticsTenantId } from "../analytics/tracker";
import type { AppConfig } from "../config";
import { createWhatsNewHtmlSecurityHeaders } from "../security/headers";
import { appLogger, type Logger } from "../security/logger";
import { renderMarkdownSafe } from "../security/markdown";
import { getGuardedWhatsNewContext } from "./authz";
import { applyWhatsNewReadGuards } from "./guards";
import { sanitizeSlugOrThrow, type ChangelogPostCategory, type ChangelogRepository } from "./repository";
import type { WhatsNewRequestContext } from "./request-context";
import {
  WHATS_NEW_DEEPLINK_HASH,
  WHATS_NEW_DEEPLINK_QUERY_PARAM,
  WHATS_NEW_DEEPLINK_QUERY_VALUE,
  WHATS_NEW_PROGRAMMATIC_API_GLOBAL,
  buildWhatsNewDeepLinkHref
} from "./trigger-contract";

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

const ANALYTICS_TAXONOMY_LITERAL = JSON.stringify(WHATS_NEW_ANALYTICS_TAXONOMY).replace(/</g, "\\u003c");

const CLIENT_SCRIPT = `(() => {
  const PAGE_SIZE = 12;
  const MARK_SEEN_DEBOUNCE_MS = 60_000;
  const OPEN_POST_SOURCE_STORAGE_KEY = "whats_new_open_post_source_v1";
  const OPEN_POST_SOURCE_TTL_MS = 120_000;
  const DEEPLINK_QUERY_PARAM = ${JSON.stringify(WHATS_NEW_DEEPLINK_QUERY_PARAM)};
  const DEEPLINK_QUERY_VALUE = ${JSON.stringify(WHATS_NEW_DEEPLINK_QUERY_VALUE)};
  const DEEPLINK_HASH = ${JSON.stringify(`#${WHATS_NEW_DEEPLINK_HASH}`)};
  const PROGRAMMATIC_API_GLOBAL = ${JSON.stringify(WHATS_NEW_PROGRAMMATIC_API_GLOBAL)};
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
  const analyticsTaxonomy = ${ANALYTICS_TAXONOMY_LITERAL};
  const analyticsProvider =
    typeof window !== "undefined" &&
    window.allbookedAnalytics &&
    typeof window.allbookedAnalytics.track === "function"
      ? window.allbookedAnalytics
      : null;
  const analyticsContext = {
    tenant_id: appRoot.dataset.tenantHash || "",
    user_id: appRoot.dataset.userId || ""
  };
  const currentView = appRoot.dataset.view || "";

  const unreadLinkEl = document.getElementById("whats-new-entry-link");
  const unreadDotEl = document.getElementById("whats-new-unread-dot");
  const unreadTextEl = document.getElementById("whats-new-unread-text");
  const overlayEl = document.getElementById("whats-new-panel-overlay");
  const panelEl = document.getElementById("whats-new-panel");
  const panelCloseEl = document.getElementById("whats-new-panel-close");
  const panelStatusEl = document.getElementById("whats-new-panel-status");
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
  let markSeenInFlightSurface = null;
  let initialTriggerConsumed = false;

  const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const normalizeString = (value) => {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  };

  const isAllowedEventName = (eventName) =>
    Array.isArray(analyticsTaxonomy.event_names) && analyticsTaxonomy.event_names.includes(eventName);

  const isForbiddenKey = (key) => {
    const normalized = String(key || "").trim().toLowerCase();
    if (normalized.length === 0) {
      return true;
    }

    if (
      Array.isArray(analyticsTaxonomy.forbidden_property_keys) &&
      analyticsTaxonomy.forbidden_property_keys.includes(normalized)
    ) {
      return true;
    }

    if (typeof analyticsTaxonomy.forbidden_property_key_pattern === "string") {
      const forbiddenPattern = new RegExp(analyticsTaxonomy.forbidden_property_key_pattern, "i");
      return forbiddenPattern.test(normalized);
    }

    return false;
  };

  const sanitizePagination = (value) => {
    if (!isRecord(value)) {
      return null;
    }

    const schema = analyticsTaxonomy.property_schema?.pagination?.properties;
    if (!schema) {
      return null;
    }

    const result = {};

    if (typeof value.limit === "number" && Number.isFinite(value.limit)) {
      result.limit = value.limit;
    }

    if (typeof value.cursor_present === "boolean") {
      result.cursor_present = value.cursor_present;
    }

    if (typeof value.page_index === "number" && Number.isFinite(value.page_index)) {
      result.page_index = value.page_index;
    }

    if (schema.limit?.required && result.limit === undefined) {
      return null;
    }

    if (schema.cursor_present?.required && result.cursor_present === undefined) {
      return null;
    }

    return result;
  };

  const sanitizePropertyValue = (key, value) => {
    const definition = analyticsTaxonomy.property_schema?.[key];
    if (!definition) {
      return null;
    }

    if (definition.type === "string") {
      const normalized = normalizeString(value);
      if (!normalized) {
        return null;
      }

      if (Array.isArray(definition.enum_values) && !definition.enum_values.includes(normalized)) {
        return null;
      }

      return normalized;
    }

    if (definition.type === "number") {
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    }

    if (definition.type === "boolean") {
      return typeof value === "boolean" ? value : null;
    }

    if (definition.type === "object" && key === "pagination") {
      return sanitizePagination(value);
    }

    return null;
  };

  const baseAnalyticsProps = () => {
    const props = {};

    const tenantId = normalizeString(analyticsContext.tenant_id);
    if (tenantId) {
      props.tenant_id = tenantId;
    }

    const userId = normalizeString(analyticsContext.user_id);
    if (userId) {
      props.user_id = userId;
    }

    return props;
  };

  const sanitizeEventProps = (eventName, rawProps) => {
    if (!isAllowedEventName(eventName)) {
      return null;
    }

    const allowlist = analyticsTaxonomy.event_property_allowlist?.[eventName];
    const requiredKeys = analyticsTaxonomy.event_required_properties?.[eventName] || [];
    if (!Array.isArray(allowlist)) {
      return null;
    }

    const merged = {
      ...baseAnalyticsProps(),
      ...(isRecord(rawProps) ? rawProps : {})
    };

    const sanitized = {};
    for (const key of allowlist) {
      if (isForbiddenKey(key)) {
        continue;
      }

      const value = sanitizePropertyValue(key, merged[key]);
      if (value !== null && value !== undefined) {
        sanitized[key] = value;
      }
    }

    for (const key of requiredKeys) {
      if (sanitized[key] === undefined) {
        return null;
      }
    }

    if (
      Array.isArray(analyticsTaxonomy.events_requiring_post_identity) &&
      analyticsTaxonomy.events_requiring_post_identity.includes(eventName)
    ) {
      const postId = typeof sanitized.post_id === "string" ? sanitized.post_id : "";
      const slug = typeof sanitized.slug === "string" ? sanitized.slug : "";
      if (!postId && !slug) {
        return null;
      }
    }

    return sanitized;
  };

  const trackEvent = (eventName, rawProps = {}) => {
    if (!analyticsProvider) {
      return;
    }

    const sanitized = sanitizeEventProps(eventName, rawProps);
    if (!sanitized) {
      return;
    }

    try {
      analyticsProvider.track(eventName, sanitized);
    } catch {
      // Keep UX unaffected if analytics provider is unavailable.
    }
  };

  const getFeedSurface = () => (currentView === "list" ? "page" : "panel");

  const normalizePanelOpenSource = (value) => {
    if (value === "deeplink") {
      return "deeplink";
    }

    if (value === "programmatic") {
      return "programmatic";
    }

    return "manual";
  };

  const hasDeepLinkQueryTrigger = () => {
    try {
      const values = new URLSearchParams(window.location.search).getAll(DEEPLINK_QUERY_PARAM);
      return values.some((value) => normalizeString(value) === DEEPLINK_QUERY_VALUE);
    } catch {
      return false;
    }
  };

  const hasDeepLinkHashTrigger = () => {
    const rawHash = typeof window.location.hash === "string" ? window.location.hash : "";
    return rawHash.trim().toLowerCase() === DEEPLINK_HASH;
  };

  const cleanupDeepLinkLocation = () => {
    if (!window.history || typeof window.history.replaceState !== "function") {
      return;
    }

    try {
      const locationUrl = new URL(window.location.href);
      const hasQueryTrigger = locationUrl.searchParams
        .getAll(DEEPLINK_QUERY_PARAM)
        .some((value) => normalizeString(value) === DEEPLINK_QUERY_VALUE);

      if (hasQueryTrigger) {
        locationUrl.searchParams.delete(DEEPLINK_QUERY_PARAM);
      }

      const hasHashTrigger = locationUrl.hash.trim().toLowerCase() === DEEPLINK_HASH;
      if (hasHashTrigger) {
        locationUrl.hash = "";
      }

      if (!hasQueryTrigger && !hasHashTrigger) {
        return;
      }

      const nextSearch = locationUrl.searchParams.toString();
      const nextUrl = locationUrl.pathname + (nextSearch.length > 0 ? "?" + nextSearch : "") + locationUrl.hash;
      window.history.replaceState(window.history.state, "", nextUrl || locationUrl.pathname);
    } catch {
      // Ignore replaceState failures.
    }
  };

  const redirectDeepLinkToPanelSurface = async () => {
    if (currentView !== "list") {
      return false;
    }

    try {
      const payload = await requestJson("/api/whats-new/posts?limit=1");
      const firstPost = Array.isArray(payload.items) ? payload.items[0] : null;
      const firstSlug = firstPost && typeof firstPost.slug === "string" ? firstPost.slug.trim() : "";
      if (!firstSlug) {
        return false;
      }

      const targetPath = detailBasePath + encodeURIComponent(firstSlug);
      const targetSearch = new URLSearchParams();
      targetSearch.set(DEEPLINK_QUERY_PARAM, DEEPLINK_QUERY_VALUE);
      const targetUrl = targetPath + "?" + targetSearch.toString();
      window.location.assign(targetUrl);
      return true;
    } catch {
      return false;
    }
  };

  const rememberOpenPostSource = (sourceSurface, postId, slug) => {
    const normalizedSlug = normalizeString(slug);
    const normalizedPostId = normalizeString(postId);
    if (!normalizedSlug && !normalizedPostId) {
      return;
    }

    try {
      sessionStorage.setItem(
        OPEN_POST_SOURCE_STORAGE_KEY,
        JSON.stringify({
          surface: sourceSurface === "panel" ? "panel" : "page",
          slug: normalizedSlug,
          post_id: normalizedPostId,
          ts: Date.now()
        })
      );
    } catch {
      // Ignore sessionStorage failures.
    }
  };

  const consumeOpenPostSource = (slug) => {
    const normalizedSlug = normalizeString(slug);
    if (!normalizedSlug) {
      return null;
    }

    try {
      const storedRaw = sessionStorage.getItem(OPEN_POST_SOURCE_STORAGE_KEY);
      if (!storedRaw) {
        return null;
      }

      sessionStorage.removeItem(OPEN_POST_SOURCE_STORAGE_KEY);

      const parsed = JSON.parse(storedRaw);
      if (!isRecord(parsed)) {
        return null;
      }

      if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > OPEN_POST_SOURCE_TTL_MS) {
        return null;
      }

      if (normalizeString(parsed.slug) !== normalizedSlug) {
        return null;
      }

      return parsed.surface === "panel" ? "panel" : "page";
    } catch {
      return null;
    }
  };

  const mapSeenErrorToCode = (error) => {
    if (isRecord(error) && typeof error.status === "number") {
      if (error.status === 401 || error.status === 403) {
        return "unauthorized";
      }
      if (error.status >= 500) {
        return "server_error";
      }
      if (error.status >= 400) {
        return "request_error";
      }
    }

    if (isRecord(error) && typeof error.code === "string") {
      const code = error.code.trim().toUpperCase();
      if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"].includes(code)) {
        return "network_error";
      }
    }

    if (error instanceof Error && (error.name === "TypeError" || error.name === "AbortError")) {
      return "network_error";
    }

    return "unknown_error";
  };

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
      throw { status: response.status };
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
      throw { status: response.status };
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
    itemEl.className = "wn-feed-item";

    const metaRowEl = document.createElement("div");
    metaRowEl.className = "wn-feed-item-meta";

    const category = getCategoryPresentation(post.category);
    const categoryEl = document.createElement("span");
    categoryEl.className = "wn-category-badge wn-category-badge--" + category.tone;
    categoryEl.textContent = category.label;
    metaRowEl.appendChild(categoryEl);

    const publishedAt = typeof post.published_at === "string" ? post.published_at : "";
    const dateEl = document.createElement("time");
    dateEl.className = "ds-text ds-text--muted";
    dateEl.dateTime = publishedAt;
    dateEl.textContent = formatPublishedDate(publishedAt);
    metaRowEl.appendChild(dateEl);
    itemEl.appendChild(metaRowEl);

    const titleEl = document.createElement("h3");
    titleEl.className = "wn-feed-title";

    const slug = typeof post.slug === "string" ? post.slug.trim() : "";
    const postId = typeof post.id === "string" ? post.id.trim() : "";
    const canNavigate = detailBasePath.length > 0 && slug.length > 0;
    if (canNavigate) {
      itemEl.classList.add("wn-feed-item--interactive");
      const linkEl = document.createElement("a");
      linkEl.className = "wn-post-link";
      linkEl.href = detailBasePath + encodeURIComponent(slug);
      linkEl.dataset.slug = slug;
      if (postId.length > 0) {
        linkEl.dataset.postId = postId;
      }
      linkEl.addEventListener("click", () => {
        rememberOpenPostSource(getFeedSurface(), postId, slug);
      });
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

    const excerptEl = document.createElement("p");
    excerptEl.className = "wn-feed-excerpt ds-text ds-text--muted";
    excerptEl.textContent = getSafeExcerpt(post);
    itemEl.appendChild(excerptEl);

    return itemEl;
  };

  const feedState = {
    items: [],
    cursor: null,
    pageIndex: 0,
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
      feedState.pageIndex = 0;
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
        feedState.pageIndex = 0;
      } else {
        feedState.items = feedState.items.concat(items);
        feedState.pageIndex += 1;
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

  const refreshUnreadIndicator = async () => {
    try {
      const payload = await requestJson("/api/whats-new/unread");
      const hasUnread = Boolean(payload.has_unread);
      setUnreadIndicator(hasUnread);
      return hasUnread;
    } catch {
      return null;
    }
  };

  const markSeen = async (sourceSurface) => {
    const surface = sourceSurface === "panel" ? "panel" : "page";
    const withinDebounceWindow =
      !hasUnreadState &&
      lastSeenWriteAtMs > 0 &&
      Date.now() - lastSeenWriteAtMs < MARK_SEEN_DEBOUNCE_MS;

    if (withinDebounceWindow) {
      const refreshedHasUnread = await refreshUnreadIndicator();
      if (refreshedHasUnread !== true) {
        return;
      }
    }

    if (markSeenPromise) {
      return markSeenPromise;
    }

    markSeenInFlightSurface = surface;

    markSeenPromise = (async () => {
      try {
        await requestPostJson("/api/whats-new/seen");
        lastSeenWriteAtMs = Date.now();
        trackEvent("whats_new.mark_seen_success", {
          surface: markSeenInFlightSurface || surface,
          result: "success"
        });
        setUnreadIndicator(false);
        await refreshUnreadIndicator();
      } catch (error) {
        trackEvent("whats_new.mark_seen_failure", {
          surface: markSeenInFlightSurface || surface,
          result: "failure",
          error_code: mapSeenErrorToCode(error)
        });
        // Fail-safe: keep current unread state when mark-seen fails.
      } finally {
        markSeenInFlightSurface = null;
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

  const openPanel = (source = "manual") => {
    if (!panelEl || !overlayEl || panelEl.hidden === false) {
      return false;
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

    trackEvent("whats_new.open_panel", {
      surface: "panel",
      source: normalizePanelOpenSource(source)
    });

    if (!feedState.hasLoadedOnce) {
      void loadFeedPage("initial");
    }

    void markSeen("panel");
    return true;
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
        openPanel("manual");
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

  const processInitialTrigger = async () => {
    if (initialTriggerConsumed) {
      return;
    }

    initialTriggerConsumed = true;
    if (!hasDeepLinkQueryTrigger() && !hasDeepLinkHashTrigger()) {
      return;
    }

    const opened = openPanel("deeplink");
    if (opened) {
      cleanupDeepLinkLocation();
      return;
    }

    const redirected = await redirectDeepLinkToPanelSurface();
    if (!redirected) {
      cleanupDeepLinkLocation();
    }
  };

  const programmaticApi = Object.freeze({
    version: "v1",
    open: () => {
      openPanel("programmatic");
    },
    close: () => {
      closePanel();
    },
    toggle: () => {
      if (!panelEl || !overlayEl) {
        return;
      }

      if (panelEl.hidden) {
        openPanel("programmatic");
      } else {
        closePanel();
      }
    }
  });

  window[PROGRAMMATIC_API_GLOBAL] = programmaticApi;

  if (loadMoreEl) {
    loadMoreEl.addEventListener("click", () => {
      trackEvent("whats_new.load_more", {
        surface: getFeedSurface(),
        pagination: {
          limit: PAGE_SIZE,
          cursor_present: Boolean(feedState.cursor),
          page_index: feedState.pageIndex + 1
        }
      });
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
    if (currentView === "list") {
      trackEvent("whats_new.open_full_page", {
        surface: "page"
      });
    }

    if (currentView === "detail") {
      const detailPostSlug = appRoot.dataset.currentPostSlug || "";
      const detailPostId = appRoot.dataset.currentPostId || "";
      const detailSourceSurface = consumeOpenPostSource(detailPostSlug) || "page";

      trackEvent("whats_new.open_post", {
        surface: detailSourceSurface,
        post_id: detailPostId,
        slug: detailPostSlug
      });
    }

    setUnreadIndicator(hasUnreadState);
    await processInitialTrigger();
    const unreadRefreshPromise = refreshUnreadIndicator();
    const markSeenOnListPromise = currentView === "list" ? markSeen("page") : Promise.resolve();
    const loadFeedOnListPromise = currentView === "list" ? loadFeedPage("initial") : Promise.resolve();

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

function renderBottomBar(hasUnread: boolean, entryHref: string = buildWhatsNewDeepLinkHref("/whats-new")): string {
  const ariaLabel = hasUnread ? "What's New. New updates available" : "What's New";
  return `<nav class="wn-bottom-bar" aria-label="App navigation">
      <a
        id="whats-new-entry-link"
        class="ds-button ds-button--ghost wn-bottom-link"
        href="${escapeHtml(entryHref)}"
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

interface CategoryPresentation {
  tone: ChangelogPostCategory;
  label: string;
}

interface DetailPagePost {
  id: string;
  slug: string;
  title: string;
  category: ChangelogPostCategory;
  publishedAt: string;
  safeHtml: string;
}

function getCategoryPresentation(category: ChangelogPostCategory): CategoryPresentation {
  if (category === "improvement") {
    return { tone: "improvement", label: "Improvement" };
  }

  if (category === "fix") {
    return { tone: "fix", label: "Fix" };
  }

  return { tone: "new", label: "New" };
}

function formatPublishedDate(isoValue: string): string {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.valueOf())) {
    return isoValue;
  }

  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

function renderAnalyticsTenantId(tenantId: string | undefined): string {
  const hashedTenantId = hashAnalyticsTenantId(tenantId);
  return hashedTenantId ?? "";
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
    <main class="wn-main ds-page-container ds-page-container--narrow">
      <header class="wn-page-heading ds-stack ds-stack--vertical">
        <h1 class="ds-text ds-text--heading">What's New</h1>
        <p class="ds-text ds-text--muted">Tenant: ${escapeHtml(context.tenantId ?? "unknown")}</p>
        <p id="whats-new-status" class="ds-text ds-text--muted" aria-live="polite"></p>
      </header>
      <section class="wn-list-feed" aria-labelledby="whats-new-feed-heading">
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
      data-tenant-hash="${escapeHtml(renderAnalyticsTenantId(context.tenantId))}"
      data-csrf-token="csrf-token-123456"
      data-initial-has-unread="${String(hasUnread)}"
      data-detail-base="/whats-new/"
    ></div>
    <script src="/whats-new/assets/client.js" defer></script>
  </body>
</html>`;
}

function renderDetailPage(context: WhatsNewRequestContext, post: DetailPagePost, hasUnread: boolean): string {
  const category = getCategoryPresentation(post.category);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(post.title)} · What's New</title>
    <link rel="stylesheet" href="/whats-new/assets/styles.css" />
  </head>
  <body class="ds-root wn-page">
    <main class="wn-main wn-main--detail ds-page-container ds-page-container--detail">
      <nav class="wn-detail-nav">
        <a class="wn-back-link" href="/whats-new">Back to What's New</a>
      </nav>
      <article class="wn-detail-shell ds-surface ds-surface--raised" aria-labelledby="whats-new-title">
        <header class="wn-detail-header ds-stack ds-stack--vertical">
          <span class="wn-category-badge wn-category-badge--${category.tone}">${category.label}</span>
          <h1 id="whats-new-title" class="ds-text ds-text--heading">${escapeHtml(post.title)}</h1>
          <p class="wn-detail-meta ds-text ds-text--muted">
            <time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(formatPublishedDate(post.publishedAt))}</time>
          </p>
        </header>
        <div id="whats-new-detail" class="wn-detail">${post.safeHtml}</div>
      </article>
    </main>
    ${renderWhatsNewPanel()}
    ${renderBottomBar(hasUnread, buildWhatsNewDeepLinkHref(`/whats-new/${encodeURIComponent(post.slug)}`))}
    <div
      id="whats-new-app"
      data-view="detail"
      data-user-id="${escapeHtml(context.userId ?? "")}"
      data-user-role="${escapeHtml(context.role ?? "ADMIN")}"
      data-tenant-id="${escapeHtml(context.tenantId ?? "")}"
      data-tenant-hash="${escapeHtml(renderAnalyticsTenantId(context.tenantId))}"
      data-csrf-token="csrf-token-123456"
      data-initial-has-unread="${String(hasUnread)}"
      data-detail-base="/whats-new/"
      data-current-post-id="${escapeHtml(post.id)}"
      data-current-post-slug="${escapeHtml(post.slug)}"
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

  router.use(createWhatsNewHtmlSecurityHeaders(config));
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
    const rawSlug = Array.isArray(slugParam) ? slugParam[0] : slugParam;
    if (!rawSlug || rawSlug.trim().length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    let slug: string;
    try {
      slug = sanitizeSlugOrThrow(rawSlug);
    } catch {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const post = await repository.findPublishedPostBySlug({ tenantId: context.tenantId }, slug);
    if (!post) {
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
      slug,
      postId: post.id
    });

    res.status(200).type("html").send(
      renderDetailPage(
        context,
        {
          id: post.id,
          slug: post.slug,
          title: post.title,
          category: post.category,
          publishedAt: post.publishedAt,
          safeHtml: renderMarkdownSafe(post.bodyMarkdown)
        },
        hasUnread
      )
    );
  });

  return router;
}
