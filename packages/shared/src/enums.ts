export const ROLES = ["admin", "redacteur", "contributeur", "expert"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrateur",
  redacteur: "Rédacteur",
  contributeur: "Contributeur",
  expert: "Expert invité",
};
/** Rôles pour lesquels la MFA est obligatoire. */
export const MFA_REQUIRED_ROLES: Role[] = ["admin", "expert"];

export const FISCAL_YEAR_STATUSES = ["draft", "in_review", "expert_validated", "sealed"] as const;
export type FiscalYearStatus = (typeof FISCAL_YEAR_STATUSES)[number];
export const FISCAL_YEAR_STATUS_LABELS: Record<FiscalYearStatus, string> = {
  draft: "Brouillon",
  in_review: "En relecture",
  expert_validated: "Validé expert",
  sealed: "Scellé",
};
/** Statuts dans lesquels les contenus de l'exercice sont modifiables. */
export const EDITABLE_FY_STATUSES: FiscalYearStatus[] = ["draft", "in_review"];

export const FY_TRANSITIONS = ["submit_review", "back_to_draft", "expert_validate", "reopen", "seal"] as const;
export type FiscalYearTransition = (typeof FY_TRANSITIONS)[number];

export const PERSON_STATUSES = ["chercheur", "technicien", "jeune_docteur"] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];
export const PERSON_STATUS_LABELS: Record<PersonStatus, string> = {
  chercheur: "Chercheur",
  technicien: "Technicien",
  jeune_docteur: "Jeune docteur",
};

export const OPERATION_FUNCTIONS = ["chef_de_projet", "chercheur", "technicien_rd"] as const;
export type OperationFunction = (typeof OPERATION_FUNCTIONS)[number];
export const OPERATION_FUNCTION_LABELS: Record<OperationFunction, string> = {
  chef_de_projet: "Chef de projet",
  chercheur: "Chercheur",
  technicien_rd: "Technicien de R&D",
};

export const OPERATION_TYPES = ["rd", "cii", "exclu"] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];
export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  rd: "R&D",
  cii: "CII",
  exclu: "Exclu (industrialisation, maintenance…)",
};

export const LOCK_OUTCOMES = ["en_cours", "leve", "partiel", "non_leve"] as const;
export type LockOutcome = (typeof LOCK_OUTCOMES)[number];
export const LOCK_OUTCOME_LABELS: Record<LockOutcome, string> = {
  en_cours: "En cours",
  leve: "Levé",
  partiel: "Partiellement levé",
  non_leve: "Non levé",
};

export const TOPIC_STATUSES = ["ouvert", "clos"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export const NOTE_RESULT_KINDS = ["succes", "echec_partiel", "echec", "non_concluant"] as const;
export type NoteResultKind = (typeof NOTE_RESULT_KINDS)[number];
export const NOTE_RESULT_LABELS: Record<NoteResultKind, string> = {
  succes: "Succès",
  echec_partiel: "Échec partiel",
  echec: "Échec",
  non_concluant: "Non concluant",
};

export const REFERENCE_TYPES = ["article", "brevet", "norme", "logiciel", "web", "autre"] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];
export const REFERENCE_TYPE_LABELS: Record<ReferenceType, string> = {
  article: "Article",
  brevet: "Brevet",
  norme: "Norme",
  logiciel: "Logiciel",
  web: "Page web",
  autre: "Autre",
};

export const RESCRIT_TYPES = ["rescrit_cir", "rescrit_jei", "rescrit_cico", "agrement_cir", "agrement_cico"] as const;
export type RescritType = (typeof RESCRIT_TYPES)[number];
export const RESCRIT_TYPE_LABELS: Record<RescritType, string> = {
  rescrit_cir: "Rescrit CIR",
  rescrit_jei: "Rescrit JEI",
  rescrit_cico: "Rescrit CICo",
  agrement_cir: "Agrément CIR",
  agrement_cico: "Agrément CICo",
};

export const FILE_KINDS = [
  "person_cv",
  "person_diploma",
  "person_job_description",
  "note_attachment",
  "company_orgchart",
  "company_rd_orgchart",
] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const FILE_KIND_LABELS: Record<FileKind, string> = {
  person_cv: "CV",
  person_diploma: "Diplôme",
  person_job_description: "Fiche de poste",
  note_attachment: "Pièce jointe",
  company_orgchart: "Organigramme société",
  company_rd_orgchart: "Organigramme R&D",
};

export const TIME_GRANULARITIES = ["day", "month"] as const;
export type TimeGranularity = (typeof TIME_GRANULARITIES)[number];

export const IMPORT_FIELDS = ["person", "project", "date", "hours", "note"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  person: "Personne (email ou « Prénom Nom »)",
  project: "Code projet",
  date: "Date (JJ/MM/AAAA) ou mois (MM/AAAA)",
  hours: "Heures",
  note: "Fiche de recherche (ex. F-0042, optionnel)",
};

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled", "incomplete", "none"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
