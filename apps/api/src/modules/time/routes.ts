import { formatDate, formatMonth, timeEntrySchema, type TimeAlertDto, type TimeGranularity, type UnlinkedStatDto } from "@cir/shared";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import { schema, type Tx } from "../../db/client";
import { forbidden, notFound, parse } from "../../lib/errors";
import { hasRole, run } from "../../middlewares/auth";
import { contributorScope, editableFiscalYear, getCompany, getFiscalYear, getProject, personName, personOfUser } from "../common";
import { capacityViolations } from "./capacity";
import { employmentOk, entryFilters, toTimeDtos, validateEntry } from "./service";
import { param } from "../../lib/http";

export const timeRouter = Router();

const listQuery = z.object({
  fiscalYearId: z.uuid(),
  personId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

timeRouter.get("/time-entries", async (req, res) => {
  const q = parse(listQuery, req.query);
  const out = await run(req, async (tx) => {
    const scope = await contributorScope(req, tx);
    if (scope) {
      if (!scope.personId) return [];
      q.personId = scope.personId;
    }
    const rows = await tx.select().from(schema.timeEntries).where(entryFilters(q)).orderBy(asc(schema.timeEntries.entryDate));
    return toTimeDtos(tx, rows);
  });
  res.json(out);
});

async function checkWriteRights(req: Request, tx: Tx, personId: string) {
  if (hasRole(req, "expert")) throw forbidden();
  if (hasRole(req, "contributeur")) {
    const me = await personOfUser(tx, req.auth!.userId);
    if (me?.id !== personId) throw forbidden("Vous ne pouvez saisir que vos propres temps");
  }
}

async function hoursOf(tx: Tx, companyId: string, quantity: number, unit: "hours" | "days") {
  if (unit === "hours") return quantity;
  const company = await getCompany(tx, companyId);
  return quantity * company.hoursPerDay;
}

timeRouter.post("/time-entries", async (req, res) => {
  const input = parse(timeEntrySchema, req.body);
  const out = await run(req, async (tx) => {
    await checkWriteRights(req, tx, input.personId);
    const project = await getProject(tx, input.projectId);
    const fy = await editableFiscalYear(tx, project.fiscalYearId);
    const hours = await hoursOf(tx, fy.companyId, input.quantity, input.unit);
    const v = await validateEntry(tx, fy, { ...input, hours });
    const [row] = await tx
      .insert(schema.timeEntries)
      .values({
        companyId: fy.companyId,
        createdBy: req.auth!.userId,
        fiscalYearId: fy.id,
        personId: v.personId,
        projectId: v.projectId,
        operationId: v.operationId ?? null,
        entryDate: v.date,
        granularity: v.granularity,
        hours: v.hours,
        noteId: v.noteId ?? null,
        source: "manual",
      })
      .returning();
    return (await toTimeDtos(tx, [row!]))[0];
  });
  res.status(201).json(out);
});

timeRouter.put("/time-entries/:id", async (req, res) => {
  const input = parse(timeEntrySchema, req.body);
  const out = await run(req, async (tx) => {
    const [current] = await tx.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, param(req)));
    if (!current) throw notFound();
    await checkWriteRights(req, tx, current.personId);
    await checkWriteRights(req, tx, input.personId);
    const project = await getProject(tx, input.projectId);
    const fy = await editableFiscalYear(tx, project.fiscalYearId);
    const hours = await hoursOf(tx, fy.companyId, input.quantity, input.unit);
    const v = await validateEntry(tx, fy, { ...input, hours }, { excludeIds: [current.id] });
    const [row] = await tx
      .update(schema.timeEntries)
      .set({ personId: v.personId, projectId: v.projectId, operationId: v.operationId ?? null, entryDate: v.date, granularity: v.granularity, hours: v.hours, noteId: v.noteId ?? null })
      .where(eq(schema.timeEntries.id, current.id))
      .returning();
    return (await toTimeDtos(tx, [row!]))[0];
  });
  res.json(out);
});

timeRouter.delete("/time-entries/:id", async (req, res) => {
  await run(req, async (tx) => {
    const [current] = await tx.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, param(req)));
    if (!current) throw notFound();
    await checkWriteRights(req, tx, current.personId);
    await editableFiscalYear(tx, current.fiscalYearId);
    await tx.delete(schema.timeEntries).where(eq(schema.timeEntries.id, current.id));
  });
  res.status(204).end();
});

/** Alertes F3.4 : capacité dépassée, temps hors période d'emploi, fonctions support ; part des temps non rattachés. */
timeRouter.get("/time-entries/alerts", async (req, res) => {
  const { fiscalYearId } = parse(z.object({ fiscalYearId: z.uuid() }), req.query);
  const out = await run(req, async (tx) => {
    const fy = await getFiscalYear(tx, fiscalYearId);
    const company = await getCompany(tx, fy.companyId);
    const scope = await contributorScope(req, tx);
    const entries = await tx
      .select()
      .from(schema.timeEntries)
      .where(and(eq(schema.timeEntries.fiscalYearId, fy.id), scope ? eq(schema.timeEntries.personId, scope.personId ?? "00000000-0000-0000-0000-000000000000") : undefined));
    const personIds = [...new Set(entries.map((e) => e.personId))];
    const people = personIds.length ? await tx.select().from(schema.people).where(inArray(schema.people.id, personIds)) : [];
    const pMap = new Map(people.map((p) => [p.id, p]));
    const alerts: TimeAlertDto[] = [];
    for (const v of capacityViolations(
      entries.map((e) => ({ personId: e.personId, date: e.entryDate, granularity: e.granularity as TimeGranularity, hours: e.hours })),
      { hoursPerDay: company.hoursPerDay, annualHoursCap: company.annualHoursCap },
    )) {
      alerts.push({ ...v, personName: personName(pMap.get(v.personId)!) });
    }
    for (const e of entries) {
      const p = pMap.get(e.personId);
      if (p && !employmentOk(p, e.entryDate, e.granularity as TimeGranularity)) {
        alerts.push({
          kind: "outside_employment",
          personId: p.id,
          personName: personName(p),
          period: e.entryDate,
          hours: e.hours,
          capacity: null,
          message: `Temps hors période d'emploi (${e.granularity === "month" ? formatMonth(e.entryDate) : formatDate(e.entryDate)})`,
        });
      }
    }
    for (const p of people.filter((x) => x.isSupportFunction)) {
      const hours = entries.filter((e) => e.personId === p.id).reduce((s, e) => s + e.hours, 0);
      alerts.push({
        kind: "support_function",
        personId: p.id,
        personName: personName(p),
        period: "exercice",
        hours,
        capacity: null,
        message: "Fonction support (administratif, commercial, juridique…) : ces heures ne sont pas du temps de personnel R&D",
      });
    }
    const projects = await tx
      .select({ id: schema.projects.id, code: schema.projects.code })
      .from(schema.projects)
      .where(and(eq(schema.projects.fiscalYearId, fy.id), isNull(schema.projects.deletedAt)));
    const unlinked: UnlinkedStatDto[] = projects
      .map((p) => {
        const list = entries.filter((e) => e.projectId === p.id);
        const totalHours = list.reduce((s, e) => s + e.hours, 0);
        const unlinkedHours = list.filter((e) => !e.noteId).reduce((s, e) => s + e.hours, 0);
        return { projectId: p.id, projectCode: p.code, totalHours, unlinkedHours, ratio: totalHours ? unlinkedHours / totalHours : 0 };
      })
      .filter((s) => !scope || scope.projectIds.includes(s.projectId));
    const byPerson = people.map((p) => {
      const list = entries.filter((e) => e.personId === p.id);
      const totalHours = list.reduce((s, e) => s + e.hours, 0);
      const unlinkedHours = list.filter((e) => !e.noteId).reduce((s, e) => s + e.hours, 0);
      return { personId: p.id, personName: personName(p), totalHours, unlinkedHours, ratio: totalHours ? unlinkedHours / totalHours : 0 };
    });
    return { alerts, unlinked, byPerson, threshold: company.unlinkedThreshold / 100 };
  });
  res.json(out);
});
