import helmet, { type HelmetOptions } from "helmet";
import type { RequestHandler } from "express";
import type { AppConfig, SecurityHeadersConfig } from "../config";

const PERMISSIONS_POLICY_VALUE = "geolocation=(), microphone=(), camera=(), payment=()";
type CspDirectives = Exclude<HelmetOptions["contentSecurityPolicy"], boolean | undefined>["directives"];

function normalizeCspSources(sources: string[], fallback: string[]): string[] {
  const normalized = sources
    .map((source) => source.trim())
    .filter((source) => source.length > 0)
    .map((source) => {
      const withoutQuotes = source.replace(/^'(.*)'$/, "$1").toLowerCase();
      if (withoutQuotes === "none") {
        return "'none'";
      }
      if (withoutQuotes === "self") {
        return "'self'";
      }
      if (withoutQuotes === "unsafe-inline") {
        return "'unsafe-inline'";
      }
      if (withoutQuotes === "unsafe-eval") {
        return "'unsafe-eval'";
      }
      if (withoutQuotes === "strict-dynamic") {
        return "'strict-dynamic'";
      }
      return source;
    });

  return normalized.length > 0 ? normalized : fallback;
}

function resolveSecurityHeadersConfig(config: AppConfig): SecurityHeadersConfig {
  const configured = config.securityHeaders;
  const inferredProduction = (process.env.NODE_ENV ?? "").toLowerCase() === "production";
  const isProduction = configured?.isProduction ?? inferredProduction;

  return {
    isProduction,
    cspReportOnly: configured?.cspReportOnly ?? !isProduction,
    cspFrameAncestors: normalizeCspSources(configured?.cspFrameAncestors ?? ["'none'"], ["'none'"]),
    cspConnectSrc: normalizeCspSources(configured?.cspConnectSrc ?? ["'self'"], ["'self'"]),
    cspImgSrc: normalizeCspSources(configured?.cspImgSrc ?? ["'self'", "data:", "https:"], [
      "'self'",
      "data:",
      "https:"
    ])
  };
}

function buildCspDirectives(config: SecurityHeadersConfig): CspDirectives {
  const directives: CspDirectives = {
    defaultSrc: ["'none'"],
    baseUri: ["'none'"],
    objectSrc: ["'none'"],
    frameAncestors: config.cspFrameAncestors,
    frameSrc: ["'none'"],
    formAction: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: config.cspImgSrc,
    fontSrc: ["'self'", "data:", "https:"],
    connectSrc: config.cspConnectSrc
  };

  if (config.isProduction) {
    directives.upgradeInsecureRequests = [];
  }

  return directives;
}

export function createWhatsNewHtmlSecurityHeaders(config: AppConfig): RequestHandler {
  const resolved = resolveSecurityHeadersConfig(config);
  const helmetMiddleware = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      reportOnly: resolved.cspReportOnly,
      directives: buildCspDirectives(resolved)
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xFrameOptions: { action: "deny" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginEmbedderPolicy: false,
    hsts: resolved.isProduction
      ? {
          maxAge: 31536000,
          includeSubDomains: true
        }
      : false
  });

  return (req, res, next) => {
    if (!res.getHeader("Permissions-Policy")) {
      res.setHeader("Permissions-Policy", PERMISSIONS_POLICY_VALUE);
    }
    helmetMiddleware(req, res, next);
  };
}
