import { createDatabasePool } from "../../src/db/connection";
import { migrateDown } from "../../src/db/migrations";
import { formatError } from "./format-error";

function parseSteps(argv: string[]): number {
  if (argv.length < 3) {
    return 1;
  }

  const value = Number(argv[2]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Usage: npm run db:migrate:down -- <positive-integer-steps>");
  }

  return value;
}

async function main() {
  const steps = parseSteps(process.argv);
  const pool = createDatabasePool();

  try {
    const rolledBack = await migrateDown(pool, steps);
    if (rolledBack.length === 0) {
      console.info("No migrations to roll back.");
      return;
    }

    console.info(`Rolled back migrations: ${rolledBack.join(", ")}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`Rollback failed:\n${formatError(error)}`);
  process.exitCode = 1;
});
