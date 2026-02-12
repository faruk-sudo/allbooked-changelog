import { describe, expect, it } from "vitest";
import {
  WHATS_NEW_DEEPLINK_QUERY_PARAM,
  WHATS_NEW_DEEPLINK_QUERY_VALUE,
  buildWhatsNewDeepLinkHref,
  hasWhatsNewDeepLinkQuery,
  isWhatsNewDeepLinkHash,
  isWhatsNewTriggerSource,
  removeWhatsNewTriggerFromLocation,
  shouldOpenWhatsNewFromLocation
} from "../src/changelog/trigger-contract";

describe("What's New trigger contract", () => {
  it("detects deep-link query values from scalar and array forms", () => {
    expect(hasWhatsNewDeepLinkQuery("1")).toBe(true);
    expect(hasWhatsNewDeepLinkQuery(["0", "1"])).toBe(true);
    expect(hasWhatsNewDeepLinkQuery("0")).toBe(false);
    expect(hasWhatsNewDeepLinkQuery(undefined)).toBe(false);
  });

  it("detects deep-link trigger from query or hash", () => {
    expect(shouldOpenWhatsNewFromLocation("?whats_new=1", "")).toBe(true);
    expect(shouldOpenWhatsNewFromLocation("?foo=bar", "#whats-new")).toBe(true);
    expect(shouldOpenWhatsNewFromLocation("?foo=bar", "#other")).toBe(false);
  });

  it("removes deep-link query/hash after consumption", () => {
    const cleaned = removeWhatsNewTriggerFromLocation("?foo=bar&whats_new=1", "#whats-new");
    expect(cleaned.changed).toBe(true);
    expect(cleaned.search).toBe("?foo=bar");
    expect(cleaned.hash).toBe("");
  });

  it("keeps location unchanged when trigger is absent", () => {
    const unchanged = removeWhatsNewTriggerFromLocation("?foo=bar", "#section-1");
    expect(unchanged.changed).toBe(false);
    expect(unchanged.search).toBe("?foo=bar");
    expect(unchanged.hash).toBe("#section-1");
  });

  it("builds a stable deep-link href for release-notes links", () => {
    expect(buildWhatsNewDeepLinkHref("/whats-new/example-post")).toBe(
      `/whats-new/example-post?${WHATS_NEW_DEEPLINK_QUERY_PARAM}=${WHATS_NEW_DEEPLINK_QUERY_VALUE}`
    );
    expect(buildWhatsNewDeepLinkHref("/whats-new/example-post", "?foo=bar")).toBe(
      `/whats-new/example-post?foo=bar&${WHATS_NEW_DEEPLINK_QUERY_PARAM}=${WHATS_NEW_DEEPLINK_QUERY_VALUE}`
    );
  });

  it("validates hash and trigger source contracts", () => {
    expect(isWhatsNewDeepLinkHash("#whats-new")).toBe(true);
    expect(isWhatsNewDeepLinkHash("whats-new")).toBe(true);
    expect(isWhatsNewDeepLinkHash("#not-whats-new")).toBe(false);

    expect(isWhatsNewTriggerSource("manual")).toBe(true);
    expect(isWhatsNewTriggerSource("deeplink")).toBe(true);
    expect(isWhatsNewTriggerSource("programmatic")).toBe(true);
    expect(isWhatsNewTriggerSource("unknown")).toBe(false);
  });
});
