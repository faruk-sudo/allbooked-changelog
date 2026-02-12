export const WHATS_NEW_DEEPLINK_QUERY_PARAM = "whats_new";
export const WHATS_NEW_DEEPLINK_QUERY_VALUE = "1";
export const WHATS_NEW_DEEPLINK_HASH = "whats-new";
export const WHATS_NEW_PROGRAMMATIC_API_GLOBAL = "AllBookedWhatsNew";

export const WHATS_NEW_TRIGGER_SOURCES = ["manual", "deeplink", "programmatic"] as const;
export type WhatsNewTriggerSource = (typeof WHATS_NEW_TRIGGER_SOURCES)[number];

function normalizeScalar(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function isWhatsNewDeepLinkQueryValue(value: unknown): boolean {
  return normalizeScalar(value) === WHATS_NEW_DEEPLINK_QUERY_VALUE;
}

export function hasWhatsNewDeepLinkQuery(rawValue: unknown): boolean {
  if (Array.isArray(rawValue)) {
    return rawValue.some((value) => isWhatsNewDeepLinkQueryValue(value));
  }

  return isWhatsNewDeepLinkQueryValue(rawValue);
}

export function isWhatsNewDeepLinkHash(rawHash: string | null | undefined): boolean {
  if (typeof rawHash !== "string") {
    return false;
  }

  const normalized = rawHash.trim().replace(/^#/, "").toLowerCase();
  return normalized === WHATS_NEW_DEEPLINK_HASH;
}

export function shouldOpenWhatsNewFromLocation(search: string, hash: string): boolean {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  const hasQueryTrigger = params
    .getAll(WHATS_NEW_DEEPLINK_QUERY_PARAM)
    .some((value) => isWhatsNewDeepLinkQueryValue(value));

  return hasQueryTrigger || isWhatsNewDeepLinkHash(hash);
}

export function removeWhatsNewTriggerFromLocation(
  search: string,
  hash: string
): { search: string; hash: string; changed: boolean } {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);

  const hadQueryTrigger = params
    .getAll(WHATS_NEW_DEEPLINK_QUERY_PARAM)
    .some((value) => isWhatsNewDeepLinkQueryValue(value));
  if (hadQueryTrigger) {
    params.delete(WHATS_NEW_DEEPLINK_QUERY_PARAM);
  }

  const hadHashTrigger = isWhatsNewDeepLinkHash(hash);
  const nextSearch = params.toString();

  return {
    search: nextSearch.length > 0 ? `?${nextSearch}` : "",
    hash: hadHashTrigger ? "" : hash,
    changed: hadQueryTrigger || hadHashTrigger
  };
}

export function buildWhatsNewDeepLinkHref(pathname: string, search = ""): string {
  const normalizedPathname = normalizeScalar(pathname) ?? "/";
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  params.set(WHATS_NEW_DEEPLINK_QUERY_PARAM, WHATS_NEW_DEEPLINK_QUERY_VALUE);

  const nextSearch = params.toString();
  return nextSearch.length > 0 ? `${normalizedPathname}?${nextSearch}` : normalizedPathname;
}

export function isWhatsNewTriggerSource(value: unknown): value is WhatsNewTriggerSource {
  return typeof value === "string" && (WHATS_NEW_TRIGGER_SOURCES as readonly string[]).includes(value);
}
