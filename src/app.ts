import express, { type Express } from "express";
import type { AppConfig } from "./config";
import { createWhatsNewAdminRouter } from "./changelog/admin-routes";
import { createWhatsNewPublisherRouter } from "./changelog/publisher-routes";
import { createWhatsNewApiRouter } from "./changelog/api-routes";
import { InMemoryChangelogRepository, type ChangelogRepository } from "./changelog/repository";
import { createWhatsNewRouter } from "./changelog/routes";
import { createPublicChangelogRouter } from "./changelog/public-routes";
import { createPublicRssRouter } from "./changelog/rss-routes";
import { appLogger, type Logger } from "./security/logger";
import { InMemoryRateLimitStore, type RateLimitStore } from "./security/rate-limit";

export interface AppDependencies {
  logger?: Logger;
  changelogRepository?: ChangelogRepository;
  rateLimitStore?: RateLimitStore;
  healthCheck?: () => Promise<void> | void;
}

function createFallbackRepository(): ChangelogRepository {
  return new InMemoryChangelogRepository([
    {
      id: "post-2026-01-admin-insights",
      tenantId: null,
      visibility: "authenticated",
      status: "published",
      category: "new",
      title: "Admin Insights Overview",
      slug: "admin-insights-overview",
      bodyMarkdown:
        "## New\n\n- Booking health summary now appears at the top of dashboards.\n- Performance fixes on high-volume calendars.",
      publishedAt: "2026-01-22T10:00:00.000Z",
      revision: 1
    },
    {
      id: "post-2026-02-draft",
      tenantId: null,
      visibility: "authenticated",
      status: "draft",
      category: "improvement",
      title: "Draft: Future Improvements",
      slug: "draft-internal-notes",
      bodyMarkdown: "Internal draft content.",
      publishedAt: null,
      revision: 1
    }
  ]);
}

export function createApp(config: AppConfig, dependencies: AppDependencies = {}): Express {
  const app = express();
  const logger = dependencies.logger ?? appLogger;
  const changelogRepository = dependencies.changelogRepository ?? createFallbackRepository();
  const rateLimitStore = dependencies.rateLimitStore ?? new InMemoryRateLimitStore();
  const healthCheck = dependencies.healthCheck ?? (() => undefined);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));

  app.get("/healthz", async (_req, res) => {
    try {
      await healthCheck();
      res.status(200).json({ ok: true });
      return;
    } catch (error) {
      logger.info("health_check_failed", { error });
      res.status(503).json({ ok: false });
    }
  });

  app.get("/", (req, res) => {
    const queryIndex = req.originalUrl.indexOf("?");
    const querySuffix = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
    res.redirect(302, `/whats-new${querySuffix}`);
  });

  app.use("/api/whats-new", createWhatsNewApiRouter(config, changelogRepository, logger, rateLimitStore));
  app.use("/api/admin/whats-new", createWhatsNewAdminRouter(config, changelogRepository, logger, rateLimitStore));
  app.use("/admin/whats-new", createWhatsNewPublisherRouter(config, changelogRepository, logger));
  app.use("/whats-new", createWhatsNewRouter(config, changelogRepository, logger));
  app.use("/changelog", createPublicChangelogRouter(config, changelogRepository, logger));
  app.use("/rss", createPublicRssRouter(config, changelogRepository, logger));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
