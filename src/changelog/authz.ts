import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config";
import { isTenantAllowlisted } from "../security/allowlist";
import { getWhatsNewRequestContext, type WhatsNewRequestContext } from "./request-context";

interface GuardedWhatsNewContext extends WhatsNewRequestContext {
  userId: string;
  tenantId: string;
  isAuthenticated: true;
  isAdmin: true;
}

function notFound(res: Response): void {
  res.status(404).json({ error: "Not found" });
}

export function requireWhatsNewEnabled(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const context = getWhatsNewRequestContext(req);

    if (!context.tenantId) {
      res.status(400).json({ error: "Tenant context missing" });
      return;
    }

    if (!isTenantAllowlisted(context.tenantId, config)) {
      notFound(res);
      return;
    }

    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const context = getWhatsNewRequestContext(req);

  if (!context.isAuthenticated || !context.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!context.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  next();
}

export function isPublisherAllowlisted(context: WhatsNewRequestContext, config: AppConfig): boolean {
  if (context.userId && config.publisherAllowlistedUserIds.has(context.userId)) {
    return true;
  }

  const email = context.email?.toLowerCase();
  if (email && config.publisherAllowlistedEmails.has(email)) {
    return true;
  }

  return false;
}

export function requirePublisher(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const context = getWhatsNewRequestContext(req);

    if (!isPublisherAllowlisted(context, config)) {
      notFound(res);
      return;
    }

    next();
  };
}

export function getGuardedWhatsNewContext(req: Request): GuardedWhatsNewContext {
  const context = getWhatsNewRequestContext(req);

  if (!context.userId || !context.tenantId || !context.isAuthenticated || !context.isAdmin) {
    throw new Error("What's New guard context missing required fields");
  }

  return {
    ...context,
    userId: context.userId,
    tenantId: context.tenantId,
    isAuthenticated: true,
    isAdmin: true
  };
}
