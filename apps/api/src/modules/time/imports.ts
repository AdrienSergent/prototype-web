import {
  firstDayOfMonth,
  formatNoteRef,
  IMPORT_FIELDS,
  importCommitSchema,
  importMappingSchema,
  parseFrenchDate,
  parseFrenchNumber,
  parseNoteRef,
  roundQuarter,
  type ImportField,
  type ImportPreviewDto,
  type TimeGranularity,
} from "@cir/shared";
import ExcelJS from "exceljs";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Router } from "express";
import Papa from "papaparse";
import { z } from "zod";
import { schema, type Tx } from "../../db/client";
import { conflict, HttpError, notFound, parse, unprocessable } from "../../lib/errors";
import { ALLOWED, inspectUpload, upload } from "../../lib/uploads";
import { requireRole, run } from "../../middlewares/auth";
import { editableFiscalYear, getCompany, personName, type FiscalYearRow } from "../common";
import { capacityViolations, type CapEntry } from "./capacity";
import { employmentOk, inPeriod } from "./service";
import { param } from "../../lib/http";

export const importsRouter = Router();
importsRouter.use("/imports", requireRole("admin", "redacteur"));

export const MAX_IMPORT_ROWS = 20_000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

type RawRow = Record<string, string>;

/* -------------------------------- Lecture -------------------------------- */

export async function readTable(buffer: Buffer, mime: string): Promise<{ headers: string[]; rows: RawRow[] }> {
  if (mime.includes("spreadsheetml")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw unprocessable("Classeur vide");
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => (headers[col - 1] = cell.text.trim() || `Colonne ${col}`));
    const rows: RawRow[] = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const r: RawRow = {};
      let any = false;
      headers.forEach((h, i) => {
        const cell = row.getCell(i + 1);
        let v = cell.text?.trim() ?? "";
        if (cell.value instanceof Date) v = cell.value.toISOString().slice(0, 10);
        if (v) any = true;
        r[h] = v;
      });
      if (any) rows.push(r);
    });
    return { headers, rows };
  }
  const text = buffer.toString("utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  return { headers: (parsed.meta.fields ?? []).filter(Boolean), rows: parsed.data };
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function guessMapping(headers: string[]): Record<ImportField, string | null> {
  const rules: Record<ImportField, RegExp> = {
    person: /(personne|collaborat|salarie|email|nom|intervenant)/,
    project: /(projet|code)/,
    date: /(date|jour|mois|periode)/,
    hours: /(heure|temps|duree|^h$|quantite)/,
    note: /(fiche|ref)/,
  };
  const used = new Set<string>();
  const out = {} as Record<ImportField, string | null>;
  for (const field of IMPORT_FIELDS) {
    const h = headers.find((x) => !used.has(x) && rules[field].test(normalize(x)));
    out[field] = h ?? null;
    if (h) used.add(h);
  }
  return out;
}

/* ------------------------------- Validation ------------------------------- */

export interface ValidRow {
  row: number;
  personId: string;
  projectId: string;
  date: string;
  granularity: TimeGranularity;
  hours: number;
  noteId: string | null;
  duplicateOf: string | null;
}

export async function validateRows(
  tx: Tx,
  fy: FiscalYearRow,
  rows: RawRow[],
  mapping: Record<string, string | null>,
  unit: "hours" | "days",
  duplicates: "replace" | "skip" | null,
) {
  const company = await getCompany(tx, fy.companyId);
  const people = await tx.select().from(schema.people).where(isNull(schema.people.deletedAt));
  const byKey = new Map<string, (typeof people)[number]>();
  for (const p of people) {
    if (p.email) byKey.set(normalize(p.email), p);
    byKey.set(normalize(`${p.firstName} ${p.lastName}`), p);
    byKey.set(normalize(`${p.lastName} ${p.firstName}`), p);
  }
  const projects = await tx
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.fiscalYearId, fy.id), isNull(schema.projects.deletedAt)));
  const projByCode = new Map(projects.map((p) => [normalize(p.code), p]));
  const projectIds = projects.map((p) => p.id);
  const assigned = new Set(
    projectIds.length
      ? (await tx.select().from(schema.assignments).where(inArray(schema.assignments.projectId, projectIds))).map((a) => `${a.projectId}:${a.personId}`)
      : [],
  );
  const notes = projectIds.length
    ? await tx
        .select({ id: schema.notes.id, refNo: schema.notes.refNo, noteDate: schema.notes.noteDate, projectId: schema.locks.projectId })
        .from(schema.notes)
        .innerJoin(schema.topics, eq(schema.topics.id, schema.notes.topicId))
        .innerJoin(schema.locks, eq(schema.locks.id, schema.topics.lockId))
        .where(and(inArray(schema.locks.projectId, projectIds), isNull(schema.notes.deletedAt)))
    : [];
  const noteByRef = new Map(notes.map((n) => [n.refNo, n]));
  const existing = await tx.select().from(schema.timeEntries).where(eq(schema.timeEntries.fiscalYearId, fy.id));
  const existingKey = new Map(existing.map((e) => [`${e.personId}:${e.projectId}:${e.entryDate}:${e.granularity}`, e.id]));

  const col = (f: ImportField) => mapping[f] ?? null;
  for (const f of ["person", "project", "date", "hours"] as const) if (!col(f)) throw unprocessable(`Colonne « ${f} » non associée`);

  const errors: { row: number; message: string }[] = [];
  const valid: ValidRow[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, i) => {
    const rowNo = i + 2; // ligne 1 = en-têtes
    const err = (message: string) => errors.push({ row: rowNo, message });
    const personRaw = raw[col("person")!] ?? "";
    const person = byKey.get(normalize(personRaw));
    if (!person) return err(`Personne inconnue : « ${personRaw} »`);
    const projectRaw = raw[col("project")!] ?? "";
    const project = projByCode.get(normalize(projectRaw));
    if (!project) return err(`Code projet inconnu sur cet exercice : « ${projectRaw} »`);
    const d = parseFrenchDate(raw[col("date")!] ?? "");
    if (!d) return err(`Date invalide : « ${raw[col("date")!] ?? ""} » (JJ/MM/AAAA ou MM/AAAA)`);
    const qty = parseFrenchNumber(raw[col("hours")!] ?? "");
    if (qty === null || qty <= 0) return err(`Quantité invalide : « ${raw[col("hours")!] ?? ""} »`);
    const hours = roundQuarter(unit === "days" ? qty * company.hoursPerDay : qty);
    const date = d.granularity === "month" ? firstDayOfMonth(d.iso) : d.iso;
    if (!inPeriod(date, d.granularity, fy.startDate, fy.endDate)) return err("Date hors de l'exercice");
    if (!employmentOk(person, date, d.granularity)) return err(`${personName(person)} n'est pas en poste à cette date`);
    if (!assigned.has(`${project.id}:${person.id}`)) return err(`${personName(person)} n'est pas affecté(e) au projet ${project.code}`);
    let noteId: string | null = null;
    const noteRaw = col("note") ? (raw[col("note")!] ?? "").trim() : "";
    if (noteRaw) {
      const refNo = parseNoteRef(noteRaw);
      const note = refNo !== null ? noteByRef.get(refNo) : undefined;
      if (!note) return err(`Fiche inconnue : « ${noteRaw} »`);
      if (note.projectId !== project.id) return err(`La fiche ${formatNoteRef(note.refNo)} ne relève pas du projet ${project.code}`);
      const sameDate = d.granularity === "day" ? note.noteDate === date : note.noteDate.slice(0, 7) === date.slice(0, 7);
      if (!sameDate) return err(`La date ne correspond pas à la fiche ${formatNoteRef(note.refNo)}`);
      noteId = note.id;
    }
    const key = `${person.id}:${project.id}:${date}:${d.granularity}`;
    if (seen.has(key)) return err("Doublon dans le fichier (même personne, projet et date)");
    seen.add(key);
    valid.push({ row: rowNo, personId: person.id, projectId: project.id, date, granularity: d.granularity, hours, noteId, duplicateOf: existingKey.get(key) ?? null });
  });

  // Capacité : on simule l'état final (doublons remplacés ou ignorés).
  const policy = duplicates ?? "replace";
  const kept = valid.filter((v) => !(v.duplicateOf && policy === "skip"));
  const replaced = new Set(kept.filter((v) => v.duplicateOf).map((v) => v.duplicateOf!));
  const finalEntries: (CapEntry & { row?: number })[] = [
    ...existing.filter((e) => !replaced.has(e.id)).map((e) => ({ personId: e.personId, date: e.entryDate, granularity: e.granularity as TimeGranularity, hours: e.hours })),
    ...kept.map((v) => ({ personId: v.personId, date: v.date, granularity: v.granularity, hours: v.hours, row: v.row })),
  ];
  const violations = capacityViolations(finalEntries, { hoursPerDay: company.hoursPerDay, annualHoursCap: company.annualHoursCap });
  for (const v of violations) {
    const rowsHit = kept.filter(
      (k) =>
        k.personId === v.personId &&
        ((v.kind === "capacity_day" && k.granularity === "day" && k.date === v.period) || (v.kind === "capacity_month" && k.date.slice(0, 7) === v.period) || v.kind === "capacity_year"),
    );
    const p = people.find((x) => x.id === v.personId);
    const target = rowsHit[rowsHit.length - 1];
    if (target) errors.push({ row: target.row, message: `Capacité dépassée pour ${p ? personName(p) : "?"} : ${v.message}` });
  }
  errors.sort((a, b) => a.row - b.row);
  return { valid: errors.length ? valid.filter((v) => !errors.some((e) => e.row === v.row)) : valid, errors, kept };
}

/* --------------------------------- Routes --------------------------------- */

type ImportRow = typeof schema.imports.$inferSelect;

function previewDto(imp: ImportRow, extra?: { validRows: number; duplicateRows: number }): ImportPreviewDto {
  const rows = (imp.rows as RawRow[] | null) ?? [];
  return {
    id: imp.id,
    status: imp.status as ImportPreviewDto["status"],
    filename: imp.filename,
    headers: imp.headers,
    sample: rows.slice(0, 8),
    mapping: (imp.mapping as Record<string, string | null>) ?? {},
    unit: imp.unit as "hours" | "days",
    totalRows: imp.totalRows,
    validRows: extra?.validRows ?? 0,
    duplicateRows: extra?.duplicateRows ?? 0,
    errors: ((imp.errors as { row: number; message: string }[] | null) ?? []).slice(0, 500),
    committedRows: imp.committedRows,
  };
}

async function getImport(tx: Tx, id: string) {
  const [imp] = await tx.select().from(schema.imports).where(eq(schema.imports.id, id));
  if (!imp) throw notFound("Import introuvable");
  return imp;
}

importsRouter.get("/imports/template", async (req, res) => {
  const format = req.query.format === "xlsx" ? "xlsx" : "csv";
  const header = ["Personne", "Code projet", "Date", "Heures", "Fiche"];
  const example = [
    ["marie.dupont@exemple.fr", "RAPPRO", "14/03/2026", "6", "F-0001"],
    ["Karim Benali", "RAPPRO", "14/03/2026", "1,5", "F-0001"],
    ["Karim Benali", "RAPPRO", "04/2026", "70", ""],
  ];
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="modele-temps.csv"');
    return res.send("﻿" + [header, ...example].map((r) => r.join(";")).join("\r\n"));
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Temps");
  ws.addRow(header);
  example.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => (c.width = 24));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="modele-temps.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

importsRouter.post("/imports", upload.single("file"), async (req, res) => {
  const { fiscalYearId } = parse(z.object({ fiscalYearId: z.uuid() }), req.body);
  const file = await inspectUpload(req.file, ALLOWED.table, MAX_IMPORT_BYTES);
  const { headers, rows } = await readTable(file.buffer, file.mime);
  if (!rows.length) throw unprocessable("Aucune ligne de données");
  if (rows.length > MAX_IMPORT_ROWS) throw unprocessable(`${rows.length} lignes : le maximum est ${MAX_IMPORT_ROWS}`);
  const out = await run(req, async (tx) => {
    const fy = await editableFiscalYear(tx, fiscalYearId);
    const company = await getCompany(tx, fy.companyId);
    const saved = (company.importMapping as Record<string, string | null> | null) ?? null;
    const mapping = saved && Object.values(saved).every((h) => !h || headers.includes(h)) ? saved : guessMapping(headers);
    const [imp] = await tx
      .insert(schema.imports)
      .values({ companyId: fy.companyId, createdBy: req.auth!.userId, fiscalYearId: fy.id, filename: file.filename, headers, rows, mapping, totalRows: rows.length, sourceSha256: file.sha256 })
      .returning();
    return previewDto(imp!);
  });
  res.status(201).json(out);
});

importsRouter.get("/imports/:id", async (req, res) => {
  res.json(await run(req, async (tx) => previewDto(await getImport(tx, param(req)))));
});

importsRouter.post("/imports/:id/mapping", async (req, res) => {
  const { mapping, unit } = parse(importMappingSchema, req.body);
  const out = await run(req, async (tx) => {
    const imp = await getImport(tx, param(req));
    if (imp.status === "committed") throw conflict("Import déjà validé");
    const fy = await editableFiscalYear(tx, imp.fiscalYearId);
    for (const h of Object.values(mapping)) if (h && !imp.headers.includes(h)) throw unprocessable(`Colonne inconnue : ${h}`);
    const { valid, errors } = await validateRows(tx, fy, (imp.rows as RawRow[]) ?? [], mapping, unit, null);
    const [row] = await tx.update(schema.imports).set({ mapping, unit, status: "mapped", errors }).where(eq(schema.imports.id, imp.id)).returning();
    await tx.update(schema.companies).set({ importMapping: mapping }).where(eq(schema.companies.id, fy.companyId));
    return previewDto(row!, { validRows: valid.length, duplicateRows: valid.filter((v) => v.duplicateOf).length });
  });
  res.json(out);
});

/** Import tout ou rien, dans une seule transaction. */
importsRouter.post("/imports/:id/commit", async (req, res) => {
  const { duplicates } = parse(importCommitSchema, req.body);
  const out = await run(req, async (tx) => {
    const imp = await getImport(tx, param(req));
    if (imp.status !== "mapped") throw conflict("Associez d'abord les colonnes");
    const fy = await editableFiscalYear(tx, imp.fiscalYearId);
    const { kept, errors } = await validateRows(tx, fy, (imp.rows as RawRow[]) ?? [], imp.mapping as Record<string, string | null>, imp.unit as "hours" | "days", duplicates);
    if (errors.length) {
      await tx.update(schema.imports).set({ errors }).where(eq(schema.imports.id, imp.id));
      throw new HttpError(422, "import_errors", `${errors.length} ligne(s) en erreur : corrigez le fichier, rien n'a été importé`, { errors: errors.slice(0, 200) });
    }
    const toReplace = kept.filter((k) => k.duplicateOf).map((k) => k.duplicateOf!);
    if (toReplace.length) await tx.delete(schema.timeEntries).where(inArray(schema.timeEntries.id, toReplace));
    for (let i = 0; i < kept.length; i += 1000) {
      await tx.insert(schema.timeEntries).values(
        kept.slice(i, i + 1000).map((k) => ({
          companyId: fy.companyId,
          createdBy: req.auth!.userId,
          fiscalYearId: fy.id,
          personId: k.personId,
          projectId: k.projectId,
          entryDate: k.date,
          granularity: k.granularity,
          hours: k.hours,
          noteId: k.noteId,
          source: "import",
          importId: imp.id,
        })),
      );
    }
    const [row] = await tx
      .update(schema.imports)
      .set({ status: "committed", committedRows: kept.length, committedAt: new Date(), errors: [], rows: null })
      .where(eq(schema.imports.id, imp.id))
      .returning();
    return { ...previewDto(row!), validRows: kept.length, duplicateRows: toReplace.length };
  });
  res.json(out);
});

importsRouter.get("/imports/:id/report", async (req, res) => {
  const imp = await run(req, (tx) => getImport(tx, param(req)));
  const errors = (imp.errors as { row: number; message: string }[] | null) ?? [];
  const lines = [
    "Rapport d'import",
    `Fichier;${imp.filename}`,
    `Statut;${imp.status}`,
    `Lignes;${imp.totalRows}`,
    `Importées;${imp.committedRows ?? 0}`,
    "",
    "Ligne;Erreur",
    ...errors.map((e) => `${e.row};"${e.message.replace(/"/g, '""')}"`),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="rapport-import-${imp.id.slice(0, 8)}.csv"`);
  res.send("﻿" + lines.join("\r\n"));
});
