import { CHARS_PER_PAGE, FRASCATI_CRITERIA, FRASCATI_MIN_ARGUMENT_LENGTH, type FrascatiCriterion, type SelfAssessment, type Verdict } from "./referentiels";

/* ---------------------------- SIREN ---------------------------- */

/** Contrôle de clé de Luhn d'un SIREN (9 chiffres). */
export function isValidSiren(value: string): boolean {
  const siren = value.replace(/\s/g, "");
  if (!/^\d{9}$/.test(siren)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let digit = Number(siren[8 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/* ---------------------------- Dates ---------------------------- */
/* Les dates métier sont manipulées en chaînes ISO « AAAA-MM-JJ » (pas de fuseau). */

export function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

export function toIsoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function firstDayOfMonth(iso: string): string {
  const { y, m } = parseIsoDate(iso);
  return toIsoDate(y, m, 1);
}

export function lastDayOfMonth(iso: string): string {
  const { y, m } = parseIsoDate(iso);
  return toIsoDate(y, m, daysInMonth(y, m));
}

export function addDays(iso: string, n: number): string {
  const { y, m, d } = parseIsoDate(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(fromIso: string, toIso: string): number {
  const a = parseIsoDate(fromIso);
  const b = parseIsoDate(toIso);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** 0 = dimanche … 6 = samedi */
export function weekday(iso: string): number {
  const { y, m, d } = parseIsoDate(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Date du dimanche de Pâques (algorithme de Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIsoDate(year, month, day);
}

/** Jours fériés de France métropolitaine. */
export function frenchHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  return new Set([
    toIsoDate(year, 1, 1),
    addDays(easter, 1), // lundi de Pâques
    toIsoDate(year, 5, 1),
    toIsoDate(year, 5, 8),
    addDays(easter, 39), // Ascension
    addDays(easter, 50), // lundi de Pentecôte
    toIsoDate(year, 7, 14),
    toIsoDate(year, 8, 15),
    toIsoDate(year, 11, 1),
    toIsoDate(year, 11, 11),
    toIsoDate(year, 12, 25),
  ]);
}

/** Nombre de jours ouvrés (lundi-vendredi, hors jours fériés) d'un mois. */
export function workingDaysInMonth(isoAnyDayOfMonth: string): number {
  const { y, m } = parseIsoDate(isoAnyDayOfMonth);
  const holidays = frenchHolidays(y);
  let count = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const iso = toIsoDate(y, m, d);
    const wd = weekday(iso);
    if (wd !== 0 && wd !== 6 && !holidays.has(iso)) count++;
  }
  return count;
}

/** Arrondi au quart d'heure (pas de saisie de 0,25 h). */
export function roundQuarter(hours: number): number {
  return Math.round(hours * 4) / 4;
}

/* --------------------------- Capacité --------------------------- */

export interface CapacityParams {
  hoursPerDay: number;
  annualHoursCap: number;
}

export function monthlyCapacity(isoAnyDayOfMonth: string, p: CapacityParams): number {
  return workingDaysInMonth(isoAnyDayOfMonth) * p.hoursPerDay;
}

/* --------------------------- Frascati --------------------------- */

export interface FrascatiAnswerLike {
  criterion: FrascatiCriterion;
  argument: string;
  selfAssessment: SelfAssessment;
}

export function frascatiComplete(answers: FrascatiAnswerLike[]): boolean {
  return FRASCATI_CRITERIA.every((c) => {
    const a = answers.find((x) => x.criterion === c);
    return !!a && a.argument.trim().length >= FRASCATI_MIN_ARGUMENT_LENGTH;
  });
}

/** Renvoie un message d'erreur si le verdict est incompatible avec les réponses, sinon null. */
export function checkVerdict(verdict: Verdict, answers: FrascatiAnswerLike[]): string | null {
  if (!frascatiComplete(answers)) {
    return "Les 5 critères de Frascati doivent être argumentés avant de rendre un verdict.";
  }
  if (verdict === "eligible_cir" && answers.some((a) => a.selfAssessment === "non_rempli")) {
    return "Un projet dont un critère est « non rempli » ne peut pas être déclaré éligible au CIR.";
  }
  return null;
}

/* --------------------------- Rédaction -------------------------- */

export function estimatePages(chars: number): number {
  return Math.round((chars / CHARS_PER_PAGE) * 10) / 10;
}

export function formatNoteRef(refNo: number): string {
  return `F-${String(refNo).padStart(4, "0")}`;
}

export function parseNoteRef(value: string): number | null {
  const m = /^\s*F-?(\d{1,6})\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

export function lockCode(n: number): string {
  return `V${n}`;
}

export function topicCode(lockNumber: number, topicNumber: number): string {
  return `S${lockNumber}.${topicNumber}`;
}

/** Une fiche saisie plus de 7 jours après sa date est signalée « saisie tardive ». */
export const LATE_ENTRY_DAYS = 7;
