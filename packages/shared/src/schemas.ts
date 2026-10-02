import { z } from "zod";
import {
  FY_TRANSITIONS,
  LOCK_OUTCOMES,
  NOTE_RESULT_KINDS,
  OPERATION_FUNCTIONS,
  OPERATION_TYPES,
  PERSON_STATUSES,
  REFERENCE_TYPES,
  RESCRIT_TYPES,
  ROLES,
  TIME_GRANULARITIES,
  TOPIC_STATUSES,
  IMPORT_FIELDS,
} from "./enums";
import { FRASCATI_CRITERIA, SELF_ASSESSMENTS, VERDICTS } from "./referentiels";
import { isValidSiren } from "./rules";

const isoDate = z.iso.date({ message: "Date invalide (AAAA-MM-JJ)" });
const optionalIsoDate = isoDate.nullable().optional();
const id = z.uuid({ message: "Identifiant invalide" });
const text = (max = 20_000) => z.string().trim().max(max);
const requiredText = (label: string, max = 20_000) =>
  z.string().trim().min(1, { message: `${label} obligatoire` }).max(max);

export const passwordSchema = z
  .string()
  .min(12, { message: "12 caractères minimum" })
  .max(200);

export const sirenSchema = z
  .string()
  .transform((s) => s.replace(/\s/g, ""))
  .refine(isValidSiren, { message: "SIREN invalide (9 chiffres, clé de contrôle)" });

/* ------------------------------ Auth ------------------------------ */

export const signupSchema = z.object({
  fullName: requiredText("Nom", 200),
  email: z.email({ message: "Email invalide" }).transform((e) => e.toLowerCase()),
  password: passwordSchema,
  company: z.object({
    siren: sirenSchema,
    name: requiredText("Raison sociale", 200),
  }),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});

export const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  fullName: z.string().trim().max(200).optional(),
  password: passwordSchema.optional(),
});

/* ---------------------------- Société ---------------------------- */

export const createCompanySchema = z.object({
  siren: sirenSchema,
  name: requiredText("Raison sociale", 200),
});

export const companyUpdateSchema = z.object({
  name: requiredText("Raison sociale", 200),
  nafCode: text(10).nullable().optional(),
  sector: text(200).nullable().optional(),
  headcountTotal: z.number().int().min(0).nullable().optional(),
  headcountRd: z.number().int().min(0).nullable().optional(),
  rdOrganization: text().nullable().optional(),
  hoursPerDay: z.number().min(1).max(12),
  annualHoursCap: z.number().int().min(100).max(2500),
  unlinkedThreshold: z.number().int().min(0).max(100),
  referentName: text(200).nullable().optional(),
  referentRole: text(200).nullable().optional(),
  referentPhone: text(50).nullable().optional(),
  referentEmail: z.email().nullable().optional().or(z.literal("")),
});
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;

export const rescritSchema = z.object({
  type: z.enum(RESCRIT_TYPES),
  decisionDate: optionalIsoDate,
  decision: z.enum(["favorable", "defavorable", "en_attente"]),
  years: text(100),
});

export const groupCreateSchema = z.object({ name: requiredText("Nom du groupe", 200) });
export const groupJoinSchema = z.object({ code: z.string().trim().min(6).max(64) });

/* ---------------------------- Exercice ---------------------------- */

export const fiscalYearSchema = z
  .object({
    label: requiredText("Libellé", 50),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((v) => v.startDate < v.endDate, { message: "La date de fin doit suivre la date de début", path: ["endDate"] });

export const fiscalYearTransitionSchema = z.object({
  action: z.enum(FY_TRANSITIONS),
  comment: text(5000).optional(),
});

/* ----------------------------- Membres ----------------------------- */

export const invitationSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(ROLES),
  accessExpiresAt: optionalIsoDate,
});

export const memberUpdateSchema = z.object({
  role: z.enum(ROLES),
  accessExpiresAt: optionalIsoDate,
});

/* ----------------------------- Équipe ----------------------------- */

export const personSchema = z
  .object({
    firstName: requiredText("Prénom", 100),
    lastName: requiredText("Nom", 100),
    email: z.email().nullable().optional().or(z.literal("")),
    jobTitle: text(200).nullable().optional(),
    degree: text(300).nullable().optional(),
    degreeInstitution: text(300).nullable().optional(),
    degreeDate: optionalIsoDate,
    status: z.enum(PERSON_STATUSES),
    entryDate: optionalIsoDate,
    exitDate: optionalIsoDate,
    thesisDate: optionalIsoDate,
    cdiDate: optionalIsoDate,
    isSupportFunction: z.boolean().default(false),
  })
  .refine((p) => p.status !== "jeune_docteur" || (!!p.thesisDate && !!p.cdiDate), {
    message: "Jeune docteur : dates de soutenance et d'embauche en CDI obligatoires",
    path: ["thesisDate"],
  })
  .refine((p) => !p.entryDate || !p.exitDate || p.entryDate <= p.exitDate, {
    message: "La date de sortie doit suivre la date d'entrée",
    path: ["exitDate"],
  });
export type PersonInput = z.infer<typeof personSchema>;

export const salarySchema = z.object({ monthlyGrossSalary: z.number().min(0).max(1_000_000).nullable() });

export const assignmentSchema = z.object({
  personId: id,
  operationFunction: z.enum(OPERATION_FUNCTIONS),
  contribution: text(5000).default(""),
});
export const assignmentsSchema = z.object({ assignments: z.array(assignmentSchema).max(500) });

/* ------------------------------ Temps ------------------------------ */

export const timeEntrySchema = z.object({
  personId: id,
  projectId: id,
  operationId: id.nullable().optional(),
  date: isoDate,
  granularity: z.enum(TIME_GRANULARITIES).default("day"),
  quantity: z.number().positive().max(400),
  unit: z.enum(["hours", "days"]).default("hours"),
  noteId: id.nullable().optional(),
});
export type TimeEntryInput = z.infer<typeof timeEntrySchema>;

export const importMappingSchema = z.object({
  mapping: z.record(z.enum(IMPORT_FIELDS), z.string().nullable()),
  unit: z.enum(["hours", "days"]).default("hours"),
});
export const importCommitSchema = z.object({ duplicates: z.enum(["replace", "skip"]) });

/* ------------------------------ Projets ------------------------------ */

export const projectSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, { message: "Code : lettres, chiffres, tirets" }),
  title: requiredText("Titre", 300),
  startDate: isoDate,
  endDate: optionalIsoDate,
  objectives: text().default(""),
  keywords: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});
export type ProjectInput = z.infer<typeof projectSchema>;

export const frascatiAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        criterion: z.enum(FRASCATI_CRITERIA),
        argument: text(10_000),
        selfAssessment: z.enum(SELF_ASSESSMENTS),
        citedLockIds: z.array(id).max(50).default([]),
        citedNoteIds: z.array(id).max(50).default([]),
      }),
    )
    .max(5),
});

export const verdictSchema = z.object({
  verdict: z.enum(VERDICTS),
  justification: requiredText("Justification", 10_000),
  expertName: requiredText("Nom de l'expert", 200),
  verdictDate: isoDate,
});

export const operationSchema = z.object({
  title: requiredText("Intitulé", 300),
  startDate: optionalIsoDate,
  endDate: optionalIsoDate,
  type: z.enum(OPERATION_TYPES),
});

/* ----------------------- Verrous, sujets, fiches ----------------------- */

export const lockSchema = z.object({
  statement: requiredText("Énoncé", 5000),
  sotaGap: requiredText("Insuffisance de l'état de l'art", 10_000),
  identifiedOn: isoDate,
  outcome: z.enum(LOCK_OUTCOMES).default("en_cours"),
});

export const topicSchema = z.object({
  title: requiredText("Titre", 300),
  hypothesis: requiredText("Hypothèse", 5000),
  approach: text(5000).default(""),
  ownerPersonId: id.nullable().optional(),
  status: z.enum(TOPIC_STATUSES).default("ouvert"),
});

export const noteSchema = z.object({
  topicId: id,
  noteDate: isoDate,
  authorPersonId: id,
  hypothesis: requiredText("Hypothèse testée", 5000),
  workDone: requiredText("Travaux menés", 10_000),
  result: requiredText("Résultat", 10_000),
  resultKind: z.enum(NOTE_RESULT_KINDS),
  conclusion: text(5000).default(""),
  nextStep: text(5000).default(""),
  links: z.array(z.object({ url: z.url(), label: text(200).default("") })).max(30).default([]),
  times: z.array(z.object({ personId: id, hours: z.number().positive().max(24) })).max(30).default([]),
  /** Créer malgré une fiche existante pour ce sujet et cette date. */
  force: z.boolean().optional(),
});
export type NoteInput = z.infer<typeof noteSchema>;

/* --------------------------- Rédaction --------------------------- */

export const sectionSaveSchema = z.object({
  content: z.record(z.string(), z.unknown()),
  baseVersion: z.number().int().min(0),
  /** true = version explicite (sinon enregistrement automatique regroupé). */
  checkpoint: z.boolean().default(false),
  confirmUpToDate: z.boolean().optional(),
});

export const referenceSchema = z.object({
  refType: z.enum(REFERENCE_TYPES),
  title: requiredText("Titre", 500),
  authors: text(1000).default(""),
  publishedOn: isoDate,
  doi: text(200).nullable().optional(),
  url: z.url().nullable().optional().or(z.literal("")),
  patentNumber: text(100).nullable().optional(),
});

export const commentSchema = z.object({
  body: requiredText("Commentaire", 5000),
  anchorText: text(500).nullable().optional(),
  parentId: id.nullable().optional(),
});

export const reminderSchema = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(6).max(21),
  weekdays: z.array(z.number().int().min(1).max(5)).min(1).max(5),
});
