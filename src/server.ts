import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  console.info(`allbooked-changelog listening on port ${config.port}`);
});
