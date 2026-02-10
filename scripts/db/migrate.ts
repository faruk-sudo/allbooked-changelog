import { createDatabasePool } from "../../src/db/connection";
import { migrateUp } from "../../src/db/migrations";
import { formatError } from "./format-error";

async function main() {
  const pool = createDatabasePool();
  try {
    const applied = await migrateUp(pool);
    if (applied.length === 0) {
      console.info("No pending migrations.");
      return;
    }

    console.info(`Applied migrations: ${applied.join(", ")}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`Migration failed:\n${formatError(error)}`);
  process.exitCode = 1;
});
