import { describe, expect, it } from "vitest";
import { renderMarkdownSafe } from "../src/security/markdown";

describe("renderMarkdownSafe", () => {
  it("blocks raw script tags while preserving markdown formatting", () => {
    const html = renderMarkdownSafe("<script>alert('xss')</script> **safe**");

    expect(html).not.toContain("<script>");
    expect(html).toContain("<strong>safe</strong>");
  });

  it("removes javascript links", () => {
    const html = renderMarkdownSafe("[click](javascript:alert(1))");

    expect(html).not.toContain("<a");
    expect(html).not.toContain("href=");
  });

  it("enforces safe link attributes", () => {
    const html = renderMarkdownSafe("[docs](https://example.com)");

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
