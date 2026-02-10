import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config";

function isPublisherAllowlisted(req: Request, config: AppConfig): boolean {
  const userId = req.auth?.userId;
  const email = req.auth?.email?.toLowerCase();

  if (userId && config.publisherAllowlistedUserIds.has(userId)) {
    return true;
  }

  if (email && config.publisherAllowlistedEmails.has(email)) {
    return true;
  }

  return false;
}

export function requirePublisherAllowlisted(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isPublisherAllowlisted(req, config)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    next();
  };
}
