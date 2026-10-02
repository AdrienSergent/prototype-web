import { FILE_KINDS, type FileKind } from "@cir/shared";
import { and, eq, isNull } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import { schema, type Tx } from "../../db/client";
import { forbidden, notFound, parse } from "../../lib/errors";
import { storage } from "../../lib/storage";
import { ALLOWED, inspectUpload, upload } from "../../lib/uploads";
import { hasRole, run } from "../../middlewares/auth";
import { assertProjectReadable, editableFiscalYear, personOfUser } from "../common";
import { filesDto, listFiles, storeFile } from "./service";
import { param } from "../../lib/http";

export const filesRouter = Router();

async function noteContext(tx: Tx, noteId: string) {
  const [row] = await tx
    .select({ note: schema.notes, projectId: schema.locks.projectId, fiscalYearId: schema.projects.fiscalYearId })
    .from(schema.notes)
    .innerJoin(schema.topics, eq(schema.topics.id, schema.notes.topicId))
    .innerJoin(schema.locks, eq(schema.locks.id, schema.topics.lockId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.locks.projectId))
    .where(and(eq(schema.notes.id, noteId), isNull(schema.notes.deletedAt)));
  if (!row) throw notFound("Fiche introuvable");
  return row;
}

async function assertCanAccess(req: Request, tx: Tx, kind: FileKind, ownerId: string, write: boolean) {
  if (kind.startsWith("company_")) {
    if (write && !hasRole(req, "admin")) throw forbidden();
    return;
  }
  if (kind.startsWith("person_")) {
    const [person] = await tx.select().from(schema.people).where(eq(schema.people.id, ownerId));
    if (!person) throw notFound("Personne introuvable");
    if (write && !hasRole(req, "admin", "redacteur")) throw forbidden();
    if (!write && hasRole(req, "contributeur")) {
      const me = await personOfUser(tx, req.auth!.userId);
      if (me?.id !== ownerId) throw forbidden();
    }
    return;
  }
  // note_attachment
  const ctx = await noteContext(tx, ownerId);
  await assertProjectReadable(req, tx, ctx.projectId);
  if (write) {
    if (hasRole(req, "expert")) throw forbidden();
    await editableFiscalYear(tx, ctx.fiscalYearId);
    if (hasRole(req, "contributeur")) {
      const me = await personOfUser(tx, req.auth!.userId);
      if (ctx.note.authorPersonId !== me?.id) throw forbidden("Seul l'auteur de la fiche peut y joindre des pièces");
    }
  }
}

const kindSchema = z.enum(FILE_KINDS);

filesRouter.get("/files", async (req, res) => {
  const { kind, ownerId } = parse(z.object({ kind: kindSchema, ownerId: z.uuid() }), req.query);
  const out = await run(req, async (tx) => {
    await assertCanAccess(req, tx, kind, ownerId, false);
    return filesDto(tx, await listFiles(tx, [ownerId], [kind]));
  });
  res.json(out);
});

filesRouter.post("/files", upload.single("file"), async (req, res) => {
  const { kind, ownerId } = parse(z.object({ kind: kindSchema, ownerId: z.uuid() }), req.body);
  const allowed = kind === "person_cv" ? ALLOWED.cv : kind === "note_attachment" ? ALLOWED.attachment : ALLOWED.document;
  const maxBytes = kind.startsWith("person_") ? 10 * 1024 * 1024 : undefined;
  const file = await inspectUpload(req.file, allowed, maxBytes);
  const out = await run(req, async (tx) => {
    await assertCanAccess(req, tx, kind, ownerId, true);
    const row = await storeFile(tx, req.company!.companyId, req.auth!.userId, kind, ownerId, file);
    return (await filesDto(tx, [row]))[0];
  });
  res.status(201).json(out);
});

filesRouter.get("/files/:id/download", async (req, res) => {
  const file = await run(req, async (tx) => {
    const [f] = await tx.select().from(schema.files).where(and(eq(schema.files.id, param(req)), isNull(schema.files.deletedAt)));
    if (!f) throw notFound();
    await assertCanAccess(req, tx, f.kind as FileKind, f.ownerId, false);
    return f;
  });
  const body = await storage.get(file.storageKey);
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  res.setHeader("X-Content-SHA256", file.sha256);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(body);
});

filesRouter.delete("/files/:id", async (req, res) => {
  await run(req, async (tx) => {
    const [f] = await tx.select().from(schema.files).where(eq(schema.files.id, param(req)));
    if (!f) throw notFound();
    await assertCanAccess(req, tx, f.kind as FileKind, f.ownerId, true);
    await tx.update(schema.files).set({ deletedAt: new Date() }).where(eq(schema.files.id, f.id));
  });
  res.status(204).end();
});
