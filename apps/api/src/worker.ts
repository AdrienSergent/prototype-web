/** Processus de tâches de fond (scellement, rappels) quand RUN_WORKERS_IN_API=false. */
import { startBoss, stopBoss } from "./jobs/boss";
import { logger } from "./lib/logger";

await startBoss(true);
logger.info("Worker pg-boss démarré");
process.on("SIGTERM", async () => {
  await stopBoss();
  process.exit(0);
});
