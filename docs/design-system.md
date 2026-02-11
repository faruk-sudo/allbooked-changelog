# Design System Foundation

## Token Strategy

This repo uses a token-first model with two layers:

1. `primitive` tokens in `tokens.json`
2. `semantic` tokens in `tokens.json`

Primitive tokens define raw values (palette, spacing, radii, typography, shadows, z-index).  
Semantic tokens map intent (`bg`, `surface`, `text`, `muted`, `border`, `primary`, `secondary`, `link`, `danger`, `success`, `warning`, `info`, `focus`, `disabled`) to primitives and support theme overrides (`light`, `dark`).

Use semantic tokens in components. Avoid direct primitive color usage in component CSS.

## Neutral Palette (v2)

The color foundation is neutral-first and intentionally monochrome for most UI chrome:

- `neutral.50` `#f8f8f9` -> app canvas
- `neutral.0` `#ffffff` -> base surface
- `neutral.100` `#f1f1f2` -> subtle/sunken surfaces
- `neutral.200` `#e4e4e7` and `neutral.300` `#d4d4d8` -> borders
- `neutral.600` `#52525b` -> muted foreground
- `neutral.900` `#18181b` and `neutral.950` `#09090b` -> primary foreground + primary actions

Status colors stay available and intentionally restrained (for affordance and accessibility, not brand dominance):

- `success.*` -> muted green
- `warning.*` -> muted amber
- `danger.*` -> muted red
- `info.*` -> muted blue

Dark mode uses the same token names with semantic overrides in `semantic.dark`.

## Semantic Mapping (Core)

Core semantic tokens consumed by components:

- `--color-bg-canvas`, `--color-bg-subtle`
- `--color-surface-base`, `--color-surface-raised`, `--color-surface-sunken`
- `--color-text-primary`, `--color-text-muted`, `--color-text-inverse`
- `--color-muted-bg`, `--color-muted-fg`
- `--color-border-default`, `--color-border-strong`, `--color-border-subtle`
- `--color-primary-*`, `--color-secondary-*`, `--color-link-*`
- `--color-danger-*`, `--color-success-*`, `--color-warning-*`, `--color-info-*`
- `--color-focus-ring`, `--color-focus-offset`
- `--color-disabled-*`

State coverage is semantic and explicit (`hover`, `active`, `disabled`) so component styles do not need raw values.

## Component Color Rule

- Raw color values (`#hex`, `rgb`, `hsl`, named colors) are allowed only in token sources (`tokens.json`) and generated token output (`src/styles/tokens.css`).
- Component/feature styles must use semantic variables (`var(--color-...)`).
- New UI color requirements should be implemented by extending semantic tokens first, then consumed by components.

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

## Public Changelog Components (Phase 5B)

Public routes (`/changelog`, `/changelog/:slug`) render from `src/changelog/public-routes.ts` with styles in `src/styles/public-changelog.css`.

Feature component map:

- `PublicChangelogList` (`.pc-feed-list`, `.pc-feed-item`):
  - purpose: public feed cards with title, date, category badge, and text-only excerpt.
  - tokens: `--color-surface-*`, `--color-border-*`, `--space-*`, `--font-size-*`, `--line-height-relaxed`.
- `PublicCategoryBadge` (`.pc-category-badge`, `.pc-category-key--*`):
  - purpose: neutral category affordance for `new`/`improvement`/`fix` that does not rely on color only.
  - tokens: `--color-surface-*`, `--color-text-*`, `--color-border-*`, `--radius-*`, `--font-weight-*`.
- `PublicChangelogDetail` (`.pc-detail`):
  - purpose: server-rendered markdown body using the shared sanitized renderer.
  - tokens: `--font-family-*`, `--font-size-*`, `--line-height-relaxed`, `--color-link-*`, `--color-focus-ring`, `--space-*`.
- `PublicPagination` (`.pc-pagination`):
  - purpose: simple page controls with server-capped page size.
  - tokens: primitive button tokens via `ds-button` plus spacing tokens.

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

## What's New Publish/Unpublish Guardrails (Phase 3C)

Publisher edit routes add confirmation + validation guardrails using the same tokenized system (`src/changelog/publisher-routes.ts`, `src/styles/whats-new-admin.css`).

Feature component map:

- `PublishActionGroup` (`.wn-admin-editor-actions`, `#whats-new-editor-publish-button`, `#whats-new-editor-view-link`):
  - purpose: primary publish/unpublish action, secondary save action, optional reader link.
  - tokens: `--space-*`, primitive button tokens (`--color-primary-*`, `--color-secondary-*`, `--color-text-*`).
- `ValidationSummary` (`#whats-new-editor-validation-summary`, `.wn-admin-editor-validation-summary-list`):
  - purpose: top-of-form summary when multiple field validations fail.
  - tokens: `--space-*`, `--color-surface-sunken`, `--color-border-default`.
- `ConfirmDialog` (`#whats-new-editor-confirm-overlay`, `#whats-new-editor-confirm-dialog`):
  - purpose: required confirmations before publish/unpublish transitions.
  - tokens: `--z-overlay`, `--shadow-md`, `--color-bg-subtle`, `--color-border-default`, `--space-*`.
- `StatusPill` (`#whats-new-editor-status-pill`, `.wn-admin-pill--draft|published`):
  - purpose: immediate state feedback after publish/unpublish actions.
  - tokens: `--color-warning-*`, `--color-success-*`, `--radius-pill`, `--font-size-xs`.

## Adding a New Token

1. Add a primitive token in `tokens.json` if the raw value is new.
2. Add or update semantic aliases in `tokens.json` (`semantic.light`, and `semantic.dark` if needed).
3. Run `node scripts/generate-token-css.mjs` to regenerate `src/styles/tokens.css`.
4. Consume the semantic variable in component CSS (`src/styles/primitives.css` or feature CSS).

## Migration Notes (Neutral Refresh)

- Primary/action tokens were remapped from blue-accented values to neutral monochrome values.
- Link styling now uses dedicated semantic link tokens (`--color-link-fg`, `--color-link-hover`) instead of reusing primary button tokens.
- Functional status tokens (`danger/success/warning/info`) remain non-neutral for usability and are intentionally less saturated.
- Button variants now include semantic `active` states in addition to existing `hover` and `disabled`.

To add a future brand accent with minimal churn:

1. Add an accent primitive scale in `tokens.json` (for example `primitive.color.accent`).
2. Remap `semantic.light.primary`, `semantic.dark.primary`, and optional `semantic.*.link`.
3. Regenerate `src/styles/tokens.css`.
4. No component refactor is needed if semantic token names stay stable.

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
