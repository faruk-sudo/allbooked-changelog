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
- Health: `http://localhost:3000/healthz`
- What's New: `http://localhost:3000/whats-new`

## Required request headers (stub auth/tenant context)
The current implementation uses headers as an auth/tenant stub until real SSO is integrated:
- `x-user-id`: any non-empty ID
- `x-user-role`: must be `ADMIN` for access
- `x-tenant-id`: tenant identifier, must be allowlisted (when allowlist is enabled)

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
- `DATABASE_URL`: PostgreSQL connection string for migrations/seeding/smoke checks
- `DATABASE_SSL`: `true|false` (default `false`) for DB TLS
- `DATABASE_SSL_REJECT_UNAUTHORIZED`: `true|false` (default `true`) when TLS is enabled

## Security defaults included
- Admin-only access enforced server-side on `/whats-new` routes
- Tenant context and allowlist gate enforced server-side
- Non-allowlisted tenants receive `404`
- CSP/security headers via Helmet for `/whats-new` routes
- Markdown rendering blocks raw HTML and sanitizes output
- Logging intentionally avoids markdown/body content
- CSRF middleware scaffolded for future mutating admin endpoints

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
npm run db:smoke
```

The smoke check verifies:
- post title is required
- post slug uniqueness is enforced
- read-state uniqueness on `(tenant_id, user_id)` is enforced

## Current app data source
Published and draft mock posts still live in `src/changelog/repository.ts`. DB-backed read/write endpoints are intentionally out of scope for this phase.

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
