import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";
import { InMemoryChangelogRepository } from "../src/changelog/repository";

const csrfToken = "csrf-token-123456";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3000,
    whatsNewKillSwitch: false,
    allowlistEnabled: true,
    allowlistedTenantIds: new Set(["tenant-alpha"]),
    publisherAllowlistedUserIds: new Set(["publisher-1"]),
    publisherAllowlistedEmails: new Set(),
    devAuthBypassEnabled: false,
    devAuthBypassUserId: "dev-admin-1",
    devAuthBypassUserRole: "ADMIN",
    devAuthBypassTenantId: "tenant-alpha",
    ...overrides
  };
}

function withAdminHeaders(req: request.Test, overrides?: { userId?: string; role?: string; tenantId?: string }) {
  return req
    .set("x-user-id", overrides?.userId ?? "admin-1")
    .set("x-user-role", overrides?.role ?? "ADMIN")
    .set("x-tenant-id", overrides?.tenantId ?? "tenant-alpha");
}

describe("What's New read API", () => {
  it("returns only global + current tenant published posts", async () => {
    const repo = new InMemoryChangelogRepository([
      {
        id: "1",
        tenantId: "tenant-alpha",
        visibility: "authenticated",
        status: "published",
        category: "new",
        title: "Tenant Alpha",
        slug: "tenant-alpha-post",
        bodyMarkdown: "Alpha body",
        publishedAt: "2026-02-01T00:00:00.000Z",
        revision: 1
      },
      {
        id: "2",
        tenantId: "tenant-beta",
        visibility: "authenticated",
        status: "published",
        category: "fix",
        title: "Tenant Beta",
        slug: "tenant-beta-post",
        bodyMarkdown: "Beta body",
        publishedAt: "2026-02-02T00:00:00.000Z",
        revision: 1
      },
      {
        id: "3",
        tenantId: null,
        visibility: "authenticated",
        status: "published",
        category: "improvement",
        title: "Global",
        slug: "global-post",
        bodyMarkdown: "Global body",
        publishedAt: "2026-02-03T00:00:00.000Z",
        revision: 1
      }
    ]);

    const app = createApp(createConfig(), { changelogRepository: repo });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/posts"));

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items.map((item: { slug: string }) => item.slug)).toEqual([
      "global-post",
      "tenant-alpha-post"
    ]);
  });

  it("returns sanitized HTML on detail endpoint and neutralizes XSS payloads", async () => {
    const repo = new InMemoryChangelogRepository([
      {
        id: "1",
        tenantId: null,
        visibility: "authenticated",
        status: "published",
        category: "new",
        title: "Unsafe markdown",
        slug: "unsafe-markdown",
        bodyMarkdown:
          "<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n<svg onload=alert(2)></svg>\n[good](https://example.com)\n[bad](javascript:alert(3))\n**safe**",
        publishedAt: "2026-02-01T00:00:00.000Z",
        revision: 1
      }
    ]);

    const app = createApp(createConfig(), { changelogRepository: repo });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/posts/unsafe-markdown"));

    expect(response.status).toBe(200);
    expect(response.body.safe_html).toContain("<strong>safe</strong>");
    expect(response.body.safe_html).toContain('href="https://example.com"');
    expect(response.body.safe_html).toContain('target="_blank"');
    expect(response.body.safe_html).toContain('rel="noopener noreferrer"');
    expect(response.body.safe_html).not.toMatch(/<script/i);
    expect(response.body.safe_html).not.toMatch(/<[^>]+\son(?:error|load)\s*=/i);
    expect(response.body.safe_html).not.toMatch(/href\s*=\s*"\s*javascript:/i);
  });

  it("returns unread=true when published posts exist and no read state is present", async () => {
    const repo = new InMemoryChangelogRepository([
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
    ]);

    const app = createApp(createConfig(), { changelogRepository: repo });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/unread"));

    expect(response.status).toBe(200);
    expect(response.body.has_unread).toBe(true);
  });

  it("returns unread=false when read_state is newer than the latest publication", async () => {
    const repo = new InMemoryChangelogRepository(
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
          lastSeenAt: "2026-02-02T00:00:00.000Z"
        }
      ]
    );

    const app = createApp(createConfig(), { changelogRepository: repo });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/unread"));

    expect(response.status).toBe(200);
    expect(response.body.has_unread).toBe(false);
  });

  it("does not count other tenant posts when computing unread", async () => {
    const repo = new InMemoryChangelogRepository([
      {
        id: "1",
        tenantId: "tenant-beta",
        visibility: "authenticated",
        status: "published",
        category: "fix",
        title: "Tenant Beta",
        slug: "tenant-beta-post",
        bodyMarkdown: "Beta body",
        publishedAt: "2026-02-03T00:00:00.000Z",
        revision: 1
      }
    ]);

    const app = createApp(createConfig(), { changelogRepository: repo });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/unread"));

    expect(response.status).toBe(200);
    expect(response.body.has_unread).toBe(false);
  });

  it("returns 404 for non-allowlisted tenant", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/posts"), {
      tenantId: "tenant-beta"
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 on unread endpoint for non-allowlisted tenant", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/unread"), {
      tenantId: "tenant-beta"
    });

    expect(response.status).toBe(404);
  });

  it("returns 403 on unread endpoint for non-admin users", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/unread"), {
      role: "USER"
    });

    expect(response.status).toBe(403);
  });
});

describe("What's New admin API", () => {
  it("blocks non-admin user", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(
      request(app).post("/api/admin/whats-new/posts").set("x-csrf-token", csrfToken),
      { role: "USER" }
    ).send({
      title: "Draft",
      category: "new",
      body_markdown: "body"
    });

    expect(response.status).toBe(403);
  });

  it("blocks admin not in publisher allowlist", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(
      request(app).post("/api/admin/whats-new/posts").set("x-csrf-token", csrfToken),
      { userId: "admin-not-publisher" }
    ).send({
      title: "Draft",
      category: "new",
      body_markdown: "body"
    });

    expect(response.status).toBe(404);
  });

  it("supports create, publish, and unpublish with audit records", async () => {
    const repo = new InMemoryChangelogRepository();
    const app = createApp(createConfig(), { changelogRepository: repo });

    const createResponse = await withAdminHeaders(
      request(app)
        .post("/api/admin/whats-new/posts")
        .set("x-csrf-token", csrfToken),
      { userId: "publisher-1" }
    ).send({
      title: "New Draft",
      category: "new",
      body_markdown: "Draft body"
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.status).toBe("draft");
    expect(createResponse.body.visibility).toBe("authenticated");

    const postId = createResponse.body.id;

    const publishResponse = await withAdminHeaders(
      request(app)
        .post(`/api/admin/whats-new/posts/${postId}/publish`)
        .set("x-csrf-token", csrfToken),
      { userId: "publisher-1" }
    ).send({ expected_revision: createResponse.body.revision });

    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.status).toBe("published");
    expect(publishResponse.body.published_at).toBeTruthy();

    const unpublishResponse = await withAdminHeaders(
      request(app)
        .post(`/api/admin/whats-new/posts/${postId}/unpublish`)
        .set("x-csrf-token", csrfToken),
      { userId: "publisher-1" }
    ).send({ expected_revision: publishResponse.body.revision });

    expect(unpublishResponse.status).toBe(200);
    expect(unpublishResponse.body.status).toBe("draft");
    expect(unpublishResponse.body.published_at).toBeNull();

    expect(repo.auditRecords.map((entry) => entry.action)).toEqual(["create", "publish", "unpublish"]);
    for (const entry of repo.auditRecords) {
      expect(JSON.stringify(entry.metadata ?? {})).not.toContain("\"body_markdown\":");
      expect(JSON.stringify(entry.metadata ?? {})).not.toContain("\"bodyMarkdown\":");
      expect(JSON.stringify(entry.metadata ?? {})).not.toContain("\"markdown\":");
    }
  });
});
