import {
  diffDays,
  estimatePages,
  formatNoteRef,
  frascatiComplete,
  GROUP_LIMITS,
  LATE_ENTRY_DAYS,
  lockCode,
  MAX_PAGES_FICHE_SCIENTIFIQUE,
  MESR_PLAN,
  RUBRIQUES_OPERATION,
  type ChecklistDto,
  type ChecklistItemDto,
  type FrascatiCriterion,
  type Rubrique,
  type SelfAssessment,
} from "@cir/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Tx } from "../../db/client";
import { getCompany, getFiscalYear, personName } from "../common";
import { latestVersions, listFiles } from "../files/service";

/**
 * Check-list de complétude F6.4.
 * Bloquant : verdict, Frascati complet, verrous avec sujets et fiches, intervenants complets,
 * rubriques remplies et validées, aucune reprise « à actualiser ».
 * Avertissements : référence postérieure au début des travaux, temps non rattachés, saisies tardives,
 * dépassement de pages, fonctions support, projet sans opération R&D.
 * Met à jour la progression de l'exercice (lue par la vue groupe).
 */
export async function computeChecklist(tx: Tx, fiscalYearId: string): Promise<ChecklistDto> {
  const fy = await getFiscalYear(tx, fiscalYearId);
  const company = await getCompany(tx, fy.companyId);
  const items: ChecklistItemDto[] = [];
  const block = (rule: string, ok: boolean, message: string, target: ChecklistItemDto["target"]) => items.push({ rule, level: "blocking", ok, message, target });
  const warn = (rule: string, message: string, target: ChecklistItemDto["target"]) => items.push({ rule, level: "warning", ok: false, message, target });

  const projects = await tx
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.fiscalYearId, fy.id), isNull(schema.projects.deletedAt)));
  if (!projects.length) block("has_project", false, "Aucun projet déclaré sur l'exercice", { type: "fiscal_year", id: fy.id });

  for (const p of projects) {
    block("project_verdict", !!p.verdict, p.verdict ? `${p.code} : verdict Frascati rendu` : `${p.code} : verdict Frascati manquant`, { type: "project", id: p.id, projectId: p.id, label: p.code });
  }
  const included = projects.filter((p) => p.verdict === null || p.verdict === "eligible_cir");
  const ids = included.map((p) => p.id);

  const answers = ids.length ? await tx.select().from(schema.frascatiAnswers).where(inArray(schema.frascatiAnswers.projectId, ids)) : [];
  const ops = ids.length ? await tx.select().from(schema.operations).where(inArray(schema.operations.projectId, ids)) : [];
  for (const p of included) {
    const ok = frascatiComplete(
      answers.filter((a) => a.projectId === p.id).map((a) => ({ criterion: a.criterion as FrascatiCriterion, argument: a.argument, selfAssessment: a.selfAssessment as SelfAssessment })),
    );
    block("frascati_complete", ok, `${p.code} : ${ok ? "5 critères de Frascati argumentés" : "questionnaire Frascati incomplet"}`, { type: "frascati", id: p.id, projectId: p.id, label: p.code });
    if (!ops.some((o) => o.projectId === p.id && o.type === "rd")) warn("rd_operation", `${p.code} : aucune opération de type R&D déclarée`, { type: "project", id: p.id, projectId: p.id, label: p.code });
  }

  // Verrous → sujets → fiches
  const locks = ids.length
    ? await tx
        .select()
        .from(schema.locks)
        .where(and(inArray(schema.locks.projectId, ids), isNull(schema.locks.deletedAt)))
    : [];
  const lockIds = locks.map((l) => l.id);
  const topics = lockIds.length
    ? await tx
        .select()
        .from(schema.topics)
        .where(and(inArray(schema.topics.lockId, lockIds), isNull(schema.topics.deletedAt)))
    : [];
  const topicIds = topics.map((t) => t.id);
  const notes = topicIds.length
    ? await tx
        .select()
        .from(schema.notes)
        .where(and(inArray(schema.notes.topicId, topicIds), isNull(schema.notes.deletedAt)))
    : [];
  for (const p of included) {
    if (!locks.some((l) => l.projectId === p.id)) block("project_has_lock", false, `${p.code} : aucun verrou déclaré`, { type: "project", id: p.id, projectId: p.id, label: p.code });
  }
  for (const l of locks) {
    const p = included.find((x) => x.id === l.projectId)!;
    const lt = topics.filter((t) => t.lockId === l.id);
    const label = `${p.code} / ${lockCode(l.number)}`;
    block("lock_has_topic", lt.length > 0, `${label} : ${lt.length ? `${lt.length} sujet(s) de recherche` : "aucun sujet de recherche"}`, { type: "lock", id: l.id, projectId: p.id, label });
    const ln = notes.filter((n) => lt.some((t) => t.id === n.topicId));
    block("lock_has_notes", ln.length > 0, `${label} : ${ln.length ? `${ln.length} fiche(s) de recherche` : "aucune fiche de recherche"}`, { type: "lock", id: l.id, projectId: p.id, label });
    block("lock_up_to_date", !l.toUpdate, `${label} : ${l.toUpdate ? "verrou repris de N-1 à actualiser" : "verrou à jour"}`, { type: "lock", id: l.id, projectId: p.id, label });
  }

  // Intervenants : diplôme, CV, temps
  const entries = ids.length ? await tx.select().from(schema.timeEntries).where(and(eq(schema.timeEntries.fiscalYearId, fy.id), inArray(schema.timeEntries.projectId, ids))) : [];
  const assigns = ids.length ? await tx.select().from(schema.assignments).where(inArray(schema.assignments.projectId, ids)) : [];
  const personIds = [...new Set([...entries.map((e) => e.personId), ...assigns.map((a) => a.personId)])];
  const people = personIds.length ? await tx.select().from(schema.people).where(inArray(schema.people.id, personIds)) : [];
  const files = latestVersions(await listFiles(tx, personIds, ["person_cv", "person_diploma"]));
  for (const person of people) {
    const hours = entries.filter((e) => e.personId === person.id).reduce((s, e) => s + e.hours, 0);
    const missing: string[] = [];
    if (!person.degree || !person.degreeDate) missing.push("diplôme et date d'obtention");
    if (!files.some((f) => f.ownerId === person.id && f.kind === "person_cv")) missing.push("CV");
    if (hours <= 0) missing.push("temps");
    block("person_complete", missing.length === 0, `${personName(person)} : ${missing.length ? `manque ${missing.join(", ")}` : "diplôme, CV et temps renseignés"}`, {
      type: "person",
      id: person.id,
      label: personName(person),
    });
    if (person.isSupportFunction && hours > 0) warn("support_function", `${personName(person)} : fonction support avec ${hours} h déclarées en R&D`, { type: "person", id: person.id, label: personName(person) });
  }

  // Rubriques : remplies, validées, à jour
  const sections = await tx.select().from(schema.sections).where(eq(schema.sections.fiscalYearId, fy.id));
  const relevant = sections.filter((s) => s.projectId === null || ids.includes(s.projectId));
  for (const s of relevant) {
    const p = included.find((x) => x.id === s.projectId);
    const label = `${p ? `${p.code} / ` : "Partie 1 / "}${MESR_PLAN[s.rubrique as Rubrique].numero}. ${MESR_PLAN[s.rubrique as Rubrique].label}`;
    const target = { type: "section", id: s.id, projectId: s.projectId, label };
    const filled = s.contentText.trim().length > 0;
    block("section_filled", filled, `${label} : ${filled ? "rédigée" : "vide"}`, target);
    block("section_up_to_date", !s.toUpdate, `${label} : ${s.toUpdate ? "reprise de N-1 à actualiser" : "à jour"}`, target);
    block("section_validated", !!s.validatedAt, `${label} : ${s.validatedAt ? "validée" : "non validée"}`, target);
  }

  // Avertissements : références postérieures au début des travaux (état de l'art)
  const stateOfArt = relevant.filter((s) => s.rubrique === "b_etat_art" && s.projectId);
  if (stateOfArt.length) {
    const cites = await tx
      .select({ sectionId: schema.sectionRefs.sectionId, ref: schema.biblioRefs })
      .from(schema.sectionRefs)
      .innerJoin(schema.biblioRefs, eq(schema.biblioRefs.id, schema.sectionRefs.refId))
      .where(inArray(schema.sectionRefs.sectionId, stateOfArt.map((s) => s.id)));
    for (const c of cites) {
      const s = stateOfArt.find((x) => x.id === c.sectionId)!;
      const p = included.find((x) => x.id === s.projectId)!;
      if (c.ref.publishedOn > p.startDate)
        warn("ref_after_start", `${p.code} : « ${c.ref.title} » (${c.ref.publishedOn}) est postérieure au début des travaux (${p.startDate})`, {
          type: "reference",
          id: c.ref.id,
          projectId: p.id,
          label: c.ref.title,
        });
    }
  }

  // Pages
  for (const p of included) {
    const ps = relevant.filter((s) => s.projectId === p.id);
    const chars = (keys: Rubrique[]) => ps.filter((s) => keys.includes(s.rubrique as Rubrique)).reduce((n, s) => n + s.contentText.length, 0);
    const total = estimatePages(chars([...RUBRIQUES_OPERATION]));
    if (total > MAX_PAGES_FICHE_SCIENTIFIQUE) warn("pages_total", `${p.code} : fiche scientifique estimée à ${total} pages (10 max.)`, { type: "project", id: p.id, projectId: p.id, label: p.code });
    const bcd = estimatePages(chars(["b_etat_art", "c_verrous", "d_demarche"]));
    if (bcd > GROUP_LIMITS.bcd) warn("pages_bcd", `${p.code} : état de l'art + verrous + démarche ≈ ${bcd} pages (3 max.)`, { type: "project", id: p.id, projectId: p.id, label: p.code });
    const ef = estimatePages(chars(["e_travaux", "f_contribution"]));
    if (ef > GROUP_LIMITS.ef) warn("pages_ef", `${p.code} : travaux + contribution ≈ ${ef} pages (3 max.)`, { type: "project", id: p.id, projectId: p.id, label: p.code });
  }

  // Temps non rattachés à une fiche
  for (const p of included) {
    const list = entries.filter((e) => e.projectId === p.id);
    const total = list.reduce((s, e) => s + e.hours, 0);
    const unlinked = list.filter((e) => !e.noteId).reduce((s, e) => s + e.hours, 0);
    if (total > 0 && (unlinked / total) * 100 > company.unlinkedThreshold)
      warn("unlinked_time", `${p.code} : ${Math.round((unlinked / total) * 100)} % des heures ne sont rattachées à aucune fiche (seuil ${company.unlinkedThreshold} %)`, {
        type: "project",
        id: p.id,
        projectId: p.id,
        label: p.code,
      });
  }

  // Saisies tardives
  for (const n of notes) {
    if (diffDays(n.noteDate, n.createdAt.toISOString().slice(0, 10)) > LATE_ENTRY_DAYS)
      warn("late_entry", `${formatNoteRef(n.refNo)} saisie plus de ${LATE_ENTRY_DAYS} jours après sa date`, { type: "note", id: n.id, label: formatNoteRef(n.refNo) });
  }

  const blocking = items.filter((i) => i.level === "blocking");
  const blockingOk = blocking.filter((i) => i.ok).length;
  const progress = blocking.length ? Math.round((blockingOk / blocking.length) * 100) : 0;
  if (progress !== fy.progress && (fy.status === "draft" || fy.status === "in_review")) {
    await tx.update(schema.fiscalYears).set({ progress }).where(eq(schema.fiscalYears.id, fy.id));
  }
  items.sort((a, b) => Number(a.ok) - Number(b.ok) || (a.level === b.level ? 0 : a.level === "blocking" ? -1 : 1));
  return { fiscalYearId: fy.id, progress, blockingTotal: blocking.length, blockingOk, items };
}
