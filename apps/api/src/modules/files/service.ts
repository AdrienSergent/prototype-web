import { FILE_KINDS, type FileDto, type FileKind } from "@cir/shared";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/client";
import type { InspectedFile } from "../../lib/uploads";
import { storage } from "../../lib/storage";
import { iso, namesOfUsers } from "../common";

export async function storeFile(tx: Tx, companyId: string, userId: string, kind: FileKind, ownerId: string, file: InspectedFile) {
  const [{ v }] = (await tx
    .select({ v: sql<number>`coalesce(max(${schema.files.version}), 0)::int` })
    .from(schema.files)
    .where(and(eq(schema.files.kind, kind), eq(schema.files.ownerId, ownerId)))) as [{ v: number }];
  const id = crypto.randomUUID();
  const storageKey = `files/${companyId}/${kind}/${ownerId}/${id}-${file.sha256.slice(0, 12)}`;
  await storage.put(storageKey, file.buffer, file.mime);
  const [row] = await tx
    .insert(schema.files)
    .values({ companyId, createdBy: userId, kind, ownerId, filename: file.filename, mime: file.mime, size: file.size, storageKey, sha256: file.sha256, version: v + 1 })
    .returning();
  return row!;
}

export async function filesDto(tx: Tx, rows: (typeof schema.files.$inferSelect)[]): Promise<FileDto[]> {
  const names = await namesOfUsers(tx, rows.map((r) => r.createdBy));
  return rows.map((f) => ({
    id: f.id,
    kind: f.kind as FileKind,
    filename: f.filename,
    mime: f.mime,
    size: f.size,
    sha256: f.sha256,
    version: f.version,
    createdAt: iso(f.createdAt)!,
    uploadedByName: f.createdBy ? (names.get(f.createdBy) ?? null) : null,
  }));
}

export async function listFiles(tx: Tx, ownerIds: string[], kinds: readonly FileKind[] = FILE_KINDS) {
  if (!ownerIds.length) return [];
  return tx
    .select()
    .from(schema.files)
    .where(and(inArray(schema.files.ownerId, ownerIds), inArray(schema.files.kind, [...kinds]), isNull(schema.files.deletedAt)))
    .orderBy(desc(schema.files.version));
}

/** Dernière version de chaque (kind, owner). */
export function latestVersions<T extends { kind: string; ownerId: string; version: number }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.kind}:${r.ownerId}`;
    const cur = map.get(k);
    if (!cur || cur.version < r.version) map.set(k, r);
  }
  return [...map.values()];
}
