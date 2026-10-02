import { addDays, todayParis } from "@cir/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { schema } from "../../db/client";
import { parse } from "../../lib/errors";
import { run } from "../../middlewares/auth";
import { contributorScope, getFiscalYear, personOfUser } from "../common";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard", async (req, res) => {
  const { fiscalYearId } = parse(z.object({ fiscalYearId: z.uuid() }), req.query);
  const out = await run(req, async (tx) => {
    const fy = await getFiscalYear(tx, fiscalYearId);
    const scope = await contributorScope(req, tx);
    let projects = await tx
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.fiscalYearId, fy.id), isNull(schema.projects.deletedAt)));
    if (scope) projects = projects.filter((p) => scope.projectIds.includes(p.id));
    const ids = projects.map((p) => p.id);
    const weekAgo = addDays(todayParis(), -7);
    const locks = ids.length ? await tx.select({ id: schema.locks.id, outcome: schema.locks.outcome }).from(schema.locks).where(and(inArray(schema.locks.projectId, ids), isNull(schema.locks.deletedAt))) : [];
    const notes = ids.length
      ? await tx
          .select({ id: schema.notes.id, date: schema.notes.noteDate, author: schema.notes.authorPersonId })
          .from(schema.notes)
          .innerJoin(schema.topics, eq(schema.topics.id, schema.notes.topicId))
          .innerJoin(schema.locks, eq(schema.locks.id, schema.topics.lockId))
          .where(and(inArray(schema.locks.projectId, ids), isNull(schema.notes.deletedAt)))
      : [];
    const entries = ids.length
      ? await tx
          .select({ hours: schema.timeEntries.hours, noteId: schema.timeEntries.noteId, personId: schema.timeEntries.personId, date: schema.timeEntries.entryDate })
          .from(schema.timeEntries)
          .where(and(eq(schema.timeEntries.fiscalYearId, fy.id), inArray(schema.timeEntries.projectId, ids)))
      : [];
    const me = await personOfUser(tx, req.auth!.userId);
    const totalHours = entries.reduce((s, e) => s + e.hours, 0);
    const unlinked = entries.filter((e) => !e.noteId).reduce((s, e) => s + e.hours, 0);
    const [{ people }] = (await tx.select({ people: sql<number>`count(*)::int` }).from(schema.people).where(isNull(schema.people.deletedAt))) as [{ people: number }];
    return {
      fiscalYear: { id: fy.id, label: fy.label, status: fy.status, progress: fy.progress },
      projects: {
        total: projects.length,
        eligible: projects.filter((p) => p.verdict === "eligible_cir").length,
        pending: projects.filter((p) => !p.verdict).length,
        cii: projects.filter((p) => p.verdict === "piste_cii").length,
        nonEligible: projects.filter((p) => p.verdict === "non_eligible").length,
      },
      locks: { total: locks.length, lifted: locks.filter((l) => l.outcome === "leve").length },
      notes: { total: notes.length, lastWeek: notes.filter((n) => n.date >= weekAgo).length },
      hours: { total: totalHours, unlinkedRatio: totalHours ? unlinked / totalHours : 0 },
      people,
      me: me
        ? {
            personId: me.id,
            notesLastWeek: notes.filter((n) => n.author === me.id && n.date >= weekAgo).length,
            hoursLastWeek: entries.filter((e) => e.personId === me.id && e.date >= weekAgo).reduce((s, e) => s + e.hours, 0),
            lastNoteDate: notes.filter((n) => n.author === me.id).map((n) => n.date).sort().at(-1) ?? null,
          }
        : null,
    };
  });
  res.json(out);
});

