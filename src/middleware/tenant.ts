import type { NextFunction, Request, Response } from "express";

export function hydrateTenantFromHeaders(req: Request, _res: Response, next: NextFunction): void {
  const tenantId = req.header("x-tenant-id")?.trim();
  req.tenantId = tenantId && tenantId.length > 0 ? tenantId : undefined;
  next();
}

export function requireTenantContext(req: Request, res: Response, next: NextFunction): void {
  if (!req.tenantId) {
    res.status(400).json({ error: "Tenant context missing" });
    return;
  }

  next();
}
