/**
 * Applique les migrations avec le rôle propriétaire, installe le schéma pg-boss
 * et donne au rôle applicatif cir_app les droits nécessaires.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import PgBoss from "pg-boss";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config";
import { QUEUES } from "../jobs/queues";


export async function runMigrations(ownerUrl = config.DATABASE_OWNER_URL, log = console.log) {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "drizzle") });
    log("Migrations appliquées.");

    if (config.DB_APP_PASSWORD) {
      await client.query(`ALTER ROLE cir_app LOGIN PASSWORD '${config.DB_APP_PASSWORD.replace(/'/g, "''")}'`);
    }
  } finally {
    await client.end();
  }

  // Schéma et files pg-boss créés par le propriétaire (le rôle applicatif n'a pas de droit DDL).
  const boss = new PgBoss({ connectionString: ownerUrl, schema: "pgboss" });
  boss.on("error", (e) => log(`pg-boss: ${e.message}`));
  await boss.start();
  for (const q of Object.values(QUEUES)) {
    if (!(await boss.getQueue(q))) await boss.createQueue(q);
  }
  await boss.stop({ graceful: false });

  const grant = new pg.Client({ connectionString: ownerUrl });
  await grant.connect();
  try {
    await grant.query(`
      GRANT USAGE ON SCHEMA pgboss TO cir_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO cir_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO cir_app;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO cir_app;
    `);
  } finally {
    await grant.end();
  }
  log("Schéma pg-boss prêt.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
