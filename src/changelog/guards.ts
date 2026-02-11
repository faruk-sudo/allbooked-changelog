import type { Router } from "express";
import type { AppConfig } from "../config";
import { requireCsrfToken } from "../security/csrf";
import { requireAdmin, requirePublisher, requireWhatsNewEnabled } from "./authz";
import { hydrateWhatsNewRequestContext } from "./request-context";

export function applyWhatsNewReadGuards(router: Router, config: AppConfig): void {
  router.use(hydrateWhatsNewRequestContext(config));
  router.use(requireAdmin);
  router.use(requireWhatsNewEnabled(config));
}

export function applyWhatsNewPublisherGuards(router: Router, config: AppConfig): void {
  applyWhatsNewReadGuards(router, config);
  router.use(requirePublisher(config));
}

export function applyWhatsNewAdminGuards(router: Router, config: AppConfig): void {
  applyWhatsNewPublisherGuards(router, config);
  router.use(requireCsrfToken);
}
