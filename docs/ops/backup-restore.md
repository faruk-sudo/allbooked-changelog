# Backup and Restore Runbook (Postgres)

This runbook is for the What's New service data path and is intended for pressure scenarios.

## Scope: what must be backed up

Back up all data and schema objects required to restore operational behavior:

- Tables:
  - `changelog_posts`
  - `changelog_read_state`
  - `changelog_audit_log`
  - `schema_migrations` (migration runner state)
- Related schema objects:
  - indexes
  - constraints/check constraints
  - enums/types (`changelog_visibility`, `changelog_post_status`, `changelog_post_category`, `changelog_audit_action`)
- Service configuration (names only; do not store secrets in git):
  - `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`
  - rollout/authz flags (`WHATS_NEW_*`)
  - rate-limit and security-header flags (`RATE_LIMIT_*`, `CSP_*`, `WHATS_NEW_CSP_REPORT_ONLY`)

## Backup procedure

### Prerequisites

- Running Postgres container (dev example): `allbooked-changelog-pg`
- Source DB exists (dev example): `allbooked_changelog`
- `docker` CLI available

### Naming and retention

- File naming convention:
  - `allbooked-changelog-<environment>-<yyyyMMdd-HHmmss>.dump`
- Retention guidance (starter):
  - daily backups: keep 14 days
  - weekly backups: keep 8 weeks
  - monthly backups: keep 12 months
- Keep at least one recent backup in a second storage location.

### Logical backup (schema + data, recommended)

```bash
BACKUP_FILE="/tmp/allbooked-changelog-$(date +%Y%m%d-%H%M%S).dump"
docker exec allbooked-changelog-pg \
  pg_dump -U postgres -d allbooked_changelog \
  --format=custom \
  --no-owner \
  --no-privileges \
  --serializable-deferrable > "$BACKUP_FILE"
echo "Backup written to: $BACKUP_FILE"
```

### Optional: data-only backup

```bash
DATA_ONLY_FILE="/tmp/allbooked-changelog-data-only-$(date +%Y%m%d-%H%M%S).sql"
docker exec allbooked-changelog-pg \
  pg_dump -U postgres -d allbooked_changelog \
  --data-only \
  --column-inserts \
  --no-owner \
  --no-privileges > "$DATA_ONLY_FILE"
echo "Data-only backup written to: $DATA_ONLY_FILE"
```

## Restore procedure (fresh database)

Set variables:

```bash
BACKUP_FILE="/tmp/allbooked-changelog-<timestamp>.dump"
RESTORE_DB="allbooked_changelog_restore_drill"
```

Create an empty target DB and restore:

```bash
docker exec allbooked-changelog-pg dropdb -U postgres --if-exists "$RESTORE_DB"
docker exec allbooked-changelog-pg createdb -U postgres "$RESTORE_DB"
cat "$BACKUP_FILE" | docker exec -i allbooked-changelog-pg \
  pg_restore -U postgres \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$RESTORE_DB"
```

Re-run migrations (must be replay-safe and idempotent):

```bash
DATABASE_URL="postgres://<user>:<password>@localhost:5432/$RESTORE_DB" npm run db:migrate
```

Expected output: `No pending migrations.` for a fully restored DB.

## Restore validation checklist

### 1) Run DB smoke checks

```bash
DATABASE_URL="postgres://<user>:<password>@localhost:5432/$RESTORE_DB" npm run db:smoke-check
```

Expected output includes `DB smoke checks passed.`

### 2) Confirm core table counts exist

```bash
docker exec allbooked-changelog-pg psql -U postgres -d "$RESTORE_DB" -c "
SELECT 'changelog_posts' AS table_name, count(*) AS row_count FROM changelog_posts
UNION ALL SELECT 'changelog_read_state', count(*) FROM changelog_read_state
UNION ALL SELECT 'changelog_audit_log', count(*) FROM changelog_audit_log;"
```

### 3) Confirm app-level read endpoints respond

Terminal 1:

```bash
PORT=3011 \
NODE_ENV=development \
WHATS_NEW_KILL_SWITCH=false \
WHATS_NEW_ALLOWLIST_ENABLED=true \
WHATS_NEW_ALLOWLIST_TENANT_IDS=tenant-alpha \
WHATS_NEW_PUBLISHER_ALLOWLIST_USER_IDS=publisher-1 \
WHATS_NEW_DEV_AUTH_BYPASS=false \
DATABASE_URL="postgres://<user>:<password>@localhost:5432/$RESTORE_DB" \
npx tsx src/server.ts
```

Terminal 2:

```bash
curl -s -i http://localhost:3011/healthz
curl -s -i http://localhost:3011/api/whats-new/unread \
  -H 'x-user-id: admin-1' \
  -H 'x-user-role: ADMIN' \
  -H 'x-tenant-id: tenant-alpha'
curl -s -i 'http://localhost:3011/api/whats-new/posts?limit=1' \
  -H 'x-user-id: admin-1' \
  -H 'x-user-role: ADMIN' \
  -H 'x-tenant-id: tenant-alpha'
```

## Migration replay validation (explicit drill)

Use a clean DB to validate migrate/rollback/re-apply:

```bash
REPLAY_DB="allbooked_changelog_replay_drill"
docker exec allbooked-changelog-pg dropdb -U postgres --if-exists "$REPLAY_DB"
docker exec allbooked-changelog-pg createdb -U postgres "$REPLAY_DB"
DATABASE_URL="postgres://<user>:<password>@localhost:5432/$REPLAY_DB" npm run db:migrate
DATABASE_URL="postgres://<user>:<password>@localhost:5432/$REPLAY_DB" npm run db:migrate:down -- 1
DATABASE_URL="postgres://<user>:<password>@localhost:5432/$REPLAY_DB" npm run db:migrate
DATABASE_URL="postgres://<user>:<password>@localhost:5432/$REPLAY_DB" npm run db:smoke-check
```

## Disaster recovery drill checklist

- `Incident commander`: coordinates timeline and go/no-go.
- `DB operator`: executes backup restore and migration replay.
- `App operator`: validates `/healthz` and read APIs on restored DB.
- `Recorder`: captures timestamps, blockers, and follow-ups.
- Track:
  - backup start/end time
  - restore start/end time
  - validation completion time
  - qualitative RTO target met/not met
- Exit criteria:
  - restore completed without SQL errors
  - migrations replay cleanly
  - smoke check passes
  - reader endpoints return successful responses

## Security and privacy requirements for backups

- Treat backups as sensitive operational data. `changelog_audit_log` may contain internal identifiers and action metadata.
- Encrypt backups at rest and in transit.
- Restrict access with least privilege and audited access controls.
- Do not store real credentials, tokens, or customer data in runbook examples.
- Do not commit backup artifacts into git.

## Validated local drill (February 11, 2026)

The following flow was executed locally against Docker Postgres:

1. Backup generated from `allbooked_changelog` to `/tmp/allbooked-changelog-20260211-151038.dump`.
2. Restore into fresh DB `allbooked_changelog_restore_drill`.
3. `npm run db:migrate` on restored DB returned `No pending migrations.`
4. `npm run db:smoke-check` passed.
5. Table counts matched source (`posts=8`, `read_state=1`, `audit_log=12`).
6. App-level checks passed (`/healthz`, `/api/whats-new/unread`, `/api/whats-new/posts?limit=1` all returned `200`).
7. Replay drill passed on `allbooked_changelog_replay_drill` (migrate -> rollback 1 -> re-apply -> smoke-check).
