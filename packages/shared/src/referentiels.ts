/**
 * Référentiels CIR versionnés par millésime : critères de Frascati et plan MESR.
 * Ces contenus pédagogiques doivent être validés (docteur / directeur de recherche + cabinet CIR partenaire)
 * avant mise en production : le nom et la date du validateur sont portés par REFERENTIEL_META.
 * Ne jamais coder ces libellés en dur dans les écrans : toujours lire ce module.
 */

export const REFERENTIEL_META = {
  millesime: 2025,
  sources: [
    "Spécification « Outil de gestion du dossier technique CIR »",
    "Dossier justificatif générique CIR 2025 (MESR)",
  ],
  /** À compléter lors de la validation : nom + date du validateur scientifique et du cabinet. */
  validation: {
    scientifique: null as null | { nom: string; date: string },
    cabinet: null as null | { nom: string; date: string },
  },
} as const;

/* ------------------------------------------------------------------ */
/* Frascati                                                            */
/* ------------------------------------------------------------------ */

export const FRASCATI_CRITERIA = [
  "nouveaute",
  "creativite",
  "incertitude",
  "systematicite",
  "transferabilite",
] as const;
export type FrascatiCriterion = (typeof FRASCATI_CRITERIA)[number];

export interface FrascatiCriterionInfo {
  key: FrascatiCriterion;
  label: string;
  exigence: string;
  question: string;
  preuves: string;
  signalIneligibilite: string;
}

export const FRASCATI: Record<FrascatiCriterion, FrascatiCriterionInfo> = {
  nouveaute: {
    key: "nouveaute",
    label: "Nouveauté",
    exigence:
      "Viser des résultats nouveaux ou améliorer significativement les connaissances existantes.",
    question:
      "Quelle connaissance n'existait pas avant vos travaux, au regard de l'état de l'art daté du début des travaux ?",
    preuves: "État de l'art et bibliographie antérieure au début des travaux.",
    signalIneligibilite:
      "Nouveau seulement pour l'entreprise ou son marché : produit inédit sans connaissance nouvelle.",
  },
  creativite: {
    key: "creativite",
    label: "Créativité",
    exigence: "Reposer sur des notions, hypothèses ou approches originales et non évidentes.",
    question:
      "Quelle hypothèse ou approche originale testez-vous, et pourquoi n'est-elle pas évidente pour un spécialiste ?",
    preuves: "Hypothèses des sujets de recherche et des fiches.",
    signalIneligibilite: "Application d'une méthode connue, assemblage de briques existantes.",
  },
  incertitude: {
    key: "incertitude",
    label: "Incertitude",
    exigence:
      "Comporter des incertitudes scientifiques ou techniques sur les résultats ou la méthode.",
    question: "Qu'est-ce qu'un spécialiste du domaine ne savait pas prédire au démarrage ?",
    preuves: "Verrous (pourquoi l'état de l'art ne suffit pas) et fiches en échec.",
    signalIneligibilite: "Incertitude seulement de délai, de coût ou de marché.",
  },
  systematicite: {
    key: "systematicite",
    label: "Systématicité",
    exigence: "Être mené de manière planifiée, structurée, avec des résultats consignés.",
    question: "Comment les travaux ont-ils été planifiés, menés et consignés ?",
    preuves: "Chaîne verrou → sujet → fiches datées → temps ; frise par verrou.",
    signalIneligibilite:
      "Pas de fiches, temps non rattachés, travaux reconstitués a posteriori.",
  },
  transferabilite: {
    key: "transferabilite",
    label: "Transférabilité / reproductibilité",
    exigence:
      "Permettre le transfert des connaissances acquises ou leur reproduction par d'autres.",
    question:
      "Sous quelle forme les connaissances acquises peuvent-elles être transférées ou reproduites ?",
    preuves: "Conclusions des fiches, indicateurs (publications, brevets, logiciels).",
    signalIneligibilite: "Savoir-faire non documenté, résultats non consignés.",
  },
};

export const FRASCATI_MIN_ARGUMENT_LENGTH = 200;

export const SELF_ASSESSMENTS = ["rempli", "incertain", "non_rempli"] as const;
export type SelfAssessment = (typeof SELF_ASSESSMENTS)[number];
export const SELF_ASSESSMENT_LABELS: Record<SelfAssessment, string> = {
  rempli: "Rempli",
  incertain: "Incertain",
  non_rempli: "Non rempli",
};

export const VERDICTS = ["eligible_cir", "piste_cii", "non_eligible"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_LABELS: Record<Verdict, string> = {
  eligible_cir: "Éligible CIR",
  piste_cii: "Piste CII",
  non_eligible: "Non éligible",
};

/* ------------------------------------------------------------------ */
/* Plan MESR                                                           */
/* ------------------------------------------------------------------ */

export const RUBRIQUES = [
  "p1_activite",
  "p1_organisation",
  "p1_selection",
  "fiche_resume",
  "a_contexte",
  "b_etat_art",
  "c_verrous",
  "d_demarche",
  "e_travaux",
  "f_contribution",
] as const;
export type Rubrique = (typeof RUBRIQUES)[number];

export type RubriquePartie = "societe" | "operation";
export type RubriquePortee = "commune" | "par_annee";

export interface RubriqueInfo {
  key: Rubrique;
  partie: RubriquePartie;
  numero: string;
  label: string;
  attendu: string;
  portee: RubriquePortee;
  /** Limite indicative en pages (null = pas de limite propre). */
  limitePages: number | null;
  /** Groupe partageant une limite commune (b+c+d, e+f). */
  groupeLimite?: "bcd" | "ef";
  /** Rubrique datée au début des travaux (versionnée par exercice). */
  dateeDebutTravaux?: boolean;
  alimentation: string;
}

export const MESR_PLAN: Record<Rubrique, RubriqueInfo> = {
  p1_activite: {
    key: "p1_activite",
    partie: "societe",
    numero: "1.1",
    label: "Activité et stratégie R&D",
    attendu:
      "Activité de la société, atouts et indicateurs de sa capacité à mener de la R&D (qualification du personnel, investissements, projets collaboratifs) ; mise en contexte des travaux.",
    portee: "commune",
    limitePages: 2,
    alimentation: "Section rédigée",
  },
  p1_organisation: {
    key: "p1_organisation",
    partie: "societe",
    numero: "1.2",
    label: "Organisation et effectifs",
    attendu:
      "Organisation de la R&D, organigrammes de la société et de l'équipe R&D, ratio effectif R&D / effectif total.",
    portee: "par_annee",
    limitePages: null,
    alimentation: "Section + organigrammes + ratio calculé",
  },
  p1_selection: {
    key: "p1_selection",
    partie: "societe",
    numero: "1.3",
    label: "Sélection des opérations déclarées",
    attendu: "Critères appliqués par la société pour sélectionner les opérations déclarées au CIR.",
    portee: "par_annee",
    limitePages: 1,
    alimentation: "Section rédigée",
  },
  fiche_resume: {
    key: "fiche_resume",
    partie: "operation",
    numero: "2.0",
    label: "Fiche descriptive : résumé scientifique",
    attendu:
      "Résumé d'une page : contexte au regard de l'état de l'art, objectif (verrou), démarche scientifique, résultat (nouveauté), conclusion (transférabilité).",
    portee: "par_annee",
    limitePages: 1,
    alimentation: "Section rédigée + intitulé, dates et volume horaire calculés",
  },
  a_contexte: {
    key: "a_contexte",
    partie: "operation",
    numero: "a",
    label: "Contexte et objectifs",
    attendu: "Contexte général de l'opération, objectifs scientifiques ou techniques.",
    portee: "commune",
    limitePages: null,
    alimentation: "Section + fiche projet",
  },
  b_etat_art: {
    key: "b_etat_art",
    partie: "operation",
    numero: "b",
    label: "État de l'art",
    attendu:
      "Analyse critique des connaissances accessibles au début des travaux, avec bibliographie datée.",
    portee: "commune",
    limitePages: 3,
    groupeLimite: "bcd",
    dateeDebutTravaux: true,
    alimentation: "Section + bibliographie",
  },
  c_verrous: {
    key: "c_verrous",
    partie: "operation",
    numero: "c",
    label: "Verrous et incertitudes",
    attendu:
      "Pourquoi l'état de l'art ne permettait pas de résoudre le problème ; nécessité d'engager une opération de R&D.",
    portee: "commune",
    limitePages: 3,
    groupeLimite: "bcd",
    dateeDebutTravaux: true,
    alimentation: "Section + verrous",
  },
  d_demarche: {
    key: "d_demarche",
    partie: "operation",
    numero: "d",
    label: "Démarche expérimentale",
    attendu: "Hypothèses, modèles, prototypes, essais, échecs et itérations.",
    portee: "par_annee",
    limitePages: 3,
    groupeLimite: "bcd",
    alimentation: "Section + sujets, fiches et frise",
  },
  e_travaux: {
    key: "e_travaux",
    partie: "operation",
    numero: "e",
    label: "Travaux réalisés et résultats",
    attendu:
      "Travaux menés sur l'exercice et résultats obtenus, y compris lorsque le verrou n'est pas levé.",
    portee: "par_annee",
    limitePages: 3,
    groupeLimite: "ef",
    alimentation: "Section + fiches",
  },
  f_contribution: {
    key: "f_contribution",
    partie: "operation",
    numero: "f",
    label: "Contribution scientifique et indicateurs",
    attendu:
      "Connaissances nouvelles acquises, savoir et savoir-faire créés, transférabilité ; indicateurs (publications, brevets, logiciels, collaborations publiques).",
    portee: "par_annee",
    limitePages: 3,
    groupeLimite: "ef",
    alimentation: "Section + références",
  },
};

export const RUBRIQUES_SOCIETE = RUBRIQUES.filter((r) => MESR_PLAN[r].partie === "societe");
export const RUBRIQUES_OPERATION = RUBRIQUES.filter((r) => MESR_PLAN[r].partie === "operation");
/** Rubriques reprises (et marquées « à actualiser ») lors de la duplication d'un exercice. */
export const RUBRIQUES_DATEES = RUBRIQUES.filter((r) => MESR_PLAN[r].dateeDebutTravaux);

export const CHARS_PER_PAGE = 3000;
export const MAX_PAGES_FICHE_SCIENTIFIQUE = 10;
export const GROUP_LIMITS: Record<"bcd" | "ef", number> = { bcd: 3, ef: 3 };
