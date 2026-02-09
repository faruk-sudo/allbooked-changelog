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
