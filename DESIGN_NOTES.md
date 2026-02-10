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
