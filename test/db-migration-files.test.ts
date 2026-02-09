import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0001_whats_new_schema.up.sql");
const migrationSql = readFileSync(migrationPath, "utf8");

describe("DB migration 0001_whats_new_schema", () => {
  it("creates required tables", () => {
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS changelog_posts");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS changelog_read_state");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS changelog_audit_log");
  });

  it("enforces key constraints", () => {
    expect(migrationSql).toContain("CONSTRAINT changelog_posts_slug_key UNIQUE (slug)");
    expect(migrationSql).toContain("PRIMARY KEY (tenant_id, user_id)");
    expect(migrationSql).toContain("CONSTRAINT changelog_audit_log_metadata_redaction CHECK");
  });

  it("adds required indexes", () => {
    expect(migrationSql).toContain("idx_changelog_posts_tenant_status_published_at_desc");
    expect(migrationSql).toContain("idx_changelog_posts_status_published_at_desc");
    expect(migrationSql).toContain("idx_changelog_audit_log_post_id_at_desc");
  });
});
