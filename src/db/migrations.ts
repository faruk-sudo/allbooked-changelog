import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

export interface Migration {
  name: string;
  upPath: string;
  downPath: string;
}

const MIGRATIONS_DIRECTORY = path.resolve(process.cwd(), "db/migrations");

async function loadMigrations(): Promise<Migration[]> {
  const files = await readdir(MIGRATIONS_DIRECTORY);
  const upMigrationFiles = files
    .filter((fileName) => fileName.endsWith(".up.sql"))
    .sort((left, right) => left.localeCompare(right));

  return upMigrationFiles.map((upFileName) => {
    const name = upFileName.slice(0, -".up.sql".length);
    const downFileName = `${name}.down.sql`;
    if (!files.includes(downFileName)) {
      throw new Error(`Missing down migration for ${name}`);
    }

    return {
      name,
      upPath: path.join(MIGRATIONS_DIRECTORY, upFileName),
      downPath: path.join(MIGRATIONS_DIRECTORY, downFileName)
    };
  });
}

async function ensureSchemaMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function migrateUp(pool: Pool): Promise<string[]> {
  await ensureSchemaMigrationsTable(pool);

  const migrations = await loadMigrations();
  const appliedResult = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(appliedResult.rows.map((row) => row.name));

  const executed: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      continue;
    }

    const sql = await readFile(migration.upPath, "utf8");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
      await client.query("COMMIT");
      executed.push(migration.name);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return executed;
}

export async function migrateDown(pool: Pool, steps = 1): Promise<string[]> {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error("steps must be a positive integer");
  }

  await ensureSchemaMigrationsTable(pool);

  const migrations = await loadMigrations();
  const migrationByName = new Map(migrations.map((migration) => [migration.name, migration]));

  const appliedResult = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations ORDER BY applied_at DESC, name DESC"
  );

  const rollbackTargets = appliedResult.rows.slice(0, steps);
  const rolledBack: string[] = [];

  for (const target of rollbackTargets) {
    const migration = migrationByName.get(target.name);
    if (!migration) {
      throw new Error(`Applied migration ${target.name} is missing from db/migrations`);
    }

    const sql = await readFile(migration.downPath, "utf8");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("DELETE FROM schema_migrations WHERE name = $1", [migration.name]);
      await client.query("COMMIT");
      rolledBack.push(migration.name);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return rolledBack;
}
