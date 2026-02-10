import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "../src/changelog/audit";

describe("sanitizeAuditMetadata", () => {
  it("strips forbidden markdown keys at top-level", () => {
    const metadata = sanitizeAuditMetadata({
      changed_fields: ["title"],
      body_markdown: "hidden",
      bodyMarkdown: "hidden",
      markdown: "hidden"
    });

    expect(metadata).toEqual({
      changed_fields: ["title"]
    });
  });

  it("strips forbidden markdown keys recursively", () => {
    const metadata = sanitizeAuditMetadata({
      nested: {
        keep: "ok",
        body_markdown: "hidden"
      },
      changes: [
        {
          field: "status",
          content: "hidden"
        }
      ]
    });

    expect(metadata).toEqual({
      nested: {
        keep: "ok"
      },
      changes: [
        {
          field: "status"
        }
      ]
    });
  });

  it("returns undefined when metadata only contains forbidden keys", () => {
    const metadata = sanitizeAuditMetadata({
      body: "hidden",
      bodyMarkdown: "hidden"
    });

    expect(metadata).toBeUndefined();
  });
});
