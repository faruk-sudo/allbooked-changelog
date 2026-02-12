import { describe, expect, it } from "vitest";
import { ALLOWED_MARKDOWN_LINK_PROTOCOLS, isSafeMarkdownLinkUrl } from "../src/changelog/markdown-editor-links";

describe("markdown editor link validation", () => {
  it("uses the expected safe protocol allowlist", () => {
    expect(ALLOWED_MARKDOWN_LINK_PROTOCOLS).toEqual(["http:", "https:", "mailto:"]);
  });

  it("accepts http, https, and mailto links", () => {
    expect(isSafeMarkdownLinkUrl("https://example.com/path?q=1")).toBe(true);
    expect(isSafeMarkdownLinkUrl("HTTP://example.com")).toBe(true);
    expect(isSafeMarkdownLinkUrl("mailto:support@example.com")).toBe(true);
  });

  it("rejects dangerous protocols", () => {
    expect(isSafeMarkdownLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeMarkdownLinkUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeMarkdownLinkUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects unsupported or malformed links", () => {
    expect(isSafeMarkdownLinkUrl("ftp://example.com")).toBe(false);
    expect(isSafeMarkdownLinkUrl("www.example.com")).toBe(false);
    expect(isSafeMarkdownLinkUrl("   ")).toBe(false);
  });
});
