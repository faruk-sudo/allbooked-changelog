const ALLOWED_PROTOCOL_SET = new Set(["http:", "https:", "mailto:"]);

export const ALLOWED_MARKDOWN_LINK_PROTOCOLS = Object.freeze([
  "http:",
  "https:",
  "mailto:"
] as const);

export function isSafeMarkdownLinkUrl(value: string): boolean {
  const rawValue = value.trim();
  if (rawValue.length === 0) {
    return false;
  }

  const lowered = rawValue.toLowerCase();
  if (lowered.startsWith("javascript:") || lowered.startsWith("data:")) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    return false;
  }

  return ALLOWED_PROTOCOL_SET.has(parsed.protocol.toLowerCase());
}
