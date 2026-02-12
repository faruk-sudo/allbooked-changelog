import { describe, expect, it } from "vitest";
import { createAnalyticsTracker, mapSeenFailureToErrorCode } from "../src/analytics/tracker";
import type { WhatsNewEventName } from "../src/analytics/events";

describe("analytics tracker", () => {
  it("drops forbidden and unexpected keys from tracked payloads", () => {
    const trackedEvents: Array<{ name: WhatsNewEventName; properties: Record<string, unknown> }> = [];
    const tracker = createAnalyticsTracker({
      track: (name, properties) => {
        trackedEvents.push({ name, properties });
      }
    });

    tracker.trackEvent("whats_new.open_post", {
      surface: "page",
      tenant_id: "sha256:tenant",
      user_id: "admin-1",
      post_id: "post-1",
      slug: "post-1",
      body_markdown: "# hidden",
      title: "Never include title",
      email: "admin@example.com",
      ip: "127.0.0.1",
      random_value: "unexpected"
    });

    expect(trackedEvents).toHaveLength(1);
    expect(trackedEvents[0]?.name).toBe("whats_new.open_post");
    expect(trackedEvents[0]?.properties).toEqual({
      surface: "page",
      tenant_id: "sha256:tenant",
      user_id: "admin-1",
      post_id: "post-1",
      slug: "post-1"
    });
  });

  it("enforces event name allowlist", () => {
    const trackedEvents: Array<{ name: WhatsNewEventName; properties: Record<string, unknown> }> = [];
    const tracker = createAnalyticsTracker({
      track: (name, properties) => {
        trackedEvents.push({ name, properties });
      }
    });

    tracker.trackEvent("whats_new.unknown_event", {
      surface: "page"
    });

    expect(trackedEvents).toHaveLength(0);
  });

  it("maps mark-seen failures to short error codes without exposing raw messages", () => {
    expect(mapSeenFailureToErrorCode({ status: 403, message: "Forbidden: token abc123" })).toBe("unauthorized");
    expect(mapSeenFailureToErrorCode({ status: 503, message: "Database timeout at host" })).toBe("server_error");
    const code = mapSeenFailureToErrorCode(new Error("connection refused: postgres://..."));
    expect(code).toBe("unknown_error");
    expect(code).not.toContain("postgres://");
  });

  it("keeps open-panel source constrained to allowed trigger values", () => {
    const trackedEvents: Array<{ name: WhatsNewEventName; properties: Record<string, unknown> }> = [];
    const tracker = createAnalyticsTracker({
      track: (name, properties) => {
        trackedEvents.push({ name, properties });
      }
    });

    tracker.trackEvent("whats_new.open_panel", {
      surface: "panel",
      source: "deeplink",
      tenant_id: "sha256:tenant",
      user_id: "admin-1"
    });

    tracker.trackEvent("whats_new.open_panel", {
      surface: "panel",
      source: "not-allowed",
      tenant_id: "sha256:tenant",
      user_id: "admin-1"
    });

    expect(trackedEvents).toHaveLength(2);
    expect(trackedEvents[0]?.properties).toEqual({
      surface: "panel",
      source: "deeplink",
      tenant_id: "sha256:tenant",
      user_id: "admin-1"
    });
    expect(trackedEvents[1]?.properties).toEqual({
      surface: "panel",
      tenant_id: "sha256:tenant",
      user_id: "admin-1"
    });
  });
});
