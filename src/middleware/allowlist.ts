import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config";
import { isTenantAllowlisted } from "../security/allowlist";

export function requireAllowlistedTenant(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isTenantAllowlisted(req.tenantId, config)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    next();
  };
}
