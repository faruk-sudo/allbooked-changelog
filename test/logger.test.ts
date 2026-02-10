import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { buildSafeRequestLogMetadata, sanitizeLogMetadata } from "../src/security/logger";

describe("sanitizeLogMetadata", () => {
  it("redacts sensitive body and secret-looking keys", () => {
    const metadata = sanitizeLogMetadata({
      tenantId: "tenant-alpha",
      body_markdown: "secret body",
      token: "abc123",
      nested: {
        markdown: "secret markdown",
        ok: true
      }
    });

    expect(metadata).toEqual({
      tenantId: "tenant-alpha",
      body_markdown: "[REDACTED]",
      token: "[REDACTED]",
      nested: {
        markdown: "[REDACTED]",
        ok: true
      }
    });
  });

  it("redacts authorization and cookie headers", () => {
    const metadata = sanitizeLogMetadata({
      headers: {
        authorization: "Bearer secret",
        cookie: "session=secret",
        "x-tenant-id": "tenant-alpha"
      }
    });

    expect(metadata).toEqual({
      headers: {
        authorization: "[REDACTED]",
        cookie: "[REDACTED]",
        "x-tenant-id": "tenant-alpha"
      }
    });
  });
});

describe("buildSafeRequestLogMetadata", () => {
  it("omits request body and redacts sensitive headers", () => {
    const metadata = buildSafeRequestLogMetadata({
      method: "POST",
      originalUrl: "/api/admin/whats-new/posts",
      url: "/api/admin/whats-new/posts",
      ip: "127.0.0.1",
      headers: {
        authorization: "Bearer secret",
        cookie: "session=secret",
        "x-user-id": "publisher-1"
      }
    } as unknown as Request);

    expect(metadata).toEqual({
      method: "POST",
      path: "/api/admin/whats-new/posts",
      ip: "127.0.0.1",
      headers: {
        authorization: "[REDACTED]",
        cookie: "[REDACTED]",
        "x-user-id": "publisher-1"
      }
    });
    expect("body" in metadata).toBe(false);
  });
});
