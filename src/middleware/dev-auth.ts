import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config";

export function applyDevAuthFallback(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!config.devAuthBypassEnabled) {
      next();
      return;
    }

    if (!req.auth) {
      req.auth = {
        userId: config.devAuthBypassUserId,
        email: config.devAuthBypassUserEmail,
        role: config.devAuthBypassUserRole,
        isAuthenticated: true
      };
    }

    if (!req.tenantId) {
      req.tenantId = config.devAuthBypassTenantId;
    }

    next();
  };
}
