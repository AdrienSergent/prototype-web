import type { DossierData } from "./dto";
import { OPERATION_FUNCTION_LABELS, OPERATION_TYPE_LABELS, FISCAL_YEAR_STATUS_LABELS, LOCK_OUTCOME_LABELS, NOTE_RESULT_LABELS, REFERENCE_TYPE_LABELS, RESCRIT_TYPE_LABELS } from "./enums";
import { formatDate, formatDateTime, formatHours, formatNumber } from "./format";
import { MESR_PLAN, RUBRIQUES_OPERATION, RUBRIQUES_SOCIETE, VERDICT_LABELS } from "./referentiels";
import { escapeHtml as e, toHtml, type CitationLabels } from "./richtext";

const STYLE = `
:root{--ink:#1c2430;--muted:#5b6675;--line:#d9dee5;--accent:#1f5f8b;--bg:#fff}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);margin:0;line-height:1.55;font-size:14px}
main{max-width:860px;margin:0 auto;padding:40px 24px 80px}
h1{font-size:26px;margin:0 0 4px}
h2{font-size:20px;margin:40px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--ink)}
h3{font-size:16px;margin:28px 0 8px;color:var(--accent)}
h4,h5,h6{font-size:14px;margin:18px 0 6px}
p{margin:0 0 10px}
.meta{color:var(--muted);font-size:13px}
table{border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:13px}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f3f5f8;font-weight:600}
.empty{color:#a33;font-style:italic}
.cite sup{color:var(--accent);font-weight:600}
.badge{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 8px;font-size:12px;color:var(--muted)}
.project{page-break-before:always}
.note{border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin:10px 0;page-break-inside:avoid}
.note dl{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;margin:0}
.note dt{color:var(--muted)}
.note dd{margin:0;white-space:pre-wrap}
.validated{color:#2f6b3a;font-size:12px}
footer{margin-top:48px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:12px}
@media print{main{padding:0}h2{break-after:avoid}}
`;

function section(title: string, numero: string, contentHtml: string, validated: { by: string | null; at: string | null }) {
  const body = contentHtml.trim() ? contentHtml : `<p class="empty">Rubrique non renseignée.</p>`;
  const val = validated.by ? `<div class="validated">Validée par ${e(validated.by)} le ${e(formatDateTime(validated.at))}</div>` : "";
  return `<h3>${e(numero)}. ${e(title)}</h3>${val}${body}`;
}

/** Rendu HTML autonome du dossier consolidé (vue écran et archive scellée). */
export function renderDossierHtml(d: DossierData): string {
  const refLabels = new Map(d.references.map((r) => [r.id, r.label]));
  const noteLabels = new Map(d.notes.map((n) => [n.id, n.ref]));
  const labels: CitationLabels = { ref: (id) => refLabels.get(id), note: (id) => noteLabels.get(id) };
  const out: string[] = [];

  out.push(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`);
  out.push(`<title>Dossier CIR ${e(d.fiscalYear.label)} — ${e(d.company.name)}</title><style>${STYLE}</style></head><body><main>`);
  out.push(`<h1>Dossier justificatif CIR — exercice ${e(d.fiscalYear.label)}</h1>`);
  out.push(
    `<p class="meta">${e(d.company.name)} · SIREN ${e(d.company.siren)} · du ${formatDate(d.fiscalYear.startDate)} au ${formatDate(d.fiscalYear.endDate)} · statut : ${e(FISCAL_YEAR_STATUS_LABELS[d.fiscalYear.status])}${
      d.fiscalYear.expertValidationName ? ` · validé par ${e(d.fiscalYear.expertValidationName)} le ${e(formatDateTime(d.fiscalYear.expertValidatedAt))}` : ""
    }</p>`,
  );

  /* Partie 1 */
  out.push(`<h2>1. Présentation de la société et de sa stratégie de R&amp;D</h2>`);
  for (const r of RUBRIQUES_SOCIETE) {
    const s = d.partOne.find((x) => x.rubrique === r);
    out.push(section(MESR_PLAN[r].label, MESR_PLAN[r].numero, toHtml(s?.content, labels), { by: s?.validatedByName ?? null, at: s?.validatedAt ?? null }));
    if (r === "p1_organisation") {
      const ratio = d.company.headcountTotal && d.company.headcountRd !== null ? `${formatNumber(((d.company.headcountRd ?? 0) / d.company.headcountTotal) * 100, 1)} %` : "—";
      out.push(
        `<table><tr><th>Effectif total</th><th>Effectif R&amp;D</th><th>Ratio R&amp;D / total</th></tr><tr><td>${e(d.company.headcountTotal ?? "—")}</td><td>${e(d.company.headcountRd ?? "—")}</td><td>${ratio}</td></tr></table>`,
      );
    }
  }
  out.push(`<h3>1.4 Rescrits et agréments</h3>`);
  if (d.company.rescrits.length === 0) out.push(`<p class="meta">Aucun rescrit ni agrément déclaré.</p>`);
  else {
    out.push(`<table><tr><th>Type</th><th>Date de l'avis</th><th>Décision</th><th>Année(s)</th></tr>`);
    for (const r of d.company.rescrits) {
      out.push(`<tr><td>${e(RESCRIT_TYPE_LABELS[r.type])}</td><td>${formatDate(r.decisionDate)}</td><td>${e(r.decision)}</td><td>${e(r.years)}</td></tr>`);
    }
    out.push(`</table>`);
  }
  const ref = d.company.referent;
  out.push(
    `<h3>1.5 Référent du dossier</h3><table><tr><th>Nom</th><th>Fonction</th><th>Téléphone</th><th>Email</th></tr><tr><td>${e(ref.name ?? "—")}</td><td>${e(ref.role ?? "—")}</td><td>${e(ref.phone ?? "—")}</td><td>${e(ref.email ?? "—")}</td></tr></table>`,
  );

  /* Partie 2 */
  out.push(`<h2>2. Travaux déclarés au CIR</h2>`);
  if (d.projects.length === 0) out.push(`<p class="empty">Aucun projet éligible.</p>`);
  d.projects.forEach((p, idx) => {
    out.push(`<div class="project"><h2>2.${idx + 1} ${e(p.code)} — ${e(p.title)}</h2>`);
    out.push(`<table><tr><th>Intitulé</th><td>${e(p.title)}</td></tr>`);
    out.push(`<tr><th>Début des travaux</th><td>${formatDate(p.startDate)}${p.endDate ? ` — fin : ${formatDate(p.endDate)}` : ""}</td></tr>`);
    out.push(`<tr><th>Volume horaire déclaré (exercice)</th><td>${formatHours(p.hours)}</td></tr>`);
    out.push(`<tr><th>Verdict Frascati</th><td>${p.verdict ? e(VERDICT_LABELS[p.verdict]) : "—"}</td></tr>`);
    if (p.operations.length) {
      out.push(
        `<tr><th>Opérations</th><td>${p.operations
          .map((o) => `${e(o.title)} <span class="badge">${e(OPERATION_TYPE_LABELS[o.type])}</span>${o.startDate ? ` ${formatDate(o.startDate)} → ${formatDate(o.endDate)}` : ""}`)
          .join("<br>")}</td></tr>`,
      );
    }
    out.push(`</table>`);
    for (const r of RUBRIQUES_OPERATION) {
      const s = p.sections.find((x) => x.rubrique === r);
      out.push(section(MESR_PLAN[r].label, MESR_PLAN[r].numero, toHtml(s?.content, labels), { by: s?.validatedByName ?? null, at: s?.validatedAt ?? null }));
      if (r === "c_verrous" && p.locks.length) {
        out.push(`<table><tr><th>Verrou</th><th>Énoncé</th><th>Issue</th></tr>`);
        p.locks.forEach((l) => out.push(`<tr><td>${e(l.code)}</td><td>${e(l.statement)}</td><td>${e(LOCK_OUTCOME_LABELS[l.outcome])}</td></tr>`));
        out.push(`</table>`);
      }
    }
    out.push(`<h3>g. Moyens : personnel</h3>`);
    out.push(`<table><tr><th>Nom Prénom</th><th>Diplôme le plus élevé</th><th>Fonction dans l'opération</th><th>Contribution directe</th><th>Temps déclaré</th></tr>`);
    p.personnel.forEach((m) =>
      out.push(
        `<tr><td>${e(m.name)}</td><td>${e([m.degree, m.degreeInstitution].filter(Boolean).join(" — ") || "—")}</td><td>${m.operationFunction ? e(OPERATION_FUNCTION_LABELS[m.operationFunction]) : "—"}</td><td>${e(m.contribution || "—")}</td><td>${formatHours(m.hours)}</td></tr>`,
      ),
    );
    out.push(`</table><p class="meta">Travaux externalisés : saisis à partir de la V1.</p></div>`);
  });

  /* Bibliographie */
  out.push(`<h2>Bibliographie</h2>`);
  if (!d.references.length) out.push(`<p class="meta">Aucune référence.</p>`);
  else {
    out.push(`<table><tr><th>Réf.</th><th>Type</th><th>Référence</th><th>Publication</th></tr>`);
    d.references.forEach((r) => {
      const id = [r.doi && `DOI ${e(r.doi)}`, r.patentNumber && `Brevet ${e(r.patentNumber)}`, r.url && e(r.url)].filter(Boolean).join(" · ");
      out.push(`<tr><td>${e(r.label)}</td><td>${e(REFERENCE_TYPE_LABELS[r.refType])}</td><td>${e(r.authors)}${r.authors ? ". " : ""}<em>${e(r.title)}</em>${id ? `<br><span class="meta">${id}</span>` : ""}</td><td>${formatDate(r.publishedOn)}</td></tr>`);
    });
    out.push(`</table>`);
  }

  /* Annexes */
  out.push(`<h2>3. Annexes</h2>`);
  out.push(`<h3>Fiches de recherche (justificatifs de temps)</h3>`);
  if (!d.notes.length) out.push(`<p class="meta">Aucune fiche.</p>`);
  d.notes.forEach((n) => {
    out.push(
      `<div class="note"><strong>${e(n.ref)}</strong> · ${e(n.projectCode)} / ${e(n.lockCode)} / ${e(n.topicCode)} · fiche du ${formatDate(n.date)} · ${e(n.authorName)} · ${formatHours(n.hours)} <span class="badge">${e(NOTE_RESULT_LABELS[n.resultKind])}</span><dl>` +
        `<dt>Hypothèse testée</dt><dd>${e(n.hypothesis)}</dd><dt>Travaux menés</dt><dd>${e(n.workDone)}</dd><dt>Résultat</dt><dd>${e(n.result)}</dd>` +
        `<dt>Conclusion</dt><dd>${e(n.conclusion || "—")}</dd><dt>Prochaine étape</dt><dd>${e(n.nextStep || "—")}</dd><dt>Saisie le</dt><dd>${e(formatDateTime(n.enteredAt))}</dd></dl></div>`,
    );
  });
  out.push(`<h3>Pièces annexées</h3>`);
  if (!d.annexes.length) out.push(`<p class="meta">Aucune pièce.</p>`);
  else {
    out.push(`<table><tr><th>N°</th><th>Pièce</th><th>Fichier</th><th>Empreinte SHA-256</th></tr>`);
    d.annexes.forEach((a) => out.push(`<tr><td>${e(a.number)}</td><td>${e(a.label)}</td><td>${e(a.filename)}</td><td style="font-family:monospace;font-size:11px;word-break:break-all">${e(a.sha256)}</td></tr>`));
    out.push(`</table>`);
  }
  out.push(`<footer>Généré le ${e(formatDateTime(d.generatedAt))}. Plan conforme au dossier justificatif générique du MESR.</footer>`);
  out.push(`</main></body></html>`);
  return out.join("\n");
}
