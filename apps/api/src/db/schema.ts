/**
 * Schéma PostgreSQL (Drizzle). Les politiques RLS, triggers d'audit et fonctions SECURITY DEFINER
 * sont dans drizzle/0001_security.sql (migration écrite à la main).
 * Toute table métier porte company_id, created_at, updated_at, created_by.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "../lib/ids";

const pk = () => uuid("id").primaryKey().$defaultFn(uuidv7);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const day = (name: string) => date(name, { mode: "string" });
const tenantColumns = () => ({
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
});

/* ------------------------------ Comptes ------------------------------ */

export const users = pgTable("users", {
  id: pk(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  passwordHash: text("password_hash"),
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaRecoveryHashes: text("mfa_recovery_hashes").array().notNull().default(sql`'{}'::text[]`),
  googleSub: text("google_sub").unique(),
  microsoftSub: text("microsoft_sub").unique(),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeCompanyId: uuid("active_company_id"),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    csrfToken: text("csrf_token").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const reminders = pgTable("reminders", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  hour: integer("hour").notNull().default(17),
  weekdays: integer("weekdays").array().notNull().default(sql`'{1,2,3,4,5}'::int[]`),
  lastSentOn: day("last_sent_on"),
});

/* ------------------------- Groupes et sociétés ------------------------- */

export const groups = pgTable("groups", {
  id: pk(),
  name: text("name").notNull(),
  joinCodeHash: text("join_code_hash").unique(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("reader"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const companies = pgTable("companies", {
  id: pk(),
  siren: text("siren").notNull().unique(),
  name: text("name").notNull(),
  nafCode: text("naf_code"),
  sector: text("sector"),
  headcountTotal: integer("headcount_total"),
  headcountRd: integer("headcount_rd"),
  rdOrganization: text("rd_organization"),
  hoursPerDay: numeric("hours_per_day", { precision: 4, scale: 2, mode: "number" }).notNull().default(7),
  annualHoursCap: integer("annual_hours_cap").notNull().default(1607),
  unlinkedThreshold: integer("unlinked_threshold").notNull().default(20),
  referentName: text("referent_name"),
  referentRole: text("referent_role"),
  referentPhone: text("referent_phone"),
  referentEmail: text("referent_email"),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  importMapping: jsonb("import_mapping"),
  trialEndsAt: ts("trial_ends_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
});

export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    ...tenantColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    accessExpiresAt: day("access_expires_at"),
  },
  (t) => [
    uniqueIndex("memberships_company_user_uq").on(t.companyId, t.userId),
    index("memberships_user_idx").on(t.userId),
    check("memberships_role_ck", sql`${t.role} in ('admin','redacteur','contributeur','expert')`),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: pk(),
    ...tenantColumns(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    accessExpiresAt: day("access_expires_at"),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("invitations_company_idx").on(t.companyId)],
);

export const subscriptions = pgTable("subscriptions", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  status: text("status").notNull().default("none"),
  currentPeriodEnd: ts("current_period_end"),
  pastDueSince: ts("past_due_since"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const rescrits = pgTable("rescrits", {
  id: pk(),
  ...tenantColumns(),
  type: text("type").notNull(),
  decisionDate: day("decision_date"),
  decision: text("decision").notNull(),
  years: text("years").notNull().default(""),
});

export const fiscalYears = pgTable(
  "fiscal_years",
  {
    id: pk(),
    ...tenantColumns(),
    label: text("label").notNull(),
    startDate: day("start_date").notNull(),
    endDate: day("end_date").notNull(),
    status: text("status").notNull().default("draft"),
    progress: integer("progress").notNull().default(0),
    expertValidationName: text("expert_validation_name"),
    expertValidatedAt: ts("expert_validated_at"),
    expertValidatedBy: uuid("expert_validated_by"),
    expertComment: text("expert_comment"),
    sourceFiscalYearId: uuid("source_fiscal_year_id"),
    sealedAt: ts("sealed_at"),
    sealedBy: uuid("sealed_by"),
  },
  (t) => [
    index("fiscal_years_company_idx").on(t.companyId),
    check("fiscal_years_dates_ck", sql`${t.startDate} < ${t.endDate}`),
    check("fiscal_years_status_ck", sql`${t.status} in ('draft','in_review','expert_validated','sealed')`),
  ],
);

/* ------------------------------- Équipe ------------------------------- */

export const people = pgTable(
  "people",
  {
    id: pk(),
    ...tenantColumns(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    jobTitle: text("job_title"),
    degree: text("degree"),
    degreeInstitution: text("degree_institution"),
    degreeDate: day("degree_date"),
    status: text("status").notNull(),
    entryDate: day("entry_date"),
    exitDate: day("exit_date"),
    thesisDate: day("thesis_date"),
    cdiDate: day("cdi_date"),
    isSupportFunction: boolean("is_support_function").notNull().default(false),
    /** Salaire mensuel brut chiffré (AES-256-GCM, clé applicative). */
    monthlySalaryEnc: text("monthly_salary_enc"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("people_company_idx").on(t.companyId)],
);

export const files = pgTable(
  "files",
  {
    id: pk(),
    ...tenantColumns(),
    kind: text("kind").notNull(),
    ownerId: uuid("owner_id").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    version: integer("version").notNull().default(1),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("files_owner_idx").on(t.companyId, t.kind, t.ownerId)],
);

/* ------------------------------- Projets ------------------------------- */

export const projects = pgTable(
  "projects",
  {
    id: pk(),
    ...tenantColumns(),
    fiscalYearId: uuid("fiscal_year_id")
      .notNull()
      .references(() => fiscalYears.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    startDate: day("start_date").notNull(),
    endDate: day("end_date"),
    objectives: text("objectives").notNull().default(""),
    keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
    verdict: text("verdict"),
    verdictJustification: text("verdict_justification"),
    verdictExpertName: text("verdict_expert_name"),
    verdictDate: day("verdict_date"),
    verdictBy: uuid("verdict_by"),
    sourceProjectId: uuid("source_project_id"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    uniqueIndex("projects_fy_code_uq").on(t.fiscalYearId, t.code).where(sql`${t.deletedAt} is null`),
    check("projects_verdict_ck", sql`${t.verdict} is null or ${t.verdict} in ('eligible_cir','piste_cii','non_eligible')`),
  ],
);

export const assignments = pgTable(
  "assignments",
  {
    id: pk(),
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    operationFunction: text("operation_function").notNull(),
    contribution: text("contribution").notNull().default(""),
  },
  (t) => [uniqueIndex("assignments_project_person_uq").on(t.projectId, t.personId)],
);

export const frascatiAnswers = pgTable(
  "frascati_answers",
  {
    id: pk(),
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    criterion: text("criterion").notNull(),
    argument: text("argument").notNull().default(""),
    selfAssessment: text("self_assessment").notNull(),
    citedLockIds: uuid("cited_lock_ids").array().notNull().default(sql`'{}'::uuid[]`),
    citedNoteIds: uuid("cited_note_ids").array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => [uniqueIndex("frascati_project_criterion_uq").on(t.projectId, t.criterion)],
);

export const operations = pgTable("operations", {
  id: pk(),
  ...tenantColumns(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** Identifie la même opération d'un exercice à l'autre. */
  lineageId: uuid("lineage_id").notNull(),
  title: text("title").notNull(),
  titleLocked: boolean("title_locked").notNull().default(false),
  startDate: day("start_date"),
  endDate: day("end_date"),
  type: text("type").notNull(),
});

/* ----------------------- Verrous, sujets, fiches ----------------------- */

export const locks = pgTable(
  "locks",
  {
    id: pk(),
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    statement: text("statement").notNull(),
    sotaGap: text("sota_gap").notNull(),
    identifiedOn: day("identified_on").notNull(),
    outcome: text("outcome").notNull().default("en_cours"),
    toUpdate: boolean("to_update").notNull().default(false),
    version: integer("version").notNull().default(1),
    sourceLockId: uuid("source_lock_id"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [uniqueIndex("locks_project_number_uq").on(t.projectId, t.number)],
);

export const lockVersions = pgTable("lock_versions", {
  id: pk(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  lockId: uuid("lock_id")
    .notNull()
    .references(() => locks.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  data: jsonb("data").notNull(),
  authorId: uuid("author_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const topics = pgTable(
  "topics",
  {
    id: pk(),
    ...tenantColumns(),
    lockId: uuid("lock_id")
      .notNull()
      .references(() => locks.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    hypothesis: text("hypothesis").notNull(),
    approach: text("approach").notNull().default(""),
    ownerPersonId: uuid("owner_person_id").references(() => people.id, { onDelete: "set null" }),
    status: text("status").notNull().default("ouvert"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [uniqueIndex("topics_lock_number_uq").on(t.lockId, t.number)],
);

export const notes = pgTable(
  "notes",
  {
    id: pk(),
    ...tenantColumns(),
    refNo: integer("ref_no").notNull(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    authorPersonId: uuid("author_person_id")
      .notNull()
      .references(() => people.id),
    noteDate: day("note_date").notNull(),
    hypothesis: text("hypothesis").notNull(),
    workDone: text("work_done").notNull(),
    result: text("result").notNull(),
    resultKind: text("result_kind").notNull(),
    conclusion: text("conclusion").notNull().default(""),
    nextStep: text("next_step").notNull().default(""),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    uniqueIndex("notes_company_ref_uq").on(t.companyId, t.refNo),
    index("notes_topic_date_idx").on(t.topicId, t.noteDate),
  ],
);

export const noteLinks = pgTable("note_links", {
  id: pk(),
  ...tenantColumns(),
  noteId: uuid("note_id")
    .notNull()
    .references(() => notes.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  label: text("label").notNull().default(""),
});

/* -------------------------------- Temps -------------------------------- */

export const imports = pgTable("imports", {
  id: pk(),
  ...tenantColumns(),
  fiscalYearId: uuid("fiscal_year_id")
    .notNull()
    .references(() => fiscalYears.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  status: text("status").notNull().default("uploaded"),
  headers: text("headers").array().notNull().default(sql`'{}'::text[]`),
  rows: jsonb("rows"),
  mapping: jsonb("mapping"),
  unit: text("unit").notNull().default("hours"),
  totalRows: integer("total_rows").notNull().default(0),
  errors: jsonb("errors"),
  committedRows: integer("committed_rows"),
  committedAt: ts("committed_at"),
  sourceSha256: text("source_sha256"),
});

export const timeEntries = pgTable(
  "time_entries",
  {
    id: pk(),
    ...tenantColumns(),
    fiscalYearId: uuid("fiscal_year_id")
      .notNull()
      .references(() => fiscalYears.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id").references(() => operations.id, { onDelete: "set null" }),
    entryDate: day("entry_date").notNull(),
    granularity: text("granularity").notNull().default("day"),
    hours: numeric("hours", { precision: 6, scale: 2, mode: "number" }).notNull(),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    source: text("source").notNull().default("manual"),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
  },
  (t) => [
    index("time_entries_person_date_idx").on(t.companyId, t.personId, t.entryDate),
    index("time_entries_project_idx").on(t.projectId),
    index("time_entries_note_idx").on(t.noteId),
    check("time_entries_hours_ck", sql`${t.hours} > 0`),
    check("time_entries_granularity_ck", sql`${t.granularity} in ('day','month')`),
  ],
);

/* ------------------------------ Rédaction ------------------------------ */

export const sections = pgTable(
  "sections",
  {
    id: pk(),
    ...tenantColumns(),
    fiscalYearId: uuid("fiscal_year_id")
      .notNull()
      .references(() => fiscalYears.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id").references(() => operations.id, { onDelete: "set null" }),
    rubrique: text("rubrique").notNull(),
    content: jsonb("content").notNull().default(sql`'{"type":"doc","content":[]}'::jsonb`),
    contentText: text("content_text").notNull().default(""),
    version: integer("version").notNull().default(0),
    authorId: uuid("author_id"),
    validatedBy: uuid("validated_by"),
    validatedAt: ts("validated_at"),
    toUpdate: boolean("to_update").notNull().default(false),
  },
  (t) => [
    uniqueIndex("sections_fy_project_rubrique_uq").on(
      t.fiscalYearId,
      sql`coalesce(${t.projectId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.rubrique,
    ),
  ],
);

export const sectionVersions = pgTable(
  "section_versions",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: jsonb("content").notNull(),
    contentText: text("content_text").notNull(),
    authorId: uuid("author_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("section_versions_uq").on(t.sectionId, t.version)],
);

export const biblioRefs = pgTable("biblio_refs", {
  id: pk(),
  ...tenantColumns(),
  refType: text("ref_type").notNull(),
  title: text("title").notNull(),
  authors: text("authors").notNull().default(""),
  publishedOn: day("published_on").notNull(),
  doi: text("doi"),
  url: text("url"),
  patentNumber: text("patent_number"),
  deletedAt: ts("deleted_at"),
});

export const sectionRefs = pgTable(
  "section_refs",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    refId: uuid("ref_id")
      .notNull()
      .references(() => biblioRefs.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.sectionId, t.refId] })],
);

export const sectionNotes = pgTable(
  "section_notes",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.sectionId, t.noteId] })],
);

export const comments = pgTable(
  "comments",
  {
    id: pk(),
    ...tenantColumns(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    authorUserId: uuid("author_user_id").notNull(),
    anchorText: text("anchor_text"),
    body: text("body").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    resolvedBy: uuid("resolved_by"),
  },
  (t) => [index("comments_section_idx").on(t.sectionId)],
);

/* ------------------------------- Archives ------------------------------- */

export const archives = pgTable("archives", {
  id: pk(),
  ...tenantColumns(),
  fiscalYearId: uuid("fiscal_year_id")
    .notNull()
    .references(() => fiscalYears.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  storageKey: text("storage_key"),
  sha256: text("sha256"),
  size: integer("size"),
  manifest: jsonb("manifest"),
  error: text("error"),
  sealedAt: ts("sealed_at"),
});

/* --------------------------------- Audit --------------------------------- */

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: uuid("company_id"),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: ts("created_at").notNull().defaultNow(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_company_idx").on(t.companyId, t.id)],
);
