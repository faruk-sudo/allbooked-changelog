import type { AuthContext } from "./context";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      tenantId?: string;
    }
  }
}

export {};
