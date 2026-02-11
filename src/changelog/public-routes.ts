import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config";
import { buildPublicAbsoluteUrl } from "../config/public-url";
import { createWhatsNewHtmlSecurityHeaders } from "../security/headers";
import { appLogger, type Logger } from "../security/logger";
import {
  applyPublicSurfaceResponseHeaders,
  enforcePublicChangelogPolicy,
  getPublicChangelogPolicy,
  renderPublicNoIndexMetaTag,
  requirePublicChangelogEnabled,
  resolvePublicSurfaceConfig
} from "./public-surface";

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPublicChangelogPlaceholder(config: AppConfig): string {
  const canonicalUrl = buildPublicAbsoluteUrl(config.publicSiteUrl, "/changelog");
  const canonicalTag = canonicalUrl
    ? `\n    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`
    : "";
  const noIndexMetaTag = renderPublicNoIndexMetaTag(config);
  const robotsMetaTag = noIndexMetaTag ? `\n    ${noIndexMetaTag}` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />${robotsMetaTag}${canonicalTag}
    <title>Changelog</title>
  </head>
  <body>
    <main>
      <h1>Changelog</h1>
      <p>Public changelog placeholder. Full public feed ships in the next phase.</p>
    </main>
  </body>
</html>`;
}

export function createPublicChangelogRouter(config: AppConfig, logger: Logger = appLogger): Router {
  const router = Router();
  const publicSurfaceConfig = resolvePublicSurfaceConfig(config);

  router.use(requirePublicChangelogEnabled(config));
  router.use(enforcePublicChangelogPolicy);

  if (publicSurfaceConfig.cspEnabled) {
    router.use(createWhatsNewHtmlSecurityHeaders(config));
  }

  router.get("/", (req: Request, res: Response) => {
    const policy = getPublicChangelogPolicy(req);

    logger.info("public_changelog_placeholder_served", {
      status: policy.status,
      visibility: policy.visibility,
      tenantId: policy.tenantId
    });

    applyPublicSurfaceResponseHeaders(res, config);
    res.status(200).type("html").send(renderPublicChangelogPlaceholder(config));
  });

  return router;
}
