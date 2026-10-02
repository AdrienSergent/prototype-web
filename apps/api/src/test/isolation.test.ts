/**
 * Isolation multi-tenant (exigence non fonctionnelle) : RLS PostgreSQL testée automatiquement.
 */
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { enableMfa, signup, type Client } from "./helpers";

let a: Client;
let b: Client;
let aProjectId: string;
let aCompanyId: string;
let bCompanyId: string;

describe("Isolation entre sociétés", () => {
  beforeAll(async () => {
    a = await signup("ceo@alpha.test", "Alpha");
    b = await signup("ceo@beta.test", "Beta");
    await enableMfa(a);
    await enableMfa(b);
    aCompanyId = (await a.me()).activeCompanyId as string;
    bCompanyId = (await b.me()).activeCompanyId as string;
    const fy = await a.post("/fiscal-years", { label: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    const p = await a.post("/projects", { fiscalYearId: fy.body.id, code: "SECRET", title: "Projet confidentiel", startDate: "2026-01-01" });
    aProjectId = p.body.id;
    await a.post("/people", { firstName: "Alice", lastName: "Secret", status: "chercheur", isSupportFunction: false });
  });

  it("une société ne lit ni n'écrit les données d'une autre via l'API", async () => {
    expect((await b.get(`/projects/${aProjectId}`)).status).toBe(404);
    expect((await b.put(`/projects/${aProjectId}`, { code: "X", title: "Piraté", startDate: "2026-01-01" })).status).toBe(404);
    expect((await b.get("/people")).body).toHaveLength(0);
    // Changer de société active sans en être membre est refusé
    expect((await b.post("/auth/switch-company", { companyId: aCompanyId })).status).toBe(403);
  });

  it("toute table portant company_id a une politique RLS", async () => {
    const owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await owner.connect();
    const r = await owner.query(`
      select c.table_name
        from information_schema.columns c
        join pg_class t on t.relname = c.table_name and t.relkind = 'r'
       where c.table_schema = 'public' and c.column_name = 'company_id'
         and (not t.relrowsecurity or not exists (select 1 from pg_policies p where p.tablename = c.table_name))`);
    await owner.end();
    expect(r.rows).toEqual([]);
  });

  it("au niveau SQL, le rôle applicatif ne voit aucune ligne d'une autre société", async () => {
    const app = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    const tables = (
      await app.query(`select table_name from information_schema.columns where table_schema='public' and column_name='company_id' and table_name <> 'audit_log'`)
    ).rows.map((r) => r.table_name as string);
    await app.query("begin");
    await app.query("select set_config('app.company_id', $1, true)", [bCompanyId]);
    for (const t of tables) {
      const rows = await app.query(`select count(*)::int as n from ${t} where company_id = $1`, [aCompanyId]);
      expect(rows.rows[0].n, t).toBe(0);
    }
    const companies = await app.query("select count(*)::int as n from companies where id = $1", [aCompanyId]);
    expect(companies.rows[0].n).toBe(0);
    // Écriture forcée dans une autre société : refusée par WITH CHECK
    await expect(app.query("insert into rescrits (id, company_id, type, decision) values (gen_random_uuid(), $1, 'rescrit_cir', 'favorable')", [aCompanyId])).rejects.toThrow(/row-level security/);
    await app.query("rollback");
    // Sans contexte société : rien n'est visible
    const none = await app.query("select count(*)::int as n from projects");
    expect(none.rows[0].n).toBe(0);
    await app.end();
  });

  it("le journal d'audit refuse modification et suppression, même pour le propriétaire", async () => {
    const owner = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await owner.connect();
    await expect(owner.query("update audit_log set action = 'x'")).rejects.toThrow(/insertion seule/);
    await expect(owner.query("delete from audit_log")).rejects.toThrow(/insertion seule/);
    await owner.end();
    const app = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    await expect(app.query("insert into audit_log (action, entity, hash) values ('x','y','z')")).rejects.toThrow(/permission denied/);
    await app.end();
  });

  it("la vue groupe n'expose que statut et avancement, et seulement aux membres du groupe", async () => {
    const g = await a.post("/company/group", { name: "Holding Alpha" });
    expect(g.status).toBe(201);
    const join = await b.post("/company/group/join", { code: g.body.joinCode });
    expect(join.status).toBe(200);
    const overview = await a.get(`/groups/${g.body.group.id}/overview`);
    expect(overview.body.companies).toHaveLength(2);
    const row = overview.body.companies.find((c: { companyName: string }) => c.companyName === "Beta");
    expect(Object.keys(row).sort()).toEqual(["cirAmount", "companyId", "companyName", "fiscalYearLabel", "progress", "siren", "status"]);
    expect((await b.get(`/groups/${g.body.group.id}/overview`)).status).toBe(403);
  });
});
