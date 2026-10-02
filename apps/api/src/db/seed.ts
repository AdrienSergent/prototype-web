/**
 * Jeu de démonstration (développement uniquement), créé via l'API pour respecter toutes les règles métier.
 * Reprend l'exemple de fiche fourni : projet « Rapprochement automatique factures / commandes »,
 * verrou V2, sujet S2.1, fiche du 14/03/2026.
 *
 * Comptes créés (mot de passe commun : demo-cir-2026!) :
 *   ceo@demo-cir.fr (administrateur), cto@demo-cir.fr (rédacteur),
 *   marie@demo-cir.fr et karim@demo-cir.fr (contributeurs), expert@cabinet-demo.fr (expert invité)
 */
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../app";
import { config, isProd } from "../config";
import { db, pool, schema } from "./client";

if (isProd) {
  console.error("Le jeu de démonstration est interdit en production.");
  process.exit(1);
}

const PASSWORD = "demo-cir-2026!";
const app = createApp();

function agent() {
  const a = request.agent(app);
  let csrf = "";
  const call = async (method: "get" | "post" | "put" | "patch", url: string, body?: object) => {
    const req = a[method](`/api/v1${url}`).set("x-csrf-token", csrf);
    const res = method === "get" ? await req : await req.send(body ?? {});
    if (res.status >= 400) throw new Error(`${method.toUpperCase()} ${url} → ${res.status} ${JSON.stringify(res.body)}`);
    if (res.body?.csrfToken) csrf = res.body.csrfToken;
    return res.body;
  };
  return {
    raw: a,
    get: (u: string) => call("get", u),
    post: (u: string, b?: object) => call("post", u, b),
    put: (u: string, b?: object) => call("put", u, b),
    patch: (u: string, b?: object) => call("patch", u, b),
    async refreshCsrf() {
      const me = await call("get", "/auth/me");
      csrf = me.csrfToken;
    },
    async upload(fields: Record<string, string>, filename: string, content: Buffer, contentType: string) {
      let r = a.post("/api/v1/files").set("x-csrf-token", csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      const res = await r.attach("file", content, { filename, contentType });
      if (res.status >= 400) throw new Error(`upload ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    },
  };
}

function minimalPdf(title: string) {
  const text = title.replace(/[()\\]/g, " ");
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

const doc = (...paragraphs: (string | { text: string; href: string })[][]) => ({
  type: "doc",
  content: paragraphs.map((parts) => ({
    type: "paragraph",
    content: parts.map((p) => (typeof p === "string" ? { type: "text", text: p } : { type: "text", text: p.text, marks: [{ type: "link", attrs: { href: p.href } }] })),
  })),
});

async function main() {
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, "ceo@demo-cir.fr"));
  if (existing) {
    console.log("Jeu de démonstration déjà présent.");
    return;
  }
  if (config.MFA_ENFORCED) console.warn("MFA_ENFORCED=true : l'administrateur devra activer la MFA à la première connexion.");

  const ceo = agent();
  await ceo.post("/auth/signup", { fullName: "Claire Martin", email: "ceo@demo-cir.fr", password: PASSWORD, company: { siren: "552100554", name: "Factura Labs" } });
  await ceo.refreshCsrf();
  await ceo.put("/company", {
    name: "Factura Labs",
    nafCode: "62.01Z",
    sector: "Édition de logiciels de gestion",
    headcountTotal: 14,
    headcountRd: 5,
    rdOrganization: "Une équipe data de 5 personnes rattachée au CTO, en lien avec le laboratoire LIS (Aix-Marseille Université).",
    hoursPerDay: 7,
    annualHoursCap: 1607,
    unlinkedThreshold: 20,
    referentName: "Claire Martin",
    referentRole: "Présidente",
    referentPhone: "04 91 00 00 00",
    referentEmail: "ceo@demo-cir.fr",
  });
  await ceo.post("/company/rescrits", { type: "rescrit_jei", decisionDate: "2024-03-12", decision: "favorable", years: "2024, 2025, 2026" });
  const fy = await ceo.post("/fiscal-years", { label: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });

  const users: Record<string, ReturnType<typeof agent>> = {};
  for (const [email, role, name] of [
    ["cto@demo-cir.fr", "redacteur", "Julien Roux"],
    ["marie@demo-cir.fr", "contributeur", "Marie Dupont"],
    ["karim@demo-cir.fr", "contributeur", "Karim Benali"],
    ["expert@cabinet-demo.fr", "expert", "Hélène Garnier"],
  ] as const) {
    const inv = await ceo.post("/invitations", { email, role, accessExpiresAt: role === "expert" ? "2027-06-30" : null });
    const token = String(inv.devLink).split("/").pop()!;
    const u = agent();
    await u.post("/auth/invitations/accept", { token, fullName: name, password: PASSWORD });
    await u.refreshCsrf();
    users[email] = u;
  }
  const cto = users["cto@demo-cir.fr"]!;
  const marie = users["marie@demo-cir.fr"]!;
  const karim = users["karim@demo-cir.fr"]!;

  const people: Record<string, string> = {};
  for (const p of [
    { key: "julien", firstName: "Julien", lastName: "Roux", email: "cto@demo-cir.fr", jobTitle: "CTO", degree: "Diplôme d'ingénieur, informatique", degreeInstitution: "INSA Lyon", degreeDate: "2012-06-30", status: "chercheur", entryDate: "2019-09-01" },
    { key: "marie", firstName: "Marie", lastName: "Dupont", email: "marie@demo-cir.fr", jobTitle: "Data scientist", degree: "Doctorat en informatique", degreeInstitution: "Aix-Marseille Université", degreeDate: "2023-11-20", status: "jeune_docteur", thesisDate: "2023-11-20", cdiDate: "2024-01-08", entryDate: "2024-01-08" },
    { key: "karim", firstName: "Karim", lastName: "Benali", email: "karim@demo-cir.fr", jobTitle: "Ingénieur données", degree: "Master data science", degreeInstitution: "EFREI", degreeDate: "2021-09-15", status: "technicien", entryDate: "2022-02-01" },
  ]) {
    const { key, ...body } = p;
    const r = await cto.post("/people", { ...body, isSupportFunction: false });
    people[key] = r.id;
    await cto.upload({ kind: "person_cv", ownerId: r.id }, `cv-${key}.pdf`, minimalPdf(`CV ${p.firstName} ${p.lastName}`), "application/pdf");
    await cto.upload({ kind: "person_diploma", ownerId: r.id }, `diplome-${key}.pdf`, minimalPdf(`Diplome ${p.firstName} ${p.lastName}`), "application/pdf");
  }
  await ceo.put(`/people/${people.marie}/salary`, { monthlyGrossSalary: 4300 });

  const project = await cto.post("/projects", {
    fiscalYearId: fy.id,
    code: "RAPPRO",
    title: "Rapprochement automatique factures / commandes",
    startDate: "2026-01-12",
    objectives: "Rapprocher automatiquement les lignes de factures fournisseurs et de commandes malgré des libellés abrégés, multilingues (FR/DE) et non normalisés, avec une précision supérieure à 90 %.",
    keywords: ["rapprochement flou", "embeddings multilingues", "abréviations métier"],
  });
  await cto.put(`/projects/${project.id}/assignments`, {
    assignments: [
      { personId: people.julien, operationFunction: "chef_de_projet", contribution: "Définition des verrous, conception du protocole d'évaluation, revue de l'état de l'art." },
      { personId: people.marie, operationFunction: "chercheur", contribution: "Conception et évaluation des approches par embeddings et fine-tuning." },
      { personId: people.karim, operationFunction: "technicien_rd", contribution: "Constitution et annotation des jeux de paires, outillage d'évaluation." },
    ],
  });
  await cto.post(`/projects/${project.id}/operations`, { title: "Rapprochement flou de libellés fournisseurs multilingues", type: "rd", startDate: "2026-01-12", endDate: null });
  await cto.post(`/projects/${project.id}/operations`, { title: "Intégration du moteur dans l'ERP client", type: "exclu", startDate: "2026-09-01", endDate: null });

  const arg = (s: string) => `${s} Les éléments datés (état de l'art au 12/01/2026, verrous V1 et V2, fiches de recherche) étayent cette réponse et sont consultables dans le dossier.`;
  await cto.put(`/projects/${project.id}/frascati`, {
    answers: [
      { criterion: "nouveaute", argument: arg("Aucune méthode publiée ne dépasse 80 % de précision sur des libellés fournisseurs abrégés et multilingues ; le projet vise une connaissance nouvelle sur la représentation de ces abréviations."), selfAssessment: "rempli" },
      { criterion: "creativite", argument: arg("L'approche combine embeddings multilingues, fine-tuning sur paires internes et apprentissage d'un dictionnaire d'abréviations, une combinaison non évidente pour un spécialiste du domaine."), selfAssessment: "rempli" },
      { criterion: "incertitude", argument: arg("Au démarrage, nul ne pouvait prédire si un modèle pré-entraîné capterait des abréviations métier absentes de son vocabulaire, ni quel volume de paires annotées serait nécessaire."), selfAssessment: "rempli" },
      { criterion: "systematicite", argument: arg("Les travaux suivent un protocole planifié : jeu de test de référence, hypothèses testées une à une, résultats consignés quotidiennement dans des fiches de recherche datées."), selfAssessment: "rempli" },
      { criterion: "transferabilite", argument: arg("Les jeux d'évaluation, le protocole et les conclusions sont documentés et reproductibles ; la méthode est transférable à d'autres documents commerciaux multilingues."), selfAssessment: "rempli" },
    ],
  });
  const expert = users["expert@cabinet-demo.fr"]!;
  await expert.post(`/projects/${project.id}/verdict`, { verdict: "eligible_cir", justification: "Verrou scientifique caractérisé par rapport à un état de l'art daté ; démarche expérimentale systématique et documentée.", expertName: "Hélène Garnier", verdictDate: "2026-02-02" });

  const v1 = await cto.post(`/projects/${project.id}/locks`, {
    statement: "Les libellés fournisseurs ne suivent aucune normalisation : unités, références et désignations varient d'un document à l'autre.",
    sotaGap: "Les approches de normalisation par règles supposent un référentiel stable, inexistant ici ; aucune méthode publiée ne traite des désignations libres de faible longueur.",
    identifiedOn: "2026-01-12",
    outcome: "partiel",
  });
  const v2 = await cto.post(`/projects/${project.id}/locks`, {
    statement: "Les méthodes de rapprochement existantes (règles, distance de Levenshtein) échouent quand les libellés fournisseurs sont abrégés ou multilingues.",
    sotaGap: "Aucune méthode publiée ne dépasse 80 % de précision sur ce type de données.",
    identifiedOn: "2026-01-20",
    outcome: "en_cours",
  });
  const s11 = await cto.post(`/locks/${v1.id}/topics`, { title: "Normalisation apprise des désignations", hypothesis: "Un modèle séquence-à-séquence léger peut normaliser les désignations sans référentiel.", approach: "Entraînement sur 3 000 couples bruts / normalisés", ownerPersonId: people.karim });
  const s21 = await cto.post(`/locks/${v2.id}/topics`, { title: "Embeddings de libellés pour le rapprochement flou", hypothesis: "Un modèle d'embeddings multilingue pré-entraîné, sans ré-entraînement, suffit à rapprocher des libellés abrégés FR/DE.", approach: "Similarité cosinus entre embeddings de libellés", ownerPersonId: people.marie });
  const s22 = await cto.post(`/locks/${v2.id}/topics`, { title: "Dictionnaire d'abréviations appris", hypothesis: "Un dictionnaire d'abréviations appris à partir des paires validées corrige les erreurs résiduelles.", approach: "Extraction d'alignements et apprentissage de règles", ownerPersonId: people.marie });

  const note = (author: ReturnType<typeof agent>, body: object) => author.post("/notes", body);
  await note(karim, { topicId: s11.id, noteDate: "2026-02-10", authorPersonId: people.karim, hypothesis: s11.hypothesis, workDone: "Constitution de 3 000 couples bruts / normalisés à partir des factures 2024. Entraînement d'un modèle T5-small.", result: "Exactitude de 62 % sur le jeu de test ; erreurs concentrées sur les unités composées.", resultKind: "echec_partiel", conclusion: "Normalisation insuffisante seule ; utile en prétraitement.", nextStep: "Ajouter des règles d'unités et réévaluer.", links: [], times: [{ personId: people.karim, hours: 7 }] });
  await note(marie, { topicId: s21.id, noteDate: "2026-03-14", authorPersonId: people.marie, hypothesis: s21.hypothesis, workDone: "Constitution d'un jeu de test de 1 200 paires annotées (FR/DE). Calcul des similarités cosinus avec deux modèles d'embeddings. Comparaison avec la méthode actuelle (Levenshtein).", result: "Précision de 71 % (Levenshtein : 64 %). Les erreurs viennent à 80 % des abréviations métier (« Dbl-Schr. » pour « Doppelschraube »), absentes du vocabulaire du modèle.", resultKind: "echec_partiel", conclusion: "L'hypothèse est invalidée : le modèle seul ne lève pas le verrou.", nextStep: "Tester un ré-entraînement léger (fine-tuning) sur 5 000 paires internes, et en parallèle un dictionnaire d'abréviations appris.", links: [{ url: "https://git.factura-labs.example/data/rappro/pull/142", label: "PR #142" }], times: [{ personId: people.marie, hours: 6 }, { personId: people.karim, hours: 1.5 }] });
  await note(marie, { topicId: s21.id, noteDate: "2026-04-08", authorPersonId: people.marie, hypothesis: "Un fine-tuning léger sur 5 000 paires internes suffit à capter les abréviations métier.", workDone: "Fine-tuning contrastif sur 5 000 paires, validation croisée en 5 plis.", result: "Précision de 84 %, mais chute à 69 % sur les fournisseurs absents de l'entraînement.", resultKind: "echec_partiel", conclusion: "Gain réel mais généralisation insuffisante.", nextStep: "Combiner avec le dictionnaire d'abréviations (S2.2).", links: [], times: [{ personId: people.marie, hours: 7 }] });
  await note(marie, { topicId: s22.id, noteDate: "2026-05-19", authorPersonId: people.marie, hypothesis: s22.hypothesis, workDone: "Extraction de 1 840 alignements abréviation / forme longue à partir des paires validées ; application avant encodage.", result: "Précision de 91 % sur le jeu de test, 88 % sur les fournisseurs inconnus.", resultKind: "succes", conclusion: "La combinaison dictionnaire + embeddings dépasse l'état de l'art publié sur ce type de données.", nextStep: "Mesurer la robustesse sur les factures italiennes.", links: [], times: [{ personId: people.marie, hours: 6.5 }, { personId: people.karim, hours: 2 }] });

  // Temps mensuels complémentaires via l'import (comme un export d'outil de temps)
  const csv = [
    "Personne;Code projet;Date;Heures;Fiche",
    "cto@demo-cir.fr;RAPPRO;01/2026;35;",
    "cto@demo-cir.fr;RAPPRO;02/2026;28;",
    "Marie Dupont;RAPPRO;02/2026;60;",
    "Karim Benali;RAPPRO;03/2026;40;",
    "Marie Dupont;RAPPRO;06/2026;70;",
  ].join("\n");
  const imp = await (async () => {
    const token = (await cto.get("/auth/me")).csrfToken;
    const res = await cto.raw.post("/api/v1/imports").set("x-csrf-token", token).field("fiscalYearId", fy.id).attach("file", Buffer.from(csv), { filename: "export-temps.csv", contentType: "text/csv" });
    if (res.status >= 400) throw new Error(JSON.stringify(res.body));
    return res.body;
  })();
  await cto.post(`/imports/${imp.id}/mapping`, { mapping: imp.mapping, unit: "hours" });
  await cto.post(`/imports/${imp.id}/commit`, { duplicates: "skip" });

  const r1 = await cto.post("/references", { refType: "article", title: "Approximate string matching for product catalogues", authors: "Navarro G., Raffinot M.", publishedOn: "2019-04-02", doi: "10.1000/demo.2019.17" });
  const r2 = await cto.post("/references", { refType: "article", title: "Multilingual sentence embeddings for entity matching", authors: "Reimers N., Gurevych I.", publishedOn: "2020-11-16", url: "https://arxiv.org/abs/2004.09813" });
  const r3 = await cto.post("/references", { refType: "article", title: "Abbreviation expansion in industrial documents", authors: "Schmidt K.", publishedOn: "2026-03-02" });

  const dossier = await cto.get(`/dossier/${fy.id}`);
  const sectionId = (rubrique: string) => dossier.projects[0].sections.find((s: { rubrique: string }) => s.rubrique === rubrique).id as string;
  const partOne = (rubrique: string) => dossier.partOne.find((s: { rubrique: string }) => s.rubrique === rubrique).id as string;
  const notes = await cto.get(`/notes?projectId=${project.id}`);
  const note14 = notes.find((n: { noteDate: string }) => n.noteDate === "2026-03-14");
  const contents: [string, object][] = [
    [partOne("p1_activite"), doc(["Factura Labs édite un logiciel de traitement automatique des factures fournisseurs pour les PME industrielles. La R&D porte sur la compréhension automatique de documents commerciaux hétérogènes."])],
    [sectionId("b_etat_art"), doc(
      ["Au début des travaux (janvier 2026), le rapprochement de libellés repose sur la distance d'édition ", { text: "(Navarro 2019)", href: `cir://ref/${r1.id}` }, " et, plus récemment, sur des embeddings de phrases multilingues ", { text: "(Reimers 2020)", href: `cir://ref/${r2.id}` }, "."],
      ["Une publication de mars 2026 sur l'expansion d'abréviations ", { text: "(Schmidt 2026)", href: `cir://ref/${r3.id}` }, " est postérieure au début des travaux : elle ne peut pas fonder l'état de l'art."],
    )],
    [sectionId("c_verrous"), doc(["V2 : les méthodes existantes échouent sur des libellés abrégés ou multilingues ; aucune ne dépasse 80 % de précision sur ce type de données."])],
    [sectionId("d_demarche"), doc(["L'hypothèse d'un modèle d'embeddings sans ré-entraînement a été invalidée le 14/03/2026 ", { text: "(F-0002)", href: `cir://note/${note14.id}` }, " : 71 % de précision. Le fine-tuning a ensuite été testé, puis combiné à un dictionnaire d'abréviations appris."])],
  ];
  for (const [id, content] of contents) {
    const s = await cto.get(`/sections/${id}`);
    await cto.put(`/sections/${id}`, { content, baseVersion: s.version, checkpoint: true });
  }
  await expert.post(`/sections/${sectionId("b_etat_art")}/comments`, { body: "La référence Schmidt 2026 est postérieure au début des travaux : à retirer de l'état de l'art ou à déplacer en contribution.", anchorText: "Une publication de mars 2026" });

  console.log(`Jeu de démonstration créé. Connexion : ceo@demo-cir.fr / ${PASSWORD} (aussi cto@, marie@, karim@demo-cir.fr et expert@cabinet-demo.fr).`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
