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

  it("returns 404 for non-allowlisted tenant", async () => {
    const app = createApp(config);
    const response = await request(app)
      .get("/whats-new")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-beta");

    expect(response.status).toBe(404);
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

  it("renders bottom bar entry with unread dot when unread updates exist", async () => {
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
      .get("/whats-new")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain('id="whats-new-entry-link"');
    expect(response.text).toContain('aria-controls="whats-new-panel"');
    expect(response.text).toContain('aria-expanded="false"');
    expect(response.text).toContain('id="whats-new-unread-dot" class="wn-nav-badge-dot"');
    expect(response.text).toContain('New updates available');
  });

  it("renders bottom bar entry without unread dot when unread is false", async () => {
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
      .get("/whats-new")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain('id="whats-new-entry-link"');
    expect(response.text).toContain('id="whats-new-unread-dot" class="wn-nav-badge-dot" hidden');
  });

  it("renders whats new side panel markup with dialog semantics", async () => {
    const app = createApp(config);
    const response = await request(app)
      .get("/whats-new")
      .set("x-user-id", "admin-1")
      .set("x-user-role", "ADMIN")
      .set("x-tenant-id", "tenant-alpha");

    expect(response.status).toBe(200);
    expect(response.text).toContain('id="whats-new-panel"');
    expect(response.text).toContain('role="dialog"');
    expect(response.text).toContain('aria-modal="true"');
    expect(response.text).toContain('id="whats-new-panel-close"');
    expect(response.text).toContain('id="whats-new-feed-load-more"');
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
    expect(response.text).toContain("/api/whats-new/seen");
    expect(response.text).toContain('"x-csrf-token"');
  });
});
