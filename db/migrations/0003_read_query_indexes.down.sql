DROP INDEX IF EXISTS idx_changelog_posts_status_visibility_published_at_id_desc;
DROP INDEX IF EXISTS idx_changelog_posts_tenant_status_visibility_published_at_id_desc;

CREATE INDEX IF NOT EXISTS idx_changelog_posts_tenant_status_published_at_desc
  ON changelog_posts (tenant_id, status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_changelog_posts_status_published_at_desc
  ON changelog_posts (status, published_at DESC);
