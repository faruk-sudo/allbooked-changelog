import express, { type Express } from "express";
import type { AppConfig } from "./config";
import { createWhatsNewRouter } from "./changelog/routes";
import { appLogger, type Logger } from "./security/logger";

export function createApp(config: AppConfig, logger: Logger = appLogger): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/whats-new", createWhatsNewRouter(config, logger));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
