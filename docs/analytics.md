# What's New Analytics (Phase 2.5)

## Event taxonomy

All event names are fixed and snake_case:

- `whats_new.open_panel`
- `whats_new.open_full_page`
- `whats_new.open_post`
- `whats_new.mark_seen_success`
- `whats_new.mark_seen_failure`
- `whats_new.load_more`

Source of truth for runtime schema + allowlist + redaction:

- `src/analytics/events.ts`
- `src/analytics/tracker.ts`

Runtime provider behavior:

- The browser calls `window.allbookedAnalytics.track(name, props)` only when that object exists.
- If no provider is configured, tracking is a silent no-op by design.

## Property contract

Common properties (included when available):

- `surface`: `"panel"` or `"page"`
- `tenant_id`: hashed tenant identifier (`sha256:<digest>`)
- `user_id`: internal stable ID only (never email)
- `post_id`: internal post ID
- `slug`: post slug (optional when `post_id` is present)

Event-specific properties:

- `result`: `"success"` or `"failure"` for mark-seen events
- `error_code`: short code only for mark-seen failure
- `pagination`:
  - `limit`: number
  - `cursor_present`: boolean
  - `page_index`: number (optional)

## Explicitly excluded data

Never emit or persist these through analytics payloads:

- Markdown or HTML body content (`body`, `body_markdown`, `markdown`, `safe_html`, etc.)
- Titles (`title`, `post_title`)
- Raw error messages / stack traces
- Email addresses
- IP addresses
- Auth tokens / cookies / headers / secrets

The tracker strips unknown keys and disallowed keys defensively before sending.

## Event meanings

- `whats_new.open_panel`: user opens the drawer panel.
- `whats_new.open_full_page`: `/whats-new` full page mounted.
- `whats_new.open_post`: user opens a post detail (`/whats-new/:slug`).
- `whats_new.mark_seen_success`: `/api/whats-new/seen` succeeded.
- `whats_new.mark_seen_failure`: `/api/whats-new/seen` failed with a safe `error_code`.
- `whats_new.load_more`: user triggered pagination via “Load more”.

## Query notes (examples)

Unique admins opening What’s New per week:

- Filter `event_name IN ('whats_new.open_panel', 'whats_new.open_full_page')`
- Group by week + `user_id`
- Count distinct `user_id`

Post opens per publish:

- Filter `event_name = 'whats_new.open_post'`
- Group by `post_id` (fallback `slug`)
- Compare against published posts table by matching `post_id`/`slug`

Seen success rate:

- Success count: `event_name = 'whats_new.mark_seen_success'`
- Failure count: `event_name = 'whats_new.mark_seen_failure'`
- Rate: `success / (success + failure)`

Load-more usage as depth proxy:

- Filter `event_name = 'whats_new.load_more'`
- Group by `surface`
- Optional depth approximation: average/max `pagination.page_index`
