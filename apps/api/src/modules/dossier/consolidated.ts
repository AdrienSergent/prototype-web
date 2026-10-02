import {
  FILE_KIND_LABELS,
  formatNoteRef,
  lockCode,
  RUBRIQUES_OPERATION,
  RUBRIQUES_SOCIETE,
  topicCode,
  type DossierData,
  type FileKind,
  type FiscalYearStatus,
  type LockOutcome,
  type NoteResultKind,
  type OperationFunction,
  type OperationType,
  type PMNode,
  type ReferenceType,
  type RescritType,
  type Rubrique,
  type Verdict,
} from "@cir/shared";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Tx } from "../../db/client";
import { getCompany, getFiscalYear, iso, namesOfUsers, personName } from "../common";
import { latestVersions, listFiles } from "../files/service";

export interface AnnexFile {
  number: string;
  label: string;
  path: string;
  file: typeof schema.files.$inferSelect;
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9.]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

/**
 * Données du dossier consolidé, dans l'ordre du plan MESR.
 * mode « screen » : annexes pointant vers l'API ; mode « archive » : chemins relatifs dans le ZIP scellé.
 */
export async function buildDossierData(tx: Tx, fiscalYearId: string, mode: "screen" | "archive"): Promise<DossierData & { annexFiles: AnnexFile[] }> {
  const fy = await getFiscalYear(tx, fiscalYearId);
  const company = await getCompany(tx, fy.companyId);
  const rescrits = await tx.select().from(schema.rescrits).orderBy(asc(schema.rescrits.createdAt));
  const sections = await tx.select().from(schema.sections).where(eq(schema.sections.fiscalYearId, fy.id));
  const names = await namesOfUsers(tx, sections.map((s) => s.validatedBy));
  const sectionOut = (s: (typeof sections)[number] | undefined, rubrique: Rubrique) => ({
    rubrique,
    content: (s?.content as PMNode) ?? { type: "doc", content: [] },
    validatedByName: s?.validatedBy ? (names.get(s.validatedBy) ?? null) : null,
    validatedAt: iso(s?.validatedAt),
  });

  const projects = (
    await tx
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.fiscalYearId, fy.id), isNull(schema.projects.deletedAt)))
      .orderBy(asc(schema.projects.code))
  ).filter((p) => p.verdict === null || p.verdict === "eligible_cir");
  const ids = projects.map((p) => p.id);
  const ops = ids.length ? await tx.select().from(schema.operations).where(inArray(schema.operations.projectId, ids)) : [];
  const locks = ids.length
    ? await tx
        .select()
        .from(schema.locks)
        .where(and(inArray(schema.locks.projectId, ids), isNull(schema.locks.deletedAt)))
        .orderBy(asc(schema.locks.number))
    : [];
  const entries = ids.length ? await tx.select().from(schema.timeEntries).where(and(eq(schema.timeEntries.fiscalYearId, fy.id), inArray(schema.timeEntries.projectId, ids))) : [];
  const assigns = ids.length ? await tx.select().from(schema.assignments).where(inArray(schema.assignments.projectId, ids)) : [];
  const personIds = [...new Set([...entries.map((e) => e.personId), ...assigns.map((a) => a.personId)])];
  const people = personIds.length ? await tx.select().from(schema.people).where(inArray(schema.people.id, personIds)) : [];

  const lockIds = locks.map((l) => l.id);
  const topics = lockIds.length ? await tx.select().from(schema.topics).where(inArray(schema.topics.lockId, lockIds)) : [];
  const notes = topics.length
    ? await tx
        .select()
        .from(schema.notes)
        .where(and(inArray(schema.notes.topicId, topics.map((t) => t.id)), isNull(schema.notes.deletedAt)))
        .orderBy(asc(schema.notes.noteDate), asc(schema.notes.refNo))
    : [];
  const noteAuthors = notes.length ? await tx.select().from(schema.people).where(inArray(schema.people.id, [...new Set(notes.map((n) => n.authorPersonId))])) : [];
  const noteTimes = notes.length ? await tx.select().from(schema.timeEntries).where(inArray(schema.timeEntries.noteId, notes.map((n) => n.id))) : [];

  // Références citées dans les sections retenues
  const sectionIds = sections.filter((s) => s.projectId === null || ids.includes(s.projectId)).map((s) => s.id);
  const cited = sectionIds.length
    ? await tx
        .select({ ref: schema.biblioRefs })
        .from(schema.sectionRefs)
        .innerJoin(schema.biblioRefs, eq(schema.biblioRefs.id, schema.sectionRefs.refId))
        .where(inArray(schema.sectionRefs.sectionId, sectionIds))
    : [];
  const refs = [...new Map(cited.map((c) => [c.ref.id, c.ref])).values()].sort((a, b) => a.publishedOn.localeCompare(b.publishedOn) || a.title.localeCompare(b.title));

  // Annexes : organigrammes, puis par intervenant CV / diplôme / fiche de poste (dernières versions), puis pièces des fiches
  const companyFiles = latestVersions(await listFiles(tx, [company.id], ["company_orgchart", "company_rd_orgchart"]));
  const sortedPeople = [...people].sort((a, b) => a.lastName.localeCompare(b.lastName));
  const personFiles = latestVersions(await listFiles(tx, personIds, ["person_cv", "person_diploma", "person_job_description"]));
  const noteFiles = await listFiles(
    tx,
    notes.map((n) => n.id),
    ["note_attachment"],
  );
  const annexFiles: AnnexFile[] = [];
  const push = (file: typeof schema.files.$inferSelect, label: string) => {
    const number = `A${String(annexFiles.length + 1).padStart(2, "0")}`;
    annexFiles.push({ number, label, file, path: mode === "archive" ? `annexes/${number}-${slug(file.filename)}` : `/api/v1/files/${file.id}/download` });
  };
  companyFiles.forEach((f) => push(f, FILE_KIND_LABELS[f.kind as FileKind]));
  for (const p of sortedPeople) {
    for (const kind of ["person_cv", "person_diploma", "person_job_description"] as const) {
      const f = personFiles.find((x) => x.ownerId === p.id && x.kind === kind);
      if (f) push(f, `${FILE_KIND_LABELS[kind]} — ${personName(p)}`);
    }
  }
  for (const n of notes) {
    noteFiles.filter((f) => f.ownerId === n.id).forEach((f) => push(f, `Pièce de la fiche ${formatNoteRef(n.refNo)}`));
  }

  return {
    generatedAt: new Date().toISOString(),
    company: {
      name: company.name,
      siren: company.siren,
      nafCode: company.nafCode,
      sector: company.sector,
      headcountTotal: company.headcountTotal,
      headcountRd: company.headcountRd,
      rdOrganization: company.rdOrganization,
      referent: { name: company.referentName, role: company.referentRole, phone: company.referentPhone, email: company.referentEmail },
      rescrits: rescrits.map((r) => ({ type: r.type as RescritType, decisionDate: r.decisionDate, decision: r.decision, years: r.years })),
    },
    fiscalYear: {
      label: fy.label,
      startDate: fy.startDate,
      endDate: fy.endDate,
      status: fy.status as FiscalYearStatus,
      expertValidationName: fy.expertValidationName,
      expertValidatedAt: iso(fy.expertValidatedAt),
    },
    partOne: RUBRIQUES_SOCIETE.map((r) => sectionOut(sections.find((s) => s.projectId === null && s.rubrique === r), r)),
    projects: projects.map((p) => ({
      id: p.id,
      code: p.code,
      title: p.title,
      startDate: p.startDate,
      endDate: p.endDate,
      verdict: p.verdict as Verdict | null,
      operations: ops
        .filter((o) => o.projectId === p.id)
        .map((o) => ({ title: o.title, type: o.type as OperationType, startDate: o.startDate, endDate: o.endDate })),
      hours: entries.filter((e) => e.projectId === p.id).reduce((s, e) => s + e.hours, 0),
      sections: RUBRIQUES_OPERATION.map((r) => sectionOut(sections.find((s) => s.projectId === p.id && s.rubrique === r), r)),
      locks: locks.filter((l) => l.projectId === p.id).map((l) => ({ code: lockCode(l.number), statement: l.statement, outcome: l.outcome as LockOutcome })),
      personnel: sortedPeople
        .filter((person) => assigns.some((a) => a.projectId === p.id && a.personId === person.id) || entries.some((e) => e.projectId === p.id && e.personId === person.id))
        .map((person) => {
          const a = assigns.find((x) => x.projectId === p.id && x.personId === person.id);
          return {
            name: `${person.lastName.toUpperCase()} ${person.firstName}`,
            degree: person.degree,
            degreeInstitution: person.degreeInstitution,
            operationFunction: (a?.operationFunction as OperationFunction) ?? null,
            contribution: a?.contribution ?? "",
            hours: entries.filter((e) => e.projectId === p.id && e.personId === person.id).reduce((s, e) => s + e.hours, 0),
          };
        }),
    })),
    references: refs.map((r, i) => ({
      id: r.id,
      label: `R${i + 1}`,
      refType: r.refType as ReferenceType,
      title: r.title,
      authors: r.authors,
      publishedOn: r.publishedOn,
      doi: r.doi,
      url: r.url,
      patentNumber: r.patentNumber,
    })),
    notes: notes.map((n) => {
      const t = topics.find((x) => x.id === n.topicId)!;
      const l = locks.find((x) => x.id === t.lockId)!;
      const p = projects.find((x) => x.id === l.projectId)!;
      const author = noteAuthors.find((a) => a.id === n.authorPersonId);
      return {
        id: n.id,
        ref: formatNoteRef(n.refNo),
        projectCode: p.code,
        lockCode: lockCode(l.number),
        topicCode: topicCode(l.number, t.number),
        date: n.noteDate,
        authorName: author ? personName(author) : "?",
        hypothesis: n.hypothesis,
        workDone: n.workDone,
        result: n.result,
        resultKind: n.resultKind as NoteResultKind,
        conclusion: n.conclusion,
        nextStep: n.nextStep,
        hours: noteTimes.filter((x) => x.noteId === n.id).reduce((s, x) => s + x.hours, 0),
        enteredAt: iso(n.createdAt)!,
      };
    }),
    annexes: annexFiles.map((a) => ({ number: a.number, label: a.label, filename: a.file.filename, sha256: a.file.sha256, path: a.path })),
    annexFiles,
  };
}
