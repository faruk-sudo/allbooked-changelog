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
- Public changelog list (disabled by default): `http://localhost:3000/changelog`
- Public changelog detail: `http://localhost:3000/changelog/:slug`
- Public changelog RSS feed (disabled by default): `http://localhost:3000/rss`

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
- `PUBLIC_CHANGELOG_ENABLED`: `true|false`; enables public `/changelog` surface (default `false`, returns `404` when disabled)
- `PUBLIC_CHANGELOG_NOINDEX`: `true|false`; when enabled, public HTML responses include `X-Robots-Tag: noindex, nofollow` (default `true`)
- `PUBLIC_SURFACE_CSP_ENABLED`: `true|false`; applies strict HTML CSP profile to public HTML surfaces (default `true`)
- `PUBLIC_SITE_URL`: canonical base URL for absolute public links/canonical tags/RSS item links (`PUBLIC_SITE_URL` preferred; falls back to `BASE_URL`; required for `/rss`)
- `BASE_URL`: backward-compatible fallback when `PUBLIC_SITE_URL` is unset
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
- `PUBLIC_SITE_URL`/`BASE_URL` validation:
  - must be an absolute `http(s)` URL
  - production requires `https`
  - non-production allows `http://localhost`/loopback for local testing
  - trailing slash is trimmed (for example `https://updates.example.com/` -> `https://updates.example.com`)

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
- Public changelog remains hidden by default (`/changelog` and `/rss` return `404` unless explicitly enabled)
- Public changelog HTML responses use shared-cache-friendly headers (`Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`)
- Public RSS responses use `application/rss+xml; charset=utf-8` and the same shared-cache header policy
- Markdown rendering blocks raw HTML and sanitizes output
- Logging is structured and safe by default (redacts body fields, auth/cookie headers, and secret-like values)
- CSRF token required on mutating admin endpoints
- API rate limiting on read and publisher mutating endpoints (generic `429` response with `Retry-After`)
- Read API cache headers are private by default (`Cache-Control: private, max-age=30, stale-while-revalidate=60`)

## Security headers and CSP
- Applied on HTML responses for What’s New reader/publisher surfaces (`/whats-new*`, `/admin/whats-new*`) and optional public HTML surfaces (`/changelog*` when enabled).
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
  - `PUBLIC_SURFACE_CSP_ENABLED` controls whether the same strict HTML CSP is attached to public HTML routes (`/changelog*`). `/rss` is XML and intentionally omits HTML CSP.
- Safe extension guidance:
  - Prefer explicit origins over wildcards (for example, `https://api.example.com` instead of `https:` or `*` for `connect-src`).
  - Keep `frame-ancestors` strict (`'none'` or minimal trusted origins).
  - Avoid `unsafe-inline` and `unsafe-eval` in production; they materially weaken XSS protections.

## Database setup and migrations
1. Start PostgreSQL locally (Docker example):
```bash
docker run --name allbooked-changelog-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=allbooked_changelog \
  -p 5432:5432 \
  -d postgres:16
```
2. Ensure `DATABASE_URL` points to an existing database.
If port `5432` is already in use, run Postgres on `5433` and update `DATABASE_URL` accordingly.
3. Run schema migrations:
```bash
npm run db:migrate
```
4. (Optional, dev-only) seed sample published changelog posts:
```bash
npm run db:seed:dev
```
5. (Optional) inspect read-query plans:
```bash
npm run db:explain:reads
```
Set `EXPLAIN_TENANT_ID`, `EXPLAIN_USER_ID`, `EXPLAIN_SLUG`, `EXPLAIN_FEED_LIMIT`, `EXPLAIN_CURSOR_PUBLISHED_AT`, and `EXPLAIN_CURSOR_ID` to override defaults.
6. (Optional) roll back most recent migration:
```bash
npm run db:migrate:down
```
7. (Optional) roll back multiple migrations:
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

## Ops runbooks
- Backup/restore and DR drill: `docs/ops/backup-restore.md`
- Observability baseline and alert starters: `docs/ops/observability.md`

## API endpoints
Read API (admin + allowlisted tenant):
- `GET /api/whats-new/posts?limit=20&cursor=<opaque-cursor>` (server cap: `limit <= 50`)
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
- Public HTML changelog pages (`/changelog`, `/changelog/:slug`) return:
  - `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`
  - optional `X-Robots-Tag: noindex, nofollow` when `PUBLIC_CHANGELOG_NOINDEX=true`
- Public RSS feed (`/rss`) returns:
  - `Content-Type: application/rss+xml; charset=utf-8`
  - `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`
  - absolute links using `PUBLIC_SITE_URL` (or `BASE_URL` fallback)
- Production note: current limiter store is in-memory and therefore per app instance. Multi-instance deployments should use a shared store (for example Redis) to keep limits globally consistent.

## Public surface rollout (Phase 5B + 5C)
- Default-safe rollout posture:
  - `PUBLIC_CHANGELOG_ENABLED=false`
  - `PUBLIC_CHANGELOG_NOINDEX=true`
- Public route implementation:
  - list page: `GET /changelog`
  - detail page: `GET /changelog/:slug`
  - RSS feed: `GET /rss`
  - implementation: `src/changelog/public-routes.ts`
  - RSS implementation: `src/changelog/rss-routes.ts` + `src/changelog/rss.ts`
  - data access: `listPublicPosts` and `findPublicPostBySlug` in `src/changelog/repository.ts`
- Public policy boundary:
  - `status='published'`
  - `visibility='public'`
  - `tenant_id IS NULL` (global-only MVP public scope)
- Public routes reject `status`/`visibility`/`tenant_id` query overrides to avoid policy bypass from request parameters.
- Pagination behavior:
  - query params: `page` and `limit`
  - server cap: `limit <= 50`
  - ordering: `published_at DESC, id DESC`
- RSS behavior:
  - query param: optional `limit`
  - default: `20`
  - server cap: `limit <= 50`
  - ordering: `published_at DESC, id DESC`
  - RSS description is sanitized HTML excerpt wrapped in CDATA
- Caching rationale:
  - public pages are cacheable at CDN/shared layers
  - short `max-age` + `s-maxage` + `stale-while-revalidate` reduces origin load while keeping updates fresh
- Recommended staging rollout:
  1. Enable `PUBLIC_CHANGELOG_ENABLED=true`
  2. Keep `PUBLIC_CHANGELOG_NOINDEX=true`
  3. Verify headers with `curl -I http://localhost:3000/changelog`
  4. Verify detail headers with `curl -I http://localhost:3000/changelog/<public-slug>`
  5. Verify RSS with `curl -i http://localhost:3000/rss`
  6. Disable noindex only when public launch is ready (`PUBLIC_CHANGELOG_NOINDEX=false`)

Audit log behavior:
- All state-changing admin endpoints write to `changelog_audit_log`.
- Audit metadata stores summaries only (e.g. `changed_fields`, status transitions), never markdown bodies.

## Current app data source
- `src/server.ts` uses Postgres-backed changelog repository (`changelog_posts`, `changelog_audit_log`, `changelog_read_state`).
- `/whats-new` renders the list feed client-side from `GET /api/whats-new/posts`.
- `/whats-new/:slug` resolves on the server, enforces published/authenticated + tenant scope, and renders markdown through the shared sanitization pipeline.
- `/changelog` and `/changelog/:slug` resolve on the server, enforce published/public/global-only scope, and render markdown through the same sanitization pipeline used by What’s New.
- `/rss` resolves on the server, enforces published/public/global-only scope, and emits RSS 2.0 XML with sanitized descriptions and absolute links.

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
