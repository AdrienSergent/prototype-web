import type { ArchiveDto } from "@cir/shared";
import { desc, eq } from "drizzle-orm";
import { Router } from "express";
import { schema, type Tx } from "../../db/client";
import { sha256 } from "../../lib/crypto";
import { notFound } from "../../lib/errors";
import { storage } from "../../lib/storage";
import { requireRole, run } from "../../middlewares/auth";
import { iso, namesOfUsers } from "../common";
import { param } from "../../lib/http";

export const archivesRouter = Router();
archivesRouter.use(["/archives", "/fiscal-years/:id/archives"], requireRole("admin", "expert", "redacteur"));

async function dtos(tx: Tx, rows: (typeof schema.archives.$inferSelect)[]): Promise<ArchiveDto[]> {
  const names = await namesOfUsers(tx, rows.map((r) => r.createdBy));
  return rows.map((a) => ({
    id: a.id,
    fiscalYearId: a.fiscalYearId,
    status: a.status as ArchiveDto["status"],
    sha256: a.sha256,
    size: a.size,
    sealedAt: iso(a.sealedAt),
    sealedByName: a.createdBy ? (names.get(a.createdBy) ?? null) : null,
    error: a.error,
    fileCount: (a.manifest as { files?: unknown[] } | null)?.files?.length ?? null,
  }));
}

archivesRouter.get("/fiscal-years/:id/archives", async (req, res) => {
  const out = await run(req, async (tx) =>
    dtos(tx, await tx.select().from(schema.archives).where(eq(schema.archives.fiscalYearId, param(req))).orderBy(desc(schema.archives.createdAt))),
  );
  res.json(out);
});

async function getDone(tx: Tx, id: string) {
  const [a] = await tx.select().from(schema.archives).where(eq(schema.archives.id, id));
  if (!a || a.status !== "done" || !a.storageKey) throw notFound("Archive indisponible");
  return a;
}

archivesRouter.get("/archives/:id/download", async (req, res) => {
  const a = await run(req, (tx) => getDone(tx, param(req)));
  const body = await storage.get(a.storageKey!);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="dossier-cir-${a.fiscalYearId.slice(0, 8)}-${a.sha256!.slice(0, 12)}.zip"`);
  res.setHeader("X-Content-SHA256", a.sha256!);
  res.send(body);
});

/** Recalcule l'empreinte de l'archive stockée et la compare à celle enregistrée au scellement. */
archivesRouter.get("/archives/:id/verify", async (req, res) => {
  const a = await run(req, (tx) => getDone(tx, param(req)));
  const actual = sha256(await storage.get(a.storageKey!));
  res.json({ expected: a.sha256, actual, ok: actual === a.sha256 });
});
