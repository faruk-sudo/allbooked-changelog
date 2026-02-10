import { createApp } from "./app";
import { PostgresChangelogRepository } from "./changelog/repository";
import { loadConfig } from "./config";
import { createDatabasePool } from "./db/connection";

const config = loadConfig();
const databasePool = createDatabasePool();
const repository = new PostgresChangelogRepository(databasePool);
const app = createApp(config, { changelogRepository: repository });

app.listen(config.port, () => {
  console.info(`allbooked-changelog listening on port ${config.port}`);
});

async function shutdown(): Promise<void> {
  await databasePool.end();
}

process.on("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});
