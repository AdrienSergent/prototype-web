import { assignmentsSchema, personSchema, salarySchema, type AssignmentDto, type OperationFunction, type PersonDto, type PersonStatus } from "@cir/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { schema, type Tx } from "../../db/client";
import { decrypt, encrypt } from "../../lib/crypto";
import { conflict, forbidden, notFound, parse } from "../../lib/errors";
import { hasRole, requireRole, run } from "../../middlewares/auth";
import { assertProjectReadable, editableProject, personName, personOfUser } from "../common";
import { filesDto, listFiles } from "../files/service";
import { param } from "../../lib/http";

export const peopleRouter = Router();

type PersonRow = typeof schema.people.$inferSelect;

async function toDtos(req: Request, tx: Tx, rows: PersonRow[]): Promise<PersonDto[]> {
  const ids = rows.map((r) => r.id);
  const files = await listFiles(tx, ids, ["person_cv", "person_diploma"]);
  const assigns = ids.length
    ? await tx.select({ personId: schema.assignments.personId, projectId: schema.assignments.projectId }).from(schema.assignments).where(inArray(schema.assignments.personId, ids))
    : [];
  const isAdmin = hasRole(req, "admin");
  return rows.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    userId: p.userId,
    jobTitle: p.jobTitle,
    degree: p.degree,
    degreeInstitution: p.degreeInstitution,
    degreeDate: p.degreeDate,
    status: p.status as PersonStatus,
    entryDate: p.entryDate,
    exitDate: p.exitDate,
    thesisDate: p.thesisDate,
    cdiDate: p.cdiDate,
    isSupportFunction: p.isSupportFunction,
    ...(isAdmin ? { monthlyGrossSalary: p.monthlySalaryEnc ? Number(decrypt(p.monthlySalaryEnc)) : null } : {}),
    hasCv: files.some((f) => f.ownerId === p.id && f.kind === "person_cv"),
    hasDiploma: files.some((f) => f.ownerId === p.id && f.kind === "person_diploma"),
    projectIds: assigns.filter((a) => a.personId === p.id).map((a) => a.projectId),
  }));
}

async function getPerson(tx: Tx, id: string) {
  const [p] = await tx.select().from(schema.people).where(and(eq(schema.people.id, id), isNull(schema.people.deletedAt)));
  if (!p) throw notFound("Personne introuvable");
  return p;
}

peopleRouter.get("/people", async (req, res) => {
  const out = await run(req, async (tx) => {
    let rows = await tx.select().from(schema.people).where(isNull(schema.people.deletedAt)).orderBy(asc(schema.people.lastName), asc(schema.people.firstName));
    if (hasRole(req, "contributeur")) {
      // Le contributeur voit les noms de l'équipe de ses projets (pour les temps des fiches) et sa propre fiche complète.
      const me = await personOfUser(tx, req.auth!.userId);
      const projectIds = me
        ? (await tx.select({ projectId: schema.assignments.projectId }).from(schema.assignments).where(eq(schema.assignments.personId, me.id))).map((a) => a.projectId)
        : [];
      const teammates = projectIds.length
        ? (await tx.select({ personId: schema.assignments.personId }).from(schema.assignments).where(inArray(schema.assignments.projectId, projectIds))).map((a) => a.personId)
        : [];
      const visible = new Set([...(me ? [me.id] : []), ...teammates]);
      rows = rows
        .filter((r) => visible.has(r.id))
        .map((r) => (r.id === me?.id ? r : { ...r, email: null, degree: null, degreeInstitution: null, degreeDate: null, entryDate: null, exitDate: null, thesisDate: null, cdiDate: null }));
    }
    return toDtos(req, tx, rows);
  });
  res.json(out);
});

peopleRouter.get("/people/:id", async (req, res) => {
  const out = await run(req, async (tx) => {
    const p = await getPerson(tx, param(req));
    if (hasRole(req, "contributeur")) {
      const me = await personOfUser(tx, req.auth!.userId);
      if (me?.id !== p.id) throw forbidden();
    }
    const [dto] = await toDtos(req, tx, [p]);
    const files = await filesDto(tx, await listFiles(tx, [p.id], ["person_cv", "person_diploma", "person_job_description"]));
    const assignments = await tx
      .select({ a: schema.assignments, code: schema.projects.code, title: schema.projects.title, fiscalYearId: schema.projects.fiscalYearId })
      .from(schema.assignments)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.assignments.projectId))
      .where(and(eq(schema.assignments.personId, p.id), isNull(schema.projects.deletedAt)));
    return {
      ...dto,
      files,
      assignments: assignments.map((r) => ({
        projectId: r.a.projectId,
        projectCode: r.code,
        projectTitle: r.title,
        fiscalYearId: r.fiscalYearId,
        operationFunction: r.a.operationFunction,
        contribution: r.a.contribution,
      })),
    };
  });
  res.json(out);
});

const personValues = (input: ReturnType<typeof personSchema.parse>) => ({
  ...input,
  email: input.email ? input.email.toLowerCase() : null,
  degreeDate: input.degreeDate ?? null,
  entryDate: input.entryDate ?? null,
  exitDate: input.exitDate ?? null,
  thesisDate: input.thesisDate ?? null,
  cdiDate: input.cdiDate ?? null,
});

peopleRouter.post("/people", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(personSchema, req.body);
  const out = await run(req, async (tx) => {
    const values = personValues(input);
    let userId: string | null = null;
    if (values.email) {
      const [u] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, values.email));
      if (u) {
        const [m] = await tx.select().from(schema.memberships).where(and(eq(schema.memberships.userId, u.id), eq(schema.memberships.companyId, req.company!.companyId)));
        if (m) userId = u.id;
      }
    }
    const [row] = await tx.insert(schema.people).values({ ...values, userId, companyId: req.company!.companyId, createdBy: req.auth!.userId }).returning();
    return (await toDtos(req, tx, [row!]))[0];
  });
  res.status(201).json(out);
});

peopleRouter.put("/people/:id", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(personSchema, req.body);
  const out = await run(req, async (tx) => {
    await getPerson(tx, param(req));
    const [row] = await tx.update(schema.people).set(personValues(input)).where(eq(schema.people.id, param(req))).returning();
    return (await toDtos(req, tx, [row!]))[0];
  });
  res.json(out);
});

peopleRouter.put("/people/:id/salary", requireRole("admin"), async (req, res) => {
  const { monthlyGrossSalary } = parse(salarySchema, req.body);
  await run(req, async (tx) => {
    await getPerson(tx, param(req));
    await tx
      .update(schema.people)
      .set({ monthlySalaryEnc: monthlyGrossSalary === null ? null : encrypt(String(monthlyGrossSalary)) })
      .where(eq(schema.people.id, param(req)));
  });
  res.status(204).end();
});

peopleRouter.delete("/people/:id", requireRole("admin"), async (req, res) => {
  await run(req, async (tx) => {
    const p = await getPerson(tx, param(req));
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(schema.timeEntries).where(eq(schema.timeEntries.personId, p.id))) as [{ n: number }];
    if (n > 0) throw conflict("Cette personne a des temps déclarés : renseignez plutôt sa date de sortie");
    await tx.update(schema.people).set({ deletedAt: new Date() }).where(eq(schema.people.id, p.id));
  });
  res.status(204).end();
});

/* ------------------------------ Affectations ------------------------------ */

peopleRouter.get("/projects/:id/assignments", async (req, res) => {
  const out = await run(req, async (tx) => {
    await assertProjectReadable(req, tx, param(req));
    const rows = await tx
      .select({ a: schema.assignments, p: schema.people })
      .from(schema.assignments)
      .innerJoin(schema.people, eq(schema.people.id, schema.assignments.personId))
      .where(eq(schema.assignments.projectId, param(req)))
      .orderBy(asc(schema.people.lastName));
    return rows.map(
      ({ a, p }): AssignmentDto => ({ id: a.id, personId: p.id, personName: personName(p), operationFunction: a.operationFunction as OperationFunction, contribution: a.contribution }),
    );
  });
  res.json(out);
});

peopleRouter.put("/projects/:id/assignments", requireRole("admin", "redacteur"), async (req, res) => {
  const { assignments } = parse(assignmentsSchema, req.body);
  await run(req, async (tx) => {
    const { project } = await editableProject(tx, param(req));
    const current = await tx.select().from(schema.assignments).where(eq(schema.assignments.projectId, project.id));
    const keep = new Set(assignments.map((a) => a.personId));
    const removed = current.filter((c) => !keep.has(c.personId));
    if (removed.length) {
      const withTime = await tx
        .select({ personId: schema.timeEntries.personId })
        .from(schema.timeEntries)
        .where(and(eq(schema.timeEntries.projectId, project.id), inArray(schema.timeEntries.personId, removed.map((r) => r.personId))))
        .limit(1);
      if (withTime.length) throw conflict("Impossible de retirer une personne qui a des temps sur ce projet");
      await tx.delete(schema.assignments).where(inArray(schema.assignments.id, removed.map((r) => r.id)));
    }
    for (const a of assignments) {
      await tx
        .insert(schema.assignments)
        .values({ ...a, projectId: project.id, companyId: req.company!.companyId, createdBy: req.auth!.userId })
        .onConflictDoUpdate({
          target: [schema.assignments.projectId, schema.assignments.personId],
          set: { operationFunction: a.operationFunction, contribution: a.contribution },
        });
    }
  });
  res.status(204).end();
});
