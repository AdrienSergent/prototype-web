import { estimatePages, extractCitations, RUBRIQUES_OPERATION, RUBRIQUES_SOCIETE, type PMNode, type Rubrique, type SectionDto } from "@cir/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/client";
import { iso, namesOfUsers } from "../common";

/** Crée les sections fixes du plan MESR (partie 1 pour l'exercice, partie 2 pour un projet). */
export async function ensureSections(tx: Tx, companyId: string, fiscalYearId: string, projectId: string | null, userId: string | null) {
  const rubriques: readonly Rubrique[] = projectId ? RUBRIQUES_OPERATION : RUBRIQUES_SOCIETE;
  await tx
    .insert(schema.sections)
    .values(rubriques.map((rubrique) => ({ companyId, fiscalYearId, projectId, rubrique, createdBy: userId })))
    .onConflictDoNothing();
}

/** Met à jour les renvois (références et fiches citées) d'une section à partir de son contenu. */
export async function syncCitations(tx: Tx, companyId: string, sectionId: string, content: PMNode) {
  const { refIds, noteIds } = extractCitations(content);
  await tx.delete(schema.sectionRefs).where(eq(schema.sectionRefs.sectionId, sectionId));
  await tx.delete(schema.sectionNotes).where(eq(schema.sectionNotes.sectionId, sectionId));
  if (refIds.length) {
    const existing = await tx.select({ id: schema.biblioRefs.id }).from(schema.biblioRefs).where(inArray(schema.biblioRefs.id, refIds));
    if (existing.length) await tx.insert(schema.sectionRefs).values(existing.map((r) => ({ companyId, sectionId, refId: r.id })));
  }
  if (noteIds.length) {
    const existing = await tx.select({ id: schema.notes.id }).from(schema.notes).where(inArray(schema.notes.id, noteIds));
    if (existing.length) await tx.insert(schema.sectionNotes).values(existing.map((n) => ({ companyId, sectionId, noteId: n.id })));
  }
}

type SectionRow = typeof schema.sections.$inferSelect;

export async function sectionDtos(tx: Tx, rows: SectionRow[]): Promise<SectionDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const counts = await tx
    .select({
      sectionId: schema.comments.sectionId,
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where not ${schema.comments.resolved} and ${schema.comments.parentId} is null)::int`,
    })
    .from(schema.comments)
    .where(inArray(schema.comments.sectionId, ids))
    .groupBy(schema.comments.sectionId);
  const names = await namesOfUsers(tx, rows.flatMap((r) => [r.authorId, r.validatedBy]));
  return rows.map((s) => ({
    id: s.id,
    rubrique: s.rubrique as Rubrique,
    projectId: s.projectId,
    operationId: s.operationId,
    content: s.content as PMNode,
    contentText: s.contentText,
    version: s.version,
    authorName: s.authorId ? (names.get(s.authorId) ?? null) : null,
    updatedAt: iso(s.updatedAt)!,
    validatedByName: s.validatedBy ? (names.get(s.validatedBy) ?? null) : null,
    validatedAt: iso(s.validatedAt),
    toUpdate: s.toUpdate,
    pages: estimatePages(s.contentText.length),
    commentCount: counts.find((c) => c.sectionId === s.id)?.total ?? 0,
    openCommentCount: counts.find((c) => c.sectionId === s.id)?.open ?? 0,
  }));
}

export async function sectionsOf(tx: Tx, fiscalYearId: string, projectId: string | null) {
  return tx
    .select()
    .from(schema.sections)
    .where(and(eq(schema.sections.fiscalYearId, fiscalYearId), projectId ? eq(schema.sections.projectId, projectId) : sql`${schema.sections.projectId} is null`));
}
