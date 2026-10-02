import {
  checkVerdict,
  FRASCATI_CRITERIA,
  frascatiAnswersSchema,
  frascatiComplete,
  operationSchema,
  projectSchema,
  verdictSchema,
  type FrascatiAnswerDto,
  type FrascatiCriterion,
  type OperationDto,
  type OperationType,
  type ProjectDto,
  type SelfAssessment,
  type Verdict,
} from "@cir/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { schema, type Tx } from "../../db/client";
import { conflict, forbidden, HttpError, notFound, parse, unprocessable } from "../../lib/errors";
import { uuidv7 } from "../../lib/ids";
import { hasRole, requireRole, run } from "../../middlewares/auth";
import { assertProjectReadable, contributorScope, editableFiscalYear, editableProject, getProject, iso } from "../common";
import { ensureSections } from "../dossier/sections-service";
import { param } from "../../lib/http";

export const projectsRouter = Router();

type ProjectRow = typeof schema.projects.$inferSelect;

export async function projectDtos(tx: Tx, rows: ProjectRow[]): Promise<ProjectDto[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const answers = await tx.select().from(schema.frascatiAnswers).where(inArray(schema.frascatiAnswers.projectId, ids));
  const lockCounts = await tx
    .select({ projectId: schema.locks.projectId, n: sql<number>`count(*)::int` })
    .from(schema.locks)
    .where(and(inArray(schema.locks.projectId, ids), isNull(schema.locks.deletedAt)))
    .groupBy(schema.locks.projectId);
  const noteCounts = await tx
    .select({ projectId: schema.locks.projectId, n: sql<number>`count(*)::int` })
    .from(schema.notes)
    .innerJoin(schema.topics, eq(schema.topics.id, schema.notes.topicId))
    .innerJoin(schema.locks, eq(schema.locks.id, schema.topics.lockId))
    .where(and(inArray(schema.locks.projectId, ids), isNull(schema.notes.deletedAt)))
    .groupBy(schema.locks.projectId);
  const hours = await tx
    .select({ projectId: schema.timeEntries.projectId, h: sql<number>`coalesce(sum(${schema.timeEntries.hours}),0)::float` })
    .from(schema.timeEntries)
    .where(inArray(schema.timeEntries.projectId, ids))
    .groupBy(schema.timeEntries.projectId);
  return rows.map((p) => ({
    id: p.id,
    fiscalYearId: p.fiscalYearId,
    code: p.code,
    title: p.title,
    startDate: p.startDate,
    endDate: p.endDate,
    objectives: p.objectives,
    keywords: p.keywords,
    verdict: p.verdict as Verdict | null,
    verdictJustification: p.verdictJustification,
    verdictExpertName: p.verdictExpertName,
    verdictDate: p.verdictDate,
    frascatiComplete: frascatiComplete(
      answers.filter((a) => a.projectId === p.id).map((a) => ({ criterion: a.criterion as FrascatiCriterion, argument: a.argument, selfAssessment: a.selfAssessment as SelfAssessment })),
    ),
    lockCount: lockCounts.find((c) => c.projectId === p.id)?.n ?? 0,
    noteCount: noteCounts.find((c) => c.projectId === p.id)?.n ?? 0,
    hours: hours.find((h) => h.projectId === p.id)?.h ?? 0,
    sourceProjectId: p.sourceProjectId,
  }));
}

projectsRouter.get("/projects", async (req, res) => {
  const { fiscalYearId } = parse(z.object({ fiscalYearId: z.uuid() }), req.query);
  const out = await run(req, async (tx) => {
    const scope = await contributorScope(req, tx);
    let rows = await tx
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.fiscalYearId, fiscalYearId), isNull(schema.projects.deletedAt)))
      .orderBy(asc(schema.projects.code));
    if (scope) rows = rows.filter((r) => scope.projectIds.includes(r.id));
    return projectDtos(tx, rows);
  });
  res.json(out);
});

projectsRouter.get("/projects/:id", async (req, res) => {
  const out = await run(req, async (tx) => {
    await assertProjectReadable(req, tx, param(req));
    return (await projectDtos(tx, [await getProject(tx, param(req))]))[0];
  });
  res.json(out);
});

projectsRouter.post("/projects", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(projectSchema.extend({ fiscalYearId: z.uuid() }), req.body);
  const out = await run(req, async (tx) => {
    const fy = await editableFiscalYear(tx, input.fiscalYearId);
    const id = uuidv7();
    const [row] = await tx
      .insert(schema.projects)
      .values({ ...input, id, code: input.code.toUpperCase(), endDate: input.endDate ?? null, companyId: fy.companyId, createdBy: req.auth!.userId })
      .returning();
    await ensureSections(tx, fy.companyId, fy.id, id, req.auth!.userId);
    return (await projectDtos(tx, [row!]))[0];
  });
  res.status(201).json(out);
});

projectsRouter.put("/projects/:id", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(projectSchema, req.body);
  const out = await run(req, async (tx) => {
    const { project } = await editableProject(tx, param(req));
    const [row] = await tx
      .update(schema.projects)
      .set({ ...input, code: input.code.toUpperCase(), endDate: input.endDate ?? null })
      .where(eq(schema.projects.id, project.id))
      .returning();
    return (await projectDtos(tx, [row!]))[0];
  });
  res.json(out);
});

projectsRouter.delete("/projects/:id", requireRole("admin", "redacteur"), async (req, res) => {
  await run(req, async (tx) => {
    const { project } = await editableProject(tx, param(req));
    await tx.update(schema.projects).set({ deletedAt: new Date() }).where(eq(schema.projects.id, project.id));
  });
  res.status(204).end();
});

/* ------------------------------- Frascati ------------------------------- */

projectsRouter.get("/projects/:id/frascati", async (req, res) => {
  const out = await run(req, async (tx) => {
    await assertProjectReadable(req, tx, param(req));
    const rows = await tx.select().from(schema.frascatiAnswers).where(eq(schema.frascatiAnswers.projectId, param(req)));
    return FRASCATI_CRITERIA.map((criterion): FrascatiAnswerDto => {
      const a = rows.find((r) => r.criterion === criterion);
      return {
        criterion,
        argument: a?.argument ?? "",
        selfAssessment: (a?.selfAssessment as SelfAssessment) ?? "incertain",
        citedLockIds: a?.citedLockIds ?? [],
        citedNoteIds: a?.citedNoteIds ?? [],
        updatedAt: iso(a?.updatedAt),
      };
    });
  });
  res.json(out);
});

projectsRouter.put("/projects/:id/frascati", requireRole("admin", "redacteur"), async (req, res) => {
  const { answers } = parse(frascatiAnswersSchema, req.body);
  await run(req, async (tx) => {
    const { project } = await editableProject(tx, param(req));
    for (const a of answers) {
      await tx
        .insert(schema.frascatiAnswers)
        .values({ ...a, projectId: project.id, companyId: project.companyId, createdBy: req.auth!.userId })
        .onConflictDoUpdate({
          target: [schema.frascatiAnswers.projectId, schema.frascatiAnswers.criterion],
          set: { argument: a.argument, selfAssessment: a.selfAssessment, citedLockIds: a.citedLockIds, citedNoteIds: a.citedNoteIds },
        });
    }
  });
  res.status(204).end();
});

/** Verdict F4.3 : l'expert invité, ou l'administrateur au nom d'un expert externe (nom et date obligatoires). */
projectsRouter.post("/projects/:id/verdict", requireRole("expert", "admin"), async (req, res) => {
  const input = parse(verdictSchema, req.body);
  const out = await run(req, async (tx) => {
    const { project } = await editableProject(tx, param(req));
    const answers = await tx.select().from(schema.frascatiAnswers).where(eq(schema.frascatiAnswers.projectId, project.id));
    const error = checkVerdict(
      input.verdict,
      answers.map((a) => ({ criterion: a.criterion as FrascatiCriterion, argument: a.argument, selfAssessment: a.selfAssessment as SelfAssessment })),
    );
    if (error) throw new HttpError(422, "verdict_refused", error);
    const expertName = hasRole(req, "expert") ? req.auth!.fullName : input.expertName;
    const [row] = await tx
      .update(schema.projects)
      .set({ verdict: input.verdict, verdictJustification: input.justification, verdictExpertName: expertName, verdictDate: input.verdictDate, verdictBy: req.auth!.userId })
      .where(eq(schema.projects.id, project.id))
      .returning();
    return (await projectDtos(tx, [row!]))[0];
  });
  res.json(out);
});

/* ------------------------------- Opérations ------------------------------- */

const opDto = (o: typeof schema.operations.$inferSelect): OperationDto => ({
  id: o.id,
  projectId: o.projectId,
  title: o.title,
  titleLocked: o.titleLocked,
  startDate: o.startDate,
  endDate: o.endDate,
  type: o.type as OperationType,
});

projectsRouter.get("/projects/:id/operations", async (req, res) => {
  const out = await run(req, async (tx) => {
    await assertProjectReadable(req, tx, param(req));
    const rows = await tx.select().from(schema.operations).where(eq(schema.operations.projectId, param(req))).orderBy(asc(schema.operations.createdAt));
    return rows.map(opDto);
  });
  res.json(out);
});

projectsRouter.post("/projects/:id/operations", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(operationSchema, req.body);
  const out = await run(req, async (tx) => {
    const { project } = await editableProject(tx, param(req));
    const [row] = await tx
      .insert(schema.operations)
      .values({ ...input, startDate: input.startDate ?? null, endDate: input.endDate ?? null, projectId: project.id, lineageId: uuidv7(), companyId: project.companyId, createdBy: req.auth!.userId })
      .returning();
    return opDto(row!);
  });
  res.status(201).json(out);
});

projectsRouter.put("/operations/:id", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(operationSchema, req.body);
  const out = await run(req, async (tx) => {
    const [op] = await tx.select().from(schema.operations).where(eq(schema.operations.id, param(req)));
    if (!op) throw notFound();
    await editableProject(tx, op.projectId);
    if (op.titleLocked && input.title !== op.title) {
      throw new HttpError(409, "title_locked", "Opération pluriannuelle : l'intitulé doit rester identique d'un exercice à l'autre");
    }
    const [row] = await tx
      .update(schema.operations)
      .set({ ...input, startDate: input.startDate ?? null, endDate: input.endDate ?? null })
      .where(eq(schema.operations.id, op.id))
      .returning();
    return opDto(row!);
  });
  res.json(out);
});

projectsRouter.delete("/operations/:id", requireRole("admin", "redacteur"), async (req, res) => {
  await run(req, async (tx) => {
    const [op] = await tx.select().from(schema.operations).where(eq(schema.operations.id, param(req)));
    if (!op) throw notFound();
    await editableProject(tx, op.projectId);
    if (op.titleLocked) throw conflict("Opération reprise d'un exercice précédent : elle ne peut pas être supprimée");
    await tx.delete(schema.operations).where(eq(schema.operations.id, op.id));
  });
  res.status(204).end();
});

