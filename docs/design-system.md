# Design System Foundation

## Token Strategy

This repo uses a token-first model with two layers:

1. `primitive` tokens in `tokens.json`
2. `semantic` tokens in `tokens.json`

Primitive tokens define raw values (palette, spacing, radii, typography, shadows, z-index).  
Semantic tokens map intent (`bg`, `surface`, `text`, `border`, `primary`, `secondary`, `danger`, `success`, `warning`, `focus`, `disabled`) to primitives and support theme overrides (`light`, `dark`).

Use semantic tokens in components. Avoid direct primitive color usage in component CSS.

## Token to CSS Variables

- Source of truth: `tokens.json`
- Generator: `scripts/generate-token-css.mjs`
- Output: `src/styles/tokens.css`

Run:

```bash
node scripts/generate-token-css.mjs
```

Then include:

```css
@import "./styles/design-system.css";
```

Dark mode works with:

```html
<html data-theme="dark">
```

## Primitive Components

Exports from `src/components/primitives/index.ts`:

- `Text`
- `Button`
- `Surface`
- `Stack`

Usage example:

```tsx
import { Button, Stack, Surface, Text } from "../components/primitives";

export function Example() {
  return (
    <Surface>
      <Stack gap="4">
        <Text as="h2" variant="heading">
          Title
        </Text>
        <Text variant="body">Body content</Text>
        <Button variant="primary">Save</Button>
      </Stack>
    </Surface>
  );
}
```

## What's New Components

Phase 2.2 and 2.3 introduce shared feature-level components for the in-app drawer feed and full-page list:

- `WhatsNewPanel`
- `WhatsNewFeedItem`
- `WhatsNewFeedBody` (shared loading/error/empty/list/load-more shell)

Implementation notes for this repo's server-rendered setup:

- `src/changelog/routes.ts`:
  - `renderWhatsNewPanel()` renders the dialog shell (`role="dialog"`, `aria-modal`, close control, loading/empty/error states, and load-more action).
  - `renderWhatsNewFeedBody()` renders shared feed states and list controls for both the panel and `/whats-new` full-page list.
  - client-side `renderWhatsNewFeedItem(post)` renders each post card safely with text-only excerpt output and category badge.
  - drawer header includes an explicit full-page affordance (`Open full page (new tab)`).
- `src/styles/whats-new.css` provides token-driven styling for panel layout, category badges, and feed cards while reusing primitives (`ds-surface`, `ds-button`, `ds-text`, `ds-stack`).

Token dependencies used by these components:

- Surfaces/borders: `--color-surface-base`, `--color-surface-raised`, `--color-surface-sunken`, `--color-border-subtle`
- Typography: `--font-size-xs`, `--font-size-lg`, `--font-weight-semibold`, `--line-height-tight`
- Spacing/radius: `--space-*`, `--radius-none`, `--radius-pill`
- Badge semantics:
  - `new`: `--color-primary-bg` / `--color-primary-fg`
  - `improvement`: `--color-success-bg` / `--color-success-fg`
  - `fix`: `--color-warning-bg` / `--color-warning-fg`
- Interaction/focus: existing primitive button focus ring tokens (`--color-focus-ring`, `--color-focus-offset`)
- Layering/shadow: `--z-overlay`, `--z-modal`, `--shadow-md`

## What's New Publisher Draft Editor (Phase 3B)

Internal draft authoring routes (`/admin/whats-new/new`, `/admin/whats-new/:id/edit`) use tokenized feature components rendered from `src/changelog/publisher-routes.ts` with styles in `src/styles/whats-new-admin.css`.

Feature component map:

- `MarkdownEditor` (`#whats-new-editor-body`, `.wn-admin-textarea`):
  - purpose: internal markdown authoring surface for draft content.
  - tokens: `--color-surface-base`, `--color-border-default`, `--color-focus-ring`, `--space-*`, `--font-family-mono`, `--radius-md`.
- `PreviewPane` (`#whats-new-editor-preview`, `.wn-admin-editor-preview-*`):
  - purpose: live preview rendered from server-sanitized markdown (`POST /api/admin/whats-new/preview`).
  - tokens: `--color-surface-base`, `--color-surface-sunken`, `--color-border-subtle`, `--space-*`, `--radius-md`.
- `FormField` (`.wn-admin-field`, `.wn-admin-input`, `.wn-admin-select`):
  - purpose: shared title/category/scope/slug metadata controls.
  - tokens: `--color-text-muted`, `--color-border-default`, `--color-focus-ring`, `--space-*`, `--font-size-sm`.
- `InlineError` (`.wn-admin-inline-error`):
  - purpose: field-level validation and conflict feedback (`slug` 409 mapping, validation errors).
  - tokens: `--color-danger-bg`, `--font-size-sm`, `--font-weight-medium`.
- `EditorBanner` (`.wn-admin-editor-banner--*`):
  - purpose: global success/error/warning save feedback.
  - tokens: `--color-success-*`, `--color-danger-*`, `--color-warning-*`, `--radius-md`, `--space-*`.

## Adding a New Token

1. Add a primitive token in `tokens.json` if the raw value is new.
2. Add or update semantic aliases in `tokens.json` (`semantic.light`, and `semantic.dark` if needed).
3. Run `node scripts/generate-token-css.mjs` to regenerate `src/styles/tokens.css`.
4. Consume the semantic variable in component CSS (`src/styles/primitives.css` or feature CSS).

## Accessibility Notes

- Buttons include `:focus-visible` ring styles via semantic focus tokens.
- Disabled state has explicit semantic colors.
- Button motion is disabled for users with reduced motion preference.
- Typography defaults to system fonts (no external font loading).

## Future Figma Sync Plan

Current setup is intentionally token-file driven so it can map to MCP/Figma workflows later:

1. Figma tokens become the upstream source.
2. A sync step updates `tokens.json`.
3. The existing generator updates `src/styles/tokens.css`.
4. Components keep working without refactors because they already consume semantic variables.

If token naming needs alignment with the broader AllBooked system, update aliases in `tokens.json` first and preserve component semantics.
