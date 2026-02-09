import type { ChangelogPost } from "../types/context";

const seededPosts: ChangelogPost[] = [
  {
    id: "post-2026-01-admin-insights",
    slug: "admin-insights-overview",
    title: "Admin Insights Overview",
    bodyMarkdown:
      "## New\n\n- Booking health summary now appears at the top of dashboards.\n- Performance fixes on high-volume calendars.",
    status: "published",
    publishedAt: "2026-01-22T10:00:00.000Z"
  },
  {
    id: "post-2026-02-draft",
    slug: "draft-internal-notes",
    title: "Draft: Future Improvements",
    bodyMarkdown: "Internal draft content.",
    status: "draft",
    publishedAt: null
  }
];

export function listPublishedPosts(): ChangelogPost[] {
  return seededPosts
    .filter((post) => post.status === "published")
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

export function findPublishedPostBySlug(slug: string): ChangelogPost | undefined {
  return listPublishedPosts().find((post) => post.slug === slug);
}
