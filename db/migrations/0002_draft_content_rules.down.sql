ALTER TABLE changelog_posts
  DROP CONSTRAINT IF EXISTS changelog_posts_required_content_when_published;

UPDATE changelog_posts
SET title = 'Untitled draft'
WHERE length(trim(title)) = 0;

UPDATE changelog_posts
SET body_markdown = 'Draft content pending.'
WHERE length(trim(body_markdown)) = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'changelog_posts_title_check'
  ) THEN
    ALTER TABLE changelog_posts
      ADD CONSTRAINT changelog_posts_title_check CHECK (length(trim(title)) > 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'changelog_posts_body_markdown_check'
  ) THEN
    ALTER TABLE changelog_posts
      ADD CONSTRAINT changelog_posts_body_markdown_check CHECK (length(trim(body_markdown)) > 0);
  END IF;
END
$$;
