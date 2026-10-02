import cookieParser from "cookie-parser";
import express, { Router } from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import { pinoHttp } from "pino-http";
import { config } from "./config";
import { errorHandler, notFound } from "./lib/errors";
import { logger } from "./lib/logger";
import { csrfProtection, loadSession, requireAuth, requireCompany } from "./middlewares/auth";
import { archivesRouter } from "./modules/archives/routes";
import { auditRouter } from "./modules/audit/routes";
import { authRouter } from "./modules/auth/routes";
import { billingRouter, stripeWebhook } from "./modules/billing/routes";
import { requireWritable } from "./modules/billing/service";
import { companiesRouter, companyCreateRouter } from "./modules/companies/routes";
import { dashboardRouter } from "./modules/dashboard/routes";
import { dossierRouter } from "./modules/dossier/routes";
import { filesRouter } from "./modules/files/routes";
import { fiscalYearsRouter } from "./modules/fiscal-years/routes";
import { companyGroupRouter, groupsRouter } from "./modules/groups/routes";
import { membersRouter } from "./modules/members/routes";
import { peopleRouter } from "./modules/people/routes";
import { projectsRouter } from "./modules/projects/routes";
import { researchRouter } from "./modules/research/routes";
import { importsRouter } from "./modules/time/imports";
import { timeRouter } from "./modules/time/routes";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          frameSrc: ["'self'"],
          frameAncestors: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  if (config.NODE_ENV !== "test") app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === "/api/health" },
        serializers: {
          req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      }),
    );

  // Webhook Stripe : corps brut pour la vérification de signature
  app.post("/api/v1/billing/webhook", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhook);
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  const api = Router();
  api.use(loadSession, csrfProtection);
  api.use(authRouter);
  api.use(companyCreateRouter);
  api.use(groupsRouter);
  api.use(billingRouter);

  // Tout ce qui suit s'exécute dans le contexte de la société active (RLS) et respecte l'abonnement.
  const company = Router();
  company.use(requireAuth, requireCompany, requireWritable);
  for (const r of [
    companiesRouter,
    companyGroupRouter,
    fiscalYearsRouter,
    membersRouter,
    peopleRouter,
    filesRouter,
    timeRouter,
    importsRouter,
    projectsRouter,
    researchRouter,
    dossierRouter,
    archivesRouter,
    auditRouter,
    dashboardRouter,
  ]) {
    company.use(r);
  }
  api.use(company);
  app.use("/api/v1", api);
  app.use("/api", (_req, _res, next) => next(notFound("Route inconnue")));

  // En production, l'API peut servir le front compilé (un seul conteneur).
  const webDist = path.resolve(process.cwd(), process.env.WEB_DIST ?? "../web/dist");
  if (config.NODE_ENV === "production" && existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
