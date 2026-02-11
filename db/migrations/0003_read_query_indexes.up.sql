DROP INDEX IF EXISTS idx_changelog_posts_tenant_status_published_at_desc;
DROP INDEX IF EXISTS idx_changelog_posts_status_published_at_desc;

CREATE INDEX IF NOT EXISTS idx_changelog_posts_tenant_status_visibility_published_at_id_desc
  ON changelog_posts (tenant_id, status, visibility, published_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_changelog_posts_status_visibility_published_at_id_desc
  ON changelog_posts (status, visibility, published_at DESC, id DESC);
