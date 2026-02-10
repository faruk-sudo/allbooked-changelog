import { Pool, type PoolConfig } from "pg";

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return defaultValue;
}

export function buildDatabaseConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const sslEnabled = parseBoolean(env.DATABASE_SSL, false);
  const rejectUnauthorized = parseBoolean(env.DATABASE_SSL_REJECT_UNAUTHORIZED, true);

  return {
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized } : undefined
  };
}

export function createDatabasePool(env: NodeJS.ProcessEnv = process.env): Pool {
  return new Pool(buildDatabaseConfig(env));
}
