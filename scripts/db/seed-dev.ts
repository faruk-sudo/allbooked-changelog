import { randomUUID } from "node:crypto";
import { createDatabasePool } from "../../src/db/connection";
import { migrateUp } from "../../src/db/migrations";
import { formatError } from "./format-error";

const DEV_SEED_POSTS = [
  {
    slug: "admin-insights-overview",
    title: "Admin Insights Overview",
    bodyMarkdown:
      "## New\n\n- Booking health summary now appears at the top of dashboards.\n- Performance fixes on high-volume calendars.",
    category: "new",
    status: "published"
  },
  {
    slug: "workflow-polish-roundup",
    title: "Workflow Polish Roundup",
    bodyMarkdown:
      "## Improvements\n\n- Faster sidebar loading for large organizations.\n- Better keyboard behavior across settings pages.",
    category: "improvement",
    status: "published"
  },
  {
    slug: "draft-editor-flow-preview",
    title: "Draft: Editor Flow Preview",
    bodyMarkdown:
      "## Draft notes\n\n- Internal draft for publisher workflow validation.\n- Publish flow lands in the next phase.",
    category: "fix",
    status: "draft"
  }
] as const;

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-dev must not run in production");
  }

  const pool = createDatabasePool();

  try {
    await migrateUp(pool);

    const actorId = process.env.SEED_ACTOR_ID ?? "dev-seed-script";
    const publishedAt = new Date().toISOString();

    for (const post of DEV_SEED_POSTS) {
      await pool.query(
        `
          INSERT INTO changelog_posts (
            id,
            tenant_id,
            visibility,
            status,
            category,
            title,
            slug,
            body_markdown,
            published_at,
            created_by_actor_id,
            updated_by_actor_id,
            revision
          )
          VALUES (
            $1,
            NULL,
            'authenticated',
            $2::changelog_post_status,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $8,
            1
          )
          ON CONFLICT (slug)
          DO UPDATE SET
            title = EXCLUDED.title,
            body_markdown = EXCLUDED.body_markdown,
            category = EXCLUDED.category,
            status = EXCLUDED.status,
            visibility = EXCLUDED.visibility,
            published_at = EXCLUDED.published_at,
            updated_at = now(),
            updated_by_actor_id = EXCLUDED.updated_by_actor_id,
            revision = changelog_posts.revision + 1
        `,
        [
          randomUUID(),
          post.status,
          post.category,
          post.title,
          post.slug,
          post.bodyMarkdown,
          post.status === "published" ? publishedAt : null,
          actorId
        ]
      );
    }

    console.info(`Seeded ${DEV_SEED_POSTS.length} dev changelog posts.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`Dev seed failed:\n${formatError(error)}`);
  process.exitCode = 1;
});
