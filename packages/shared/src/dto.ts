/** Objets renvoyés par l'API (camelCase). Dates ISO « AAAA-MM-JJ », horodatages ISO 8601. */
import type {
  FileKind,
  FiscalYearStatus,
  LockOutcome,
  NoteResultKind,
  OperationFunction,
  OperationType,
  PersonStatus,
  ReferenceType,
  RescritType,
  Role,
  SubscriptionStatus,
  TimeGranularity,
  TopicStatus,
} from "./enums";
import type { FrascatiCriterion, Rubrique, SelfAssessment, Verdict } from "./referentiels";
import type { PMNode } from "./richtext";

export interface MembershipDto {
  companyId: string;
  companyName: string;
  siren: string;
  role: Role;
  accessExpiresAt: string | null;
}

export interface MeDto {
  user: { id: string; email: string; fullName: string; mfaEnabled: boolean };
  memberships: MembershipDto[];
  groups: { id: string; name: string; role: "owner" | "reader" }[];
  activeCompanyId: string | null;
  role: Role | null;
  mfaRequired: boolean;
  csrfToken: string;
  billing: { enabled: boolean; status: SubscriptionStatus; readOnly: boolean; trialEndsAt: string | null } | null;
  features: { sso: { google: boolean; microsoft: boolean } };
}

export interface CompanyDto {
  id: string;
  siren: string;
  name: string;
  nafCode: string | null;
  sector: string | null;
  headcountTotal: number | null;
  headcountRd: number | null;
  rdOrganization: string | null;
  hoursPerDay: number;
  annualHoursCap: number;
  unlinkedThreshold: number;
  referentName: string | null;
  referentRole: string | null;
  referentPhone: string | null;
  referentEmail: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface RescritDto {
  id: string;
  type: RescritType;
  decisionDate: string | null;
  decision: "favorable" | "defavorable" | "en_attente";
  years: string;
}

export interface FiscalYearDto {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: FiscalYearStatus;
  progress: number;
  expertValidationName: string | null;
  expertValidatedAt: string | null;
  expertComment: string | null;
  sealedAt: string | null;
  sourceFiscalYearId: string | null;
}

export interface MemberDto {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  accessExpiresAt: string | null;
  mfaEnabled: boolean;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  accessExpiresAt: string | null;
  acceptedAt: string | null;
}

export interface FileDto {
  id: string;
  kind: FileKind;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  version: number;
  createdAt: string;
  uploadedByName: string | null;
}

export interface PersonDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  userId: string | null;
  jobTitle: string | null;
  degree: string | null;
  degreeInstitution: string | null;
  degreeDate: string | null;
  status: PersonStatus;
  entryDate: string | null;
  exitDate: string | null;
  thesisDate: string | null;
  cdiDate: string | null;
  isSupportFunction: boolean;
  /** Présent uniquement pour l'administrateur. */
  monthlyGrossSalary?: number | null;
  hasCv: boolean;
  hasDiploma: boolean;
  projectIds: string[];
}

export interface AssignmentDto {
  id: string;
  personId: string;
  personName: string;
  operationFunction: OperationFunction;
  contribution: string;
}

export interface ProjectDto {
  id: string;
  fiscalYearId: string;
  code: string;
  title: string;
  startDate: string;
  endDate: string | null;
  objectives: string;
  keywords: string[];
  verdict: Verdict | null;
  verdictJustification: string | null;
  verdictExpertName: string | null;
  verdictDate: string | null;
  frascatiComplete: boolean;
  lockCount: number;
  noteCount: number;
  hours: number;
  sourceProjectId: string | null;
}

export interface FrascatiAnswerDto {
  criterion: FrascatiCriterion;
  argument: string;
  selfAssessment: SelfAssessment;
  citedLockIds: string[];
  citedNoteIds: string[];
  updatedAt: string | null;
}

export interface OperationDto {
  id: string;
  projectId: string;
  title: string;
  titleLocked: boolean;
  startDate: string | null;
  endDate: string | null;
  type: OperationType;
}

export interface LockDto {
  id: string;
  projectId: string;
  number: number;
  code: string;
  statement: string;
  sotaGap: string;
  identifiedOn: string;
  outcome: LockOutcome;
  toUpdate: boolean;
  version: number;
  topicCount: number;
  noteCount: number;
  hours: number;
}

export interface LockVersionDto {
  version: number;
  data: Pick<LockDto, "statement" | "sotaGap" | "identifiedOn" | "outcome">;
  authorName: string | null;
  createdAt: string;
}

export interface TopicDto {
  id: string;
  lockId: string;
  number: number;
  code: string;
  title: string;
  hypothesis: string;
  approach: string;
  ownerPersonId: string | null;
  ownerName: string | null;
  status: TopicStatus;
  noteCount: number;
  lastNoteDate: string | null;
}

export interface NoteDto {
  id: string;
  ref: string;
  topicId: string;
  topicCode: string;
  topicTitle: string;
  lockId: string;
  lockCode: string;
  projectId: string;
  projectCode: string;
  noteDate: string;
  authorPersonId: string;
  authorName: string;
  hypothesis: string;
  workDone: string;
  result: string;
  resultKind: NoteResultKind;
  conclusion: string;
  nextStep: string;
  links: { id: string; url: string; label: string }[];
  files: FileDto[];
  times: { id: string; personId: string; personName: string; hours: number }[];
  totalHours: number;
  enteredAt: string;
  lateEntry: boolean;
  createdByUserId: string | null;
}

export interface TimeEntryDto {
  id: string;
  personId: string;
  personName: string;
  projectId: string;
  projectCode: string;
  operationId: string | null;
  date: string;
  granularity: TimeGranularity;
  hours: number;
  noteId: string | null;
  noteRef: string | null;
  source: "manual" | "import" | "note";
}

export interface TimeAlertDto {
  kind: "capacity_day" | "capacity_month" | "capacity_year" | "outside_employment" | "support_function";
  personId: string;
  personName: string;
  period: string;
  hours: number;
  capacity: number | null;
  message: string;
}

export interface UnlinkedStatDto {
  projectId: string;
  projectCode: string;
  totalHours: number;
  unlinkedHours: number;
  ratio: number;
}

export interface ImportPreviewDto {
  id: string;
  status: "uploaded" | "mapped" | "committed" | "failed";
  filename: string;
  headers: string[];
  sample: Record<string, string>[];
  mapping: Record<string, string | null>;
  unit: "hours" | "days";
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  errors: { row: number; message: string }[];
  committedRows: number | null;
}

export interface SectionDto {
  id: string;
  rubrique: Rubrique;
  projectId: string | null;
  operationId: string | null;
  content: PMNode;
  contentText: string;
  version: number;
  authorName: string | null;
  updatedAt: string;
  validatedByName: string | null;
  validatedAt: string | null;
  toUpdate: boolean;
  pages: number;
  commentCount: number;
  openCommentCount: number;
}

export interface SectionVersionDto {
  version: number;
  authorName: string | null;
  createdAt: string;
  contentText: string;
  content: PMNode;
}

export interface ReferenceDto {
  id: string;
  refType: ReferenceType;
  title: string;
  authors: string;
  publishedOn: string;
  doi: string | null;
  url: string | null;
  patentNumber: string | null;
  citedIn: { sectionId: string; rubrique: Rubrique; projectCode: string | null }[];
}

export interface CommentDto {
  id: string;
  sectionId: string;
  parentId: string | null;
  authorName: string;
  authorUserId: string;
  anchorText: string | null;
  body: string;
  resolved: boolean;
  createdAt: string;
}

export interface ChecklistItemDto {
  rule: string;
  level: "blocking" | "warning";
  ok: boolean;
  message: string;
  target: { type: string; id: string | null; projectId?: string | null; label?: string };
}

export interface ChecklistDto {
  fiscalYearId: string;
  progress: number;
  blockingTotal: number;
  blockingOk: number;
  items: ChecklistItemDto[];
}

export interface GroupOverviewRowDto {
  companyId: string;
  companyName: string;
  siren: string;
  fiscalYearLabel: string | null;
  status: FiscalYearStatus | null;
  progress: number | null;
  /** Montant CIR : V1. Toujours null en V0. */
  cirAmount: null;
}

export interface ArchiveDto {
  id: string;
  fiscalYearId: string;
  status: "pending" | "done" | "failed";
  sha256: string | null;
  size: number | null;
  sealedAt: string | null;
  sealedByName: string | null;
  error: string | null;
  fileCount: number | null;
}

export interface AuditEntryDto {
  id: number;
  createdAt: string;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  hash: string;
}

export interface TimelineDto {
  lock: LockDto;
  start: string;
  end: string;
  topics: { id: string; code: string; title: string }[];
  notes: { id: string; ref: string; date: string; topicId: string; resultKind: NoteResultKind; authorName: string; hours: number }[];
  weeklyHours: { week: string; hours: number }[];
  outcomeChanges: { date: string; outcome: LockOutcome }[];
}

/* --------------------------- Vue consolidée --------------------------- */

export interface DossierData {
  generatedAt: string;
  company: {
    name: string;
    siren: string;
    nafCode: string | null;
    sector: string | null;
    headcountTotal: number | null;
    headcountRd: number | null;
    rdOrganization: string | null;
    referent: { name: string | null; role: string | null; phone: string | null; email: string | null };
    rescrits: { type: RescritType; decisionDate: string | null; decision: string; years: string }[];
  };
  fiscalYear: {
    label: string;
    startDate: string;
    endDate: string;
    status: FiscalYearStatus;
    expertValidationName: string | null;
    expertValidatedAt: string | null;
  };
  partOne: { rubrique: Rubrique; content: PMNode; validatedByName: string | null; validatedAt: string | null }[];
  projects: {
    id: string;
    code: string;
    title: string;
    startDate: string;
    endDate: string | null;
    verdict: Verdict | null;
    operations: { title: string; type: OperationType; startDate: string | null; endDate: string | null }[];
    hours: number;
    sections: { rubrique: Rubrique; content: PMNode; validatedByName: string | null; validatedAt: string | null }[];
    locks: { code: string; statement: string; outcome: LockOutcome }[];
    personnel: {
      name: string;
      degree: string | null;
      degreeInstitution: string | null;
      operationFunction: OperationFunction | null;
      contribution: string;
      hours: number;
    }[];
  }[];
  references: { id: string; label: string; refType: ReferenceType; title: string; authors: string; publishedOn: string; doi: string | null; url: string | null; patentNumber: string | null }[];
  notes: {
    id: string;
    ref: string;
    projectCode: string;
    lockCode: string;
    topicCode: string;
    date: string;
    authorName: string;
    hypothesis: string;
    workDone: string;
    result: string;
    resultKind: NoteResultKind;
    conclusion: string;
    nextStep: string;
    hours: number;
    enteredAt: string;
  }[];
  annexes: { number: string; label: string; filename: string; sha256: string; path: string }[];
}
