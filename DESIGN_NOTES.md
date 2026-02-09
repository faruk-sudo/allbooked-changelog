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
