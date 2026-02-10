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

Phase 2.2 introduces two feature-level components for the in-app drawer feed:

- `WhatsNewPanel`
- `WhatsNewFeedItem`

Implementation notes for this repo's server-rendered setup:

- `src/changelog/routes.ts`:
  - `renderWhatsNewPanel()` renders the dialog shell (`role="dialog"`, `aria-modal`, close control, loading/empty/error states, and load-more action).
  - client-side `renderWhatsNewFeedItem(post)` renders each post card safely with text-only excerpt output and category badge.
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
