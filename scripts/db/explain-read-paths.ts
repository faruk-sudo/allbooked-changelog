import { createDatabasePool } from "../../src/db/connection";
import { formatError } from "./format-error";

interface ExplainSpec {
  name: string;
  sql: string;
  values: unknown[];
}

function requireNonEmpty(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} must be non-empty`);
  }
  return normalized;
}

async function runExplain(pool: ReturnType<typeof createDatabasePool>, spec: ExplainSpec): Promise<void> {
  console.info(`\n=== ${spec.name} ===`);
  const result = await pool.query<{ "QUERY PLAN": string }>(
    `EXPLAIN (ANALYZE, BUFFERS, VERBOSE) ${spec.sql}`,
    spec.values
  );
  for (const row of result.rows) {
    console.info(row["QUERY PLAN"]);
  }
}

async function main() {
  const pool = createDatabasePool();

  try {
    const tenantId = requireNonEmpty("EXPLAIN_TENANT_ID", process.env.EXPLAIN_TENANT_ID ?? "tenant-alpha");
    const userId = requireNonEmpty("EXPLAIN_USER_ID", process.env.EXPLAIN_USER_ID ?? "admin-1");
    const slug = requireNonEmpty("EXPLAIN_SLUG", process.env.EXPLAIN_SLUG ?? "admin-insights-overview");
    const feedLimit = Number.parseInt(process.env.EXPLAIN_FEED_LIMIT ?? "12", 10);
    const cursorPublishedAt = process.env.EXPLAIN_CURSOR_PUBLISHED_AT ?? new Date().toISOString();
    const cursorId = process.env.EXPLAIN_CURSOR_ID ?? "00000000-0000-4000-8000-000000000000";

    if (!Number.isInteger(feedLimit) || feedLimit < 1 || feedLimit > 50) {
      throw new Error("EXPLAIN_FEED_LIMIT must be an integer between 1 and 50");
    }

    const specs: ExplainSpec[] = [
      {
        name: "feed list (first page)",
        sql: `
          SELECT
            id,
            category,
            title,
            slug,
            published_at,
            left(body_markdown, 1200) AS excerpt_source
          FROM changelog_posts
          WHERE status = 'published'
            AND visibility = 'authenticated'
            AND published_at IS NOT NULL
            AND (tenant_id = $1 OR tenant_id IS NULL)
          ORDER BY published_at DESC, id DESC
          LIMIT $2
        `,
        values: [tenantId, feedLimit]
      },
      {
        name: "feed list (keyset cursor page)",
        sql: `
          SELECT
            id,
            category,
            title,
            slug,
            published_at,
            left(body_markdown, 1200) AS excerpt_source
          FROM changelog_posts
          WHERE status = 'published'
            AND visibility = 'authenticated'
            AND published_at IS NOT NULL
            AND (tenant_id = $1 OR tenant_id IS NULL)
            AND (published_at, id) < ($2::timestamptz, $3::uuid)
          ORDER BY published_at DESC, id DESC
          LIMIT $4
        `,
        values: [tenantId, cursorPublishedAt, cursorId, feedLimit]
      },
      {
        name: "unread existence check",
        sql: `
          SELECT EXISTS (
            SELECT 1
            FROM changelog_posts
            WHERE status = 'published'
              AND visibility = 'authenticated'
              AND published_at IS NOT NULL
              AND (tenant_id = $1 OR tenant_id IS NULL)
              AND published_at > COALESCE(
                (
                  SELECT last_seen_at
                  FROM changelog_read_state
                  WHERE tenant_id = $1
                    AND user_id = $2
                  LIMIT 1
                ),
                to_timestamp(0)
              )
          ) AS has_unread
        `,
        values: [tenantId, userId]
      },
      {
        name: "detail by slug",
        sql: `
          SELECT
            id,
            tenant_id,
            visibility,
            status,
            category,
            title,
            slug,
            body_markdown,
            published_at,
            created_at,
            updated_at,
            revision
          FROM changelog_posts
          WHERE slug = $1
            AND status = 'published'
            AND visibility = 'authenticated'
            AND (tenant_id = $2 OR tenant_id IS NULL)
          LIMIT 1
        `,
        values: [slug, tenantId]
      }
    ];

    for (const spec of specs) {
      await runExplain(pool, spec);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`Explain read paths failed:\n${formatError(error)}`);
  process.exitCode = 1;
});
