import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0001_whats_new_schema.up.sql");
const migrationSql = readFileSync(migrationPath, "utf8");
const draftRulesMigrationPath = path.resolve(process.cwd(), "db/migrations/0002_draft_content_rules.up.sql");
const draftRulesMigrationSql = readFileSync(draftRulesMigrationPath, "utf8");
const readQueryIndexesMigrationPath = path.resolve(process.cwd(), "db/migrations/0003_read_query_indexes.up.sql");
const readQueryIndexesMigrationSql = readFileSync(readQueryIndexesMigrationPath, "utf8");

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

  it("adds draft content rules migration for publish-time content enforcement", () => {
    expect(draftRulesMigrationSql).toContain("changelog_posts_required_content_when_published");
    expect(draftRulesMigrationSql).toContain("DROP CONSTRAINT IF EXISTS changelog_posts_title_check");
    expect(draftRulesMigrationSql).toContain("DROP CONSTRAINT IF EXISTS changelog_posts_body_markdown_check");
  });

  it("adds read-query index alignment migration for feed + unread filters", () => {
    expect(readQueryIndexesMigrationSql).toContain("idx_changelog_posts_tenant_status_visibility_published_at_id_desc");
    expect(readQueryIndexesMigrationSql).toContain("idx_changelog_posts_status_visibility_published_at_id_desc");
  });
});
