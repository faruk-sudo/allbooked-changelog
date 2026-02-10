CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'changelog_visibility') THEN
    CREATE TYPE changelog_visibility AS ENUM ('authenticated', 'public');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'changelog_post_status') THEN
    CREATE TYPE changelog_post_status AS ENUM ('draft', 'published');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'changelog_post_category') THEN
    CREATE TYPE changelog_post_category AS ENUM ('new', 'improvement', 'fix');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'changelog_audit_action') THEN
    CREATE TYPE changelog_audit_action AS ENUM ('create', 'update', 'publish', 'unpublish', 'delete');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS changelog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NULL,
  visibility changelog_visibility NOT NULL DEFAULT 'authenticated',
  status changelog_post_status NOT NULL DEFAULT 'draft',
  category changelog_post_category NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  slug text NOT NULL CHECK (length(trim(slug)) > 0),
  body_markdown text NOT NULL CHECK (length(trim(body_markdown)) > 0),
  published_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL CHECK (length(trim(created_by_actor_id)) > 0),
  updated_by_actor_id text NOT NULL CHECK (length(trim(updated_by_actor_id)) > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 0),
  CONSTRAINT changelog_posts_slug_key UNIQUE (slug),
  CONSTRAINT changelog_posts_published_at_consistency CHECK (
    (status = 'draft' AND published_at IS NULL) OR
    (status = 'published' AND published_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS changelog_read_state (
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS changelog_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NULL,
  actor_id text NOT NULL CHECK (length(trim(actor_id)) > 0),
  action changelog_audit_action NOT NULL,
  post_id uuid NULL REFERENCES changelog_posts (id) ON DELETE SET NULL,
  at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NULL,
  CONSTRAINT changelog_audit_log_metadata_redaction CHECK (
    metadata IS NULL OR (
      NOT jsonb_path_exists(metadata, '$.**.body_markdown') AND
      NOT jsonb_path_exists(metadata, '$.**.bodyMarkdown')
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_changelog_posts_tenant_status_published_at_desc
  ON changelog_posts (tenant_id, status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_changelog_posts_status_published_at_desc
  ON changelog_posts (status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_changelog_audit_log_post_id_at_desc
  ON changelog_audit_log (post_id, at DESC);
