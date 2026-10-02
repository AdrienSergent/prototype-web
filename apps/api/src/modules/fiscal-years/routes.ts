import { fiscalYearSchema, fiscalYearTransitionSchema, RUBRIQUES_DATEES, type FiscalYearDto, type FiscalYearStatus } from "@cir/shared";
import { and, desc, eq, inArray, isNull, lte, gte, ne, or } from "drizzle-orm";
import { Router } from "express";
import { schema, type Tx } from "../../db/client";
import { conflict, forbidden, HttpError, parse } from "../../lib/errors";
import { uuidv7 } from "../../lib/ids";
import { hasRole, requireRole, run } from "../../middlewares/auth";
import { iso } from "../common";
import { getFiscalYear } from "../common";
import { ensureSections } from "../dossier/sections-service";
import { computeChecklist } from "../dossier/checklist";
import { startSeal } from "../archives/service";
import { param } from "../../lib/http";

export const fiscalYearsRouter = Router();

export function fyDto(f: typeof schema.fiscalYears.$inferSelect): FiscalYearDto {
  return {
    id: f.id,
    label: f.label,
    startDate: f.startDate,
    endDate: f.endDate,
    status: f.status as FiscalYearStatus,
    progress: f.progress,
    expertValidationName: f.expertValidationName,
    expertValidatedAt: iso(f.expertValidatedAt),
    expertComment: f.expertComment,
    sealedAt: iso(f.sealedAt),
    sourceFiscalYearId: f.sourceFiscalYearId,
  };
}

async function assertNoOverlap(tx: Tx, startDate: string, endDate: string, exceptId?: string) {
  const overlapping = await tx
    .select({ id: schema.fiscalYears.id, label: schema.fiscalYears.label })
    .from(schema.fiscalYears)
    .where(
      and(
        lte(schema.fiscalYears.startDate, endDate),
        gte(schema.fiscalYears.endDate, startDate),
        exceptId ? ne(schema.fiscalYears.id, exceptId) : undefined,
      ),
    );
  if (overlapping.length) throw conflict(`Chevauchement avec l'exercice ${overlapping[0]!.label}`);
}

fiscalYearsRouter.get("/fiscal-years", async (req, res) => {
  const rows = await run(req, (tx) => tx.select().from(schema.fiscalYears).orderBy(desc(schema.fiscalYears.startDate)));
  res.json(rows.map(fyDto));
});

fiscalYearsRouter.get("/fiscal-years/:id", async (req, res) => {
  res.json(fyDto(await run(req, (tx) => getFiscalYear(tx, param(req)))));
});

fiscalYearsRouter.post("/fiscal-years", requireRole("admin"), async (req, res) => {
  const input = parse(fiscalYearSchema, req.body);
  const fy = await run(req, async (tx) => {
    await assertNoOverlap(tx, input.startDate, input.endDate);
    const [row] = await tx
      .insert(schema.fiscalYears)
      .values({ ...input, companyId: req.company!.companyId, createdBy: req.auth!.userId })
      .returning();
    await ensureSections(tx, req.company!.companyId, row!.id, null, req.auth!.userId);
    return row!;
  });
  res.status(201).json(fyDto(fy));
});

fiscalYearsRouter.patch("/fiscal-years/:id", requireRole("admin"), async (req, res) => {
  const input = parse(fiscalYearSchema, req.body);
  const fy = await run(req, async (tx) => {
    const current = await getFiscalYear(tx, param(req));
    if (current.status !== "draft") throw new HttpError(409, "fiscal_year_locked", "Seul un exercice en brouillon peut être modifié");
    await assertNoOverlap(tx, input.startDate, input.endDate, current.id);
    const [row] = await tx.update(schema.fiscalYears).set(input).where(eq(schema.fiscalYears.id, current.id)).returning();
    return row!;
  });
  res.json(fyDto(fy));
});

/** Cycle de vie : brouillon → en relecture → validé expert → scellé. */
fiscalYearsRouter.post("/fiscal-years/:id/transition", async (req, res) => {
  const { action, comment } = parse(fiscalYearTransitionSchema, req.body);
  const result = await run(req, async (tx) => {
    const fy = await getFiscalYear(tx, param(req));
    const set = (values: Partial<typeof schema.fiscalYears.$inferInsert>) =>
      tx.update(schema.fiscalYears).set(values).where(eq(schema.fiscalYears.id, fy.id)).returning();
    const expect = (status: FiscalYearStatus, msg: string) => {
      if (fy.status !== status) throw new HttpError(409, "invalid_transition", msg);
    };
    switch (action) {
      case "submit_review":
        if (!hasRole(req, "admin")) throw forbidden();
        expect("draft", "Seul un exercice en brouillon peut passer en relecture");
        return { fy: (await set({ status: "in_review" }))[0]! };
      case "back_to_draft":
        if (!hasRole(req, "admin")) throw forbidden();
        expect("in_review", "L'exercice n'est pas en relecture");
        return { fy: (await set({ status: "draft" }))[0]! };
      case "expert_validate": {
        if (!hasRole(req, "expert")) throw forbidden("Seul l'expert invité valide l'exercice");
        expect("in_review", "L'exercice doit être en relecture");
        const checklist = await computeChecklist(tx, fy.id);
        if (checklist.blockingOk < checklist.blockingTotal) {
          throw new HttpError(409, "checklist_incomplete", `Check-list incomplète : ${checklist.blockingTotal - checklist.blockingOk} point(s) bloquant(s)`);
        }
        return {
          fy: (
            await set({
              status: "expert_validated",
              expertValidationName: req.auth!.fullName,
              expertValidatedAt: new Date(),
              expertValidatedBy: req.auth!.userId,
              expertComment: comment ?? null,
            })
          )[0]!,
        };
      }
      case "reopen":
        if (!hasRole(req, "admin")) throw forbidden();
        expect("expert_validated", "Seul un exercice validé peut être rouvert");
        return {
          fy: (await set({ status: "draft", expertValidationName: null, expertValidatedAt: null, expertValidatedBy: null, expertComment: comment ?? null }))[0]!,
        };
      case "seal": {
        if (!hasRole(req, "admin")) throw forbidden();
        expect("expert_validated", "Seul un exercice validé par l'expert peut être scellé");
        const [pending] = await tx
          .select()
          .from(schema.archives)
          .where(and(eq(schema.archives.fiscalYearId, fy.id), inArray(schema.archives.status, ["pending", "done"])));
        if (pending) throw conflict("Scellement déjà en cours ou effectué");
        const [archive] = await tx
          .insert(schema.archives)
          .values({ companyId: fy.companyId, fiscalYearId: fy.id, createdBy: req.auth!.userId })
          .returning();
        return { fy, archiveId: archive!.id };
      }
    }
  });
  if ("archiveId" in result && result.archiveId) {
    await startSeal({ companyId: req.company!.companyId, userId: req.auth!.userId, archiveId: result.archiveId });
  }
  const fy = await run(req, (tx) => getFiscalYear(tx, param(req)));
  res.json({ fiscalYear: fyDto(fy), archiveId: "archiveId" in result ? result.archiveId : null });
});

/**
 * Duplication N → N+1 : projets non clos, opérations (intitulé verrouillé), affectations, réponses Frascati,
 * verrous et sujets ouverts, sections « état de l'art » et « verrous » marquées « à actualiser ».
 * Le verdict est remis à zéro : l'expert le reconfirme pour le nouvel exercice. Ni fiches ni temps ne sont copiés.
 */
fiscalYearsRouter.post("/fiscal-years/:id/duplicate", requireRole("admin"), async (req, res) => {
  const input = parse(fiscalYearSchema, req.body);
  const companyId = req.company!.companyId;
  const userId = req.auth!.userId;
  const fy = await run(req, async (tx) => {
    const source = await getFiscalYear(tx, param(req));
    if (input.startDate <= source.startDate) throw conflict("Le nouvel exercice doit commencer après l'exercice source");
    await assertNoOverlap(tx, input.startDate, input.endDate);
    const [target] = await tx
      .insert(schema.fiscalYears)
      .values({ ...input, companyId, createdBy: userId, sourceFiscalYearId: source.id })
      .returning();
    await ensureSections(tx, companyId, target!.id, null, userId);

    const projects = await tx
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.fiscalYearId, source.id),
          isNull(schema.projects.deletedAt),
          or(isNull(schema.projects.endDate), gte(schema.projects.endDate, input.startDate)),
        ),
      );
    for (const p of projects) {
      if (p.verdict === "non_eligible") continue;
      const newProjectId = uuidv7();
      await tx.insert(schema.projects).values({
        id: newProjectId,
        companyId,
        createdBy: userId,
        fiscalYearId: target!.id,
        code: p.code,
        title: p.title,
        startDate: p.startDate,
        endDate: p.endDate,
        objectives: p.objectives,
        keywords: p.keywords,
        sourceProjectId: p.id,
      });
      await ensureSections(tx, companyId, target!.id, newProjectId, userId);

      const ops = await tx.select().from(schema.operations).where(eq(schema.operations.projectId, p.id));
      if (ops.length)
        await tx.insert(schema.operations).values(
          ops.map((o) => ({ companyId, createdBy: userId, projectId: newProjectId, lineageId: o.lineageId, title: o.title, titleLocked: true, startDate: o.startDate, endDate: o.endDate, type: o.type })),
        );
      const assigns = await tx.select().from(schema.assignments).where(eq(schema.assignments.projectId, p.id));
      if (assigns.length)
        await tx.insert(schema.assignments).values(
          assigns.map((a) => ({ companyId, createdBy: userId, projectId: newProjectId, personId: a.personId, operationFunction: a.operationFunction, contribution: a.contribution })),
        );
      const answers = await tx.select().from(schema.frascatiAnswers).where(eq(schema.frascatiAnswers.projectId, p.id));
      if (answers.length)
        await tx.insert(schema.frascatiAnswers).values(
          answers.map((a) => ({ companyId, createdBy: userId, projectId: newProjectId, criterion: a.criterion, argument: a.argument, selfAssessment: a.selfAssessment })),
        );

      const locks = await tx.select().from(schema.locks).where(and(eq(schema.locks.projectId, p.id), isNull(schema.locks.deletedAt)));
      for (const l of locks) {
        const newLockId = uuidv7();
        await tx.insert(schema.locks).values({
          id: newLockId,
          companyId,
          createdBy: userId,
          projectId: newProjectId,
          number: l.number,
          statement: l.statement,
          sotaGap: l.sotaGap,
          identifiedOn: l.identifiedOn,
          outcome: l.outcome,
          toUpdate: true,
          version: 1,
          sourceLockId: l.id,
        });
        await tx.insert(schema.lockVersions).values({
          companyId,
          lockId: newLockId,
          version: 1,
          authorId: userId,
          data: { statement: l.statement, sotaGap: l.sotaGap, identifiedOn: l.identifiedOn, outcome: l.outcome, duplicatedFrom: l.id },
        });
        const topics = await tx
          .select()
          .from(schema.topics)
          .where(and(eq(schema.topics.lockId, l.id), eq(schema.topics.status, "ouvert"), isNull(schema.topics.deletedAt)));
        if (topics.length)
          await tx.insert(schema.topics).values(
            topics.map((t) => ({ companyId, createdBy: userId, lockId: newLockId, number: t.number, title: t.title, hypothesis: t.hypothesis, approach: t.approach, ownerPersonId: t.ownerPersonId, status: "ouvert" })),
          );
      }

      const sections = await tx
        .select()
        .from(schema.sections)
        .where(and(eq(schema.sections.projectId, p.id), inArray(schema.sections.rubrique, [...RUBRIQUES_DATEES])));
      for (const s of sections) {
        const [created] = await tx
          .update(schema.sections)
          .set({ content: s.content, contentText: s.contentText, toUpdate: true, version: 1, authorId: userId })
          .where(and(eq(schema.sections.projectId, newProjectId), eq(schema.sections.rubrique, s.rubrique)))
          .returning();
        if (created)
          await tx.insert(schema.sectionVersions).values({ companyId, sectionId: created.id, version: 1, content: s.content, contentText: s.contentText, authorId: userId });
      }
    }
    return target!;
  });
  res.status(201).json(fyDto(fy));
});
