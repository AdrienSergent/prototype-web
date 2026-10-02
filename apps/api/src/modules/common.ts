import { EDITABLE_FY_STATUSES, type FiscalYearStatus } from "@cir/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Request } from "express";
import { schema, type Tx } from "../db/client";
import { forbidden, HttpError, notFound } from "../lib/errors";
import { hasRole } from "../middlewares/auth";

export type FiscalYearRow = typeof schema.fiscalYears.$inferSelect;
export type ProjectRow = typeof schema.projects.$inferSelect;

export async function getFiscalYear(tx: Tx, id: string): Promise<FiscalYearRow> {
  const [fy] = await tx.select().from(schema.fiscalYears).where(eq(schema.fiscalYears.id, id));
  if (!fy) throw notFound("Exercice introuvable");
  return fy;
}

export function assertEditable(fy: FiscalYearRow) {
  if (!EDITABLE_FY_STATUSES.includes(fy.status as FiscalYearStatus)) {
    throw new HttpError(409, "fiscal_year_locked", "Exercice validé ou scellé : les contenus sont en lecture seule");
  }
}

export async function editableFiscalYear(tx: Tx, id: string) {
  const fy = await getFiscalYear(tx, id);
  assertEditable(fy);
  return fy;
}

export async function getProject(tx: Tx, id: string): Promise<ProjectRow> {
  const [p] = await tx
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), isNull(schema.projects.deletedAt)));
  if (!p) throw notFound("Projet introuvable");
  return p;
}

export async function editableProject(tx: Tx, id: string) {
  const project = await getProject(tx, id);
  const fy = await editableFiscalYear(tx, project.fiscalYearId);
  return { project, fy };
}

export async function getCompany(tx: Tx, companyId: string) {
  const [c] = await tx.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!c) throw notFound("Société introuvable");
  return c;
}

/** Fiche personne liée à l'utilisateur connecté (contributeur). */
export async function personOfUser(tx: Tx, userId: string) {
  const [p] = await tx
    .select()
    .from(schema.people)
    .where(and(eq(schema.people.userId, userId), isNull(schema.people.deletedAt)));
  return p ?? null;
}

/**
 * Périmètre du contributeur : sa fiche personne et ses projets affectés.
 * Renvoie null pour les autres rôles (accès à tout le périmètre de la société).
 */
export async function contributorScope(req: Request, tx: Tx): Promise<{ personId: string | null; projectIds: string[] } | null> {
  if (!hasRole(req, "contributeur")) return null;
  const person = await personOfUser(tx, req.auth!.userId);
  if (!person) return { personId: null, projectIds: [] };
  const rows = await tx.select({ projectId: schema.assignments.projectId }).from(schema.assignments).where(eq(schema.assignments.personId, person.id));
  return { personId: person.id, projectIds: rows.map((r) => r.projectId) };
}

export async function assertProjectReadable(req: Request, tx: Tx, projectId: string) {
  const scope = await contributorScope(req, tx);
  if (scope && !scope.projectIds.includes(projectId)) throw forbidden("Projet non affecté");
}

export async function isAssigned(tx: Tx, projectId: string, personId: string) {
  const [a] = await tx
    .select({ id: schema.assignments.id })
    .from(schema.assignments)
    .where(and(eq(schema.assignments.projectId, projectId), eq(schema.assignments.personId, personId)));
  return !!a;
}

export async function namesOfUsers(tx: Tx, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await tx.select({ id: schema.users.id, name: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export const personName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

/** Verrou consultatif transactionnel (sérialise une allocation de numéro, etc.). */
export async function advisoryLock(tx: Tx, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
