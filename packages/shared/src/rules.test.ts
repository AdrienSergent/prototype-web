import { describe, expect, it } from "vitest";
import { checkVerdict, easterSunday, frenchHolidays, isValidSiren, workingDaysInMonth, parseNoteRef, formatNoteRef } from "./rules";
import { parseFrenchDate, parseFrenchNumber } from "./format";
import { extractCitations, toHtml, toPlainText } from "./richtext";

describe("SIREN", () => {
  it("valide la clé de Luhn", () => {
    expect(isValidSiren("732829320")).toBe(true);
    expect(isValidSiren("732 829 320")).toBe(true);
    expect(isValidSiren("732829321")).toBe(false);
    expect(isValidSiren("12345")).toBe(false);
  });
});

describe("calendrier", () => {
  it("calcule Pâques et les jours fériés", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    const h = frenchHolidays(2026);
    expect(h.has("2026-04-06")).toBe(true); // lundi de Pâques
    expect(h.has("2026-05-14")).toBe(true); // Ascension
    expect(h.has("2026-05-25")).toBe(true); // Pentecôte
  });
  it("compte les jours ouvrés", () => {
    // mars 2026 : 22 jours de semaine, aucun férié
    expect(workingDaysInMonth("2026-03-14")).toBe(22);
    // mai 2026 : 21 jours de semaine − 1er mai, 8 mai, Ascension, Pentecôte = 17
    expect(workingDaysInMonth("2026-05-01")).toBe(17);
  });
});

describe("Frascati", () => {
  const arg = "x".repeat(220);
  const all = (sa: "rempli" | "non_rempli") =>
    (["nouveaute", "creativite", "incertitude", "systematicite", "transferabilite"] as const).map((criterion) => ({ criterion, argument: arg, selfAssessment: sa }));
  it("refuse un verdict éligible si un critère n'est pas rempli", () => {
    const answers = all("rempli");
    answers[2]!.selfAssessment = "non_rempli" as never;
    expect(checkVerdict("eligible_cir", answers)).toMatch(/non rempli/);
    expect(checkVerdict("non_eligible", answers)).toBeNull();
  });
  it("exige les 5 critères argumentés", () => {
    expect(checkVerdict("eligible_cir", all("rempli").slice(0, 4))).toMatch(/5 critères/);
    expect(checkVerdict("eligible_cir", all("rempli"))).toBeNull();
  });
});

describe("formats", () => {
  it("parse les dates françaises", () => {
    expect(parseFrenchDate("14/03/2026")).toEqual({ iso: "2026-03-14", granularity: "day" });
    expect(parseFrenchDate("03/2026")).toEqual({ iso: "2026-03-01", granularity: "month" });
    expect(parseFrenchDate("31/02/2026")).toBeNull();
    expect(parseFrenchNumber("1,5")).toBe(1.5);
  });
  it("formate les références de fiches", () => {
    expect(formatNoteRef(42)).toBe("F-0042");
    expect(parseNoteRef("f-0042")).toBe(42);
  });
});

describe("richtext", () => {
  const id = "0190f3a0-0000-7000-8000-000000000001";
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Voir " }, { type: "text", text: "Dupont 2021", marks: [{ type: "link", attrs: { href: `cir://ref/${id}` } }] }] },
      { type: "paragraph", content: [{ type: "text", text: "<script>" }] },
    ],
  };
  it("extrait les citations", () => {
    expect(extractCitations(doc).refIds).toEqual([id]);
  });
  it("échappe le HTML", () => {
    const html = toHtml(doc, { ref: () => "R1", note: () => undefined });
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("[R1]");
    expect(toPlainText(doc)).toContain("Dupont 2021");
  });
});
