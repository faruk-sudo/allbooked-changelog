import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";
import { InMemoryChangelogRepository } from "../src/changelog/repository";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base: AppConfig = {
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
    securityHeaders: {
      isProduction: false,
      cspReportOnly: true,
      cspFrameAncestors: ["'none'"],
      cspConnectSrc: ["'self'"],
      cspImgSrc: ["'self'", "data:", "https:"]
    },
    publicSurface: {
      enabled: false,
      noindex: true,
      cspEnabled: true
    }
  };

  return {
    ...base,
    ...overrides,
    securityHeaders: {
      ...base.securityHeaders,
      ...overrides.securityHeaders
    },
    publicSurface: {
      ...base.publicSurface,
      ...overrides.publicSurface
    }
  };
}

function buildPublicPost(overrides: Partial<ConstructorParameters<typeof InMemoryChangelogRepository>[0][number]> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    tenantId: null,
    visibility: "public" as const,
    status: "published" as const,
    category: "new" as const,
    title: "Public launch",
    slug: "public-launch",
    bodyMarkdown: "## Highlights\n\n**Public** update body.",
    publishedAt: "2026-02-01T00:00:00.000Z",
    revision: 1,
    ...overrides
  };
}

describe("public changelog routes", () => {
  it("returns 404 for list and detail routes when PUBLIC_CHANGELOG_ENABLED is false", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });

    const listResponse = await request(app).get("/changelog");
    const detailResponse = await request(app).get("/changelog/public-launch");

    expect(listResponse.status).toBe(404);
    expect(detailResponse.status).toBe(404);
  });

  it("serves list and detail pages with noindex, cache, and CSP headers when enabled", async () => {
    const app = createApp(
      createConfig({
        publicSurface: {
          enabled: true,
          noindex: true,
          cspEnabled: true
        }
      }),
      { changelogRepository: new InMemoryChangelogRepository([buildPublicPost()]) }
    );

    const listResponse = await request(app).get("/changelog");
    const detailResponse = await request(app).get("/changelog/public-launch");

    expect(listResponse.status).toBe(200);
    expect(listResponse.text).toContain("<h1");
    expect(listResponse.text).toContain("Changelog");
    expect(listResponse.text).toContain('<meta name="robots" content="noindex,nofollow" />');
    expect(listResponse.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(listResponse.headers["cache-control"]).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    expect(listResponse.headers["content-security-policy-report-only"]).toContain("default-src 'none'");

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.text).toContain("Back to Changelog");
    expect(detailResponse.text).toContain('<meta name="robots" content="noindex,nofollow" />');
    expect(detailResponse.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(detailResponse.headers["cache-control"]).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    expect(detailResponse.headers["content-security-policy-report-only"]).toContain("default-src 'none'");
  });

  it("omits noindex headers and robots meta when PUBLIC_CHANGELOG_NOINDEX is false", async () => {
    const app = createApp(
      createConfig({
        publicSurface: {
          enabled: true,
          noindex: false,
          cspEnabled: true
        }
      }),
      { changelogRepository: new InMemoryChangelogRepository([buildPublicPost()]) }
    );

    const listResponse = await request(app).get("/changelog");
    const detailResponse = await request(app).get("/changelog/public-launch");

    expect(listResponse.status).toBe(200);
    expect(listResponse.text).not.toContain('<meta name="robots" content="noindex,nofollow" />');
    expect(listResponse.headers["x-robots-tag"]).toBeUndefined();

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.text).not.toContain('<meta name="robots" content="noindex,nofollow" />');
    expect(detailResponse.headers["x-robots-tag"]).toBeUndefined();
  });

  it("rejects query attempts to override public policy filters", async () => {
    const app = createApp(
      createConfig({
        publicSurface: {
          enabled: true,
          noindex: true,
          cspEnabled: true
        }
      }),
      { changelogRepository: new InMemoryChangelogRepository([buildPublicPost()]) }
    );

    const response = await request(app).get("/changelog?status=draft");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Unsupported query parameter" });
  });

  it("shows only published + public + global posts in list and detail routes", async () => {
    const app = createApp(
      createConfig({
        publicSurface: {
          enabled: true,
          noindex: true,
          cspEnabled: true
        }
      }),
      {
        changelogRepository: new InMemoryChangelogRepository([
          buildPublicPost({ title: "Public launch", slug: "public-launch", id: "00000000-0000-4000-8000-000000000001" }),
          buildPublicPost({
            title: "Authenticated only",
            slug: "authenticated-only",
            visibility: "authenticated",
            id: "00000000-0000-4000-8000-000000000002"
          }),
          buildPublicPost({
            title: "Draft public",
            slug: "draft-public",
            status: "draft",
            publishedAt: null,
            id: "00000000-0000-4000-8000-000000000003"
          }),
          buildPublicPost({
            title: "Tenant public",
            slug: "tenant-public",
            tenantId: "tenant-alpha",
            id: "00000000-0000-4000-8000-000000000004"
          })
        ])
      }
    );

    const listResponse = await request(app).get("/changelog");

    expect(listResponse.status).toBe(200);
    expect(listResponse.text).toContain("Public launch");
    expect(listResponse.text).not.toContain("Authenticated only");
    expect(listResponse.text).not.toContain("Draft public");
    expect(listResponse.text).not.toContain("Tenant public");

    const publicDetail = await request(app).get("/changelog/public-launch");
    expect(publicDetail.status).toBe(200);

    const authenticatedDetail = await request(app).get("/changelog/authenticated-only");
    const draftDetail = await request(app).get("/changelog/draft-public");
    const tenantDetail = await request(app).get("/changelog/tenant-public");

    expect(authenticatedDetail.status).toBe(404);
    expect(draftDetail.status).toBe(404);
    expect(tenantDetail.status).toBe(404);
  });

  it("caps list page size at 50 and renders page controls", async () => {
    const posts = Array.from({ length: 55 }).map((_, index) =>
      buildPublicPost({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        title: `Public post ${index + 1}`,
        slug: `public-post-${index + 1}`,
        publishedAt: new Date(Date.UTC(2026, 1, 1, 0, 0, 55 - index)).toISOString()
      })
    );

    const app = createApp(
      createConfig({
        publicSurface: {
          enabled: true,
          noindex: true,
          cspEnabled: true
        }
      }),
      { changelogRepository: new InMemoryChangelogRepository(posts) }
    );

    const firstPageResponse = await request(app).get("/changelog?limit=999");
    const firstPageRows = (firstPageResponse.text.match(/class="pc-feed-row"/g) || []).length;

    expect(firstPageResponse.status).toBe(200);
    expect(firstPageRows).toBe(50);
    expect(firstPageResponse.text).toContain("/changelog?page=2&amp;limit=50");

    const secondPageResponse = await request(app).get("/changelog?page=2&limit=50");
    const secondPageRows = (secondPageResponse.text.match(/class=\"pc-feed-row\"/g) || []).length;

    expect(secondPageResponse.status).toBe(200);
    expect(secondPageRows).toBe(5);
    expect(secondPageResponse.text).toContain("/changelog?page=1&amp;limit=50");
  });

  it("keeps detail markdown rendering sanitized for XSS payloads", async () => {
    const app = createApp(
      createConfig({
        publicSurface: {
          enabled: true,
          noindex: true,
          cspEnabled: true
        }
      }),
      {
        changelogRepository: new InMemoryChangelogRepository([
          buildPublicPost({
            slug: "sanitized-public",
            bodyMarkdown:
              "<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[bad](javascript:alert(2))\n[ok](https://example.com)\n**safe**"
          })
        ])
      }
    );

    const response = await request(app).get("/changelog/sanitized-public");

    expect(response.status).toBe(200);
    expect(response.text).toContain("<strong>safe</strong>");
    expect(response.text).toContain('href="https://example.com"');
    expect(response.text).toContain('target="_blank"');
    expect(response.text).toContain('rel="noopener noreferrer"');
    expect(response.text).not.toContain("<script>alert(1)</script>");
    expect(response.text).not.toMatch(/<[^>]+\son(?:error|load)\s*=/i);
    expect(response.text).not.toMatch(/href\s*=\s*"\s*javascript:/i);
  });
});
