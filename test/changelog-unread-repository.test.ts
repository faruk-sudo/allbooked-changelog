import { describe, expect, it } from "vitest";
import { InMemoryChangelogRepository } from "../src/changelog/repository";

describe("InMemoryChangelogRepository.hasUnreadPosts", () => {
  it("returns true when no read_state exists and scoped published posts exist", async () => {
    const repository = new InMemoryChangelogRepository([
      {
        id: "1",
        tenantId: "tenant-alpha",
        visibility: "authenticated",
        status: "published",
        category: "new",
        title: "Tenant Alpha update",
        slug: "tenant-alpha-update",
        bodyMarkdown: "Body",
        publishedAt: "2026-02-01T00:00:00.000Z",
        revision: 1
      }
    ]);

    const hasUnread = await repository.hasUnreadPosts({
      tenantScope: { tenantId: "tenant-alpha" },
      userId: "admin-1"
    });

    expect(hasUnread).toBe(true);
  });

  it("returns false when read_state is newer than latest scoped publication", async () => {
    const repository = new InMemoryChangelogRepository(
      [
        {
          id: "1",
          tenantId: null,
          visibility: "authenticated",
          status: "published",
          category: "improvement",
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

    const hasUnread = await repository.hasUnreadPosts({
      tenantScope: { tenantId: "tenant-alpha" },
      userId: "admin-1"
    });

    expect(hasUnread).toBe(false);
  });

  it("enforces tenant isolation and ignores posts from other tenants", async () => {
    const repository = new InMemoryChangelogRepository([
      {
        id: "1",
        tenantId: "tenant-beta",
        visibility: "authenticated",
        status: "published",
        category: "fix",
        title: "Tenant Beta update",
        slug: "tenant-beta-update",
        bodyMarkdown: "Body",
        publishedAt: "2026-02-03T00:00:00.000Z",
        revision: 1
      }
    ]);

    const hasUnread = await repository.hasUnreadPosts({
      tenantScope: { tenantId: "tenant-alpha" },
      userId: "admin-1"
    });

    expect(hasUnread).toBe(false);
  });
});
