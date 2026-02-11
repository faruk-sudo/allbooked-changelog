export interface PublicSiteUrlValidationOptions {
  enforceHttps: boolean;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function normalizePublicSiteUrl(rawValue: string, options: PublicSiteUrlValidationOptions): string {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error("PUBLIC_SITE_URL/BASE_URL must be a valid absolute URL");
  }

  if (options.enforceHttps && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_SITE_URL/BASE_URL must use https in production");
  }

  if (!options.enforceHttps && parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("PUBLIC_SITE_URL/BASE_URL must use https unless pointing to localhost in non-production");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("PUBLIC_SITE_URL/BASE_URL must use http or https");
  }

  parsed.hash = "";
  parsed.search = "";

  const normalizedPathname = parsed.pathname === "/" ? "" : trimTrailingSlash(parsed.pathname);
  return `${parsed.origin}${normalizedPathname}`;
}

export function resolvePublicSiteUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const preferred = (env.PUBLIC_SITE_URL ?? "").trim();
  const fallback = (env.BASE_URL ?? "").trim();
  const configured = preferred.length > 0 ? preferred : fallback;
  if (!configured) {
    return undefined;
  }

  const nodeEnv = (env.NODE_ENV ?? "").toLowerCase();
  const enforceHttps = nodeEnv === "production";

  return normalizePublicSiteUrl(configured, { enforceHttps });
}

export function buildPublicAbsoluteUrl(publicSiteUrl: string | undefined, path: string): string | undefined {
  if (!publicSiteUrl) {
    return undefined;
  }

  const normalizedBase = trimTrailingSlash(publicSiteUrl);
  if (!normalizedBase) {
    return undefined;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
