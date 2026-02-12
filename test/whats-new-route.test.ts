import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { InMemoryChangelogRepository } from "../src/changelog/repository";
import { loadConfig, type AppConfig } from "../src/config";

const config: AppConfig = {
  port: 3000,
  whatsNewKillSwitch: false,
  allowlistEnabled: true,
  allowlistedTenantIds: new Set(["tenant-alpha"]),
  publisherAllowlistedUserIds: new Set(["publisher-1"]),
  publisherAllowlistedEmails: new Set(),
  devAuthBypassEnabled: false,
  devAuthBypassUserId: "dev-admin-1",
  devAuthBypassUserRole: "ADMIN",
  devAuthBypassTenantId: "tenant-alpha"
};

describe("GET /whats-new", () => {
  it("redirects root path to /whats-new", async () => {
    const app = createApp(config);
    const response = await request(app).get("/");

    expect(response.status).toBe(302);
    expect(response.header.location).toBe("/whats-new");
  });

  it("preserves deep-link query params when redirecting root path", async () => {
    const app = createApp(config);
    const response = await request(app).get("/?whats_new=1");

    expect(response.status).toBe(302);
    expect(response.header.location).toBe("/whats-new?whats_new=1");
  });

  it("serves route for allowlisted admin", async () => {
    const app = createApp(config);
    const response = await request(app)
      .get("/whats-new")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain("What's New");
  });

  it("renders full-page feed markup on /whats-new", async () => {
    const app = createApp(config);
    const response = await request(app)
      .get("/whats-new")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain('<h1 class="ds-text ds-text--heading">What\'s New</h1>');
    expect(response.text).toContain('id="whats-new-feed-list"');
    expect(response.text).toContain('id="whats-new-feed-load-more"');
    expect(response.text).toContain("Latest updates");
    expect(response.text).not.toContain('id="whats-new-panel"');
  });

  it("returns 404 for non-allowlisted tenant", async () => {
    const app = createApp(config);
    const response = await request(app)
      .get("/whats-new")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-beta");

    expect(response.status).toBe(404);
  });

  it("keeps deep-link trigger gated for non-allowlisted tenants without leaking reason", async () => {
    const app = createApp(config);
    const response = await request(app)
      .get("/whats-new?whats_new=1")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-beta");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found" });
  });

  it("supports browser access without headers when dev auth fallback is enabled", async () => {
    const app = createApp({
      ...config,
      devAuthBypassEnabled: true
    });
    const response = await request(app).get("/whats-new");

    expect(response.status).toBe(200);
    expect(response.text).toContain("What's New");
  });

  it("supports browser access with loadConfig defaults when env allowlist is not set", async () => {
    const derivedConfig = loadConfig({
      NODE_ENV: "development",
      WHATS_NEW_KILL_SWITCH: "false",
      WHATS_NEW_ALLOWLIST_ENABLED: "true"
    });
    const app = createApp(derivedConfig);
    const response = await request(app).get("/whats-new");

    expect(response.status).toBe(200);
    expect(response.text).toContain("What's New");
  });

  it("renders canonical detail page with metadata and sanitized markdown", async () => {
    const app = createApp(config, {
      changelogRepository: new InMemoryChangelogRepository([
        {
          id: "1",
          tenantId: null,
          visibility: "authenticated",
          status: "published",
          category: "fix",
          title: "Sanitized detail",
          slug: "sanitized-detail",
          bodyMarkdown:
            "<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[good](https://example.com)\n[bad](javascript:alert(2))\n**safe**",
          publishedAt: "2026-02-01T00:00:00.000Z",
          revision: 1
        }
      ])
    });

    const response = await request(app)
      .get("/whats-new/sanitized-detail")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Back to What's New");
    expect(response.text).toContain('wn-category-badge--fix');
    expect(response.text).toContain('<time datetime="2026-02-01T00:00:00.000Z">');
    expect(response.text).toContain("<strong>safe</strong>");
    expect(response.text).toContain('href="https://example.com"');
    expect(response.text).toContain('target="_blank"');
    expect(response.text).toContain('rel="noopener noreferrer"');
    expect(response.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(response.text).not.toContain("<script>alert(1)</script>");
    expect(response.text).not.toMatch(/<[^>]+\son(?:error|load)\s*=/i);
    expect(response.text).not.toMatch(/href\s*=\s*"\s*javascript:/i);
  });

  it("renders drawer entry with unread dot on detail route when unread updates exist", async () => {
    const app = createApp(config, {
      changelogRepository: new InMemoryChangelogRepository([
        {
          id: "1",
          tenantId: null,
          visibility: "authenticated",
          status: "published",
          category: "new",
          title: "Global update",
          slug: "global-update",
          bodyMarkdown: "Body",
          publishedAt: "2026-02-01T00:00:00.000Z",
          revision: 1
        }
      ])
    });

    const response = await request(app)
      .get("/whats-new/global-update")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain('id="whats-new-entry-link"');
    expect(response.text).toContain('href="/whats-new/global-update?whats_new=1"');
    expect(response.text).toContain('aria-controls="whats-new-panel"');
    expect(response.text).toContain('aria-expanded="false"');
    expect(response.text).toContain('id="whats-new-unread-dot" class="wn-nav-badge-dot"');
    expect(response.text).toContain('New updates available');
  });

  it("renders drawer entry without unread dot on detail route when unread is false", async () => {
    const app = createApp(config, {
      changelogRepository: new InMemoryChangelogRepository(
        [
          {
            id: "1",
            tenantId: null,
            visibility: "authenticated",
            status: "published",
            category: "new",
            title: "Global update",
            slug: "global-update",
            bodyMarkdown: "Body",
            publishedAt: "2026-02-01T00:00:00.000Z",
            revision: 1
          }
        ],
        [
          {
            tenantId: "tenant-alpha",
            userId: "admin-1",
            lastSeenAt: "2026-03-01T00:00:00.000Z"
          }
        ]
      )
    });

    const response = await request(app)
      .get("/whats-new/global-update")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain('id="whats-new-entry-link"');
    expect(response.text).toContain('id="whats-new-unread-dot" class="wn-nav-badge-dot" hidden');
  });

  it("returns 404 for unknown or gated detail slugs", async () => {
    const app = createApp(config, {
      changelogRepository: new InMemoryChangelogRepository([
        {
          id: "1",
          tenantId: "tenant-beta",
          visibility: "authenticated",
          status: "published",
          category: "new",
          title: "Tenant Beta only",
          slug: "tenant-beta-only",
          bodyMarkdown: "Body",
          publishedAt: "2026-02-01T00:00:00.000Z",
          revision: 1
        },
        {
          id: "2",
          tenantId: null,
          visibility: "authenticated",
          status: "draft",
          category: "new",
          title: "Draft post",
          slug: "draft-post",
          bodyMarkdown: "Body",
          publishedAt: null,
          revision: 1
        }
      ])
    });

    const unknownResponse = await request(app)
      .get("/whats-new/not-a-post")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");
    expect(unknownResponse.status).toBe(404);

    const tenantGatedResponse = await request(app)
      .get("/whats-new/tenant-beta-only")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");
    expect(tenantGatedResponse.status).toBe(404);

    const draftResponse = await request(app)
      .get("/whats-new/draft-post")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");
    expect(draftResponse.status).toBe(404);
  });

  it("renders whats new side panel markup with dialog semantics on detail route", async () => {
    const app = createApp(config, {
      changelogRepository: new InMemoryChangelogRepository([
        {
          id: "1",
          tenantId: null,
          visibility: "authenticated",
          status: "published",
          category: "new",
          title: "Example post",
          slug: "example-post",
          bodyMarkdown: "Body",
          publishedAt: "2026-02-01T00:00:00.000Z",
          revision: 1
        }
      ])
    });
    const response = await request(app)
      .get("/whats-new/example-post")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain('id="whats-new-panel"');
    expect(response.text).toContain('role="dialog"');
    expect(response.text).toContain('aria-modal="true"');
    expect(response.text).toContain('id="whats-new-panel-close"');
    expect(response.text).toContain('id="whats-new-feed-load-more"');
    expect(response.text).toContain('id="whats-new-panel-open-full-page"');
    expect(response.text).toContain('target="_blank"');
    expect(response.text).toContain('rel="noopener noreferrer"');
  });

  it("keeps [hidden] behavior enforced for drawer visibility toggles", async () => {
    const app = createApp(config);
    const response = await request(app)
      .get("/whats-new/assets/styles.css")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain(".wn-page [hidden]");
    expect(response.text).toContain("display: none !important;");
  });

  it("wires client mark-seen flow with debounce and csrf header", async () => {
    const app = createApp(config);
    const response = await request(app)
      .get("/whats-new/assets/client.js")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain("MARK_SEEN_DEBOUNCE_MS = 60_000");
    expect(response.text).toContain('const DEEPLINK_QUERY_PARAM = "whats_new"');
    expect(response.text).toContain('const DEEPLINK_QUERY_VALUE = "1"');
    expect(response.text).toContain('const DEEPLINK_HASH = "#whats-new"');
    expect(response.text).toContain("lastSeenWriteAtMs > 0");
    expect(response.text).toContain("const refreshedHasUnread = await refreshUnreadIndicator();");
    expect(response.text).toContain("/api/whats-new/seen");
    expect(response.text).toContain('"x-csrf-token"');
    expect(response.text).toContain('trackEvent("whats_new.open_panel"');
    expect(response.text).toContain('source: normalizePanelOpenSource(source)');
    expect(response.text).toContain("let initialTriggerConsumed = false;");
    expect(response.text).toContain("const processInitialTrigger = async () => {");
    expect(response.text).toContain('const opened = openPanel("deeplink");');
    expect(response.text).toContain('const payload = await requestJson("/api/whats-new/posts?limit=1");');
    expect(response.text).toContain("window.location.assign(targetUrl);");
    expect(response.text).toContain("if (initialTriggerConsumed) {");
    expect(response.text).toContain("window.history.replaceState");
    expect(response.text).toContain('window[PROGRAMMATIC_API_GLOBAL] = programmaticApi;');
    expect((response.text.match(/trackEvent\("whats_new\.open_panel"/g) || []).length).toBe(1);
    expect(response.text).toContain('trackEvent("whats_new.load_more"');
    expect(response.text).toContain('trackEvent("whats_new.open_full_page"');
    expect(response.text).toContain('trackEvent("whats_new.open_post"');
    expect(response.text).toContain('trackEvent("whats_new.mark_seen_success"');
    expect(response.text).toContain('trackEvent("whats_new.mark_seen_failure"');
  });
});
