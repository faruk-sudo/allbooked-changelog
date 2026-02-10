import type { NextFunction, Request, Response } from "express";
import type { AuthContext, UserRole } from "../types/context";

function normalizeRole(rawRole: string | undefined): UserRole {
  return rawRole?.toUpperCase() === "ADMIN" ? "ADMIN" : "USER";
}

export function hydrateAuthFromHeaders(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.header("x-user-id");
  if (!userId) {
    req.auth = undefined;
    next();
    return;
  }

  const authContext: AuthContext = {
    userId,
    email: req.header("x-user-email")?.trim(),
    role: normalizeRole(req.header("x-user-role")),
    isAuthenticated: true
  };

  req.auth = authContext;
  next();
}

export function requireAuthenticated(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.isAuthenticated) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  next();
}
