import {
  commentSchema,
  frascatiComplete,
  GROUP_LIMITS,
  MESR_PLAN,
  referenceSchema,
  RUBRIQUES_OPERATION,
  RUBRIQUES_SOCIETE,
  sectionSaveSchema,
  toPlainText,
  estimatePages,
  type CommentDto,
  type FrascatiCriterion,
  type PMNode,
  type ReferenceDto,
  type ReferenceType,
  type Rubrique,
  type SectionVersionDto,
  type SelfAssessment,
} from "@cir/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import { schema, type Tx } from "../../db/client";
import { conflict, forbidden, HttpError, notFound, parse, unprocessable } from "../../lib/errors";
import { hasRole, requireRole, run } from "../../middlewares/auth";
import { contributorScope, editableFiscalYear, getFiscalYear, iso, namesOfUsers } from "../common";
import { projectDtos } from "../projects/routes";
import { computeChecklist } from "./checklist";
import { buildDossierData } from "./consolidated";
import { renderDossierHtml } from "@cir/shared";
import { sectionDtos, sectionsOf, syncCitations } from "./sections-service";
import { param } from "../../lib/http";

export const dossierRouter = Router();

const MAX_CONTENT_BYTES = 1_000_000;

async function getSection(tx: Tx, id: string) {
  const [s] = await tx.select().from(schema.sections).where(eq(schema.sections.id, id));
  if (!s) throw notFound("Section introuvable");
  return s;
}

async function assertSectionReadable(req: Request, tx: Tx, projectId: string | null) {
  if (!projectId) return;
  const scope = await contributorScope(req, tx);
  if (scope && !scope.projectIds.includes(projectId)) throw forbidden("Projet non affecté");
}

/** Sommaire : partie 1 + sections de chaque projet retenu (hors non éligibles et pistes CII). */
dossierRouter.get("/dossier/:fiscalYearId", async (req, res) => {
  const out = await run(req, async (tx) => {
    const fy = await getFiscalYear(tx, param(req, "fiscalYearId"));
    const scope = await contributorScope(req, tx);
    const partOne = await sectionDtos(tx, await sectionsOf(tx, fy.id, null));
    const projectRows = await tx
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.fiscalYearId, fy.id), isNull(schema.projects.deletedAt)))
      .orderBy(asc(schema.projects.code));
    const projects = (await projectDtos(tx, projectRows)).filter((p) => !scope || scope.projectIds.includes(p.id));
    const out = [];
    for (const p of projects) {
      const sections = await sectionDtos(tx, await sectionsOf(tx, fy.id, p.id));
      const pagesOf = (keys: Rubrique[]) => estimatePages(sections.filter((s) => keys.includes(s.rubrique)).reduce((n, s) => n + s.contentText.length, 0));
      out.push({
        project: p,
        included: p.verdict === null || p.verdict === "eligible_cir",
        sections: RUBRIQUES_OPERATION.map((r) => sections.find((s) => s.rubrique === r)).filter(Boolean),
        pages: {
          total: pagesOf([...RUBRIQUES_OPERATION]),
          bcd: pagesOf(["b_etat_art", "c_verrous", "d_demarche"]),
          ef: pagesOf(["e_travaux", "f_contribution"]),
          limits: { total: 10, ...GROUP_LIMITS },
        },
      });
    }
    return {
      fiscalYearId: fy.id,
      status: fy.status,
      partOne: RUBRIQUES_SOCIETE.map((r) => partOne.find((s) => s.rubrique === r)).filter(Boolean),
      projects: out,
    };
  });
  res.json(out);
});

dossierRouter.get("/sections/:id", async (req, res) => {
  const out = await run(req, async (tx) => {
    const s = await getSection(tx, param(req));
    await assertSectionReadable(req, tx, s.projectId);
    return (await sectionDtos(tx, [s]))[0];
  });
  res.json(out);
});

async function assertSectionWritable(tx: Tx, s: typeof schema.sections.$inferSelect) {
  await editableFiscalYear(tx, s.fiscalYearId);
  if (s.projectId) {
    const answers = await tx.select().from(schema.frascatiAnswers).where(eq(schema.frascatiAnswers.projectId, s.projectId));
    const complete = frascatiComplete(
      answers.map((a) => ({ criterion: a.criterion as FrascatiCriterion, argument: a.argument, selfAssessment: a.selfAssessment as SelfAssessment })),
    );
    if (!complete) throw new HttpError(409, "frascati_incomplete", "Qualifiez d'abord le projet : les 5 critères de Frascati doivent être argumentés avant la rédaction");
  }
}

async function saveContent(tx: Tx, req: Request, s: typeof schema.sections.$inferSelect, content: PMNode, opts: { clearToUpdate: boolean }) {
  const contentText = toPlainText(content);
  const version = s.version + 1;
  const changed = contentText !== s.contentText || JSON.stringify(content) !== JSON.stringify(s.content);
  const [row] = await tx
    .update(schema.sections)
    .set({
      content,
      contentText,
      version,
      authorId: req.auth!.userId,
      toUpdate: opts.clearToUpdate ? false : s.toUpdate,
      ...(changed ? { validatedBy: null, validatedAt: null } : {}),
    })
    .where(eq(schema.sections.id, s.id))
    .returning();
  await tx.insert(schema.sectionVersions).values({ companyId: s.companyId, sectionId: s.id, version, content, contentText, authorId: req.auth!.userId });
  await syncCitations(tx, s.companyId, s.id, content);
  return row!;
}

dossierRouter.put("/sections/:id", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(sectionSaveSchema, req.body);
  if (Buffer.byteLength(JSON.stringify(input.content)) > MAX_CONTENT_BYTES) throw unprocessable("Contenu trop volumineux (1 Mo maximum par rubrique)");
  const content = input.content as unknown as PMNode;
  if (content.type !== "doc") throw unprocessable("Contenu invalide");
  const out = await run(req, async (tx) => {
    const s = await getSection(tx, param(req));
    await assertSectionWritable(tx, s);
    if (input.baseVersion !== s.version) {
      throw new HttpError(409, "version_conflict", "La section a été modifiée entre-temps par quelqu'un d'autre : rechargez-la", { currentVersion: s.version });
    }
    const row = await saveContent(tx, req, s, content, { clearToUpdate: true });
    return (await sectionDtos(tx, [row]))[0];
  });
  res.json(out);
});

/** Confirme qu'une section reprise de N-1 (« à actualiser ») reste exacte sans la modifier. */
dossierRouter.post("/sections/:id/confirm", requireRole("admin", "redacteur"), async (req, res) => {
  const out = await run(req, async (tx) => {
    const s = await getSection(tx, param(req));
    await editableFiscalYear(tx, s.fiscalYearId);
    const [row] = await tx.update(schema.sections).set({ toUpdate: false }).where(eq(schema.sections.id, s.id)).returning();
    return (await sectionDtos(tx, [row!]))[0];
  });
  res.json(out);
});

dossierRouter.get("/sections/:id/versions", async (req, res) => {
  const out = await run(req, async (tx) => {
    const s = await getSection(tx, param(req));
    await assertSectionReadable(req, tx, s.projectId);
    const rows = await tx.select().from(schema.sectionVersions).where(eq(schema.sectionVersions.sectionId, s.id)).orderBy(desc(schema.sectionVersions.version));
    const names = await namesOfUsers(tx, rows.map((r) => r.authorId));
    return rows.map(
      (r): SectionVersionDto => ({
        version: r.version,
        authorName: r.authorId ? (names.get(r.authorId) ?? null) : null,
        createdAt: iso(r.createdAt)!,
        contentText: r.contentText,
        content: r.content as PMNode,
      }),
    );
  });
  res.json(out);
});

/** Restauration sans perte : la version choisie devient une nouvelle version. */
dossierRouter.post("/sections/:id/restore", requireRole("admin", "redacteur"), async (req, res) => {
  const { version } = parse(z.object({ version: z.number().int().min(1) }), req.body);
  const out = await run(req, async (tx) => {
    const s = await getSection(tx, param(req));
    await assertSectionWritable(tx, s);
    const [v] = await tx
      .select()
      .from(schema.sectionVersions)
      .where(and(eq(schema.sectionVersions.sectionId, s.id), eq(schema.sectionVersions.version, version)));
    if (!v) throw notFound("Version introuvable");
    const row = await saveContent(tx, req, s, v.content as PMNode, { clearToUpdate: false });
    return (await sectionDtos(tx, [row]))[0];
  });
  res.json(out);
});

dossierRouter.post("/sections/:id/validate", requireRole("admin"), async (req, res) => {
  const out = await run(req, async (tx) => {
    const s = await getSection(tx, param(req));
    await editableFiscalYear(tx, s.fiscalYearId);
    if (!s.contentText.trim()) throw unprocessable("Une rubrique vide ne peut pas être validée");
    if (s.toUpdate) throw unprocessable("Actualisez ou confirmez d'abord cette rubrique reprise de l'exercice précédent");
    const [row] = await tx.update(schema.sections).set({ validatedBy: req.auth!.userId, validatedAt: new Date() }).where(eq(schema.sections.id, s.id)).returning();
    return (await sectionDtos(tx, [row!]))[0];
  });
  res.json(out);
});

dossierRouter.delete("/sections/:id/validate", requireRole("admin"), async (req, res) => {
  const out = await run(req, async (tx) => {
    const s = await getSection(tx, param(req));
    await editableFiscalYear(tx, s.fiscalYearId);
    const [row] = await tx.update(schema.sections).set({ validatedBy: null, validatedAt: null }).where(eq(schema.sections.id, s.id)).returning();
    return (await sectionDtos(tx, [row!]))[0];
  });
  res.json(out);
});

/* ------------------------------- Commentaires ------------------------------- */

async function commentDtos(tx: Tx, rows: (typeof schema.comments.$inferSelect)[]): Promise<CommentDto[]> {
  const names = await namesOfUsers(tx, rows.map((r) => r.authorUserId));
  return rows.map((c) => ({
    id: c.id,
    sectionId: c.sectionId,
    parentId: c.parentId,
    authorName: names.get(c.authorUserId) ?? "?",
    authorUserId: c.authorUserId,
    anchorText: c.anchorText,
    body: c.body,
    resolved: c.resolved,
    createdAt: iso(c.createdAt)!,
  }));
}

dossierRouter.get("/sections/:id/comments", async (req, res) => {
  const out = await run(req, async (tx) => {
    const s = await getSection(tx, param(req));
    await assertSectionReadable(req, tx, s.projectId);
    return commentDtos(tx, await tx.select().from(schema.comments).where(eq(schema.comments.sectionId, s.id)).orderBy(asc(schema.comments.createdAt)));
  });
  res.json(out);
});

dossierRouter.post("/sections/:id/comments", requireRole("admin", "redacteur", "expert"), async (req, res) => {
  const input = parse(commentSchema, req.body);
  const out = await run(req, async (tx) => {
    const s = await getSection(tx, param(req));
    const fy = await getFiscalYear(tx, s.fiscalYearId);
    if (fy.status === "sealed") throw conflict("Exercice scellé");
    if (input.parentId) {
      const [parent] = await tx.select().from(schema.comments).where(eq(schema.comments.id, input.parentId));
      if (!parent || parent.sectionId !== s.id) throw unprocessable("Fil de commentaires introuvable");
    }
    const [row] = await tx
      .insert(schema.comments)
      .values({ companyId: s.companyId, createdBy: req.auth!.userId, sectionId: s.id, parentId: input.parentId ?? null, authorUserId: req.auth!.userId, anchorText: input.anchorText ?? null, body: input.body })
      .returning();
    return (await commentDtos(tx, [row!]))[0];
  });
  res.status(201).json(out);
});

dossierRouter.patch("/comments/:id", requireRole("admin", "redacteur", "expert"), async (req, res) => {
  const { resolved } = parse(z.object({ resolved: z.boolean() }), req.body);
  const out = await run(req, async (tx) => {
    const [c] = await tx.select().from(schema.comments).where(eq(schema.comments.id, param(req)));
    if (!c) throw notFound();
    const [row] = await tx
      .update(schema.comments)
      .set({ resolved, resolvedBy: resolved ? req.auth!.userId : null })
      .where(eq(schema.comments.id, c.id))
      .returning();
    return (await commentDtos(tx, [row!]))[0];
  });
  res.json(out);
});

/* ------------------------------ Bibliographie ------------------------------ */

async function referenceDtos(tx: Tx, rows: (typeof schema.biblioRefs.$inferSelect)[], fiscalYearId?: string): Promise<ReferenceDto[]> {
  const ids = rows.map((r) => r.id);
  const cites = ids.length
    ? await tx
        .select({ refId: schema.sectionRefs.refId, sectionId: schema.sections.id, rubrique: schema.sections.rubrique, projectCode: schema.projects.code, fiscalYearId: schema.sections.fiscalYearId })
        .from(schema.sectionRefs)
        .innerJoin(schema.sections, eq(schema.sections.id, schema.sectionRefs.sectionId))
        .leftJoin(schema.projects, eq(schema.projects.id, schema.sections.projectId))
        .where(inArray(schema.sectionRefs.refId, ids))
    : [];
  return rows.map((r) => ({
    id: r.id,
    refType: r.refType as ReferenceType,
    title: r.title,
    authors: r.authors,
    publishedOn: r.publishedOn,
    doi: r.doi,
    url: r.url,
    patentNumber: r.patentNumber,
    citedIn: cites
      .filter((c) => c.refId === r.id && (!fiscalYearId || c.fiscalYearId === fiscalYearId))
      .map((c) => ({ sectionId: c.sectionId, rubrique: c.rubrique as Rubrique, projectCode: c.projectCode })),
  }));
}

dossierRouter.get("/references", async (req, res) => {
  const { fiscalYearId } = parse(z.object({ fiscalYearId: z.uuid().optional() }), req.query);
  const out = await run(req, async (tx) =>
    referenceDtos(tx, await tx.select().from(schema.biblioRefs).where(isNull(schema.biblioRefs.deletedAt)).orderBy(desc(schema.biblioRefs.publishedOn)), fiscalYearId),
  );
  res.json(out);
});

const refValues = (input: z.infer<typeof referenceSchema>) => ({ ...input, url: input.url || null, doi: input.doi || null, patentNumber: input.patentNumber || null });

dossierRouter.post("/references", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(referenceSchema, req.body);
  const out = await run(req, async (tx) => {
    const [row] = await tx.insert(schema.biblioRefs).values({ ...refValues(input), companyId: req.company!.companyId, createdBy: req.auth!.userId }).returning();
    return (await referenceDtos(tx, [row!]))[0];
  });
  res.status(201).json(out);
});

dossierRouter.put("/references/:id", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(referenceSchema, req.body);
  const out = await run(req, async (tx) => {
    const [row] = await tx.update(schema.biblioRefs).set(refValues(input)).where(eq(schema.biblioRefs.id, param(req))).returning();
    if (!row) throw notFound();
    return (await referenceDtos(tx, [row]))[0];
  });
  res.json(out);
});

dossierRouter.delete("/references/:id", requireRole("admin", "redacteur"), async (req, res) => {
  await run(req, async (tx) => {
    const [c] = await tx.select().from(schema.sectionRefs).where(eq(schema.sectionRefs.refId, param(req))).limit(1);
    if (c) throw conflict("Référence citée dans une section : retirez d'abord la citation");
    await tx.update(schema.biblioRefs).set({ deletedAt: new Date() }).where(eq(schema.biblioRefs.id, param(req)));
  });
  res.status(204).end();
});

/* --------------------------- Check-list et vue consolidée --------------------------- */

dossierRouter.get("/fiscal-years/:id/checklist", async (req, res) => {
  res.json(await run(req, (tx) => computeChecklist(tx, param(req))));
});

dossierRouter.get("/fiscal-years/:id/consolidated", async (req, res) => {
  if (hasRole(req, "contributeur")) throw forbidden();
  const { annexFiles: _files, ...data } = await run(req, (tx) => buildDossierData(tx, param(req), "screen"));
  res.json(data);
});

dossierRouter.get("/fiscal-years/:id/consolidated.html", async (req, res) => {
  if (hasRole(req, "contributeur")) throw forbidden();
  const { annexFiles: _files, ...data } = await run(req, (tx) => buildDossierData(tx, param(req), "screen"));
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'");
  res.type("html").send(renderDossierHtml(data));
});

