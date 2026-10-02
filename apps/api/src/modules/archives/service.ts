import { renderDossierHtml } from "@cir/shared";
import { ZipArchive } from "archiver";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "../../db/client";
import { sha256 } from "../../lib/crypto";
import { logger } from "../../lib/logger";
import { storage } from "../../lib/storage";
import { enqueue, registerInlineHandler } from "../../jobs/boss";
import { QUEUES } from "../../jobs/queues";
import { buildDossierData } from "../dossier/consolidated";

export interface SealJob {
  companyId: string;
  userId: string;
  archiveId: string;
}

registerInlineHandler<SealJob>(QUEUES.sealArchive, (job) => sealArchive(job));

export async function startSeal(job: SealJob) {
  await enqueue(QUEUES.sealArchive, job);
}

async function zip(entries: { name: string; data: Buffer | string }[]): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", () => resolve());
    archive.on("error", reject);
  });
  for (const e of entries) archive.append(e.data, { name: e.name, date: new Date("2000-01-01T00:00:00Z") });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

/**
 * Scellement F6.5 : ZIP (contenus JSON, vue consolidée HTML, pièces, manifeste des empreintes SHA-256),
 * empreinte globale, stockage non modifiable, exercice passé en « scellé » (lecture seule).
 */
export async function sealArchive(job: SealJob) {
  const ctx = { companyId: job.companyId, userId: job.userId };
  try {
    const [archive] = await withTenant(ctx, (tx) => tx.select().from(schema.archives).where(eq(schema.archives.id, job.archiveId)));
    if (!archive || archive.status !== "pending") return;
    const data = await withTenant(ctx, (tx) => buildDossierData(tx, archive.fiscalYearId, "archive"));
    const { annexFiles, ...dossier } = data;
    const raw = await withTenant(ctx, async (tx) => ({
      timeEntries: await tx.select().from(schema.timeEntries).where(eq(schema.timeEntries.fiscalYearId, archive.fiscalYearId)),
    }));
    const files: { name: string; data: Buffer | string }[] = [];
    files.push({ name: "dossier.html", data: renderDossierHtml({ ...dossier, annexes: dossier.annexes }) });
    files.push({ name: "dossier.json", data: JSON.stringify(dossier, null, 2) });
    files.push({
      name: "temps.json",
      data: JSON.stringify(
        raw.timeEntries.map((t) => ({ id: t.id, personId: t.personId, projectId: t.projectId, date: t.entryDate, granularity: t.granularity, hours: t.hours, noteId: t.noteId, source: t.source })),
        null,
        2,
      ),
    });
    for (const a of annexFiles) {
      const body = await storage.get(a.file.storageKey);
      if (sha256(body) !== a.file.sha256) throw new Error(`Empreinte incohérente pour ${a.file.filename}`);
      files.push({ name: a.path, data: body });
    }
    const manifest = {
      generatedAt: new Date().toISOString(),
      fiscalYear: dossier.fiscalYear,
      company: { name: dossier.company.name, siren: dossier.company.siren },
      algorithm: "SHA-256",
      files: files.map((f) => ({ path: f.name, sha256: sha256(typeof f.data === "string" ? Buffer.from(f.data) : f.data), size: typeof f.data === "string" ? Buffer.byteLength(f.data) : f.data.length })),
    };
    files.push({ name: "manifest.json", data: JSON.stringify(manifest, null, 2) });
    const buffer = await zip(files);
    const globalHash = sha256(buffer);
    const key = `archives/${job.companyId}/${archive.fiscalYearId}/${archive.id}.zip`;
    await storage.put(key, buffer, "application/zip", { immutable: true });
    await withTenant(ctx, async (tx) => {
      await tx
        .update(schema.archives)
        .set({ status: "done", storageKey: key, sha256: globalHash, size: buffer.length, manifest, sealedAt: new Date() })
        .where(eq(schema.archives.id, archive.id));
      await tx
        .update(schema.fiscalYears)
        .set({ status: "sealed", sealedAt: new Date(), sealedBy: job.userId })
        .where(and(eq(schema.fiscalYears.id, archive.fiscalYearId), eq(schema.fiscalYears.status, "expert_validated")));
    });
    logger.info({ archiveId: archive.id, sha256: globalHash }, "Exercice scellé");
  } catch (err) {
    logger.error({ err, archiveId: job.archiveId }, "Échec du scellement");
    await withTenant(ctx, (tx) =>
      tx
        .update(schema.archives)
        .set({ status: "failed", error: (err as Error).message.slice(0, 500) })
        .where(eq(schema.archives.id, job.archiveId)),
    );
  }
}
