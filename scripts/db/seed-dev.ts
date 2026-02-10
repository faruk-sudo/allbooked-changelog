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
    category: "new"
  },
  {
    slug: "workflow-polish-roundup",
    title: "Workflow Polish Roundup",
    bodyMarkdown:
      "## Improvements\n\n- Faster sidebar loading for large organizations.\n- Better keyboard behavior across settings pages.",
    category: "improvement"
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
            'published',
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $7,
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
          post.category,
          post.title,
          post.slug,
          post.bodyMarkdown,
          publishedAt,
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
