import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config";
import * as schema from "./schema";

// Les colonnes DATE restent des chaînes « AAAA-MM-JJ » (pas de conversion de fuseau).
pg.types.setTypeParser(1082, (v) => v);

// Fuseau UTC côté session : le chaînage du journal d'audit doit être recalculable à l'identique.
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 20, options: "-c TimeZone=UTC" });

export const db = drizzle(pool, { schema, casing: "snake_case" });
export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export interface TenantContext {
  companyId: string | null;
  userId: string | null;
  ip?: string | null;
}

/**
 * Exécute fn dans une transaction où la société et l'utilisateur courants sont posés
 * (SET LOCAL) : les politiques RLS PostgreSQL s'appliquent à toutes les requêtes.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.company_id', ${ctx.companyId ?? ""}, true),
                 set_config('app.user_id', ${ctx.userId ?? ""}, true),
                 set_config('app.ip', ${ctx.ip ?? ""}, true)`,
    );
    return fn(tx);
  });
}

export { schema };
