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

  it("does not emit script tags, event handlers, or javascript href attributes", () => {
    const html = renderMarkdownSafe(
      "<script>alert(1)</script><img src=x onerror=alert(1)> [bad](javascript:alert(2)) [ok](https://example.com)"
    );

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<[^>]+\son(?:error|load)\s*=/i);
    expect(html).not.toMatch(/href\s*=\s*"\s*javascript:/i);
  });
});
