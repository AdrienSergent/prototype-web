/**
 * Recette V0 (cahier des charges §8.3) : scénario de bout en bout.
 */
import { authenticator } from "otplib";
import { beforeAll, describe, expect, it } from "vitest";
import { client, enableMfa, lastMailLink, longText, signup, type Client } from "./helpers";

const FRASCATI = ["nouveaute", "creativite", "incertitude", "systematicite", "transferabilite"] as const;

let admin: Client;
let redacteur: Client;
let contributeur: Client;
let expert: Client;
let fyId: string;
let projectId: string;
let lockId: string;
let topicId: string;
let noteId: string;
const people: Record<string, string> = {};

async function invite(email: string, role: string): Promise<Client> {
  const r = await admin.post("/invitations", { email, role, accessExpiresAt: role === "expert" ? "2099-12-31" : null });
  expect(r.status).toBe(201);
  const token = lastMailLink(email);
  expect(token).toBeTruthy();
  const c = await client();
  const info = await c.get(`/auth/invitations/${token}`);
  expect(info.body.role).toBe(role);
  const acc = await c.agent.post("/api/v1/auth/invitations/accept").send({ token, fullName: email.split("@")[0], password: "motdepasse-solide-2" });
  expect(acc.status).toBe(200);
  await c.me();
  return c;
}

describe("Scénario de recette V0", () => {
  beforeAll(async () => {
    admin = await signup("ceo@acme.test", "ACME Rapprochement");
  });

  it("impose la MFA à l'administrateur avant tout accès société", async () => {
    const r = await admin.get("/company");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("mfa_required");
    await enableMfa(admin);
    expect((await admin.get("/company")).status).toBe(200);
  });

  it("refuse les écritures sans jeton CSRF", async () => {
    const r = await admin.agent.put("/api/v1/company").send({ name: "x" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("csrf");
  });

  it("paramètre la société et crée l'exercice avec les sections de la partie 1", async () => {
    const r = await admin.put("/company", {
      name: "ACME Rapprochement",
      nafCode: "62.01Z",
      sector: "Logiciel",
      headcountTotal: 12,
      headcountRd: 4,
      rdOrganization: "Équipe data de 4 personnes",
      hoursPerDay: 7,
      annualHoursCap: 1607,
      unlinkedThreshold: 20,
      referentName: "Claire Martin",
      referentRole: "CEO",
      referentPhone: "0600000000",
      referentEmail: "ceo@acme.test",
    });
    expect(r.status).toBe(200);
    const fy = await admin.post("/fiscal-years", { label: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    expect(fy.status).toBe(201);
    fyId = fy.body.id;
    const overlap = await admin.post("/fiscal-years", { label: "bis", startDate: "2026-06-01", endDate: "2027-05-31" });
    expect(overlap.status).toBe(409);
    const dossier = await admin.get(`/dossier/${fyId}`);
    expect(dossier.body.partOne).toHaveLength(3);
  });

  it("invite un rédacteur, deux contributeurs et un expert", async () => {
    redacteur = await invite("cto@acme.test", "redacteur");
    contributeur = await invite("marie@acme.test", "contributeur");
    await invite("karim@acme.test", "contributeur");
    expert = await invite("expert@cabinet.test", "expert");
    expect((await expert.get("/company")).body.code).toBe("mfa_required");
    await enableMfa(expert);
    const members = await admin.get("/members");
    expect(members.body).toHaveLength(5);
    expect((await redacteur.get("/members")).status).toBe(403);
  });

  it("crée l'équipe, chiffre le salaire et le réserve à l'administrateur", async () => {
    const base = { status: "chercheur", degreeDate: "2018-06-30", entryDate: "2020-01-01", isSupportFunction: false };
    for (const [key, p] of Object.entries({
      marie: { firstName: "Marie", lastName: "Dupont", email: "marie@acme.test", degree: "Doctorat en informatique", degreeInstitution: "Aix-Marseille Université" },
      karim: { firstName: "Karim", lastName: "Benali", email: "karim@acme.test", degree: "Master data science", degreeInstitution: "EFREI", status: "technicien" },
      claire: { firstName: "Claire", lastName: "Martin", email: null, degree: "Ingénieur", degreeInstitution: "Centrale" },
    })) {
      const r = await redacteur.post("/people", { ...base, ...p });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      people[key] = r.body.id;
    }
    expect((await admin.put(`/people/${people.marie}/salary`, { monthlyGrossSalary: 4500 })).status).toBe(204);
    expect((await redacteur.put(`/people/${people.marie}/salary`, { monthlyGrossSalary: 1 })).status).toBe(403);
    const adminView = await admin.get("/people");
    expect(adminView.body.find((p: { id: string }) => p.id === people.marie).monthlyGrossSalary).toBe(4500);
    const redView = await redacteur.get("/people");
    expect(redView.body.find((p: { id: string }) => p.id === people.marie).monthlyGrossSalary).toBeUndefined();
    // Le contributeur est lié automatiquement à sa fiche personne
    const mine = await contributeur.get("/people");
    expect(mine.body.map((p: { id: string }) => p.id)).toContain(people.marie);
  });

  it("importe les CV avec empreinte SHA-256 et refuse un type de fichier non autorisé", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    for (const key of ["marie", "karim", "claire"]) {
      const r = await redacteur.agent
        .post("/api/v1/files")
        .set("x-csrf-token", redacteur.csrf)
        .field("kind", "person_cv")
        .field("ownerId", people[key]!)
        .attach("file", pdf, { filename: `cv-${key}.pdf`, contentType: "application/pdf" });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const bad = await redacteur.agent
      .post("/api/v1/files")
      .set("x-csrf-token", redacteur.csrf)
      .field("kind", "person_cv")
      .field("ownerId", people.marie!)
      .attach("file", Buffer.from("MZ\x90\x00binary"), { filename: "cv.exe" });
    expect(bad.status).toBe(422);
  });

  it("crée le projet, l'affectation et qualifie Frascati", async () => {
    const p = await redacteur.post("/projects", {
      fiscalYearId: fyId,
      code: "rappro",
      title: "Rapprochement automatique factures / commandes",
      startDate: "2026-01-15",
      objectives: "Rapprocher automatiquement des libellés fournisseurs abrégés et multilingues.",
      keywords: ["embeddings", "rapprochement flou"],
    });
    expect(p.status).toBe(201);
    expect(p.body.code).toBe("RAPPRO");
    projectId = p.body.id;
    const a = await redacteur.put(`/projects/${projectId}/assignments`, {
      assignments: [
        { personId: people.marie, operationFunction: "chef_de_projet", contribution: "Conception des expériences d'embeddings" },
        { personId: people.karim, operationFunction: "technicien_rd", contribution: "Annotation des paires de test" },
        { personId: people.claire, operationFunction: "chercheur", contribution: "Revue de l'état de l'art" },
      ],
    });
    expect(a.status).toBe(204);
    expect((await redacteur.post(`/projects/${projectId}/operations`, { title: "Rapprochement flou multilingue", type: "rd" })).status).toBe(201);

    // Rédaction impossible tant que Frascati n'est pas complet
    const dossier = await redacteur.get(`/dossier/${fyId}`);
    const sec = dossier.body.projects[0].sections.find((s: { rubrique: string }) => s.rubrique === "a_contexte");
    const early = await redacteur.put(`/sections/${sec.id}`, { content: { type: "doc", content: [] }, baseVersion: 0 });
    expect(early.body.code).toBe("frascati_incomplete");

    const answers = FRASCATI.map((criterion) => ({ criterion, argument: longText(criterion), selfAssessment: criterion === "creativite" ? "non_rempli" : "rempli" }));
    expect((await redacteur.put(`/projects/${projectId}/frascati`, { answers })).status).toBe(204);
    const refused = await expert.post(`/projects/${projectId}/verdict`, { verdict: "eligible_cir", justification: "Ok", expertName: "x", verdictDate: "2026-02-01" });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("verdict_refused");
    answers[1]!.selfAssessment = "rempli";
    await redacteur.put(`/projects/${projectId}/frascati`, { answers });
    expect((await contributeur.post(`/projects/${projectId}/verdict`, { verdict: "eligible_cir", justification: "Ok", expertName: "x", verdictDate: "2026-02-01" })).status).toBe(403);
    const ok = await expert.post(`/projects/${projectId}/verdict`, { verdict: "eligible_cir", justification: "Verrou scientifique réel, démarche systématique.", expertName: "ignoré", verdictDate: "2026-02-01" });
    expect(ok.status).toBe(200);
    expect(ok.body.verdict).toBe("eligible_cir");
    expect(ok.body.verdictExpertName).toBe("expert");
  });

  it("crée le verrou V2 et le sujet S2.1 (versionnés)", async () => {
    const v1 = await redacteur.post(`/projects/${projectId}/locks`, { statement: "Verrou préliminaire", sotaGap: "À préciser", identifiedOn: "2026-01-15" });
    expect(v1.body.code).toBe("V1");
    const v2 = await redacteur.post(`/projects/${projectId}/locks`, {
      statement: "Les méthodes de rapprochement existantes échouent sur des libellés abrégés ou multilingues.",
      sotaGap: "Aucune méthode publiée ne dépasse 80 % de précision sur ce type de données.",
      identifiedOn: "2026-01-20",
    });
    expect(v2.body.code).toBe("V2");
    lockId = v2.body.id;
    const upd = await redacteur.put(`/locks/${lockId}`, { ...v2.body, statement: v2.body.statement + " (précisé)", outcome: "en_cours" });
    expect(upd.body.version).toBe(2);
    expect((await redacteur.get(`/locks/${lockId}/versions`)).body).toHaveLength(2);
    const t = await redacteur.post(`/locks/${lockId}/topics`, {
      title: "Embeddings de libellés pour le rapprochement flou",
      hypothesis: "Un modèle d'embeddings multilingue pré-entraîné suffit.",
      approach: "Similarité cosinus",
      ownerPersonId: people.marie,
    });
    expect(t.body.code).toBe("S2.1");
    topicId = t.body.id;
    // Le verrou V1 a besoin d'un sujet et d'une fiche pour la check-list : on le supprime (pas de sujet)
    expect((await redacteur.del(`/locks/${v1.body.id}`)).status).toBe(204);
  });

  it("saisit la fiche du 14/03/2026 avec 6 h et 1,5 h rattachées, refuse le doublon", async () => {
    const ctx = await contributeur.get(`/notes/quick-context?fiscalYearId=${fyId}`);
    expect(ctx.body.me.id).toBe(people.marie);
    expect(ctx.body.topics[0].code).toBe("S2.1");
    const body = {
      topicId,
      noteDate: "2026-03-14",
      authorPersonId: people.marie,
      hypothesis: "Un modèle d'embeddings multilingue pré-entraîné, sans ré-entraînement, suffit à rapprocher des libellés abrégés FR/DE.",
      workDone: "Jeu de test de 1 200 paires annotées (FR/DE). Similarités cosinus avec deux modèles. Comparaison avec Levenshtein.",
      result: "Précision de 71 % (Levenshtein : 64 %). 80 % des erreurs viennent des abréviations métier.",
      resultKind: "echec_partiel",
      conclusion: "L'hypothèse est invalidée : le modèle seul ne lève pas le verrou.",
      nextStep: "Fine-tuning sur 5 000 paires internes et dictionnaire d'abréviations appris.",
      links: [{ url: "https://git.example.fr/acme/rappro/pull/142", label: "PR #142" }],
      times: [
        { personId: people.marie, hours: 6 },
        { personId: people.karim, hours: 1.5 },
      ],
    };
    const r = await contributeur.post("/notes", body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.ref).toBe("F-0001");
    expect(r.body.totalHours).toBe(7.5);
    noteId = r.body.id;
    const dup = await contributeur.post("/notes", body);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("note_exists");
    // Un contributeur ne rédige pas au nom d'un autre
    expect((await contributeur.post("/notes", { ...body, noteDate: "2026-03-16", authorPersonId: people.karim })).status).toBe(403);
    // Capacité : 6 h + 2 h > 7 h le même jour
    const over = await contributeur.post("/time-entries", { personId: people.marie, projectId, date: "2026-03-14", quantity: 2 });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe("capacity_exceeded");
  });

  it("importe un CSV : une erreur bloque tout, le fichier corrigé passe", async () => {
    const upload = async (csv: string) => {
      const r = await redacteur.agent
        .post("/api/v1/imports")
        .set("x-csrf-token", redacteur.csrf)
        .field("fiscalYearId", fyId)
        .attach("file", Buffer.from(csv), { filename: "temps.csv", contentType: "text/csv" });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body;
    };
    const header = "Personne;Code projet;Date;Heures;Fiche";
    const bad = await upload([header, "marie@acme.test;RAPPRO;02/2026;100;", "Karim Benali;RAPPRO;03/2026;80;", "Inconnu;RAPPRO;04/2026;10;"].join("\n"));
    expect(bad.mapping.person).toBe("Personne");
    const mapped = await redacteur.post(`/imports/${bad.id}/mapping`, { mapping: bad.mapping, unit: "hours" });
    expect(mapped.body.errors).toHaveLength(1);
    expect(mapped.body.errors[0].row).toBe(4);
    const commit = await redacteur.post(`/imports/${bad.id}/commit`, { duplicates: "skip" });
    expect(commit.status).toBe(422);
    const good = await upload([header, "marie@acme.test;RAPPRO;02/2026;100;", "Karim Benali;RAPPRO;03/2026;80;", "Claire Martin;RAPPRO;04/2026;20;"].join("\n"));
    await redacteur.post(`/imports/${good.id}/mapping`, { mapping: good.mapping, unit: "hours" });
    const ok = await redacteur.post(`/imports/${good.id}/commit`, { duplicates: "skip" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.committedRows).toBe(3);
    const alerts = await admin.get(`/time-entries/alerts?fiscalYearId=${fyId}`);
    const stat = alerts.body.unlinked.find((u: { projectId: string }) => u.projectId === projectId);
    expect(stat.totalHours).toBe(207.5);
    expect(stat.unlinkedHours).toBe(200);
  });

  it("rédige, cite une référence postérieure (alerte), commente et valide toutes les rubriques", async () => {
    const ref = await redacteur.post("/references", { refType: "article", title: "Fuzzy matching of supplier labels", authors: "Dupont A.", publishedOn: "2026-02-10" });
    expect(ref.status).toBe(201);
    const oldRef = await redacteur.post("/references", { refType: "article", title: "Levenshtein distance revisited", authors: "Smith B.", publishedOn: "2019-05-01" });
    const dossier = await redacteur.get(`/dossier/${fyId}`);
    const all = [...dossier.body.partOne, ...dossier.body.projects[0].sections];
    for (const s of all) {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: `Contenu de la rubrique ${s.rubrique}. Voir ` },
              ...(s.rubrique === "b_etat_art"
                ? [
                    { type: "text", text: "Dupont 2026", marks: [{ type: "link", attrs: { href: `cir://ref/${ref.body.id}` } }] },
                    { type: "text", text: " et " },
                    { type: "text", text: "Smith 2019", marks: [{ type: "link", attrs: { href: `cir://ref/${oldRef.body.id}` } }] },
                  ]
                : [{ type: "text", text: "la fiche F-0001", marks: [{ type: "link", attrs: { href: `cir://note/${noteId}` } }] }]),
            ],
          },
        ],
      };
      const r = await redacteur.put(`/sections/${s.id}`, { content, baseVersion: s.version });
      expect(r.status, `${s.rubrique} ${JSON.stringify(r.body)}`).toBe(200);
      const conflict = await redacteur.put(`/sections/${s.id}`, { content, baseVersion: s.version });
      expect(conflict.body.code).toBe("version_conflict");
    }
    const checklist = await admin.get(`/fiscal-years/${fyId}/checklist`);
    expect(checklist.body.items.some((i: { rule: string }) => i.rule === "ref_after_start")).toBe(true);
    expect(checklist.body.items.some((i: { rule: string }) => i.rule === "unlinked_time")).toBe(true);

    const sectionA = all.find((s: { rubrique: string }) => s.rubrique === "a_contexte");
    const c = await expert.post(`/sections/${sectionA.id}/comments`, { body: "Préciser le marché visé ?", anchorText: "Contenu" });
    expect(c.status).toBe(201);
    expect((await contributeur.post(`/sections/${sectionA.id}/comments`, { body: "x" })).status).toBe(403);
    expect((await redacteur.patch(`/comments/${c.body.id}`, { resolved: true })).body.resolved).toBe(true);

    expect((await redacteur.post(`/sections/${sectionA.id}/validate`)).status).toBe(403);
    for (const s of all) expect((await admin.post(`/sections/${s.id}/validate`)).status).toBe(200);
  });

  it("atteint 100 % des règles bloquantes, valide (expert) puis scelle l'exercice", async () => {
    const checklist = await admin.get(`/fiscal-years/${fyId}/checklist`);
    const blocking = checklist.body.items.filter((i: { level: string; ok: boolean }) => i.level === "blocking" && !i.ok);
    expect(blocking, JSON.stringify(blocking)).toHaveLength(0);
    expect(checklist.body.progress).toBe(100);

    expect((await expert.post(`/fiscal-years/${fyId}/transition`, { action: "expert_validate" })).body.code).toBe("invalid_transition");
    expect((await admin.post(`/fiscal-years/${fyId}/transition`, { action: "submit_review" })).status).toBe(200);
    expect((await admin.post(`/fiscal-years/${fyId}/transition`, { action: "expert_validate" })).status).toBe(403);
    const v = await expert.post(`/fiscal-years/${fyId}/transition`, { action: "expert_validate", comment: "Dossier conforme" });
    expect(v.status).toBe(200);
    expect(v.body.fiscalYear.status).toBe("expert_validated");

    // Contenus figés après validation
    const frozen = await contributeur.post("/time-entries", { personId: people.marie, projectId, date: "2026-03-17", quantity: 1 });
    expect(frozen.body.code).toBe("fiscal_year_locked");

    const seal = await admin.post(`/fiscal-years/${fyId}/transition`, { action: "seal" });
    expect(seal.status, JSON.stringify(seal.body)).toBe(200);
    const fy = await admin.get(`/fiscal-years/${fyId}`);
    expect(fy.body.status).toBe("sealed");
    const archives = await admin.get(`/fiscal-years/${fyId}/archives`);
    expect(archives.body[0].status).toBe("done");
    expect(archives.body[0].fileCount).toBe(6); // dossier.html, dossier.json, temps.json, 3 CV
    const verify = await expert.get(`/archives/${archives.body[0].id}/verify`);
    expect(verify.body.ok).toBe(true);
    const html = await admin.get(`/fiscal-years/${fyId}/consolidated.html`);
    expect(html.text).toContain("Rapprochement automatique factures");
    expect(html.text).toContain("[R1]");
  });

  it("duplique l'exercice : état de l'art et verrous repris « à actualiser », intitulé d'opération verrouillé", async () => {
    const r = await admin.post(`/fiscal-years/${fyId}/duplicate`, { label: "2027", startDate: "2027-01-01", endDate: "2027-12-31" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const next = r.body.id;
    const projects = await admin.get(`/projects?fiscalYearId=${next}`);
    expect(projects.body).toHaveLength(1);
    expect(projects.body[0].verdict).toBeNull();
    const pid = projects.body[0].id;
    const dossier = await admin.get(`/dossier/${next}`);
    const sections = dossier.body.projects[0].sections;
    expect(sections.find((s: { rubrique: string }) => s.rubrique === "b_etat_art").toUpdate).toBe(true);
    expect(sections.find((s: { rubrique: string }) => s.rubrique === "e_travaux").contentText).toBe("");
    const locks = await admin.get(`/projects/${pid}/locks`);
    expect(locks.body[0].toUpdate).toBe(true);
    const ops = await admin.get(`/projects/${pid}/operations`);
    expect(ops.body[0].titleLocked).toBe(true);
    const rename = await admin.put(`/operations/${ops.body[0].id}`, { title: "Autre intitulé", type: "rd" });
    expect(rename.body.code).toBe("title_locked");
    expect((await admin.get(`/notes?fiscalYearId=${next}`)).body).toHaveLength(0);
  });

  it("trace tout dans un journal d'audit chaîné et vérifiable", async () => {
    const log = await admin.get("/audit?limit=20");
    expect(log.status).toBe(200);
    expect(log.body.length).toBeGreaterThan(5);
    const verify = await admin.get("/audit/verify");
    expect(verify.body.ok).toBe(true);
    expect(verify.body.total).toBeGreaterThan(50);
    expect((await contributeur.get("/audit")).status).toBe(403);
  });

  it("verrouille temporairement un compte après 5 échecs", async () => {
    const c = await client();
    for (let i = 0; i < 5; i++) await c.agent.post("/api/v1/auth/login").send({ email: "cto@acme.test", password: "mauvais-mot-de-passe" });
    const locked = await c.agent.post("/api/v1/auth/login").send({ email: "cto@acme.test", password: "motdepasse-solide-2" });
    expect(locked.status).toBe(423);
  });

  it("exige le code MFA à la connexion de l'administrateur", async () => {
    const c = await client();
    const login = await c.agent.post("/api/v1/auth/login").send({ email: "ceo@acme.test", password: "motdepasse-solide-1" });
    expect(login.body.mfaPending).toBe(true);
    expect((await c.get("/auth/me")).body.code).toBe("mfa_pending");
    const bad = await c.agent.post("/api/v1/auth/mfa/verify").set("x-csrf-token", login.body.csrfToken).send({ code: "000000" });
    expect(bad.status).toBe(401);
    const session = await c.get("/auth/session");
    expect(session.body.mfaPending).toBe(true);
    void authenticator;
  });
});
