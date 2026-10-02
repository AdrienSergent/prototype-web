/** Réinitialise la base de développement (schémas supprimés, migrations rejouées). Interdit en production. */
import pg from "pg";
import { config, isProd } from "../config";
import { runMigrations } from "./migrate";

if (isProd) {
  console.error("Réinitialisation interdite en production.");
  process.exit(1);
}
const client = new pg.Client({ connectionString: config.DATABASE_OWNER_URL });
await client.connect();
await client.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;");
await client.end();
await runMigrations();
process.exit(0);
