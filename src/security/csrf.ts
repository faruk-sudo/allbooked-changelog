import type { NextFunction, Request, Response } from "express";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requireCsrfToken(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const token = req.header("x-csrf-token");
  if (!token || token.length < 16) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  next();
}
