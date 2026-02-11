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
- `RATE_LIMIT_ENABLED`: `true|false`; enables API rate limiting (default `true`)
- `RATE_LIMIT_READ_PER_MIN`: per-minute limit for read endpoints and `/api/whats-new/seen` (default `120`)
- `RATE_LIMIT_WRITE_PER_MIN`: per-minute limit for publisher mutating admin endpoints (default `30`)
- `WHATS_NEW_CSP_REPORT_ONLY`: `true|false`; toggles CSP report-only mode (`true` by default outside production)
- `CSP_FRAME_ANCESTORS`: comma-separated frame ancestor sources (default `'none'`; example `'self',https://www.example.com`)
- `CSP_CONNECT_SRC`: comma-separated `connect-src` sources (default `'self'`)
- `CSP_IMG_SRC`: comma-separated `img-src` sources (default `'self',data:,https:`)
- `DATABASE_URL`: PostgreSQL connection string for migrations/seeding/smoke checks
- `DATABASE_SSL`: `true|false` (default `false`) for DB TLS
- `DATABASE_SSL_REJECT_UNAUTHORIZED`: `true|false` (default `true`) when TLS is enabled
- Dev convenience behavior: when `WHATS_NEW_DEV_AUTH_BYPASS=true` and dev role is `ADMIN`, the dev bypass user is auto-added to publisher allowlist at runtime (non-production only).

## Publisher allowlist configuration (MVP)
- Primary control: `WHATS_NEW_PUBLISHER_ALLOWLIST_USER_IDS`.
- Fallback only: `WHATS_NEW_PUBLISHER_ALLOWLIST_EMAILS` (exact match, lowercase recommended).
- Add a publisher: append their stable internal user ID to `WHATS_NEW_PUBLISHER_ALLOWLIST_USER_IDS` (comma-separated).
- Remove a publisher: remove their user ID from `WHATS_NEW_PUBLISHER_ALLOWLIST_USER_IDS`.
- Apply changes: restart the service after env changes so config is reloaded.
- Security note: there is no UI to manage publisher allowlist entries in MVP; configuration is env-only to reduce accidental privilege escalation risk.
- Commit-safe examples only: never commit real employee emails, tokens, or credentials.

## Security defaults included
- Admin-only access enforced server-side on `/whats-new`, `/api/whats-new`, and `/api/admin/whats-new`
- Tenant context and allowlist gate enforced server-side
- Non-allowlisted tenants receive `404`
- Publisher allowlist gate enforced on admin CRUD endpoints
- Security headers + strict CSP on HTML routes under `/whats-new*` and `/admin/whats-new*`
- Markdown rendering blocks raw HTML and sanitizes output
- Logging is structured and safe by default (redacts body fields, auth/cookie headers, and secret-like values)
- CSRF token required on mutating admin endpoints
- API rate limiting on read and publisher mutating endpoints (generic `429` response with `Retry-After`)
- Read API cache headers are private by default (`Cache-Control: private, max-age=30, stale-while-revalidate=60`)

## Security headers and CSP
- Applied on HTML responses for What’s New reader/publisher surfaces (`/whats-new*`, `/admin/whats-new*`).
- Baseline headers:
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()`
  - `X-Frame-Options: DENY`
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Resource-Policy: same-site`
  - `Strict-Transport-Security` only in production
- CSP defaults (strict):
  - `default-src 'none'`
  - `base-uri 'none'`
  - `object-src 'none'`
  - `frame-ancestors` from `CSP_FRAME_ANCESTORS` (default `'none'`)
  - `script-src 'self'`
  - `style-src 'self'`
  - `img-src` from `CSP_IMG_SRC` (default `'self' data: https:`)
  - `font-src 'self' data: https:`
  - `connect-src` from `CSP_CONNECT_SRC` (default `'self'`)
  - `frame-src 'none'`
  - `form-action 'self'`
  - `upgrade-insecure-requests` in production
- Environment behavior:
  - Production enforces `Content-Security-Policy` by default.
  - Non-production defaults to `Content-Security-Policy-Report-Only` to reduce local tooling breakage risk.
  - `WHATS_NEW_CSP_REPORT_ONLY` can override either mode for staged rollout.
- Safe extension guidance:
  - Prefer explicit origins over wildcards (for example, `https://api.example.com` instead of `https:` or `*` for `connect-src`).
  - Keep `frame-ancestors` strict (`'none'` or minimal trusted origins).
  - Avoid `unsafe-inline` and `unsafe-eval` in production; they materially weaken XSS protections.

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
- `POST /api/whats-new/seen`

Admin API (admin + allowlisted tenant + publisher allowlist + CSRF token for mutating methods):
- `GET /api/admin/whats-new/posts?status=draft|published&tenant_id=<current-tenant|global>&limit=20&offset=0`
- `GET /api/admin/whats-new/posts/:id`
- `POST /api/admin/whats-new/preview`
- `POST /api/admin/whats-new/posts`
- `PUT /api/admin/whats-new/posts/:id`
- `POST /api/admin/whats-new/posts/:id/publish`
- `POST /api/admin/whats-new/posts/:id/unpublish`

## API rate limiting and cache behavior
- Scope key: per `(tenant_id, user_id)` when available, otherwise by IP fallback.
- Read endpoints (`GET /api/whats-new/*`) and `POST /api/whats-new/seen` use read policy (`RATE_LIMIT_READ_PER_MIN`, default `120/min`).
- Publisher mutating admin endpoints (`POST`/`PUT` on `/api/admin/whats-new/*`) use write policy (`RATE_LIMIT_WRITE_PER_MIN`, default `30/min`).
- Exceeded limits return `429` with a generic body (`{ "error": "Too many requests" }`) and include `Retry-After`.
- API responses expose `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers.
- Read GET endpoints return:
  - `Cache-Control: private, max-age=30, stale-while-revalidate=60`
  - `Vary: Authorization, x-user-id, x-tenant-id`
  - weak `ETag`; matching `If-None-Match` requests return `304`.
- Production note: current limiter store is in-memory and therefore per app instance. Multi-instance deployments should use a shared store (for example Redis) to keep limits globally consistent.

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
