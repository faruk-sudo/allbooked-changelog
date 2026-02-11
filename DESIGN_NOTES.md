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

## Design system neutral refresh (February 11, 2026)

### Decisions

1. Kept the existing token pipeline (`tokens.json` -> `scripts/generate-token-css.mjs` -> `src/styles/tokens.css`) and avoided a theming-engine rewrite.
2. Introduced a neutral-first primitive scale (`neutral.0` to `neutral.950`) and remapped semantic light/dark tokens so backgrounds, surfaces, borders, text, focus, and primary actions are monochrome by default.
3. Added semantic state/link/status coverage needed by components:
   - `link` tokens for text links (separate from button-primary)
   - `active` tokens for button/action states
   - retained `danger/success/warning` and added `info` to preserve functional affordances.
4. Preserved token purity by keeping raw color literals in token files only and updating component styles to consume semantic variables.

### Tradeoffs

- We kept status colors muted rather than fully monochrome because removing color from all status affordances would reduce scanability and increase accessibility risk.
- We used neutral focus rings (instead of brand accent rings) to fit the monochrome goal while remaining visible in both light and dark themes.

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
- Endpoint-level rate limiting was deferred in Phase 1.4 and implemented later in Phase 4A (shared middleware + configurable limits).

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

## Phase 2.1 bottom-bar unread entry point

- Added a reusable nav badge primitive in the What's New page shell (`renderNavBadgeDot` in `src/changelog/routes.ts`) so the same shape can evolve into count badges later.
- Dot styling is token-driven in `src/styles/whats-new.css`:
  - size: `--space-2`
  - radius: `--radius-pill`
  - color: `--color-primary-bg`
  - nav spacing/surface/focus behavior reuse existing primitives from `src/styles/primitives.css` (`ds-button`, focus ring tokens).
- Accessibility: when unread is true, visually hidden copy (`New updates available`) is exposed and link `aria-label` includes the same cue.

## Phase 2.2 in-app side panel feed

### Decisions

1. Keep the current server-rendered Express route architecture and implement `WhatsNewPanel`/`WhatsNewFeedItem` as route-level render helpers + progressive client behavior (no new bundler/runtime dependencies).
2. Reuse existing read endpoint (`GET /api/whats-new/posts`) with `limit` + cursor-as-offset pagination; default client page size is `12`.
3. Keep server-side feed query deterministic (`published_at DESC, id DESC`) and align in-memory repository sorting to the same order for test parity.
4. Ensure drawer accessibility in the client controller:
   - `role=\"dialog\"` + `aria-modal=\"true\"`
   - close button, ESC close, overlay click close
   - focus trap while open
   - focus return to trigger on close
5. Keep read-state untouched in this phase: opening the panel only reads list data and unread indicator; no read-state mutation is performed.

### Styling approach

- Drawer/feed UI uses design-system semantic tokens and primitives (`ds-surface`, `ds-button`, `ds-text`, `ds-stack`), with no hardcoded color values.
- Category badge tones map to semantic intent tokens:
  - `new` -> primary
  - `improvement` -> success
  - `fix` -> warning

## Phase 2.3 full-page list + drawer affordance

### Decisions

1. Promoted `/whats-new` into a true full-page feed and kept pagination semantics aligned with the drawer (`GET /api/whats-new/posts`, cursor-as-offset, client page size `12`).
2. Extracted shared route-level feed shell markup (`renderWhatsNewFeedBody`) so loading/error/empty/list/load-more structure is reused by both the full-page route and drawer panel.
3. Added an explicit drawer header affordance to open `/whats-new` in a new tab using an anchor with `target="_blank"` and `rel="noopener noreferrer"`.
4. Preserved server-side rollout and authorization gates; UI remains progressively enhanced and token-driven via existing design-system primitives.

### Styling approach

- Full-page list layout uses `ds-surface`, `ds-stack`, `ds-text`, and `ds-button` with semantic token values only.
- New full-page wrapper classes (`wn-list-feed*`) reuse the same feed-item styles already used by the drawer.

## Phase 2.4 read-state mutation on feed open

### Decisions

1. Added a dedicated read-state endpoint on the existing read router: `POST /api/whats-new/seen`.
2. Kept authorization and rollout gating centralized through existing guards (`requireAdmin`, kill switch + tenant allowlist via `requireWhatsNewEnabled`), preserving safe `404` behavior for blocked tenants.
3. Enforced CSRF on this mutating endpoint with existing middleware (`requireCsrfToken`); client script now sends `x-csrf-token`.
4. Implemented server-time upsert in repository (`INSERT ... ON CONFLICT ... DO UPDATE`) keyed by `(tenant_id, user_id)` and ignored client-provided timestamps in v1.
5. Preserved unread semantics: unread remains based on latest scoped published post timestamp (`tenant + global`, `status='published'`, `visibility='authenticated'`) compared to `last_seen_at`.
6. Wired panel/page behavior in the existing progressive client controller:
   - mark seen on side-panel open
   - mark seen on list page load (`/whats-new`)
   - debounce writes for 60s when already read to avoid toggle spam
   - when inside debounce window, re-check unread state first and only write again if new posts are detected
   - fail-safe behavior: unread dot only clears after successful `/seen`.

## Phase 2.5 instrumentation (panel + full-page + detail)

### Decisions

1. Added a small analytics module (`src/analytics/events.ts`, `src/analytics/tracker.ts`) as the single source of truth for:
   - allowed event names
   - event/property allowlists + required fields
   - forbidden/redacted keys
2. Kept runtime integration dependency-free:
   - browser wrapper uses `window.allbookedAnalytics.track(eventName, properties)` when present
   - no provider configured => silent no-op (no UX impact)
3. Applied strict payload minimization and privacy defaults:
   - tenant is emitted as hashed `tenant_id` (`sha256:<digest>`)
   - no titles, body content, emails, IPs, tokens, headers, or raw error text
4. Wired events on user intent points:
   - panel open, full-page mount, detail open, mark-seen success/failure, load-more click
   - detail open source (`panel` vs `page`) is carried via short-lived `sessionStorage` handoff from feed link click
5. Added analytics consumer notes in `docs/analytics.md` with event definitions and starter query patterns.

## Phase 3A (3.1) publisher admin list UI

### Decisions

1. Added a dedicated internal route at `/admin/whats-new` mounted separately from API routes.
2. Reused existing server-side authz controls for safe gating:
   - admin required
   - tenant allowlist + kill switch required
   - publisher allowlist required (`404` for non-publisher admins)
3. Kept list data sourcing on `GET /api/admin/whats-new/posts` and extended it with a server-side `q` filter (title/slug partial match) so pagination remains correct.
4. Implemented default admin list sorting as:
   - published first by `published_at DESC` (fallback `updated_at`)
   - drafts by `updated_at DESC`
5. Added placeholder navigation routes only (`/admin/whats-new/new`, `/admin/whats-new/:id/edit`) for Phase 3B handoff.

### Components and token usage

- `AdminPostsTable` (`/admin/whats-new` table shell + row rendering):
  - purpose: internal browse/filter/search surface for draft/published posts
  - tokens used: `--color-surface-*`, `--color-border-*`, `--color-text-*`, `--space-*`, `--font-size-*`, `--font-weight-*`
- `AdminStatusPill` (`wn-admin-pill--draft`, `wn-admin-pill--published`):
  - purpose: high-signal status visibility in list rows
  - tokens used: `--color-warning-*` (draft), `--color-success-*` (published), `--radius-pill`, `--font-size-xs`
- `AdminCategoryPill` (`wn-admin-pill--category-*`):
  - purpose: category tag (`new`/`improvement`/`fix`) in list rows
  - tokens used: `--color-primary-*`, `--color-success-*`, `--color-warning-*`, `--radius-pill`
- `AdminFilters` (`wn-admin-input`, `wn-admin-select`):
  - purpose: status + scope + search controls
  - tokens used: `--color-surface-base`, `--color-border-default`, `--color-focus-ring`, `--color-focus-offset`, `--space-*`, `--radius-md`

## Phase 3B (3.2) publisher create/edit draft UI

### Decisions

1. Replaced placeholder routes with guarded internal authoring pages:
   - `GET /admin/whats-new/new`
   - `GET /admin/whats-new/:id/edit`
2. Added admin detail + preview API endpoints behind existing publisher/admin/allowlist/kill-switch guards:
   - `GET /api/admin/whats-new/posts/:id`
   - `POST /api/admin/whats-new/preview`
3. Kept preview sanitization aligned with reader surfaces by reusing `renderMarkdownSafe` from `src/security/markdown.ts`.
4. Implemented slug UX in the editor client:
   - auto-generate from title by default
   - stop auto-overwriting once manually edited
   - validate pattern/length client-side
   - map `409 slug already exists` responses to inline slug errors + suggested alternative.
5. Added dirty-form navigation protection (`beforeunload` + internal link confirm) for accidental navigation.
6. Updated draft content rules so empty title/body can be saved while draft, but publishing now enforces both fields server-side.

### Design-system component usage

- `MarkdownEditor` (`.wn-admin-textarea`)
- `PreviewPane` (`.wn-admin-editor-preview-pane`, `.wn-admin-editor-preview-body`)
- `FormField` (`.wn-admin-field`, `.wn-admin-input`, `.wn-admin-select`)
- `InlineError` (`.wn-admin-inline-error`)
- `EditorBanner` (`.wn-admin-editor-banner--success|error|warning`)

All styling remains token-driven via semantic variables (`--color-*`, `--space-*`, `--radius-*`, `--font-*`) in `src/styles/whats-new-admin.css`.

## Phase 3C (3.3 + 3.4 + 3.5 docs) publish/unpublish guardrails

### Decisions

1. Implemented publish/unpublish actions only on the edit route (`/admin/whats-new/:id/edit`) for the safest MVP surface area; list rows continue to route users into edit.
2. Added required confirmation dialog before status transitions:
   - publish confirmation includes audience context
   - global-scope drafts show stronger global warning
   - unpublish confirmation clarifies that visibility is removed and status returns to draft
3. Chose explicit `Save & Publish` sequencing when unsaved edits exist, rather than auto-publishing stale server state.
4. Added client-side publish guardrails with field + summary errors:
   - required on publish: `title`, `category`, `body_markdown`, valid `slug`
   - max lengths: `title <= 140`, `slug <= 100`, `body_markdown <= 50_000`
5. Added safe error mapping in the editor client:
   - `400` -> field/bucketed validation messages
   - `401/403` -> safe access message
   - `404` -> not found
   - `409` slug conflict -> inline slug error + one-click suggestion
   - `5xx` -> generic retry message
6. Kept server-side authorization/tenant/CSRF guards unchanged and added minimal failure telemetry in admin routes (`route`, `actorId`, `tenantId`, `postId`, `statusCode`, `errorType`) without request bodies or markdown content.
7. Documented publisher allowlist operations as env-only (no UI management in MVP) in `README.md` and `.env.example` comments.

## Phase 4.1 security headers + CSP hardening

### Decisions

1. Replaced the static Helmet config with a centralized, env-aware builder in `src/security/headers.ts` so directives remain readable and auditable in one place.
2. Scoped CSP/header middleware to What’s New HTML surfaces only (`/whats-new*`, `/admin/whats-new*`) by attaching it inside reader/publisher routers and removing it from shared API guards.
3. Hardened default CSP posture:
   - `default-src 'none'`
   - `base-uri 'none'`
   - `object-src 'none'`
   - `frame-ancestors` configurable, default `'none'`
   - `script-src 'self'` and `style-src 'self'` (no `unsafe-inline`/`unsafe-eval` in production)
4. Added baseline response headers via Helmet for HTML routes:
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy` disables geolocation/microphone/camera/payment
   - `X-Frame-Options: DENY`
   - `Cross-Origin-Opener-Policy: same-origin`
   - `Cross-Origin-Resource-Policy: same-site`
   - `Strict-Transport-Security` enabled only in production
5. Chose environment-aware CSP behavior for safer rollout:
   - production defaults to enforced CSP
   - non-production defaults to `Content-Security-Policy-Report-Only`
   - `WHATS_NEW_CSP_REPORT_ONLY` allows explicit override in any environment
6. Added future-proof configuration knobs with safe defaults in `loadConfig` and `.env.example`:
   - `CSP_FRAME_ANCESTORS`
   - `CSP_CONNECT_SRC`
   - `CSP_IMG_SRC`
7. Added automated route tests validating header presence and key CSP directives, including enforce vs report-only toggle coverage.

## Phase 4A (4.2 + 4.3 slice) API rate limiting + read caching headers

### Decisions

1. Added a reusable rate-limit module (`src/security/rate-limit.ts`) with a pluggable store interface so the current in-memory strategy can be swapped to Redis/shared cache without route rewrites.
2. Chose `(tenant_id, user_id)` as the primary key, with IP fallback when identity context is unavailable.
3. Applied policies by route role:
   - read endpoints (`GET /api/whats-new/*`): `120/min` default
   - read-state write (`POST /api/whats-new/seen`): same read policy (`120/min` default)
   - publisher mutating admin endpoints (`POST`/`PUT`): `30/min` default
4. Added env controls with safe defaults:
   - `RATE_LIMIT_ENABLED` (default `true`)
   - `RATE_LIMIT_READ_PER_MIN` (default `120`)
   - `RATE_LIMIT_WRITE_PER_MIN` (default `30`)
5. On limit exceed, API now returns generic `429` (`{ error: "Too many requests" }`) and sets `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`.
6. Added read-endpoint cache headers (`GET /api/whats-new/posts`, `GET /api/whats-new/posts/:slug`, `GET /api/whats-new/unread`) with secure defaults:
   - `Cache-Control: private, max-age=30, stale-while-revalidate=60`
   - `Vary: Authorization, x-user-id, x-tenant-id`
   - weak `ETag` support with `304` on matching `If-None-Match`
7. Kept caching private-only to avoid shared cache cross-tenant/user leakage while still reducing repeated in-app fetch load.

### Tradeoffs and follow-ups

- In-memory limiting is per-process only; multi-instance production should use a shared store for globally consistent enforcement.
- ETag values are response-payload based (deterministic JSON hash), which is simple and robust for this phase; future public feeds may prefer version/timestamp-derived tags.

## Phase 4B (4.3 remainder) read-path performance + scalability checks

### Decisions

1. Switched reader feed pagination from offset/cursor-as-offset to keyset cursor pagination using deterministic sort keys:
   - order: `published_at DESC, id DESC`
   - cursor payload: opaque token containing `{ published_at, id }`
   - next page filter: `(published_at, id) < (cursor.published_at, cursor.id)`
2. Kept strict server-side read limits:
   - default `20`
   - hard cap `50`
   - invalid cursor/limit values return `400`
3. Preserved exact reader scope in all read paths:
   - `(tenant_id = currentTenant OR tenant_id IS NULL)`
   - `status = 'published'`
   - `visibility = 'authenticated'`
4. Reduced feed query payload and avoided expensive per-item rendering:
   - feed list does not render markdown to HTML
   - feed list reads only a truncated markdown source (`left(body_markdown, 1200)`) and returns excerpt text
   - detail endpoint renders sanitized HTML for one post only
5. Added index-alignment migration (`0003_read_query_indexes`) to match read filters + sort:
   - `(tenant_id, status, visibility, published_at DESC, id DESC)`
   - `(status, visibility, published_at DESC, id DESC)`
6. Added lightweight local query-plan script (`npm run db:explain:reads`) for feed/detail/unread `EXPLAIN (ANALYZE, BUFFERS)` checks.

### Canonical read query shapes

- Feed list (reader API):
```sql
SELECT id, category, title, slug, published_at, left(body_markdown, 1200)
FROM changelog_posts
WHERE status = 'published'
  AND visibility = 'authenticated'
  AND published_at IS NOT NULL
  AND (tenant_id = $tenant OR tenant_id IS NULL)
  AND (published_at, id) < ($cursor_published_at, $cursor_id) -- when cursor present
ORDER BY published_at DESC, id DESC
LIMIT $limit_plus_one;
```

- Detail by slug:
```sql
SELECT ...
FROM changelog_posts
WHERE slug = $slug
  AND status = 'published'
  AND visibility = 'authenticated'
  AND (tenant_id = $tenant OR tenant_id IS NULL)
LIMIT 1;
```

- Unread existence:
```sql
SELECT EXISTS (
  SELECT 1
  FROM changelog_posts
  WHERE status = 'published'
    AND visibility = 'authenticated'
    AND published_at IS NOT NULL
    AND (tenant_id = $tenant OR tenant_id IS NULL)
    AND published_at > COALESCE(
      (SELECT last_seen_at FROM changelog_read_state WHERE tenant_id = $tenant AND user_id = $user LIMIT 1),
      to_timestamp(0)
    )
) AS has_unread;
```

### Why no rendered-HTML caching yet

- This phase prioritized correctness, bounded query work, and payload reductions first.
- Caching rendered HTML safely will require explicit invalidation keys (revision + tenant scope + visibility + sanitizer/version), which is better handled in a later phase to avoid stale/cross-scope content risk.

## Phase 4C (4.4 + 4.5) operational readiness package

### Decisions

1. Added explicit operations runbooks under `docs/ops/`:
   - `backup-restore.md` for Postgres backup/restore + validation drills
   - `observability.md` for baseline monitoring, alerts, and logging safety rules
2. Upgraded existing `GET /healthz` from static response to dependency-aware health:
   - response shape is now `{ ok: true|false }`
   - server wiring performs DB ping (`SELECT 1`) through an injected `healthCheck` dependency
   - failure returns `503` without disclosing internal config
3. Kept instrumentation lightweight:
   - no new metrics framework introduced in this phase
   - documented future metrics integration approach instead
4. Validation-first posture:
   - executed local backup/restore drill on February 11, 2026
   - validated restore with migration idempotency check, smoke-check, table count checks, and live read endpoint probes

## Phase 5A (5.0) public-surface readiness toggle

### Decisions

1. Added a canonical public URL resolver (`src/config/public-url.ts`) to standardize absolute URL generation:
   - prefers `PUBLIC_SITE_URL`, falls back to `BASE_URL`
   - trims trailing slashes and strips query/hash
   - production requires `https`
   - non-production allows loopback `http://localhost` / `127.0.0.1` / `::1`
2. Introduced explicit public-surface toggles in config with safe defaults:
   - `PUBLIC_CHANGELOG_ENABLED=false`
   - `PUBLIC_CHANGELOG_NOINDEX=true`
   - `PUBLIC_SURFACE_CSP_ENABLED=true`
3. Added a reusable public policy module (`src/changelog/public-surface.ts`) that sets an immutable boundary for future public routes:
   - `status='published'`
   - `visibility='public'`
   - `tenant_id IS NULL` (global-only MVP public scope)
   - request query overrides for `status`, `visibility`, and `tenant_id` are rejected
4. Added shared public response header helpers for future `/changelog` and `/rss`:
   - `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`
   - optional `X-Robots-Tag: noindex, nofollow` when noindex toggle is enabled
5. Added a minimal `/changelog` placeholder route (`src/changelog/public-routes.ts`) behind the readiness toggle:
   - returns `404` when disabled to avoid feature discovery
   - returns simple HTML placeholder when enabled with no public content exposure
   - applies same strict HTML CSP as existing What’s New surfaces when `PUBLIC_SURFACE_CSP_ENABLED=true`

## Phase 5B (5.1) public HTML changelog list + detail

### Decisions

1. Replaced the Phase 5A placeholder with real public pages:
   - `GET /changelog` list page
   - `GET /changelog/:slug` detail page
   - implementation in `src/changelog/public-routes.ts`
2. Enforced the public boundary in repository reads (not only in route middleware):
   - `status='published'`
   - `visibility='public'`
   - `tenant_id IS NULL` (global-only MVP)
   - new repository APIs: `listPublicPosts` and `findPublicPostBySlug` in `src/changelog/repository.ts`
3. Reused the same markdown sanitization pipeline as authenticated surfaces:
   - detail pages render via `renderMarkdownSafe` (`src/security/markdown.ts`)
   - no separate sanitizer config was introduced
4. Kept safe rollout controls from Phase 5A and applied them consistently:
   - readiness gate (`PUBLIC_CHANGELOG_ENABLED`) returns safe `404` when off
   - noindex header/meta (`PUBLIC_CHANGELOG_NOINDEX`)
   - shared public cache headers (`public, max-age=60, s-maxage=300, stale-while-revalidate=600`)
   - strict HTML CSP reuse for `/changelog*` when `PUBLIC_SURFACE_CSP_ENABLED=true`
5. Implemented simple server-rendered page pagination for the public list:
   - query params: `page`, `limit`
   - hard cap: `limit <= 50`
   - ordering: `published_at DESC, id DESC`
6. Added a dedicated token-based public stylesheet (`src/styles/public-changelog.css`) that follows the neutral design tokens and preserves accessible focus/link states.
