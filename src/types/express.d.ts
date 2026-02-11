import type { AuthContext } from "./context";
import type { WhatsNewRequestContext } from "../changelog/request-context";
import type { PublicChangelogPolicy } from "../changelog/public-surface";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      tenantId?: string;
      whatsNewContext?: WhatsNewRequestContext;
      publicChangelogPolicy?: PublicChangelogPolicy;
    }
  }
}

export {};
