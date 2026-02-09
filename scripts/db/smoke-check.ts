import { randomUUID } from "node:crypto";
import { createDatabasePool } from "../../src/db/connection";
import { migrateUp } from "../../src/db/migrations";
import { formatError } from "./format-error";

async function expectFailure(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch {
    console.info(`Verified constraint: ${label}`);
    return;
  }

  throw new Error(`Expected failure but succeeded: ${label}`);
}

async function main() {
  const pool = createDatabasePool();
  const tenantId = `tenant-smoke-${Date.now()}`;
  const actorId = `actor-smoke-${Date.now()}`;
  const slug = `smoke-post-${Date.now()}`;
  const userId = `user-smoke-${Date.now()}`;
  const insertedPostIds: string[] = [];

  try {
    await migrateUp(pool);

    const publishedPostId = randomUUID();
    insertedPostIds.push(publishedPostId);
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
        ) VALUES (
          $1,
          $2,
          'authenticated',
          'published',
          'new',
          'Smoke Test Post',
          $3,
          'Smoke body',
          now(),
          $4,
          $4,
          1
        )
      `,
      [publishedPostId, tenantId, slug, actorId]
    );

    await expectFailure("post title required", async () => {
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
          ) VALUES (
            $1,
            $2,
            'authenticated',
            'published',
            'fix',
            NULL,
            $3,
            'Invalid post with missing title',
            now(),
            $4,
            $4,
            1
          )
        `,
        [randomUUID(), tenantId, `${slug}-missing-title`, actorId]
      );
    });

    await expectFailure("post slug uniqueness", async () => {
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
          ) VALUES (
            $1,
            $2,
            'authenticated',
            'published',
            'improvement',
            'Duplicate slug test',
            $3,
            'Duplicate slug should fail',
            now(),
            $4,
            $4,
            1
          )
        `,
        [randomUUID(), tenantId, slug, actorId]
      );
    });

    await pool.query(
      `
        INSERT INTO changelog_read_state (tenant_id, user_id, last_seen_at)
        VALUES ($1, $2, now())
      `,
      [tenantId, userId]
    );

    await expectFailure("read_state unique tenant/user", async () => {
      await pool.query(
        `
          INSERT INTO changelog_read_state (tenant_id, user_id, last_seen_at)
          VALUES ($1, $2, now())
        `,
        [tenantId, userId]
      );
    });

    console.info("DB smoke checks passed.");
  } finally {
    await pool.query("DELETE FROM changelog_read_state WHERE tenant_id = $1", [tenantId]);
    if (insertedPostIds.length > 0) {
      await pool.query("DELETE FROM changelog_posts WHERE id = ANY($1::uuid[])", [insertedPostIds]);
    }
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`DB smoke check failed:\n${formatError(error)}`);
  process.exitCode = 1;
});
