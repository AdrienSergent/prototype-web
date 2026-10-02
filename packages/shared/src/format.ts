/** Formats français : dates JJ/MM/AAAA, décimales à virgule, fuseau Europe/Paris. */

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function formatMonth(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m] = iso.slice(0, 10).split("-");
  return `${m}/${y}`;
}

export function formatDateTime(ts: string | Date | null | undefined): string {
  if (!ts) return "—";
  const date = typeof ts === "string" ? new Date(ts) : ts;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(date);
}

export function formatNumber(n: number | null | undefined, maxDigits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: maxDigits }).format(n);
}

export function formatHours(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${formatNumber(n)} h`;
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return "—";
  return `${formatNumber(ratio * 100, 0)} %`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${formatNumber(n / 1024, 0)} Ko`;
  return `${formatNumber(n / 1024 / 1024, 1)} Mo`;
}

/** Date du jour à Paris, en ISO AAAA-MM-JJ. */
export function todayParis(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // fr-CA → AAAA-MM-JJ
}

/** Parse « JJ/MM/AAAA », « MM/AAAA », « AAAA-MM-JJ » ou « AAAA-MM ». */
export function parseFrenchDate(value: string): { iso: string; granularity: "day" | "month" } | null {
  const v = value.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return validDay(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return validDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return validMonth(Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})$/.exec(v);
  if (m) return validMonth(Number(m[1]), Number(m[2]));
  return null;
}

function validDay(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { iso: dt.toISOString().slice(0, 10), granularity: "day" as const };
}

function validMonth(y: number, mo: number) {
  if (mo < 1 || mo > 12 || y < 1900) return null;
  return { iso: `${y}-${String(mo).padStart(2, "0")}-01`, granularity: "month" as const };
}

/** Parse un nombre « 7,5 » ou « 7.5 ». */
export function parseFrenchNumber(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
