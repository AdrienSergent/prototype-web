import { firstDayOfMonth, formatNoteRef, lastDayOfMonth, roundQuarter, type TimeEntryDto, type TimeGranularity } from "@cir/shared";
import { and, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { schema, type Tx } from "../../db/client";
import { HttpError, unprocessable } from "../../lib/errors";
import { getCompany, isAssigned, personName, type FiscalYearRow } from "../common";
import { capacityViolations, violationsFor, type CapEntry } from "./capacity";

type PersonRow = typeof schema.people.$inferSelect;

export function inPeriod(date: string, granularity: TimeGranularity, start: string | null, end: string | null) {
  const from = granularity === "month" ? firstDayOfMonth(date) : date;
  const to = granularity === "month" ? lastDayOfMonth(date) : date;
  return (!start || to >= start) && (!end || from <= end);
}

export function employmentOk(person: PersonRow, date: string, granularity: TimeGranularity) {
  return inPeriod(date, granularity, person.entryDate, person.exitDate);
}

/** Lignes de temps existantes d'une personne sur l'exercice (pour le contrôle de capacité). */
export async function personEntries(tx: Tx, fiscalYearId: string, personId: string, excludeIds: string[] = []): Promise<CapEntry[]> {
  const rows = await tx
    .select({ id: schema.timeEntries.id, personId: schema.timeEntries.personId, date: schema.timeEntries.entryDate, granularity: schema.timeEntries.granularity, hours: schema.timeEntries.hours })
    .from(schema.timeEntries)
    .where(and(eq(schema.timeEntries.fiscalYearId, fiscalYearId), eq(schema.timeEntries.personId, personId)));
  return rows.filter((r) => !excludeIds.includes(r.id)).map((r) => ({ ...r, granularity: r.granularity as TimeGranularity }));
}

export interface EntryCandidate {
  personId: string;
  projectId: string;
  operationId?: string | null;
  date: string;
  granularity: TimeGranularity;
  hours: number;
  noteId?: string | null;
}

/** Contrôles d'une ligne de temps (période, emploi, affectation, fiche, capacité). Lève une 422 explicite. */
export async function validateEntry(tx: Tx, fy: FiscalYearRow, c: EntryCandidate, opts: { excludeIds?: string[] } = {}) {
  const date = c.granularity === "month" ? firstDayOfMonth(c.date) : c.date;
  if (!inPeriod(date, c.granularity, fy.startDate, fy.endDate)) throw unprocessable("Date hors de l'exercice");
  const [person] = await tx.select().from(schema.people).where(and(eq(schema.people.id, c.personId), isNull(schema.people.deletedAt)));
  if (!person) throw unprocessable("Personne introuvable");
  if (!employmentOk(person, date, c.granularity)) throw unprocessable(`${personName(person)} n'est pas en poste à cette date`);
  if (!(await isAssigned(tx, c.projectId, c.personId))) throw unprocessable(`${personName(person)} n'est pas affecté(e) à ce projet`);
  if (c.operationId) {
    const [op] = await tx.select().from(schema.operations).where(eq(schema.operations.id, c.operationId));
    if (!op || op.projectId !== c.projectId) throw unprocessable("Opération étrangère au projet");
  }
  if (c.noteId) {
    const [n] = await tx
      .select({ noteDate: schema.notes.noteDate, projectId: schema.locks.projectId })
      .from(schema.notes)
      .innerJoin(schema.topics, eq(schema.topics.id, schema.notes.topicId))
      .innerJoin(schema.locks, eq(schema.locks.id, schema.topics.lockId))
      .where(and(eq(schema.notes.id, c.noteId), isNull(schema.notes.deletedAt)));
    if (!n || n.projectId !== c.projectId) throw unprocessable("La fiche de recherche ne relève pas de ce projet");
    const ok = c.granularity === "day" ? n.noteDate === date : n.noteDate.slice(0, 7) === date.slice(0, 7);
    if (!ok) throw unprocessable("La date du temps doit correspondre à celle de la fiche");
  }
  const company = await getCompany(tx, fy.companyId);
  const existing = await personEntries(tx, fy.id, c.personId, opts.excludeIds);
  const candidate: CapEntry = { personId: c.personId, date, granularity: c.granularity, hours: c.hours };
  const violations = violationsFor(candidate, capacityViolations([...existing, candidate], { hoursPerDay: company.hoursPerDay, annualHoursCap: company.annualHoursCap }));
  if (violations.length) {
    throw new HttpError(422, "capacity_exceeded", `Temps R&D supérieur au temps de travail : ${violations.map((v) => v.message).join(" ; ")}`, { violations });
  }
  return { ...c, date, hours: roundQuarter(c.hours) };
}

export async function toTimeDtos(tx: Tx, rows: (typeof schema.timeEntries.$inferSelect)[]): Promise<TimeEntryDto[]> {
  const personIds = [...new Set(rows.map((r) => r.personId))];
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const noteIds = [...new Set(rows.map((r) => r.noteId).filter((x): x is string => !!x))];
  const people = personIds.length ? await tx.select().from(schema.people).where(inArray(schema.people.id, personIds)) : [];
  const projects = projectIds.length ? await tx.select({ id: schema.projects.id, code: schema.projects.code }).from(schema.projects).where(inArray(schema.projects.id, projectIds)) : [];
  const notes = noteIds.length ? await tx.select({ id: schema.notes.id, refNo: schema.notes.refNo }).from(schema.notes).where(inArray(schema.notes.id, noteIds)) : [];
  const pMap = new Map(people.map((p) => [p.id, personName(p)]));
  const prMap = new Map(projects.map((p) => [p.id, p.code]));
  const nMap = new Map(notes.map((n) => [n.id, formatNoteRef(n.refNo)]));
  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    personName: pMap.get(r.personId) ?? "?",
    projectId: r.projectId,
    projectCode: prMap.get(r.projectId) ?? "?",
    operationId: r.operationId,
    date: r.entryDate,
    granularity: r.granularity as TimeGranularity,
    hours: r.hours,
    noteId: r.noteId,
    noteRef: r.noteId ? (nMap.get(r.noteId) ?? null) : null,
    source: r.source as TimeEntryDto["source"],
  }));
}

export function entryFilters(q: { fiscalYearId: string; personId?: string; projectId?: string; from?: string; to?: string; excludeId?: string }) {
  return and(
    eq(schema.timeEntries.fiscalYearId, q.fiscalYearId),
    q.personId ? eq(schema.timeEntries.personId, q.personId) : undefined,
    q.projectId ? eq(schema.timeEntries.projectId, q.projectId) : undefined,
    q.from ? gte(schema.timeEntries.entryDate, q.from) : undefined,
    q.to ? lte(schema.timeEntries.entryDate, q.to) : undefined,
    q.excludeId ? ne(schema.timeEntries.id, q.excludeId) : undefined,
  );
}
