import { groupCreateSchema, groupJoinSchema, type FiscalYearStatus, type GroupOverviewRowDto } from "@cir/shared";
import { and, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db, schema, withTenant } from "../../db/client";
import { hashToken, randomToken } from "../../lib/crypto";
import { conflict, forbidden, notFound, parse } from "../../lib/errors";
import { requireAuth, requireRole, run } from "../../middlewares/auth";
import { param } from "../../lib/http";

/** Routes groupe sans société active (lecture de la vue groupe). */
export const groupsRouter = Router();
/** Routes groupe dans le contexte de la société active. */
export const companyGroupRouter = Router();

async function assertGroupRole(groupId: string, userId: string, owner = false) {
  const [m] = await db
    .select()
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, userId)));
  if (!m || (owner && m.role !== "owner")) throw forbidden("Accès refusé à ce groupe");
}

const newJoinCode = () => randomToken(9).replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase();

groupsRouter.get("/groups/:id/overview", requireAuth, async (req, res) => {
  await assertGroupRole(param(req), req.auth!.userId);
  const rows = await withTenant({ companyId: null, userId: req.auth!.userId }, (tx) =>
    tx.execute<{ company_id: string; company_name: string; siren: string; fiscal_year_label: string | null; status: string | null; progress: number | null }>(
      sql`select * from app_group_overview(${param(req)})`,
    ),
  );
  const [group] = await db.select({ name: schema.groups.name }).from(schema.groups).where(eq(schema.groups.id, param(req)));
  res.json({
    group: { id: req.params.id, name: group?.name ?? "" },
    companies: rows.rows.map(
      (r): GroupOverviewRowDto => ({
        companyId: r.company_id,
        companyName: r.company_name,
        siren: r.siren,
        fiscalYearLabel: r.fiscal_year_label,
        status: r.status as FiscalYearStatus | null,
        progress: r.progress,
        cirAmount: null,
      }),
    ),
  });
});

groupsRouter.get("/groups/:id/readers", requireAuth, async (req, res) => {
  await assertGroupRole(param(req), req.auth!.userId, true);
  const rows = await db
    .select({ userId: schema.users.id, email: schema.users.email, fullName: schema.users.fullName, role: schema.groupMembers.role })
    .from(schema.groupMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.groupMembers.userId))
    .where(eq(schema.groupMembers.groupId, param(req)));
  res.json(rows);
});

groupsRouter.post("/groups/:id/readers", requireAuth, async (req, res) => {
  await assertGroupRole(param(req), req.auth!.userId, true);
  const { email } = parse(z.object({ email: z.email().transform((e) => e.toLowerCase()) }), req.body);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) throw notFound("Aucun compte avec cet email : la personne doit d'abord s'inscrire ou être invitée dans une société");
  await db.insert(schema.groupMembers).values({ groupId: param(req), userId: user.id, role: "reader" }).onConflictDoNothing();
  res.status(201).json({ ok: true });
});

groupsRouter.post("/groups/:id/join-code", requireAuth, async (req, res) => {
  await assertGroupRole(param(req), req.auth!.userId, true);
  const code = newJoinCode();
  await db.update(schema.groups).set({ joinCodeHash: hashToken(code) }).where(eq(schema.groups.id, param(req)));
  res.json({ joinCode: code });
});

/** Crée un groupe depuis la société active (qui y est rattachée) ; renvoie le code de rattachement. */
companyGroupRouter.post("/company/group", requireRole("admin"), async (req, res) => {
  const { name } = parse(groupCreateSchema, req.body);
  const code = newJoinCode();
  const [group] = await db.insert(schema.groups).values({ name, joinCodeHash: hashToken(code), createdBy: req.auth!.userId }).returning();
  await db.insert(schema.groupMembers).values({ groupId: group!.id, userId: req.auth!.userId, role: "owner" });
  await run(req, (tx) => tx.update(schema.companies).set({ groupId: group!.id }).where(eq(schema.companies.id, req.company!.companyId)));
  res.status(201).json({ group: { id: group!.id, name: group!.name }, joinCode: code });
});

/** Rattache la société active à un groupe existant : l'administrateur de la société saisit le code fourni par le groupe. */
companyGroupRouter.post("/company/group/join", requireRole("admin"), async (req, res) => {
  const { code } = parse(groupJoinSchema, req.body);
  const [group] = await db.select().from(schema.groups).where(eq(schema.groups.joinCodeHash, hashToken(code.trim().toUpperCase())));
  if (!group) throw notFound("Code de groupe invalide");
  await run(req, async (tx) => {
    const [c] = await tx.select({ groupId: schema.companies.groupId }).from(schema.companies).where(eq(schema.companies.id, req.company!.companyId));
    if (c?.groupId === group.id) throw conflict("Société déjà rattachée à ce groupe");
    await tx.update(schema.companies).set({ groupId: group.id }).where(eq(schema.companies.id, req.company!.companyId));
  });
  res.json({ group: { id: group.id, name: group.name } });
});

companyGroupRouter.delete("/company/group", requireRole("admin"), async (req, res) => {
  await run(req, (tx) => tx.update(schema.companies).set({ groupId: null }).where(eq(schema.companies.id, req.company!.companyId)));
  res.status(204).end();
});
