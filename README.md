# Dossier CIR — V0

Outil SaaS de constitution du dossier technique du Crédit d'Impôt Recherche, en saisie manuelle (V0 du cahier des charges).
Il structure la chaîne **projet → verrou → sujet de recherche → fiche de recherche quotidienne → temps**, qualifie chaque projet sur les 5 critères de Frascati avant rédaction, impose le plan du dossier justificatif du MESR et scelle l'exercice (archive ZIP + empreintes SHA-256).

| Couche | Choix |
| --- | --- |
| Front | React 19, TypeScript strict, Vite 7, Tailwind CSS 4, React Router 7, TanStack Query 5, React Hook Form + Zod, TipTap 3 |
| Back | Node.js 22, Express 5, TypeScript, Zod, Drizzle ORM, PostgreSQL 16 (row-level security), pg-boss |
| Partagé | `packages/shared` : référentiels Frascati et plan MESR, schémas Zod, règles métier, rendu du dossier consolidé |
| Tests | Vitest + Supertest (API sur vraie base PostgreSQL), Playwright (parcours navigateur, dont mobile) |

## Démarrage rapide

Prérequis : Node 22, npm 10, Docker (ou un PostgreSQL 16 local).

```bash
npm install
docker compose up -d postgres            # crée cir_owner, cir_app (sans BYPASSRLS) et la base cir_test
cp apps/api/.env.example apps/api/.env   # en local, MFA_ENFORCED=false évite l'enrôlement MFA des comptes de démo
npm run db:migrate                       # schéma, RLS, triggers d'audit, files pg-boss
npm run db:seed                          # jeu de démonstration (facultatif)
npm run dev                              # API sur :3000, front sur http://localhost:5173
```

Comptes de démonstration (mot de passe `demo-cir-2026!`) :

| Compte | Rôle |
| --- | --- |
| ceo@demo-cir.fr | Administrateur |
| cto@demo-cir.fr | Rédacteur |
| marie@demo-cir.fr, karim@demo-cir.fr | Contributeurs |
| expert@cabinet-demo.fr | Expert invité |

Le jeu reprend l'exemple de fiche fourni : projet « Rapprochement automatique factures / commandes », verrou V2, sujet S2.1, fiche du 14/03/2026 (6 h + 1,5 h).

## Commandes

| Commande | Effet |
| --- | --- |
| `npm run dev` | API (tsx watch) et front (Vite) |
| `npm run typecheck` | TypeScript sur les 3 paquets |
| `npm test` | Tests unitaires + API + isolation RLS + audit (base `cir_test` recréée à chaque exécution) |
| `npm run test:e2e` | Playwright sur l'application démarrée et le jeu de démo (`PW_CHROMIUM` pour un Chromium déjà installé) |
| `npm run build` | Front compilé (`apps/web/dist`) + API bundlée (`apps/api/dist`) |
| `npm run db:reset` | Réinitialise la base de développement (interdit en production) |
| `docker compose --profile prod up --build` | Image de production (API servant le front) |

## Architecture

```text
cir-dossier/
├─ apps/
│  ├─ api/                 Express 5
│  │  ├─ drizzle/          0000_init.sql (tables) · 0001_security.sql (RLS, audit, fonctions SECURITY DEFINER, droits)
│  │  └─ src/
│  │     ├─ db/            schéma Drizzle, client (withTenant → SET LOCAL), migrate, seed, reset
│  │     ├─ middlewares/   session, CSRF, société active, rôles
│  │     ├─ modules/       auth, companies, groups, fiscal-years, members, people, files, time (+ imports),
│  │     │                 projects, research (verrous, sujets, fiches), dossier (sections, check-list,
│  │     │                 vue consolidée), archives (scellement), audit, billing, dashboard
│  │     ├─ jobs/          pg-boss : scellement, rappels quotidiens
│  │     └─ test/          scénario de recette, isolation multi-tenant
│  └─ web/                 React + Tailwind (src/features/* : un dossier par module)
├─ packages/shared/        référentiels, schémas Zod, règles, DTO, rendu HTML du dossier
├─ e2e/                    Playwright
└─ infra/postgres/         rôles de développement
```

### Isolation multi-tenant

- L'API se connecte avec `cir_app`, rôle **sans `BYPASSRLS`**. Chaque requête ouvre une transaction et pose `app.company_id`, `app.user_id`, `app.ip` (`SET LOCAL`).
- Toute table portant `company_id` a une politique `tenant_isolation` (`USING` + `WITH CHECK`). Un test échoue si une table en est dépourvue.
- Les seules lectures transverses passent par des fonctions `SECURITY DEFINER` : mes adhésions, invitation par jeton, vue groupe (statut et avancement uniquement), webhook Stripe.

### Journal d'audit

Triggers PostgreSQL sur les tables métier : chaque création, modification ou suppression est écrite dans `audit_log` avec l'auteur, l'avant/après et une empreinte SHA-256 chaînée à l'entrée précédente de la société. Le rôle applicatif n'a aucun droit d'écriture sur la table, et un trigger refuse `UPDATE`, `DELETE` et `TRUNCATE`, même au propriétaire. `GET /api/v1/audit/verify` recalcule toute la chaîne.

### Sécurité

Sessions serveur (cookie httpOnly, SameSite=Lax, expiration après 12 h d'inactivité), jeton CSRF en en-tête, argon2id, verrouillage après 5 échecs, MFA TOTP obligatoire pour administrateur et expert (codes de secours), SSO Google/Microsoft (OpenID Connect, PKCE), Helmet + CSP, limitation de débit, validation Zod de toute entrée, contrôle du type réel des fichiers, antivirus ClamAV optionnel, salaires chiffrés en AES-256-GCM au niveau du champ.

### Scellement

`POST /fiscal-years/:id/transition {action: "seal"}` (administrateur, exercice validé par l'expert) met en file un travail pg-boss qui produit un ZIP : `dossier.html` (vue consolidée), `dossier.json`, `temps.json`, `annexes/` (CV, diplômes, fiches de poste, organigrammes, pièces des fiches) et `manifest.json` (SHA-256 de chaque fichier). L'empreinte globale est enregistrée et l'archive est stockée en mode non modifiable (S3 Object Lock en production). L'exercice passe en lecture seule.

## Correspondance avec le cahier des charges

| Exigence | Implémentation |
| --- | --- |
| F1.1–F1.5 Société, partie 1 MESR, exercices, cycle de vie | `modules/companies`, `modules/fiscal-years` · écrans Administration |
| F1.2 Groupe | `modules/groups`, `app_group_overview()` · rattachement par code saisi par l'administrateur de la filiale |
| F1.3 Duplication d'exercice | `POST /fiscal-years/:id/duplicate` : sections datées et verrous « à actualiser », intitulés d'opération verrouillés, verdict à reconfirmer |
| F1.4 Rôles | matrice dans `middlewares/auth.ts` + contrôles par module ; `usePermissions()` côté front |
| F2.1–F2.3 Équipe, CV, affectations | `modules/people`, `modules/files` (versions, SHA-256) |
| F3.1–F3.4 Temps, import, rattachement, alertes | `modules/time` (capacité jour / mois en jours ouvrés hors fériés / année), assistant d'import tout-ou-rien |
| F4.1–F4.4 Projets, Frascati, verdict, opérations | `modules/projects`, `checkVerdict()` partagé |
| F5.1–F5.6 Verrous versionnés, sujets, fiches, frise | `modules/research`, `features/projects/Timeline.tsx` |
| F6.1–F6.5 Éditeur MESR, bibliographie datée, commentaires, versions, check-list, scellement | `modules/dossier`, `modules/archives`, `features/dossier` |
| Exigences non fonctionnelles | RLS, audit, MFA/SSO, CSRF, chiffrement de champ, Stripe (lecture seule après 14 jours de grâce), RGAA (libellés, focus, contrastes) |

Référentiels Frascati et plan MESR : `packages/shared/src/referentiels.ts`. Ils sont à valider par un docteur et un cabinet partenaire (`REFERENTIEL_META.validation`), puis à vérifier contre le guide du CIR du millésime en cours.

## Choix et limites de la V0

- **Verdict lors d'une duplication** : remis à zéro, l'expert le reconfirme pour le nouvel exercice ; les réponses Frascati sont reprises.
- **Sections** : rattachées au projet (comme la spécification) avec une opération optionnelle ; à confirmer avec le cabinet (le MESR raisonne par opération).
- **Nomenclature scientifique** : hors périmètre ; le projet porte des mots-clés libres.
- **Export Word/PDF** : V1. En V0, la vue consolidée s'imprime en PDF depuis le navigateur et figure dans l'archive scellée.
- **SSO Microsoft** : renseigner l'identifiant du tenant (`MICROSOFT_TENANT`) ; le mode multi-tenant `common` demande une validation d'émetteur spécifique.
- **Réinitialisation du mot de passe par email** : non incluse (changement de mot de passe depuis le profil uniquement).
- **Durée de conservation des archives** : `ARCHIVE_RETENTION_YEARS` (6 par défaut), à valider avec un fiscaliste.

## Mise en production (France)

1. PostgreSQL 16 managé (Scaleway ou OVHcloud, région Paris). Le DBA crée `cir_owner` (migrations) et `cir_app LOGIN NOBYPASSRLS`.
2. Deux buckets S3 chiffrés, dont un avec Object Lock pour les archives (`S3_ARCHIVE_BUCKET`).
3. Variables : `APP_ENCRYPTION_KEY` (`openssl rand -base64 32`, conservée dans le gestionnaire de secrets), `MFA_ENFORCED=true`, Brevo, Stripe, SSO.
4. Image Docker : migrations au démarrage, puis API (`RUN_WORKERS_IN_API=false` et un second conteneur `node dist/worker.js` pour les tâches de fond).
5. Webhook Stripe : `POST /api/v1/billing/webhook` (événements `customer.subscription.*`).
