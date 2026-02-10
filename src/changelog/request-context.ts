import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config";
import type { AuthContext, UserRole } from "../types/context";

export interface WhatsNewRequestContext {
  userId?: string;
  email?: string;
  role: UserRole;
  isAuthenticated: boolean;
  isAdmin: boolean;
  tenantId?: string;
}

function normalizeRole(rawRole: string | undefined): UserRole {
  return rawRole?.toUpperCase() === "ADMIN" ? "ADMIN" : "USER";
}

function normalizeOptionalValue(input: string | undefined): string | undefined {
  const normalized = input?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function toExpressAuthContext(context: WhatsNewRequestContext): AuthContext | undefined {
  if (!context.userId || !context.isAuthenticated) {
    return undefined;
  }

  return {
    userId: context.userId,
    email: context.email,
    role: context.role,
    isAuthenticated: true
  };
}

function deriveContextFromHeaders(req: Request): WhatsNewRequestContext {
  const userId = normalizeOptionalValue(req.header("x-user-id") ?? undefined);
  const email = normalizeOptionalValue(req.header("x-user-email") ?? undefined);
  const role = normalizeRole(req.header("x-user-role") ?? undefined);

  return {
    userId,
    email,
    role,
    isAuthenticated: Boolean(userId),
    isAdmin: Boolean(userId) && role === "ADMIN",
    tenantId: normalizeOptionalValue(req.header("x-tenant-id") ?? undefined)
  };
}

function applyDevFallback(context: WhatsNewRequestContext, config: AppConfig): WhatsNewRequestContext {
  if (!config.devAuthBypassEnabled) {
    return context;
  }

  const withAuthFallback = context.userId
    ? context
    : {
        ...context,
        userId: config.devAuthBypassUserId,
        email: context.email ?? config.devAuthBypassUserEmail,
        role: config.devAuthBypassUserRole,
        isAuthenticated: true
      };

  const tenantId = withAuthFallback.tenantId ?? config.devAuthBypassTenantId;

  return {
    ...withAuthFallback,
    tenantId,
    isAdmin: withAuthFallback.role === "ADMIN" && withAuthFallback.isAuthenticated
  };
}

export function hydrateWhatsNewRequestContext(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const context = applyDevFallback(deriveContextFromHeaders(req), config);

    req.whatsNewContext = context;
    req.auth = toExpressAuthContext(context);
    req.tenantId = context.tenantId;

    next();
  };
}

export function getWhatsNewRequestContext(req: Request): WhatsNewRequestContext {
  if (req.whatsNewContext) {
    return req.whatsNewContext;
  }

  const auth = req.auth;
  const role = auth?.role ?? "USER";

  return {
    userId: auth?.userId,
    email: auth?.email,
    role,
    isAuthenticated: Boolean(auth?.isAuthenticated && auth.userId),
    isAdmin: role === "ADMIN" && Boolean(auth?.isAuthenticated && auth.userId),
    tenantId: req.tenantId
  };
}
