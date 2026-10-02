import {
  diffDays,
  formatNoteRef,
  LATE_ENTRY_DAYS,
  lockCode,
  lockSchema,
  noteSchema,
  todayParis,
  topicCode,
  topicSchema,
  type LockDto,
  type LockOutcome,
  type LockVersionDto,
  type NoteDto,
  type NoteResultKind,
  type TimelineDto,
  type TopicDto,
  type TopicStatus,
} from "@cir/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import { schema, type Tx } from "../../db/client";
import { conflict, forbidden, HttpError, notFound, parse, unprocessable } from "../../lib/errors";
import { hasRole, requireRole, run } from "../../middlewares/auth";
import {
  advisoryLock,
  assertProjectReadable,
  contributorScope,
  editableFiscalYear,
  editableProject,
  getFiscalYear,
  getProject,
  isAssigned,
  iso,
  namesOfUsers,
  personName,
  personOfUser,
} from "../common";
import { filesDto, listFiles } from "../files/service";
import { validateEntry } from "../time/service";
import { param } from "../../lib/http";

export const researchRouter = Router();

type LockRow = typeof schema.locks.$inferSelect;
type TopicRow = typeof schema.topics.$inferSelect;
type NoteRow = typeof schema.notes.$inferSelect;

/* --------------------------------- Verrous --------------------------------- */

async function lockDtos(tx: Tx, rows: LockRow[]): Promise<LockDto[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const topics = await tx
    .select({ lockId: schema.topics.lockId, n: sql<number>`count(*)::int` })
    .from(schema.topics)
    .where(and(inArray(schema.topics.lockId, ids), isNull(schema.topics.deletedAt)))
    .groupBy(schema.topics.lockId);
  const notes = await tx
    .select({ lockId: schema.topics.lockId, n: sql<number>`count(distinct ${schema.notes.id})::int`, h: sql<number>`coalesce(sum(${schema.timeEntries.hours}),0)::float` })
    .from(schema.notes)
    .innerJoin(schema.topics, eq(schema.topics.id, schema.notes.topicId))
    .leftJoin(schema.timeEntries, eq(schema.timeEntries.noteId, schema.notes.id))
    .where(and(inArray(schema.topics.lockId, ids), isNull(schema.notes.deletedAt)))
    .groupBy(schema.topics.lockId);
  return rows.map((l) => ({
    id: l.id,
    projectId: l.projectId,
    number: l.number,
    code: lockCode(l.number),
    statement: l.statement,
    sotaGap: l.sotaGap,
    identifiedOn: l.identifiedOn,
    outcome: l.outcome as LockOutcome,
    toUpdate: l.toUpdate,
    version: l.version,
    topicCount: topics.find((t) => t.lockId === l.id)?.n ?? 0,
    noteCount: notes.find((t) => t.lockId === l.id)?.n ?? 0,
    hours: notes.find((t) => t.lockId === l.id)?.h ?? 0,
  }));
}

async function getLock(tx: Tx, id: string) {
  const [l] = await tx
    .select()
    .from(schema.locks)
    .where(and(eq(schema.locks.id, id), isNull(schema.locks.deletedAt)));
  if (!l) throw notFound("Verrou introuvable");
  return l;
}

researchRouter.get("/projects/:id/locks", async (req, res) => {
  const out = await run(req, async (tx) => {
    await assertProjectReadable(req, tx, param(req));
    const rows = await tx
      .select()
      .from(schema.locks)
      .where(and(eq(schema.locks.projectId, param(req)), isNull(schema.locks.deletedAt)))
      .orderBy(asc(schema.locks.number));
    return lockDtos(tx, rows);
  });
  res.json(out);
});

researchRouter.post("/projects/:id/locks", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(lockSchema, req.body);
  const out = await run(req, async (tx) => {
    const { project } = await editableProject(tx, param(req));
    await advisoryLock(tx, `locks:${project.id}`);
    const [{ n }] = (await tx
      .select({ n: sql<number>`coalesce(max(${schema.locks.number}),0)::int` })
      .from(schema.locks)
      .where(eq(schema.locks.projectId, project.id))) as [{ n: number }];
    const [row] = await tx
      .insert(schema.locks)
      .values({ ...input, projectId: project.id, number: n + 1, companyId: project.companyId, createdBy: req.auth!.userId })
      .returning();
    await tx.insert(schema.lockVersions).values({ companyId: project.companyId, lockId: row!.id, version: 1, data: input, authorId: req.auth!.userId });
    return (await lockDtos(tx, [row!]))[0];
  });
  res.status(201).json(out);
});

researchRouter.get("/locks/:id", async (req, res) => {
  const out = await run(req, async (tx) => {
    const l = await getLock(tx, param(req));
    await assertProjectReadable(req, tx, l.projectId);
    return (await lockDtos(tx, [l]))[0];
  });
  res.json(out);
});

/** Toute modification crée une nouvelle version (historique complet, pas d'écrasement). */
researchRouter.put("/locks/:id", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(lockSchema, req.body);
  const out = await run(req, async (tx) => {
    const l = await getLock(tx, param(req));
    await editableProject(tx, l.projectId);
    const version = l.version + 1;
    const [row] = await tx
      .update(schema.locks)
      .set({ ...input, version, toUpdate: false })
      .where(eq(schema.locks.id, l.id))
      .returning();
    await tx.insert(schema.lockVersions).values({ companyId: l.companyId, lockId: l.id, version, data: input, authorId: req.auth!.userId });
    return (await lockDtos(tx, [row!]))[0];
  });
  res.json(out);
});

researchRouter.post("/locks/:id/confirm", requireRole("admin", "redacteur"), async (req, res) => {
  const out = await run(req, async (tx) => {
    const l = await getLock(tx, param(req));
    await editableProject(tx, l.projectId);
    const [row] = await tx.update(schema.locks).set({ toUpdate: false }).where(eq(schema.locks.id, l.id)).returning();
    return (await lockDtos(tx, [row!]))[0];
  });
  res.json(out);
});

researchRouter.delete("/locks/:id", requireRole("admin", "redacteur"), async (req, res) => {
  await run(req, async (tx) => {
    const l = await getLock(tx, param(req));
    await editableProject(tx, l.projectId);
    const [{ n }] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.topics)
      .where(and(eq(schema.topics.lockId, l.id), isNull(schema.topics.deletedAt)))) as [{ n: number }];
    if (n) throw conflict("Supprimez d'abord les sujets de recherche de ce verrou");
    await tx.update(schema.locks).set({ deletedAt: new Date() }).where(eq(schema.locks.id, l.id));
  });
  res.status(204).end();
});

researchRouter.get("/locks/:id/versions", async (req, res) => {
  const out = await run(req, async (tx) => {
    const l = await getLock(tx, param(req));
    await assertProjectReadable(req, tx, l.projectId);
    const rows = await tx.select().from(schema.lockVersions).where(eq(schema.lockVersions.lockId, l.id)).orderBy(desc(schema.lockVersions.version));
    const names = await namesOfUsers(tx, rows.map((r) => r.authorId));
    return rows.map(
      (r): LockVersionDto => ({
        version: r.version,
        data: r.data as LockVersionDto["data"],
        authorName: r.authorId ? (names.get(r.authorId) ?? null) : null,
        createdAt: iso(r.createdAt)!,
      }),
    );
  });
  res.json(out);
});

/** Frise F5.6 : fiches, heures par semaine, changements d'issue du verrou. */
researchRouter.get("/locks/:id/timeline", async (req, res) => {
  const out = await run(req, async (tx): Promise<TimelineDto> => {
    const l = await getLock(tx, param(req));
    await assertProjectReadable(req, tx, l.projectId);
    const project = await getProject(tx, l.projectId);
    const fy = await getFiscalYear(tx, project.fiscalYearId);
    const topics = await tx
      .select()
      .from(schema.topics)
      .where(and(eq(schema.topics.lockId, l.id), isNull(schema.topics.deletedAt)))
      .orderBy(asc(schema.topics.number));
    const topicIds = topics.map((t) => t.id);
    const notes = topicIds.length
      ? await tx
          .select({ n: schema.notes, p: schema.people })
          .from(schema.notes)
          .innerJoin(schema.people, eq(schema.people.id, schema.notes.authorPersonId))
          .where(and(inArray(schema.notes.topicId, topicIds), isNull(schema.notes.deletedAt)))
          .orderBy(asc(schema.notes.noteDate))
      : [];
    const noteIds = notes.map((x) => x.n.id);
    const times = noteIds.length ? await tx.select().from(schema.timeEntries).where(inArray(schema.timeEntries.noteId, noteIds)) : [];
    const weekly = new Map<string, number>();
    for (const t of times) {
      const d = new Date(`${t.entryDate}T00:00:00Z`);
      const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
      weekly.set(monday, (weekly.get(monday) ?? 0) + t.hours);
    }
    const versions = await tx.select().from(schema.lockVersions).where(eq(schema.lockVersions.lockId, l.id)).orderBy(asc(schema.lockVersions.version));
    // La version initiale est datée de l'identification du verrou ; seuls les changements d'issue sont marqués.
    const outcomeChanges: TimelineDto["outcomeChanges"] = [];
    let last: string = "en_cours";
    versions.forEach((v, i) => {
      const outcome = (v.data as { outcome?: LockOutcome }).outcome ?? "en_cours";
      if (outcome !== last) outcomeChanges.push({ date: i === 0 ? l.identifiedOn : v.createdAt.toISOString().slice(0, 10), outcome });
      last = outcome;
    });
    return {
      lock: (await lockDtos(tx, [l]))[0]!,
      start: fy.startDate,
      end: fy.endDate,
      topics: topics.map((t) => ({ id: t.id, code: topicCode(l.number, t.number), title: t.title })),
      notes: notes.map(({ n, p }) => ({
        id: n.id,
        ref: formatNoteRef(n.refNo),
        date: n.noteDate,
        topicId: n.topicId,
        resultKind: n.resultKind as NoteResultKind,
        authorName: personName(p),
        hours: times.filter((t) => t.noteId === n.id).reduce((s, t) => s + t.hours, 0),
      })),
      weeklyHours: [...weekly.entries()].sort().map(([week, hours]) => ({ week, hours })),
      outcomeChanges,
    };
  });
  res.json(out);
});

/* --------------------------------- Sujets --------------------------------- */

async function topicDtos(tx: Tx, rows: TopicRow[], lockNumbers: Map<string, number>): Promise<TopicDto[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const stats = await tx
    .select({ topicId: schema.notes.topicId, n: sql<number>`count(*)::int`, last: sql<string>`max(${schema.notes.noteDate})::text` })
    .from(schema.notes)
    .where(and(inArray(schema.notes.topicId, ids), isNull(schema.notes.deletedAt)))
    .groupBy(schema.notes.topicId);
  const ownerIds = rows.map((r) => r.ownerPersonId).filter((x): x is string => !!x);
  const owners = ownerIds.length ? await tx.select().from(schema.people).where(inArray(schema.people.id, ownerIds)) : [];
  return rows.map((t) => {
    const owner = owners.find((o) => o.id === t.ownerPersonId);
    const s = stats.find((x) => x.topicId === t.id);
    return {
      id: t.id,
      lockId: t.lockId,
      number: t.number,
      code: topicCode(lockNumbers.get(t.lockId) ?? 0, t.number),
      title: t.title,
      hypothesis: t.hypothesis,
      approach: t.approach,
      ownerPersonId: t.ownerPersonId,
      ownerName: owner ? personName(owner) : null,
      status: t.status as TopicStatus,
      noteCount: s?.n ?? 0,
      lastNoteDate: s?.last ?? null,
    };
  });
}

researchRouter.get("/locks/:id/topics", async (req, res) => {
  const out = await run(req, async (tx) => {
    const l = await getLock(tx, param(req));
    await assertProjectReadable(req, tx, l.projectId);
    const rows = await tx
      .select()
      .from(schema.topics)
      .where(and(eq(schema.topics.lockId, l.id), isNull(schema.topics.deletedAt)))
      .orderBy(asc(schema.topics.number));
    return topicDtos(tx, rows, new Map([[l.id, l.number]]));
  });
  res.json(out);
});

async function checkOwner(tx: Tx, projectId: string, ownerPersonId: string | null | undefined) {
  if (ownerPersonId && !(await isAssigned(tx, projectId, ownerPersonId))) throw unprocessable("Le responsable doit être affecté au projet");
}

researchRouter.post("/locks/:id/topics", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(topicSchema, req.body);
  const out = await run(req, async (tx) => {
    const l = await getLock(tx, param(req));
    await editableProject(tx, l.projectId);
    await checkOwner(tx, l.projectId, input.ownerPersonId);
    await advisoryLock(tx, `topics:${l.id}`);
    const [{ n }] = (await tx
      .select({ n: sql<number>`coalesce(max(${schema.topics.number}),0)::int` })
      .from(schema.topics)
      .where(eq(schema.topics.lockId, l.id))) as [{ n: number }];
    const [row] = await tx
      .insert(schema.topics)
      .values({ ...input, ownerPersonId: input.ownerPersonId ?? null, lockId: l.id, number: n + 1, companyId: l.companyId, createdBy: req.auth!.userId })
      .returning();
    return (await topicDtos(tx, [row!], new Map([[l.id, l.number]])))[0];
  });
  res.status(201).json(out);
});

researchRouter.put("/topics/:id", requireRole("admin", "redacteur"), async (req, res) => {
  const input = parse(topicSchema, req.body);
  const out = await run(req, async (tx) => {
    const [t] = await tx.select().from(schema.topics).where(and(eq(schema.topics.id, param(req)), isNull(schema.topics.deletedAt)));
    if (!t) throw notFound();
    const l = await getLock(tx, t.lockId);
    await editableProject(tx, l.projectId);
    await checkOwner(tx, l.projectId, input.ownerPersonId);
    const [row] = await tx
      .update(schema.topics)
      .set({ ...input, ownerPersonId: input.ownerPersonId ?? null })
      .where(eq(schema.topics.id, t.id))
      .returning();
    return (await topicDtos(tx, [row!], new Map([[l.id, l.number]])))[0];
  });
  res.json(out);
});

researchRouter.delete("/topics/:id", requireRole("admin", "redacteur"), async (req, res) => {
  await run(req, async (tx) => {
    const [t] = await tx.select().from(schema.topics).where(eq(schema.topics.id, param(req)));
    if (!t) throw notFound();
    const l = await getLock(tx, t.lockId);
    await editableProject(tx, l.projectId);
    const [{ n }] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.notes)
      .where(and(eq(schema.notes.topicId, t.id), isNull(schema.notes.deletedAt)))) as [{ n: number }];
    if (n) throw conflict("Ce sujet porte des fiches de recherche : clôturez-le plutôt que de le supprimer");
    await tx.update(schema.topics).set({ deletedAt: new Date() }).where(eq(schema.topics.id, t.id));
  });
  res.status(204).end();
});

/* ------------------------------ Fiches de recherche ------------------------------ */

async function topicContext(tx: Tx, topicId: string) {
  const [row] = await tx
    .select({ topic: schema.topics, lock: schema.locks, project: schema.projects })
    .from(schema.topics)
    .innerJoin(schema.locks, eq(schema.locks.id, schema.topics.lockId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.locks.projectId))
    .where(and(eq(schema.topics.id, topicId), isNull(schema.topics.deletedAt), isNull(schema.locks.deletedAt), isNull(schema.projects.deletedAt)));
  if (!row) throw notFound("Sujet de recherche introuvable");
  return row;
}

export async function noteDtos(tx: Tx, rows: NoteRow[]): Promise<NoteDto[]> {
  if (!rows.length) return [];
  const topicIds = [...new Set(rows.map((r) => r.topicId))];
  const ctx = await tx
    .select({ topic: schema.topics, lock: schema.locks, project: schema.projects })
    .from(schema.topics)
    .innerJoin(schema.locks, eq(schema.locks.id, schema.topics.lockId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.locks.projectId))
    .where(inArray(schema.topics.id, topicIds));
  const ids = rows.map((r) => r.id);
  const links = await tx.select().from(schema.noteLinks).where(inArray(schema.noteLinks.noteId, ids));
  const times = await tx
    .select({ t: schema.timeEntries, p: schema.people })
    .from(schema.timeEntries)
    .innerJoin(schema.people, eq(schema.people.id, schema.timeEntries.personId))
    .where(inArray(schema.timeEntries.noteId, ids));
  const authors = await tx.select().from(schema.people).where(inArray(schema.people.id, [...new Set(rows.map((r) => r.authorPersonId))]));
  const fileRows = await listFiles(tx, ids, ["note_attachment"]);
  const files = await filesDto(tx, fileRows);
  return rows.map((n) => {
    const c = ctx.find((x) => x.topic.id === n.topicId)!;
    const author = authors.find((a) => a.id === n.authorPersonId);
    const t = times.filter((x) => x.t.noteId === n.id);
    const enteredDay = n.createdAt.toISOString().slice(0, 10);
    return {
      id: n.id,
      ref: formatNoteRef(n.refNo),
      topicId: n.topicId,
      topicCode: topicCode(c.lock.number, c.topic.number),
      topicTitle: c.topic.title,
      lockId: c.lock.id,
      lockCode: lockCode(c.lock.number),
      projectId: c.project.id,
      projectCode: c.project.code,
      noteDate: n.noteDate,
      authorPersonId: n.authorPersonId,
      authorName: author ? personName(author) : "?",
      hypothesis: n.hypothesis,
      workDone: n.workDone,
      result: n.result,
      resultKind: n.resultKind as NoteResultKind,
      conclusion: n.conclusion,
      nextStep: n.nextStep,
      links: links.filter((l) => l.noteId === n.id).map((l) => ({ id: l.id, url: l.url, label: l.label })),
      files: files.filter((_f, i) => fileRows[i]!.ownerId === n.id),
      times: t.map((x) => ({ id: x.t.id, personId: x.p.id, personName: personName(x.p), hours: x.t.hours })),
      totalHours: t.reduce((s, x) => s + x.t.hours, 0),
      enteredAt: iso(n.createdAt)!,
      lateEntry: diffDays(n.noteDate, enteredDay) > LATE_ENTRY_DAYS,
      createdByUserId: n.createdBy,
    };
  });
}

async function getNote(tx: Tx, id: string) {
  const [n] = await tx.select().from(schema.notes).where(and(eq(schema.notes.id, id), isNull(schema.notes.deletedAt)));
  if (!n) throw notFound("Fiche introuvable");
  return n;
}

/** Contributeur : auteur = sa fiche personne. Expert : lecture seule. */
async function assertNoteWriter(req: Request, tx: Tx, authorPersonId: string) {
  if (hasRole(req, "expert")) throw forbidden();
  if (hasRole(req, "contributeur")) {
    const me = await personOfUser(tx, req.auth!.userId);
    if (!me || me.id !== authorPersonId) throw forbidden("Vous ne pouvez rédiger que vos propres fiches");
  }
}

async function writeTimes(tx: Tx, req: Request, noteId: string, projectId: string, fyId: string, noteDate: string, times: { personId: string; hours: number }[]) {
  const fy = await getFiscalYear(tx, fyId);
  const previous = await tx
    .select({ id: schema.timeEntries.id })
    .from(schema.timeEntries)
    .where(and(eq(schema.timeEntries.noteId, noteId), eq(schema.timeEntries.source, "note")));
  const previousIds = previous.map((p) => p.id);
  if (previousIds.length) await tx.delete(schema.timeEntries).where(inArray(schema.timeEntries.id, previousIds));
  const persons = new Set<string>();
  for (const t of times) {
    if (persons.has(t.personId)) throw unprocessable("Une même personne apparaît deux fois dans les temps de la fiche");
    persons.add(t.personId);
    const v = await validateEntry(tx, fy, { personId: t.personId, projectId, date: noteDate, granularity: "day", hours: t.hours, noteId });
    await tx.insert(schema.timeEntries).values({
      companyId: fy.companyId,
      createdBy: req.auth!.userId,
      fiscalYearId: fy.id,
      personId: v.personId,
      projectId,
      entryDate: v.date,
      granularity: "day",
      hours: v.hours,
      noteId,
      source: "note",
    });
  }
}

const notesQuery = z.object({
  fiscalYearId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  lockId: z.uuid().optional(),
  topicId: z.uuid().optional(),
  mine: z.enum(["1", "0"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

researchRouter.get("/notes", async (req, res) => {
  const q = parse(notesQuery, req.query);
  const out = await run(req, async (tx) => {
    const scope = await contributorScope(req, tx);
    const conds = [isNull(schema.notes.deletedAt)];
    if (q.topicId) conds.push(eq(schema.notes.topicId, q.topicId));
    if (q.lockId) conds.push(eq(schema.topics.lockId, q.lockId));
    if (q.projectId) conds.push(eq(schema.locks.projectId, q.projectId));
    if (q.fiscalYearId) conds.push(eq(schema.projects.fiscalYearId, q.fiscalYearId));
    if (scope) conds.push(scope.projectIds.length ? inArray(schema.locks.projectId, scope.projectIds) : sql`false`);
    if (q.mine === "1") {
      const me = await personOfUser(tx, req.auth!.userId);
      conds.push(me ? eq(schema.notes.authorPersonId, me.id) : sql`false`);
    }
    const rows = await tx
      .select({ n: schema.notes })
      .from(schema.notes)
      .innerJoin(schema.topics, eq(schema.topics.id, schema.notes.topicId))
      .innerJoin(schema.locks, eq(schema.locks.id, schema.topics.lockId))
      .innerJoin(schema.projects, eq(schema.projects.id, schema.locks.projectId))
      .where(and(...conds))
      .orderBy(desc(schema.notes.noteDate), desc(schema.notes.refNo))
      .limit(q.limit);
    return noteDtos(
      tx,
      rows.map((r) => r.n),
    );
  });
  res.json(out);
});

/** Contexte de saisie rapide (F5.5) : ma fiche personne, sujets ouverts de mes projets, dernier sujet utilisé. */
researchRouter.get("/notes/quick-context", async (req, res) => {
  const { fiscalYearId } = parse(z.object({ fiscalYearId: z.uuid() }), req.query);
  const out = await run(req, async (tx) => {
    const me = await personOfUser(tx, req.auth!.userId);
    const scope = await contributorScope(req, tx);
    const conds = [
      eq(schema.projects.fiscalYearId, fiscalYearId),
      isNull(schema.projects.deletedAt),
      isNull(schema.locks.deletedAt),
      isNull(schema.topics.deletedAt),
      eq(schema.topics.status, "ouvert"),
    ];
    if (scope) conds.push(scope.projectIds.length ? inArray(schema.projects.id, scope.projectIds) : sql`false`);
    const topics = await tx
      .select({ topic: schema.topics, lock: schema.locks, project: schema.projects })
      .from(schema.topics)
      .innerJoin(schema.locks, eq(schema.locks.id, schema.topics.lockId))
      .innerJoin(schema.projects, eq(schema.projects.id, schema.locks.projectId))
      .where(and(...conds))
      .orderBy(asc(schema.projects.code), asc(schema.locks.number), asc(schema.topics.number));
    let lastTopicId: string | null = null;
    if (me) {
      const [last] = await tx
        .select({ topicId: schema.notes.topicId })
        .from(schema.notes)
        .where(and(eq(schema.notes.authorPersonId, me.id), isNull(schema.notes.deletedAt)))
        .orderBy(desc(schema.notes.createdAt))
        .limit(1);
      lastTopicId = last?.topicId ?? null;
    }
    return {
      me: me ? { id: me.id, name: personName(me) } : null,
      today: todayParis(),
      lastTopicId,
      topics: topics.map(({ topic, lock, project }) => ({
        id: topic.id,
        code: topicCode(lock.number, topic.number),
        title: topic.title,
        hypothesis: topic.hypothesis,
        lockCode: lockCode(lock.number),
        projectId: project.id,
        projectCode: project.code,
      })),
    };
  });
  res.json(out);
});

researchRouter.get("/notes/:id", async (req, res) => {
  const out = await run(req, async (tx) => {
    const n = await getNote(tx, param(req));
    const { project } = await topicContext(tx, n.topicId);
    await assertProjectReadable(req, tx, project.id);
    return (await noteDtos(tx, [n]))[0];
  });
  res.json(out);
});

researchRouter.post("/notes", async (req, res) => {
  const input = parse(noteSchema, req.body);
  const out = await run(req, async (tx) => {
    const { project } = await topicContext(tx, input.topicId);
    await assertNoteWriter(req, tx, input.authorPersonId);
    const fy = await editableFiscalYear(tx, project.fiscalYearId);
    if (input.noteDate < fy.startDate || input.noteDate > fy.endDate) throw unprocessable("Date hors de l'exercice");
    if (input.noteDate > todayParis()) throw unprocessable("Une fiche ne peut pas être datée dans le futur");
    if (!(await isAssigned(tx, project.id, input.authorPersonId))) throw unprocessable("L'auteur doit être affecté au projet");
    if (!input.force) {
      const [existing] = await tx
        .select({ id: schema.notes.id, refNo: schema.notes.refNo })
        .from(schema.notes)
        .where(and(eq(schema.notes.topicId, input.topicId), eq(schema.notes.noteDate, input.noteDate), isNull(schema.notes.deletedAt)));
      if (existing) {
        throw new HttpError(409, "note_exists", `Une fiche existe déjà pour ce sujet à cette date (${formatNoteRef(existing.refNo)})`, { noteId: existing.id });
      }
    }
    await advisoryLock(tx, `notes:${project.companyId}`);
    const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(${schema.notes.refNo}),0)::int` }).from(schema.notes)) as [{ n: number }];
    const [note] = await tx
      .insert(schema.notes)
      .values({
        companyId: project.companyId,
        createdBy: req.auth!.userId,
        refNo: n + 1,
        topicId: input.topicId,
        authorPersonId: input.authorPersonId,
        noteDate: input.noteDate,
        hypothesis: input.hypothesis,
        workDone: input.workDone,
        result: input.result,
        resultKind: input.resultKind,
        conclusion: input.conclusion,
        nextStep: input.nextStep,
      })
      .returning();
    if (input.links.length)
      await tx.insert(schema.noteLinks).values(input.links.map((l) => ({ ...l, noteId: note!.id, companyId: project.companyId, createdBy: req.auth!.userId })));
    await writeTimes(tx, req, note!.id, project.id, project.fiscalYearId, input.noteDate, input.times);
    return (await noteDtos(tx, [note!]))[0];
  });
  res.status(201).json(out);
});

researchRouter.put("/notes/:id", async (req, res) => {
  const input = parse(noteSchema, req.body);
  const out = await run(req, async (tx) => {
    const current = await getNote(tx, param(req));
    if (current.topicId !== input.topicId) throw unprocessable("Le sujet d'une fiche ne peut pas être changé");
    const { project } = await topicContext(tx, current.topicId);
    await assertNoteWriter(req, tx, current.authorPersonId);
    await assertNoteWriter(req, tx, input.authorPersonId);
    const fy = await editableFiscalYear(tx, project.fiscalYearId);
    if (input.noteDate < fy.startDate || input.noteDate > fy.endDate) throw unprocessable("Date hors de l'exercice");
    if (!(await isAssigned(tx, project.id, input.authorPersonId))) throw unprocessable("L'auteur doit être affecté au projet");
    const [note] = await tx
      .update(schema.notes)
      .set({
        authorPersonId: input.authorPersonId,
        noteDate: input.noteDate,
        hypothesis: input.hypothesis,
        workDone: input.workDone,
        result: input.result,
        resultKind: input.resultKind,
        conclusion: input.conclusion,
        nextStep: input.nextStep,
      })
      .where(eq(schema.notes.id, current.id))
      .returning();
    await tx.delete(schema.noteLinks).where(eq(schema.noteLinks.noteId, current.id));
    if (input.links.length)
      await tx.insert(schema.noteLinks).values(input.links.map((l) => ({ ...l, noteId: current.id, companyId: project.companyId, createdBy: req.auth!.userId })));
    await writeTimes(tx, req, current.id, project.id, project.fiscalYearId, input.noteDate, input.times);
    return (await noteDtos(tx, [note!]))[0];
  });
  res.json(out);
});

researchRouter.delete("/notes/:id", async (req, res) => {
  await run(req, async (tx) => {
    const current = await getNote(tx, param(req));
    const { project } = await topicContext(tx, current.topicId);
    await assertNoteWriter(req, tx, current.authorPersonId);
    await editableFiscalYear(tx, project.fiscalYearId);
    await tx.delete(schema.timeEntries).where(and(eq(schema.timeEntries.noteId, current.id), eq(schema.timeEntries.source, "note")));
    await tx.update(schema.timeEntries).set({ noteId: null }).where(eq(schema.timeEntries.noteId, current.id));
    await tx.update(schema.notes).set({ deletedAt: new Date() }).where(eq(schema.notes.id, current.id));
  });
  res.status(204).end();
});

