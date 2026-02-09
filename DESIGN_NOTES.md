# DESIGN_NOTES

## Why this stack
- Express + TypeScript is conservative, well-understood, and easy to embed/port into an existing Node-based backend.
- Dependencies are minimal and focused on security and testability.
- The architecture keeps auth and tenant handling in middleware so real SSO/session integration can replace header stubs without changing route logic.

## Security model (v1)
### Threats addressed
- XSS from markdown: mitigated with `markdown-it` (`html: false`) and strict `sanitize-html` allowlist.
- Authz bypass: `requireAuthenticated` and `requireAdmin` are enforced on every `/whats-new` route.
- Tenant isolation failure: `requireTenantContext` + `requireAllowlistedTenant` middleware enforced server-side.
- CSRF on state changes: `requireCsrfToken` middleware is prepared for future mutating endpoints.
- Unsafe logging: route logs emit only IDs and action summaries; markdown/body fields are redacted by logger utility.

### Route behavior choices
- Not allowlisted tenant -> `404` to avoid feature exposure.
- Missing tenant context -> `400` because tenant context is required to process request.

## Rollout controls
- Kill switch: `WHATS_NEW_KILL_SWITCH=true` disables all tenant access.
- Allowlist toggle: `WHATS_NEW_ALLOWLIST_ENABLED` controls whether tenant ID checks are enforced.
- Tenant IDs: `WHATS_NEW_ALLOWLIST_TENANT_IDS` configures rollout cohort.

## Data model (seeded)
`ChangelogPost`
- `id`
- `slug`
- `title`
- `bodyMarkdown`
- `status` (`draft` | `published`)
- `publishedAt`

v1 route reads only `published` posts.

## Intended analytics events (names only, not implemented)
- `whats_new_list_viewed`
- `whats_new_post_viewed`
- `whats_new_blocked_not_admin`
- `whats_new_blocked_not_allowlisted`
- `whats_new_killswitch_blocked`

No PII payloads should be added when instrumentation is implemented.

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
