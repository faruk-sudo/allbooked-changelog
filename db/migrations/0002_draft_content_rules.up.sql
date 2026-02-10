ALTER TABLE changelog_posts
  DROP CONSTRAINT IF EXISTS changelog_posts_title_check,
  DROP CONSTRAINT IF EXISTS changelog_posts_body_markdown_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'changelog_posts_required_content_when_published'
  ) THEN
    ALTER TABLE changelog_posts
      ADD CONSTRAINT changelog_posts_required_content_when_published CHECK (
        status <> 'published'::changelog_post_status
        OR (length(trim(title)) > 0 AND length(trim(body_markdown)) > 0)
      );
  END IF;
END
$$;
