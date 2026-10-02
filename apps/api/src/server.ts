import { config } from "./config";
import { createApp } from "./app";
import { startBoss, stopBoss } from "./jobs/boss";
import { pool } from "./db/client";
import { logger } from "./lib/logger";

const app = createApp();
await startBoss(config.RUN_WORKERS_IN_API);
const server = app.listen(config.PORT, () => logger.info(`API prête sur http://localhost:${config.PORT}`));

async function shutdown() {
  server.close();
  await stopBoss();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
