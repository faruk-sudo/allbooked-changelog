DROP INDEX IF EXISTS idx_changelog_audit_log_post_id_at_desc;
DROP INDEX IF EXISTS idx_changelog_posts_status_published_at_desc;
DROP INDEX IF EXISTS idx_changelog_posts_tenant_status_published_at_desc;

DROP TABLE IF EXISTS changelog_audit_log;
DROP TABLE IF EXISTS changelog_read_state;
DROP TABLE IF EXISTS changelog_posts;

DROP TYPE IF EXISTS changelog_audit_action;
DROP TYPE IF EXISTS changelog_post_category;
DROP TYPE IF EXISTS changelog_post_status;
DROP TYPE IF EXISTS changelog_visibility;
