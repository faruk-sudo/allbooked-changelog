# allbooked-changelog

Secure foundation for AllBooked's in-app admin-only "What's New" (changelog) feature.

## Why this exists
- v1 scope: authenticated admin users only.
- Entry point: app footer/bottom bar link to `/whats-new`.
- Rollout safety: tenant allowlist and kill switch are enforced server-side.

## Stack
- Node.js + TypeScript
- Express (small, portable integration surface)
- PostgreSQL + SQL migrations (lightweight custom runner)
- `markdown-it` + `sanitize-html` for strict markdown rendering
- Vitest + Supertest for unit/smoke-ish route tests

## Quick start
1. Install dependencies:
```bash
npm install
```
2. Copy env defaults:
```bash
cp .env.example .env
```
3. Run in dev mode:
```bash
npm run dev
```
4. Open:
- Root (redirects): `http://localhost:3000/`
- Health: `http://localhost:3000/healthz`
- What's New: `http://localhost:3000/whats-new`
- What's New detail: `http://localhost:3000/whats-new/:slug`

## Required request headers (stub auth/tenant context)
The current implementation uses headers as an auth/tenant stub until real SSO is integrated.
In local dev, `.env.example` enables a dev auth fallback so browser access works without headers.

When dev auth fallback is disabled, these headers are required:
- `x-user-id`: any non-empty ID
- `x-user-role`: must be `ADMIN` for access
- `x-tenant-id`: tenant identifier, must be allowlisted (when allowlist is enabled)
- `x-user-email`: optional; only used for publisher allowlist fallback
- `x-csrf-token`: required for mutating admin API endpoints (`POST`/`PUT`)

Example:
```bash
curl -i http://localhost:3000/whats-new \
  -H 'x-user-id: admin-1' \
  -H 'x-user-role: ADMIN' \
  -H 'x-tenant-id: tenant-alpha'
```

## Environment config
- `PORT`: server port (default `3000`)
- `WHATS_NEW_KILL_SWITCH`: `true|false`; when `true`, blocks all tenants
- `WHATS_NEW_ALLOWLIST_ENABLED`: `true|false`; when `false`, any tenant with context is allowed
- `WHATS_NEW_ALLOWLIST_TENANT_IDS`: comma-separated tenant IDs (e.g. `tenant-alpha,tenant-beta`)
- `WHATS_NEW_PUBLISHER_ALLOWLIST_USER_IDS`: comma-separated stable user IDs allowed to use admin CRUD endpoints
- `WHATS_NEW_PUBLISHER_ALLOWLIST_EMAILS`: optional comma-separated fallback email allowlist (exact match only; use IDs when available)
- `WHATS_NEW_DEV_AUTH_BYPASS`: `true|false`; when `true`, missing auth/tenant headers are auto-populated for local browser testing (disabled automatically in production `NODE_ENV`)
- `WHATS_NEW_DEV_USER_ID`: fallback user ID when dev auth bypass is enabled
- `WHATS_NEW_DEV_USER_ROLE`: fallback role (`ADMIN` or `USER`) when dev auth bypass is enabled
- `WHATS_NEW_DEV_TENANT_ID`: fallback tenant ID when dev auth bypass is enabled
- `WHATS_NEW_DEV_USER_EMAIL`: optional fallback email when dev auth bypass is enabled
- `DATABASE_URL`: PostgreSQL connection string for migrations/seeding/smoke checks
- `DATABASE_SSL`: `true|false` (default `false`) for DB TLS
- `DATABASE_SSL_REJECT_UNAUTHORIZED`: `true|false` (default `true`) when TLS is enabled

## Security defaults included
- Admin-only access enforced server-side on `/whats-new`, `/api/whats-new`, and `/api/admin/whats-new`
- Tenant context and allowlist gate enforced server-side
- Non-allowlisted tenants receive `404`
- Publisher allowlist gate enforced on admin CRUD endpoints
- CSP/security headers via Helmet for `/whats-new` routes
- Markdown rendering blocks raw HTML and sanitizes output
- Logging is structured and safe by default (redacts body fields, auth/cookie headers, and secret-like values)
- CSRF token required on mutating admin endpoints

## Database setup and migrations
1. Start PostgreSQL locally and ensure `DATABASE_URL` points to an existing database.
2. Run schema migrations:
```bash
npm run db:migrate
```
3. (Optional, dev-only) seed sample published changelog posts:
```bash
npm run db:seed:dev
```
4. (Optional) roll back most recent migration:
```bash
npm run db:migrate:down
```
5. (Optional) roll back multiple migrations:
```bash
npm run db:migrate:down -- 2
```

Migration files live in `db/migrations`.

## DB smoke check
Run constraint-level verification against a local Postgres instance:
```bash
npm run db:smoke-check
```

The smoke check verifies:
- post title is required
- post slug uniqueness is enforced
- read-state uniqueness on `(tenant_id, user_id)` is enforced

## API endpoints
Read API (admin + allowlisted tenant):
- `GET /api/whats-new/posts?limit=20&offset=0` (supports `cursor` alias for offset)
- `GET /api/whats-new/posts/:slug`
- `GET /api/whats-new/unread` -> `{ has_unread: boolean }`

Admin API (admin + allowlisted tenant + publisher allowlist + CSRF token for mutating methods):
- `GET /api/admin/whats-new/posts?status=draft|published&tenant_id=<current-tenant|global>&limit=20&offset=0`
- `POST /api/admin/whats-new/posts`
- `PUT /api/admin/whats-new/posts/:id`
- `POST /api/admin/whats-new/posts/:id/publish`
- `POST /api/admin/whats-new/posts/:id/unpublish`

Audit log behavior:
- All state-changing admin endpoints write to `changelog_audit_log`.
- Audit metadata stores summaries only (e.g. `changed_fields`, status transitions), never markdown bodies.

## Current app data source
- `src/server.ts` uses Postgres-backed changelog repository (`changelog_posts`, `changelog_audit_log`, `changelog_read_state`).
- `/whats-new` renders the list feed client-side from `GET /api/whats-new/posts`.
- `/whats-new/:slug` resolves on the server, enforces published/authenticated + tenant scope, and renders markdown through the shared sanitization pipeline.

## Tests
Run unit tests:
```bash
npm test
```

Smoke command:
```bash
npm run smoke
```

Current test coverage focus:
- allowlist gate logic
- admin auth guard behavior
- markdown sanitization with XSS payloads
- allowlisted route access behavior
