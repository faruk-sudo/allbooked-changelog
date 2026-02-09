import { inspect } from "node:util";

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return inspect(error, { depth: 4 });
}
