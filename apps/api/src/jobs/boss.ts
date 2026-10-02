import PgBoss from "pg-boss";
import { config } from "../config";
import { logger } from "../lib/logger";
import { QUEUES } from "./queues";

let boss: PgBoss | null = null;
const inlineHandlers = new Map<string, (data: never) => Promise<void>>();

export function registerInlineHandler<T>(queue: string, fn: (data: T) => Promise<void>) {
  inlineHandlers.set(queue, fn as (data: never) => Promise<void>);
}

/** Démarre pg-boss (schéma créé à la migration ; le rôle applicatif n'a pas de droit DDL). */
export async function startBoss(withWorkers: boolean) {
  boss = new PgBoss({ connectionString: config.DATABASE_URL, schema: "pgboss", migrate: false, schedule: withWorkers, supervise: withWorkers });
  boss.on("error", (err) => logger.error({ err }, "pg-boss"));
  await boss.start();
  if (withWorkers) {
    const { registerWorkers } = await import("./workers");
    await registerWorkers(boss);
  }
  return boss;
}

export async function stopBoss() {
  await boss?.stop({ graceful: true });
  boss = null;
}

/** Envoie un travail en file ; sans pg-boss démarré (tests), l'exécute immédiatement. */
export async function enqueue<T extends object>(queue: (typeof QUEUES)[keyof typeof QUEUES], data: T) {
  if (boss) {
    await boss.send(queue, data, { retryLimit: 3, retryDelay: 30, retryBackoff: true });
    return;
  }
  const handler = inlineHandlers.get(queue);
  if (handler) await handler(data as never);
}
