import type { AuthContext } from "./context";
import type { WhatsNewRequestContext } from "../changelog/request-context";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      tenantId?: string;
      whatsNewContext?: WhatsNewRequestContext;
    }
  }
}

export {};
