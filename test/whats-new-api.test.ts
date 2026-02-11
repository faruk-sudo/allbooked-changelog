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
    rateLimit: {
      enabled: true,
      readPerMinute: 120,
      writePerMinute: 30
    },
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
      },
      {
        id: "4",
        tenantId: null,
        visibility: "authenticated",
        status: "draft",
        category: "new",
        title: "Global draft",
        slug: "global-draft",
        bodyMarkdown: "Draft body",
        publishedAt: null,
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

  it("supports deterministic cursor pagination ordered by published_at desc and id desc", async () => {
    const repo = new InMemoryChangelogRepository([
      {
        id: "00000000-0000-4000-8000-000000000001",
        tenantId: null,
        visibility: "authenticated",
        status: "published",
        category: "new",
        title: "A post",
        slug: "a-post",
        bodyMarkdown: "A body",
        publishedAt: "2026-02-04T00:00:00.000Z",
        revision: 1
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        tenantId: null,
        visibility: "authenticated",
        status: "published",
        category: "improvement",
        title: "Z post",
        slug: "z-post",
        bodyMarkdown: "Z body",
        publishedAt: "2026-02-04T00:00:00.000Z",
        revision: 1
      },
      {
        id: "00000000-0000-4000-8000-000000000000",
        tenantId: null,
        visibility: "authenticated",
        status: "published",
        category: "fix",
        title: "Older post",
        slug: "older-post",
        bodyMarkdown: "Older body",
        publishedAt: "2026-02-01T00:00:00.000Z",
        revision: 1
      }
    ]);

    const app = createApp(createConfig(), { changelogRepository: repo });

    const firstPage = await withAdminHeaders(request(app).get("/api/whats-new/posts?limit=2"));
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items.map((item: { slug: string }) => item.slug)).toEqual(["z-post", "a-post"]);
    expect(firstPage.body.pagination.next_cursor).toBeTypeOf("string");

    const secondPage = await withAdminHeaders(
      request(app).get(`/api/whats-new/posts?limit=2&cursor=${firstPage.body.pagination.next_cursor}`)
    );
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items.map((item: { slug: string }) => item.slug)).toEqual(["older-post"]);
    expect(secondPage.body.pagination.next_cursor).toBeNull();
  });

  it("caps feed limit at 50 and keeps feed payload lightweight", async () => {
    const posts = Array.from({ length: 60 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      tenantId: null,
      visibility: "authenticated" as const,
      status: "published" as const,
      category: "new" as const,
      title: `Post ${index}`,
      slug: `post-${index}`,
      bodyMarkdown: `Body ${index}`,
      publishedAt: "2026-02-04T00:00:00.000Z",
      revision: 1
    }));
    const repo = new InMemoryChangelogRepository(posts);
    const app = createApp(createConfig(), { changelogRepository: repo });

    const response = await withAdminHeaders(request(app).get("/api/whats-new/posts?limit=999"));

    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBe(50);
    expect(response.body.items).toHaveLength(50);
    expect(response.body.pagination.next_cursor).toBeTypeOf("string");
    expect(response.body.items[0].slug).toBe("post-59");
    expect(response.body.items[49].slug).toBe("post-10");
    expect(response.body.items[0].body_markdown).toBeUndefined();
  });

  it("rejects invalid read-feed cursor values", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/posts?cursor=not-a-cursor"));

    expect(response.status).toBe(400);
    expect(String(response.body.error || "")).toContain("cursor");
  });

  it("rejects invalid read-feed limit values", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/posts?limit=-1"));

    expect(response.status).toBe(400);
    expect(String(response.body.error || "")).toContain("limit");
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

  it("returns 404 on detail endpoint when slug is missing, draft, or outside tenant scope", async () => {
    const repo = new InMemoryChangelogRepository([
      {
        id: "1",
        tenantId: "tenant-beta",
        visibility: "authenticated",
        status: "published",
        category: "new",
        title: "Tenant Beta",
        slug: "tenant-beta-post",
        bodyMarkdown: "Beta body",
        publishedAt: "2026-02-01T00:00:00.000Z",
        revision: 1
      },
      {
        id: "2",
        tenantId: null,
        visibility: "authenticated",
        status: "draft",
        category: "new",
        title: "Draft",
        slug: "draft-post",
        bodyMarkdown: "Draft body",
        publishedAt: null,
        revision: 1
      }
    ]);

    const app = createApp(createConfig(), { changelogRepository: repo });

    const missingResponse = await withAdminHeaders(request(app).get("/api/whats-new/posts/missing-post"));
    expect(missingResponse.status).toBe(404);

    const otherTenantResponse = await withAdminHeaders(request(app).get("/api/whats-new/posts/tenant-beta-post"));
    expect(otherTenantResponse.status).toBe(404);

    const draftResponse = await withAdminHeaders(request(app).get("/api/whats-new/posts/draft-post"));
    expect(draftResponse.status).toBe(404);
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

  it("ignores drafts when computing unread state", async () => {
    const repo = new InMemoryChangelogRepository(
      [
        {
          id: "1",
          tenantId: null,
          visibility: "authenticated",
          status: "published",
          category: "new",
          title: "Published update",
          slug: "published-update",
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
          title: "Draft update",
          slug: "draft-update",
          bodyMarkdown: "Draft body",
          publishedAt: null,
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

  it("sets private cache headers on feed endpoint", async () => {
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
    const response = await withAdminHeaders(request(app).get("/api/whats-new/posts"));

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, max-age=30, stale-while-revalidate=60");
    expect(response.headers["vary"]).toContain("Authorization");
    expect(response.headers["etag"]).toBeTypeOf("string");
  });

  it("returns 304 on feed endpoint when If-None-Match matches ETag", async () => {
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
    const firstResponse = await withAdminHeaders(request(app).get("/api/whats-new/posts"));
    const etag = firstResponse.headers["etag"];

    expect(firstResponse.status).toBe(200);
    expect(etag).toBeTypeOf("string");

    const secondResponse = await withAdminHeaders(request(app).get("/api/whats-new/posts").set("if-none-match", etag));
    expect(secondResponse.status).toBe(304);
  });

  it("sets private cache headers on detail and unread endpoints", async () => {
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
    const detailResponse = await withAdminHeaders(request(app).get("/api/whats-new/posts/global-update"));
    const unreadResponse = await withAdminHeaders(request(app).get("/api/whats-new/unread"));

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.headers["cache-control"]).toBe("private, max-age=30, stale-while-revalidate=60");
    expect(detailResponse.headers["etag"]).toBeTypeOf("string");

    expect(unreadResponse.status).toBe(200);
    expect(unreadResponse.headers["cache-control"]).toBe("private, max-age=30, stale-while-revalidate=60");
    expect(unreadResponse.headers["etag"]).toBeTypeOf("string");
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

  it("returns unread=true when a newer publication exists after last_seen_at", async () => {
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
          publishedAt: "2026-02-03T00:00:00.000Z",
          revision: 1
        }
      ],
      [
        {
          tenantId: "tenant-alpha",
          userId: "admin-1",
          lastSeenAt: "2026-02-01T00:00:00.000Z"
        }
      ]
    );

    const app = createApp(createConfig(), { changelogRepository: repo });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/unread"));

    expect(response.status).toBe(200);
    expect(response.body.has_unread).toBe(true);
  });

  it("creates read_state on first /seen call and clears unread when nothing newer exists", async () => {
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
    const before = await withAdminHeaders(request(app).get("/api/whats-new/unread"));
    expect(before.status).toBe(200);
    expect(before.body.has_unread).toBe(true);

    const seen = await withAdminHeaders(
      request(app).post("/api/whats-new/seen").set("x-csrf-token", csrfToken)
    );
    expect(seen.status).toBe(200);
    expect(seen.body.ok).toBe(true);
    expect(new Date(seen.body.last_seen_at).toISOString()).toBe(seen.body.last_seen_at);

    const after = await withAdminHeaders(request(app).get("/api/whats-new/unread"));
    expect(after.status).toBe(200);
    expect(after.body.has_unread).toBe(false);
  });

  it("updates last_seen_at on subsequent /seen calls", async () => {
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
          lastSeenAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    );

    const app = createApp(createConfig(), { changelogRepository: repo });
    const seen = await withAdminHeaders(
      request(app).post("/api/whats-new/seen").set("x-csrf-token", csrfToken)
    );

    expect(seen.status).toBe(200);
    expect(new Date(seen.body.last_seen_at).toISOString()).toBe(seen.body.last_seen_at);
    expect(Date.parse(seen.body.last_seen_at)).toBeGreaterThan(Date.parse("2026-01-01T00:00:00.000Z"));
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

  it("enforces tenant isolation for /seen state writes", async () => {
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

    const app = createApp(
      createConfig({
        allowlistedTenantIds: new Set(["tenant-alpha", "tenant-beta"])
      }),
      { changelogRepository: repo }
    );

    const seenResponse = await withAdminHeaders(
      request(app).post("/api/whats-new/seen").set("x-csrf-token", csrfToken),
      { tenantId: "tenant-alpha" }
    );
    expect(seenResponse.status).toBe(200);

    const unreadBeta = await withAdminHeaders(request(app).get("/api/whats-new/unread"), {
      tenantId: "tenant-beta"
    });
    expect(unreadBeta.status).toBe(200);
    expect(unreadBeta.body.has_unread).toBe(true);
  });

  it("returns 404 on /seen endpoint for non-allowlisted tenant", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(
      request(app).post("/api/whats-new/seen").set("x-csrf-token", csrfToken),
      { tenantId: "tenant-beta" }
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 on unread endpoint for non-admin users", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(request(app).get("/api/whats-new/unread"), {
      role: "USER"
    });

    expect(response.status).toBe(403);
  });

  it("returns 403 on /seen endpoint for non-admin users", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(
      request(app).post("/api/whats-new/seen").set("x-csrf-token", csrfToken),
      {
        role: "USER"
      }
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 on /seen endpoint when csrf token is missing", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(request(app).post("/api/whats-new/seen"));

    expect(response.status).toBe(403);
  });

  it("rate limits read endpoints and returns 429 with retry-after", async () => {
    const app = createApp(
      createConfig({
        rateLimit: {
          enabled: true,
          readPerMinute: 2,
          writePerMinute: 30
        }
      }),
      { changelogRepository: new InMemoryChangelogRepository() }
    );

    const first = await withAdminHeaders(request(app).get("/api/whats-new/posts"));
    const second = await withAdminHeaders(request(app).get("/api/whats-new/posts"));
    const third = await withAdminHeaders(request(app).get("/api/whats-new/posts"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error).toBe("Too many requests");
    expect(third.headers["retry-after"]).toBeTypeOf("string");
    expect(third.headers["ratelimit-limit"]).toBe("2");
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

  it("lists admin posts with published-first sorting and draft fallback sorting", async () => {
    const repo = new InMemoryChangelogRepository([
      {
        id: "published-newer",
        tenantId: null,
        visibility: "authenticated",
        status: "published",
        category: "new",
        title: "Published newer",
        slug: "published-newer",
        bodyMarkdown: "Body",
        publishedAt: "2026-02-04T00:00:00.000Z",
        revision: 1,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-05T00:00:00.000Z"
      },
      {
        id: "published-older",
        tenantId: "tenant-alpha",
        visibility: "authenticated",
        status: "published",
        category: "fix",
        title: "Published older",
        slug: "published-older",
        bodyMarkdown: "Body",
        publishedAt: "2026-02-02T00:00:00.000Z",
        revision: 1,
        createdAt: "2026-01-20T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z"
      },
      {
        id: "draft-newer",
        tenantId: "tenant-alpha",
        visibility: "authenticated",
        status: "draft",
        category: "improvement",
        title: "Draft newer",
        slug: "draft-newer",
        bodyMarkdown: "Body",
        publishedAt: null,
        revision: 1,
        createdAt: "2026-02-06T00:00:00.000Z",
        updatedAt: "2026-02-10T00:00:00.000Z"
      },
      {
        id: "draft-older",
        tenantId: null,
        visibility: "authenticated",
        status: "draft",
        category: "new",
        title: "Draft older",
        slug: "draft-older",
        bodyMarkdown: "Body",
        publishedAt: null,
        revision: 1,
        createdAt: "2026-02-05T00:00:00.000Z",
        updatedAt: "2026-02-07T00:00:00.000Z"
      }
    ]);
    const app = createApp(createConfig(), { changelogRepository: repo });

    const response = await withAdminHeaders(request(app).get("/api/admin/whats-new/posts?limit=10"), {
      userId: "publisher-1"
    });

    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      "published-newer",
      "published-older",
      "draft-newer",
      "draft-older"
    ]);
  });

  it("supports admin list search across title + slug and honors scope/status filters", async () => {
    const repo = new InMemoryChangelogRepository([
      {
        id: "global-published",
        tenantId: null,
        visibility: "authenticated",
        status: "published",
        category: "new",
        title: "Global launch announcement",
        slug: "global-launch",
        bodyMarkdown: "Body",
        publishedAt: "2026-02-04T00:00:00.000Z",
        revision: 1
      },
      {
        id: "tenant-draft",
        tenantId: "tenant-alpha",
        visibility: "authenticated",
        status: "draft",
        category: "fix",
        title: "Tenant bug followup",
        slug: "tenant-bug-followup",
        bodyMarkdown: "Body",
        publishedAt: null,
        revision: 1
      },
      {
        id: "tenant-published",
        tenantId: "tenant-alpha",
        visibility: "authenticated",
        status: "published",
        category: "improvement",
        title: "Tenant rollout notes",
        slug: "tenant-rollout",
        bodyMarkdown: "Body",
        publishedAt: "2026-02-02T00:00:00.000Z",
        revision: 1
      }
    ]);
    const app = createApp(createConfig(), { changelogRepository: repo });

    const searchBySlug = await withAdminHeaders(
      request(app).get("/api/admin/whats-new/posts?limit=10&q=bug"),
      { userId: "publisher-1" }
    );
    expect(searchBySlug.status).toBe(200);
    expect(searchBySlug.body.items.map((item: { id: string }) => item.id)).toEqual(["tenant-draft"]);

    const scopeGlobal = await withAdminHeaders(
      request(app).get("/api/admin/whats-new/posts?limit=10&tenant_id=global"),
      { userId: "publisher-1" }
    );
    expect(scopeGlobal.status).toBe(200);
    expect(scopeGlobal.body.items.map((item: { id: string }) => item.id)).toEqual(["global-published"]);

    const draftOnly = await withAdminHeaders(
      request(app).get("/api/admin/whats-new/posts?limit=10&status=draft"),
      { userId: "publisher-1" }
    );
    expect(draftOnly.status).toBe(200);
    expect(draftOnly.body.items.map((item: { id: string }) => item.id)).toEqual(["tenant-draft"]);
  });

  it("returns admin post detail by id with markdown body and tenant isolation", async () => {
    const repo = new InMemoryChangelogRepository([
      {
        id: "tenant-draft",
        tenantId: "tenant-alpha",
        visibility: "authenticated",
        status: "draft",
        category: "new",
        title: "Tenant draft",
        slug: "tenant-draft",
        bodyMarkdown: "## Tenant markdown body",
        publishedAt: null,
        revision: 2
      },
      {
        id: "other-tenant-draft",
        tenantId: "tenant-beta",
        visibility: "authenticated",
        status: "draft",
        category: "fix",
        title: "Other tenant draft",
        slug: "other-tenant-draft",
        bodyMarkdown: "Hidden",
        publishedAt: null,
        revision: 1
      }
    ]);
    const app = createApp(
      createConfig({
        allowlistedTenantIds: new Set(["tenant-alpha", "tenant-beta"])
      }),
      { changelogRepository: repo }
    );

    const detailResponse = await withAdminHeaders(
      request(app).get("/api/admin/whats-new/posts/tenant-draft"),
      { userId: "publisher-1" }
    );

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe("tenant-draft");
    expect(detailResponse.body.body_markdown).toContain("Tenant markdown");

    const crossTenantResponse = await withAdminHeaders(
      request(app).get("/api/admin/whats-new/posts/other-tenant-draft"),
      { userId: "publisher-1", tenantId: "tenant-alpha" }
    );
    expect(crossTenantResponse.status).toBe(404);
  });

  it("sanitizes markdown preview payloads on admin endpoint", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withAdminHeaders(
      request(app)
        .post("/api/admin/whats-new/preview")
        .set("x-csrf-token", csrfToken)
        .send({
          body_markdown:
            "<script>alert(1)</script><img src=x onerror=alert(2)> [safe](https://example.com) [bad](javascript:alert(3)) **ok**"
        }),
      { userId: "publisher-1" }
    );

    expect(response.status).toBe(200);
    expect(response.body.safe_html).toContain("<strong>ok</strong>");
    expect(response.body.safe_html).toContain('href="https://example.com"');
    expect(response.body.safe_html).not.toMatch(/<script/i);
    expect(response.body.safe_html).not.toMatch(/<[^>]+\\son(?:error|load)\\s*=/i);
    expect(response.body.safe_html).not.toMatch(/href\\s*=\\s*"\\s*javascript:/i);
  });

  it("allows saving empty draft content and blocks publishing until title/body exist", async () => {
    const repo = new InMemoryChangelogRepository();
    const app = createApp(createConfig(), { changelogRepository: repo });

    const createResponse = await withAdminHeaders(
      request(app).post("/api/admin/whats-new/posts").set("x-csrf-token", csrfToken),
      { userId: "publisher-1" }
    ).send({
      category: "new",
      title: "",
      body_markdown: ""
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.title).toBe("");

    const publishResponse = await withAdminHeaders(
      request(app)
        .post(`/api/admin/whats-new/posts/${createResponse.body.id}/publish`)
        .set("x-csrf-token", csrfToken),
      { userId: "publisher-1" }
    ).send({
      expected_revision: createResponse.body.revision
    });

    expect(publishResponse.status).toBe(400);
    expect(String(publishResponse.body.error || "")).toContain("required");
  });

  it("enforces title and slug max lengths on draft save", async () => {
    const repo = new InMemoryChangelogRepository();
    const app = createApp(createConfig(), { changelogRepository: repo });

    const longTitleResponse = await withAdminHeaders(
      request(app).post("/api/admin/whats-new/posts").set("x-csrf-token", csrfToken),
      { userId: "publisher-1" }
    ).send({
      category: "new",
      title: "t".repeat(141),
      body_markdown: "Body"
    });

    expect(longTitleResponse.status).toBe(400);
    expect(String(longTitleResponse.body.error || "")).toContain("140");

    const longSlugResponse = await withAdminHeaders(
      request(app).post("/api/admin/whats-new/posts").set("x-csrf-token", csrfToken),
      { userId: "publisher-1" }
    ).send({
      category: "new",
      title: "Valid title",
      slug: "s".repeat(101),
      body_markdown: "Body"
    });

    expect(longSlugResponse.status).toBe(400);
    expect(String(longSlugResponse.body.error || "")).toContain("100");
  });

  it("returns 409 for slug conflicts on update", async () => {
    const repo = new InMemoryChangelogRepository([
      {
        id: "post-1",
        tenantId: "tenant-alpha",
        visibility: "authenticated",
        status: "draft",
        category: "new",
        title: "Post one",
        slug: "post-one",
        bodyMarkdown: "One",
        publishedAt: null,
        revision: 1
      },
      {
        id: "post-2",
        tenantId: "tenant-alpha",
        visibility: "authenticated",
        status: "draft",
        category: "fix",
        title: "Post two",
        slug: "post-two",
        bodyMarkdown: "Two",
        publishedAt: null,
        revision: 1
      }
    ]);
    const app = createApp(createConfig(), { changelogRepository: repo });

    const updateResponse = await withAdminHeaders(
      request(app)
        .put("/api/admin/whats-new/posts/post-1")
        .set("x-csrf-token", csrfToken)
        .send({
          slug: "post-two",
          expected_revision: 1
        }),
      { userId: "publisher-1" }
    );

    expect(updateResponse.status).toBe(409);
    expect(String(updateResponse.body.error || "")).toContain("slug");
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

  it("rate limits publisher write endpoints and returns 429 with retry-after", async () => {
    const app = createApp(
      createConfig({
        rateLimit: {
          enabled: true,
          readPerMinute: 120,
          writePerMinute: 2
        }
      }),
      { changelogRepository: new InMemoryChangelogRepository() }
    );

    const first = await withAdminHeaders(
      request(app)
        .post("/api/admin/whats-new/posts")
        .set("x-csrf-token", csrfToken)
        .send({ title: "First", slug: "first-post", category: "new", body_markdown: "Body" }),
      { userId: "publisher-1" }
    );
    const second = await withAdminHeaders(
      request(app)
        .post("/api/admin/whats-new/posts")
        .set("x-csrf-token", csrfToken)
        .send({ title: "Second", slug: "second-post", category: "new", body_markdown: "Body" }),
      { userId: "publisher-1" }
    );
    const third = await withAdminHeaders(
      request(app)
        .post("/api/admin/whats-new/posts")
        .set("x-csrf-token", csrfToken)
        .send({ title: "Third", slug: "third-post", category: "new", body_markdown: "Body" }),
      { userId: "publisher-1" }
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(429);
    expect(third.body.error).toBe("Too many requests");
    expect(third.headers["retry-after"]).toBeTypeOf("string");
    expect(third.headers["ratelimit-limit"]).toBe("2");
  });
});
