# What's New Trigger Contract (Phase 5D)

## Deep-link trigger (canonical)

Use query-param deep links to open the in-app drawer once on page load:

- `?whats_new=1` (canonical)
- `#whats-new` (compatibility alias)

Behavior:

- If the drawer surface is available and the user is eligible, the panel opens automatically.
- If the current page is the full-page list (`/whats-new`) without a drawer surface, the client redirects to the latest detail route and opens the drawer there.
- After a successful deep-link open, the client removes the trigger query/hash with `history.replaceState` so refresh/back does not re-open from the same URL entry.

## Release notes link format

Recommended internal link contract:

- `/<current-in-app-route>?whats_new=1`

Example:

- `/whats-new/some-post?whats_new=1`

This is safe for normal click and new-tab behavior. New tab loads the route, processes the trigger once, and opens the panel.

## Programmatic API (v1)

When the app shell is loaded, the client exposes:

```ts
window.AllBookedWhatsNew = {
  version: "v1",
  open: () => void,
  close: () => void,
  toggle: () => void
}
```

Contract:

- `open()` and `toggle()` reuse the same panel-open path as manual clicks.
- If the panel is unavailable/blocked on that page, calls are silent no-ops.
- No internal gating state is exposed through this API.

## Security posture

- Server-side guards remain authoritative (`ADMIN`, tenant allowlist, kill switch).
- Trigger inputs only request a single action ("open once"); no arbitrary commands are accepted.
- Ineligible users still get generic blocked responses (`404`) from existing guards without allowlist/admin detail leakage.
