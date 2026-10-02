import { formatDate, formatHours, formatMonth, monthlyCapacity, type CapacityParams, type TimeGranularity } from "@cir/shared";

export interface CapEntry {
  id?: string;
  personId: string;
  date: string;
  granularity: TimeGranularity;
  hours: number;
}

export interface CapViolation {
  kind: "capacity_day" | "capacity_month" | "capacity_year";
  personId: string;
  period: string;
  hours: number;
  capacity: number;
  message: string;
}

const EPS = 1e-6;

/** Contrôle bloquant : temps R&D ≤ temps de travail (jour, mois en jours ouvrés, plafond annuel de l'exercice). */
export function capacityViolations(entries: CapEntry[], params: CapacityParams): CapViolation[] {
  const byPerson = new Map<string, CapEntry[]>();
  for (const e of entries) byPerson.set(e.personId, [...(byPerson.get(e.personId) ?? []), e]);
  const out: CapViolation[] = [];
  for (const [personId, list] of byPerson) {
    const days = new Map<string, number>();
    const months = new Map<string, number>();
    let total = 0;
    for (const e of list) {
      total += e.hours;
      const month = e.date.slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + e.hours);
      if (e.granularity === "day") days.set(e.date, (days.get(e.date) ?? 0) + e.hours);
    }
    for (const [date, hours] of days) {
      if (hours > params.hoursPerDay + EPS)
        out.push({ kind: "capacity_day", personId, period: date, hours, capacity: params.hoursPerDay, message: `${formatHours(hours)} le ${formatDate(date)} (capacité ${formatHours(params.hoursPerDay)})` });
    }
    for (const [month, hours] of months) {
      const cap = monthlyCapacity(`${month}-01`, params);
      if (hours > cap + EPS)
        out.push({ kind: "capacity_month", personId, period: month, hours, capacity: cap, message: `${formatHours(hours)} en ${formatMonth(`${month}-01`)} (capacité ${formatHours(cap)})` });
    }
    if (total > params.annualHoursCap + EPS)
      out.push({ kind: "capacity_year", personId, period: "exercice", hours: total, capacity: params.annualHoursCap, message: `${formatHours(total)} sur l'exercice (plafond ${formatHours(params.annualHoursCap)})` });
  }
  return out;
}

/** Violations concernant une écriture donnée (même jour, même mois, ou plafond annuel). */
export function violationsFor(entry: CapEntry, all: CapViolation[]): CapViolation[] {
  return all.filter(
    (v) =>
      v.personId === entry.personId &&
      ((v.kind === "capacity_day" && entry.granularity === "day" && v.period === entry.date) ||
        (v.kind === "capacity_month" && v.period === entry.date.slice(0, 7)) ||
        v.kind === "capacity_year"),
  );
}
