# DESIGN_NOTES

## Why this stack
- Express + TypeScript is conservative, well-understood, and easy to embed/port into an existing Node-based backend.
- Dependencies are minimal and focused on security and testability.
- The architecture keeps auth and tenant handling in middleware so real SSO/session integration can replace header stubs without changing route logic.

## Security model (v1)
### Threats addressed
- XSS from markdown: mitigated with `markdown-it` (`html: false`) and strict `sanitize-html` allowlist.
- Authz bypass: centralized What's New request context + `requireAdmin` are enforced on every `/whats-new` route.
- Tenant isolation failure: `requireWhatsNewEnabled` enforces tenant context + allowlist/kill-switch server-side.
- CSRF on state changes: `requireCsrfToken` middleware is prepared for future mutating endpoints.
- Unsafe logging: `sanitizeLogMetadata` redacts body fields, auth/cookie headers, and secret-like/env values before emitting structured logs.

### Route behavior choices
- Not allowlisted tenant -> `404` to avoid feature exposure.
- Missing tenant context -> `400` because tenant context is required to process request.

## Rollout controls
- Kill switch: `WHATS_NEW_KILL_SWITCH=true` disables all tenant access.
- Allowlist toggle: `WHATS_NEW_ALLOWLIST_ENABLED` controls whether tenant ID checks are enforced.
- Tenant IDs: `WHATS_NEW_ALLOWLIST_TENANT_IDS` configures rollout cohort.

## Data model posture

- Runtime reads/writes now use PostgreSQL changelog tables (`changelog_posts`, `changelog_read_state`, `changelog_audit_log`).
- v1 read path serves only `published` + `authenticated` posts, scoped to `(tenant_id = currentTenant OR tenant_id IS NULL)`.

## Design system foundation

### Context

The repository was empty at implementation time, so no existing UI stack, styling toolchain, or component conventions could be inferred.

### Decisions

1. Use plain CSS + React-compatible TSX primitives with zero new runtime dependencies.
2. Keep `tokens.json` as the single source of truth and generate `src/styles/tokens.css` via a small Node script.
3. Include both light and dark semantic modes with `:root` and `[data-theme="dark"]`.
4. Keep primitives intentionally small (`Text`, `Button`, `Surface`, `Stack`) and rely on semantic CSS variables only.
5. Add a smoke component (`src/pages/DesignSystemSmoke.tsx`) instead of introducing router/framework-specific wiring.

### Tradeoffs

- Chose a hand-rolled generator over an external token package to avoid dependency overhead while preserving a clear upgrade path.
- Primitive components are framework-agnostic enough for most React builds but not tied to any one app entrypoint because no existing app structure was present.

## Phase 1.1 DB schema (What's New)

### Decisions

1. Use PostgreSQL with SQL-first migrations and a minimal custom runner (`db/migrations` + `scripts/db/*`) to keep dependencies low while still supporting deterministic up/down execution.
2. Keep slugs globally unique in v1 to simplify future public URL exposure.
3. Enforce secure defaults in schema:
   - `status` default is `draft`
   - `visibility` default is `authenticated`
   - actor references are internal IDs only (no email fields)
4. Add a schema-level metadata redaction check on `changelog_audit_log` to block `body_markdown` keys from being persisted.
5. Preserve tenant-scoping primitives in every durable table (`tenant_id` on posts/read_state/audit rows) to support clean multi-tenant isolation in query and access layers.

### Retention and forward-looking notes

- Audit logs are append-oriented and should be retained according to compliance policy (exact retention window to be set with security/legal before production rollout).
- `visibility='public'` is modelled now for forward compatibility, but v1 behavior should continue to serve authenticated/admin-only content until explicitly enabled.

## Phase 1.4 API + admin CRUD

### Endpoint surface

- Read API:
  - `GET /api/whats-new/posts`
  - `GET /api/whats-new/posts/:slug`
- Admin CRUD API:
  - `GET /api/admin/whats-new/posts`
  - `POST /api/admin/whats-new/posts`
  - `PUT /api/admin/whats-new/posts/:id`
  - `POST /api/admin/whats-new/posts/:id/publish`
  - `POST /api/admin/whats-new/posts/:id/unpublish`
- UI wiring:
  - `/whats-new` page now reads from the read API.

### Security and privacy controls

1. Shared guards applied server-side to all What’s New endpoints:
   - centralized context hydration from existing header stub/dev fallback
   - `requireAdmin` for authenticated ADMIN role
   - `requireWhatsNewEnabled` for tenant context + tenant allowlist + kill switch
2. Admin CRUD endpoints require `requirePublisher` (user-id allowlist first, exact-match email fallback).
3. CSRF token validation is enforced on mutating admin methods (`POST`/`PUT`).
4. Markdown is rendered through the existing safe pipeline (`markdown-it` with raw HTML disabled + strict `sanitize-html`).
5. State-changing admin actions write through a shared audit helper that strips forbidden markdown/body keys from metadata before persistence.
6. Application logs are structured and minimal; request bodies are excluded by default, and sensitive headers/secrets are redacted.
7. Local-browser developer ergonomics use a configurable dev auth fallback (`WHATS_NEW_DEV_AUTH_BYPASS`) that auto-hydrates auth/tenant context when headers are missing; this is disabled automatically in production `NODE_ENV`.

### Observability and rollout notes

- Kill switch default stays OFF (`WHATS_NEW_KILL_SWITCH=false`) and can be toggled for immediate rollback.
- Application events are emitted as structured JSON logs via `appLogger` (safe metadata redaction applied globally).
- Durable audit events are persisted in `changelog_audit_log`; query this table for create/update/publish/unpublish traces.

### Tradeoffs and follow-ups

- Publisher allowlist is an env-driven stopgap until role-based publisher permissions are available from the identity system.
- Pagination currently supports offset/cursor-as-offset for simplicity; can evolve to opaque cursors if feed size grows.
- Endpoint-level rate limiting is not yet implemented because no shared limiter exists in this service today.

### Verification evidence (live API checks)

Verification run date: February 10, 2026.

- Read API and page:
  - `/` redirected to `/whats-new` (`302`).
  - `/whats-new` returned `200` for allowlisted admin.
  - `GET /api/whats-new/posts` returned DB records including newly created verification posts.
  - `GET /api/whats-new/posts/:slug` returned sanitized `safe_html`; script tags were escaped and no executable links were produced.
- Admin and publisher gating:
  - Non-admin request returned `403` (`Admin access required`).
  - Non-publisher admin request to CRUD returned `404` (no allowlist details leaked).
  - Publisher-allowlisted admin successfully completed create/update/publish/unpublish flow.
- Tenant allowlist and kill switch:
  - Non-allowlisted tenant returned `404`.
  - Allowlisted tenant returned `200`.
  - With `WHATS_NEW_KILL_SWITCH=true`, read/admin endpoints returned `404` even for otherwise allowlisted admins.
- Audit log checks (via Postgres):
  - `changelog_audit_log` recorded create/update/publish/unpublish actions.
  - Metadata stored summary fields only.
  - JSON path check confirmed `0` rows containing `body_markdown`/`bodyMarkdown` keys.

Issue discovered during verification:
- Publish transition initially returned `500` due enum parameter typing in SQL update path.
- Fixed in commit `511ccf7` by casting status parameter to `changelog_post_status`.

## Intended analytics events (names only, not implemented)

- `whats_new_api_posts_listed`
- `whats_new_api_post_viewed`
- `whats_new_admin_posts_listed`
- `whats_new_admin_post_created`
- `whats_new_admin_post_updated`
- `whats_new_admin_post_published`
- `whats_new_admin_post_unpublished`

No PII payloads should be added when instrumentation is implemented.
