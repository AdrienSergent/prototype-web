import pg from "pg";
import { rm } from "node:fs/promises";

/** Base de test vierge à chaque exécution : schémas supprimés puis migrations rejouées. */
export default async function setup() {
  const ownerUrl = process.env.TEST_DATABASE_OWNER_URL ?? "postgres://cir_owner:cir_owner@localhost:5432/cir_test";
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;`);
  await client.end();
  await rm("./storage-test", { recursive: true, force: true });
  process.env.DATABASE_OWNER_URL = ownerUrl;
  process.env.DB_APP_PASSWORD = "cir_app";
  process.env.NODE_ENV = "test";
  const { runMigrations } = await import("../db/migrate");
  await runMigrations(ownerUrl, () => {});
}
