import type { Router } from "express";
import type { AppConfig } from "../config";
import { requireCsrfToken } from "../security/csrf";
import { whatsNewSecurityHeaders } from "../security/headers";
import { requireAdmin, requirePublisher, requireWhatsNewEnabled } from "./authz";
import { hydrateWhatsNewRequestContext } from "./request-context";

export function applyWhatsNewReadGuards(router: Router, config: AppConfig): void {
  router.use(whatsNewSecurityHeaders);
  router.use(hydrateWhatsNewRequestContext(config));
  router.use(requireAdmin);
  router.use(requireWhatsNewEnabled(config));
}

export function applyWhatsNewAdminGuards(router: Router, config: AppConfig): void {
  applyWhatsNewReadGuards(router, config);
  router.use(requirePublisher(config));
  router.use(requireCsrfToken);
}
