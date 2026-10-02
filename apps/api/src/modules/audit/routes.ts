import type { AuditEntryDto } from "@cir/shared";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { schema } from "../../db/client";
import { parse } from "../../lib/errors";
import { requireRole, run } from "../../middlewares/auth";
import { iso, namesOfUsers } from "../common";

export const auditRouter = Router();
auditRouter.use("/audit", requireRole("admin", "expert"));

const ENTITY_LABELS: Record<string, string> = {
  companies: "société",
  memberships: "membre",
  invitations: "invitation",
  rescrits: "rescrit",
  fiscal_years: "exercice",
  people: "personne",
  files: "fichier",
  projects: "projet",
  assignments: "affectation",
  frascati_answers: "réponse Frascati",
  operations: "opération",
  locks: "verrou",
  topics: "sujet",
  notes: "fiche de recherche",
  note_links: "lien de fiche",
  time_entries: "temps",
  imports: "import",
  sections: "section",
  biblio_refs: "référence",
  comments: "commentaire",
  archives: "archive",
  subscriptions: "abonnement",
};
const ACTION_LABELS: Record<string, string> = { insert: "Création", update: "Modification", delete: "Suppression" };

function summarize(entity: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const v = after ?? before ?? {};
  const pick = ["code", "title", "label", "name", "statement", "rubrique", "filename", "email", "status", "verdict"].find((k) => typeof v[k] === "string" && v[k]);
  let detail = pick ? String(v[pick]).slice(0, 80) : "";
  if (before && after) {
    const changed = Object.keys(after).filter((k) => !["version", "updated_at", "last_seen_at"].includes(k) && JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    if (changed.length) detail += `${detail ? " — " : ""}champs : ${changed.slice(0, 6).join(", ")}`;
  }
  return detail;
}

auditRouter.get("/audit", async (req, res) => {
  const q = parse(z.object({ before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), entity: z.string().optional() }), req.query);
  const out = await run(req, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.auditLog)
      .where(and(q.before ? lt(schema.auditLog.id, q.before) : undefined, q.entity ? eq(schema.auditLog.entity, q.entity) : undefined))
      .orderBy(desc(schema.auditLog.id))
      .limit(q.limit);
    const names = await namesOfUsers(tx, rows.map((r) => r.actorUserId));
    return rows.map(
      (r): AuditEntryDto => ({
        id: r.id,
        createdAt: iso(r.createdAt)!,
        actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : "Système",
        action: ACTION_LABELS[r.action] ?? r.action,
        entity: ENTITY_LABELS[r.entity] ?? r.entity,
        entityId: r.entityId,
        summary: summarize(r.entity, r.before as Record<string, unknown> | null, r.after as Record<string, unknown> | null),
        hash: r.hash,
      }),
    );
  });
  res.json(out);
});

/** Vérifie le chaînage SHA-256 de tout le journal de la société (détecte toute altération). */
auditRouter.get("/audit/verify", async (req, res) => {
  const out = await run(req, async (tx) => {
    const r = await tx.execute<{ total: number; broken: number; first_broken: number | null }>(sql`
      with chain as (
        select id, hash, prev_hash,
               lag(hash) over (order by id) as expected_prev,
               encode(sha256(convert_to(coalesce(prev_hash,'') || '|' || entity || '|' || action || '|' || coalesce(entity_id,'') || '|' ||
                     coalesce(before::text,'') || '|' || coalesce(after::text,'') || '|' || created_at::text, 'UTF8')), 'hex') as recomputed
          from audit_log where company_id = app_company_id()
      )
      select count(*)::int as total,
             count(*) filter (where recomputed <> hash or prev_hash is distinct from expected_prev)::int as broken,
             min(id) filter (where recomputed <> hash or prev_hash is distinct from expected_prev) as first_broken
        from chain`);
    return r.rows[0]!;
  });
  res.json({ total: out.total, broken: out.broken, firstBrokenId: out.first_broken, ok: out.broken === 0 });
});
