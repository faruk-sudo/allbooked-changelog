import type { Router } from "express";
import type { AppConfig } from "../config";
import { hydrateAuthFromHeaders, requireAdmin, requireAuthenticated } from "../middleware/auth";
import { requireAllowlistedTenant } from "../middleware/allowlist";
import { requirePublisherAllowlisted } from "../middleware/publisher";
import { hydrateTenantFromHeaders, requireTenantContext } from "../middleware/tenant";
import { requireCsrfToken } from "../security/csrf";
import { whatsNewSecurityHeaders } from "../security/headers";

export function applyWhatsNewReadGuards(router: Router, config: AppConfig): void {
  router.use(whatsNewSecurityHeaders);
  router.use(hydrateTenantFromHeaders);
  router.use(hydrateAuthFromHeaders);
  router.use(requireAuthenticated);
  router.use(requireAdmin);
  router.use(requireTenantContext);
  router.use(requireAllowlistedTenant(config));
}

export function applyWhatsNewAdminGuards(router: Router, config: AppConfig): void {
  applyWhatsNewReadGuards(router, config);
  router.use(requirePublisherAllowlisted(config));
  router.use(requireCsrfToken);
}
