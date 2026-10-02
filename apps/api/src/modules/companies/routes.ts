import { companyUpdateSchema, createCompanySchema, rescritSchema, type CompanyDto, type RescritDto } from "@cir/shared";
import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { config } from "../../config";
import { db, schema, withTenant } from "../../db/client";
import { conflict, notFound, parse } from "../../lib/errors";
import { uuidv7 } from "../../lib/ids";
import { requireAuth, requireRole, run } from "../../middlewares/auth";
import { getCompany } from "../common";
import { param } from "../../lib/http";

/** Routes de la société active (montées derrière requireAuth + requireCompany). */
export const companiesRouter = Router();
/** Routes sans société active. */
export const companyCreateRouter = Router();

function toDto(c: typeof schema.companies.$inferSelect, groupName: string | null): CompanyDto {
  return {
    id: c.id,
    siren: c.siren,
    name: c.name,
    nafCode: c.nafCode,
    sector: c.sector,
    headcountTotal: c.headcountTotal,
    headcountRd: c.headcountRd,
    rdOrganization: c.rdOrganization,
    hoursPerDay: c.hoursPerDay,
    annualHoursCap: c.annualHoursCap,
    unlinkedThreshold: c.unlinkedThreshold,
    referentName: c.referentName,
    referentRole: c.referentRole,
    referentPhone: c.referentPhone,
    referentEmail: c.referentEmail,
    groupId: c.groupId,
    groupName,
  };
}

async function groupName(groupId: string | null) {
  if (!groupId) return null;
  const [g] = await db.select({ name: schema.groups.name }).from(schema.groups).where(eq(schema.groups.id, groupId));
  return g?.name ?? null;
}

/** Créer une société supplémentaire (utilisateur déjà inscrit, ex. holding ou SSO). */
companyCreateRouter.post("/companies", requireAuth, async (req, res) => {
  const input = parse(createCompanySchema, req.body);
  const companyId = uuidv7();
  const userId = req.auth!.userId;
  try {
    await withTenant({ companyId, userId, ip: req.ip }, async (tx) => {
      await tx.insert(schema.companies).values({
        id: companyId,
        siren: input.siren,
        name: input.name,
        createdBy: userId,
        trialEndsAt: new Date(Date.now() + config.TRIAL_DAYS * 86_400_000),
      });
      await tx.insert(schema.memberships).values({ companyId, userId, role: "admin", createdBy: userId });
      await tx.insert(schema.subscriptions).values({ companyId, status: "none" });
    });
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
    if (code === "23505") throw conflict("Une société avec ce SIREN est déjà inscrite");
    throw e;
  }
  await db.update(schema.sessions).set({ activeCompanyId: companyId }).where(eq(schema.sessions.id, req.auth!.sessionId));
  res.status(201).json({ id: companyId });
});

const scoped = companiesRouter;

scoped.get("/company", async (req, res) => {
  const c = await run(req, (tx) => getCompany(tx, req.company!.companyId));
  res.json(toDto(c, await groupName(c.groupId)));
});

scoped.put("/company", requireRole("admin"), async (req, res) => {
  const input = parse(companyUpdateSchema, req.body);
  const c = await run(req, async (tx) => {
    const [row] = await tx
      .update(schema.companies)
      .set({ ...input, referentEmail: input.referentEmail || null })
      .where(eq(schema.companies.id, req.company!.companyId))
      .returning();
    return row!;
  });
  res.json(toDto(c, await groupName(c.groupId)));
});

/* --------------------------- Rescrits et agréments --------------------------- */

const rescritDto = (r: typeof schema.rescrits.$inferSelect): RescritDto => ({
  id: r.id,
  type: r.type as RescritDto["type"],
  decisionDate: r.decisionDate,
  decision: r.decision as RescritDto["decision"],
  years: r.years,
});

scoped.get("/company/rescrits", async (req, res) => {
  const rows = await run(req, (tx) => tx.select().from(schema.rescrits).orderBy(asc(schema.rescrits.createdAt)));
  res.json(rows.map(rescritDto));
});

scoped.post("/company/rescrits", requireRole("admin"), async (req, res) => {
  const input = parse(rescritSchema, req.body);
  const [row] = await run(req, (tx) =>
    tx.insert(schema.rescrits).values({ ...input, companyId: req.company!.companyId, createdBy: req.auth!.userId }).returning(),
  );
  res.status(201).json(rescritDto(row!));
});

scoped.put("/company/rescrits/:id", requireRole("admin"), async (req, res) => {
  const input = parse(rescritSchema, req.body);
  const [row] = await run(req, (tx) => tx.update(schema.rescrits).set(input).where(eq(schema.rescrits.id, param(req))).returning());
  if (!row) throw notFound();
  res.json(rescritDto(row));
});

scoped.delete("/company/rescrits/:id", requireRole("admin"), async (req, res) => {
  await run(req, (tx) => tx.delete(schema.rescrits).where(eq(schema.rescrits.id, param(req))));
  res.status(204).end();
});
