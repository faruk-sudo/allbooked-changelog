import { Button, Stack, Surface, Text } from "../components/primitives";

export function DesignSystemSmoke() {
  return (
    <main className="ds-root" style={{ minHeight: "100dvh", padding: "var(--space-8)" }}>
      <Stack gap="6">
        <Text as="h1" variant="heading">
          Design System Smoke
        </Text>
        <Text variant="muted">This page validates token-based primitives and semantic theming.</Text>

        <Surface variant="base">
          <Stack gap="4">
            <Text variant="heading">Text + Buttons</Text>
            <Text variant="body">Body text uses semantic foreground and typography scale tokens.</Text>
            <Stack direction="horizontal" gap="3" wrap>
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button disabled variant="primary">
                Disabled
              </Button>
            </Stack>
          </Stack>
        </Surface>

        <Stack direction="horizontal" gap="4" wrap>
          <Surface style={{ minWidth: "16rem" }} variant="base">
            <Text variant="heading">Base Surface</Text>
          </Surface>
          <Surface style={{ minWidth: "16rem" }} variant="raised">
            <Text variant="heading">Raised Surface</Text>
          </Surface>
          <Surface style={{ minWidth: "16rem" }} variant="sunken">
            <Text variant="heading">Sunken Surface</Text>
          </Surface>
        </Stack>
      </Stack>
    </main>
  );
}
