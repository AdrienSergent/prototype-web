import { MFA_REQUIRED_ROLES, todayParis, type Role } from "@cir/shared";
import { and, eq, sql } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config, isProd } from "../config";
import { db, schema, withTenant, type Tx } from "../db/client";
import { forbidden, HttpError, unauthorized } from "../lib/errors";
import { hashToken, randomToken, safeEqual } from "../lib/crypto";

export const SESSION_COOKIE = "cir_sid";
const ABSOLUTE_TTL_DAYS = 7;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: ABSOLUTE_TTL_DAYS * 86_400_000,
  };
}

/** Crée une session serveur et pose le cookie httpOnly. */
export async function createSession(
  res: Response,
  req: Request,
  userId: string,
  opts: { mfaVerified: boolean; activeCompanyId: string | null },
) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  await db.insert(schema.sessions).values({
    tokenHash: hashToken(token),
    userId,
    mfaVerified: opts.mfaVerified,
    activeCompanyId: opts.activeCompanyId,
    csrfToken,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + ABSOLUTE_TTL_DAYS * 86_400_000),
  });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  return { csrfToken };
}

/** Charge la session depuis le cookie (sans l'exiger). */
export const loadSession: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== "string") return next();
  const rows = await db
    .select({ s: schema.sessions, u: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.tokenHash, hashToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return next();
  const now = Date.now();
  const idleLimit = row.s.lastSeenAt.getTime() + config.SESSION_IDLE_HOURS * 3_600_000;
  if (row.s.expiresAt.getTime() < now || idleLimit < now) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, row.s.id));
    return next();
  }
  if (now - row.s.lastSeenAt.getTime() > 60_000) {
    await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, row.s.id));
  }
  req.auth = {
    sessionId: row.s.id,
    userId: row.u.id,
    email: row.u.email,
    fullName: row.u.fullName,
    mfaEnabled: row.u.mfaEnabled,
    mfaVerified: row.s.mfaVerified,
    activeCompanyId: row.s.activeCompanyId,
    csrfToken: row.s.csrfToken,
  };
  next();
};

/** Protection CSRF : jeton de session exigé dans l'en-tête X-CSRF-Token pour toute requête qui modifie. */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.auth) return next();
  const header = req.get("x-csrf-token") ?? "";
  if (!safeEqual(header, req.auth.csrfToken)) return next(new HttpError(403, "csrf", "Jeton CSRF invalide"));
  next();
};

/** Session authentifiée ; si la MFA est activée, elle doit avoir été vérifiée. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  if (req.auth.mfaEnabled && !req.auth.mfaVerified) return next(new HttpError(401, "mfa_pending", "Code MFA requis"));
  next();
};

/** Société active + adhésion valide + MFA obligatoire pour administrateur et expert. */
export const requireCompany: RequestHandler = async (req, _res, next) => {
  const auth = req.auth!;
  if (!auth.activeCompanyId) return next(new HttpError(409, "no_company", "Aucune société active"));
  const membership = await withTenant({ companyId: auth.activeCompanyId, userId: auth.userId }, (tx) =>
    tx
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.companyId, auth.activeCompanyId!), eq(schema.memberships.userId, auth.userId)))
      .limit(1),
  );
  const m = membership[0];
  if (!m) return next(forbidden("Vous n'êtes pas membre de cette société"));
  if (m.accessExpiresAt && m.accessExpiresAt < todayParis()) return next(forbidden("Votre accès invité a expiré", "access_expired"));
  const role = m.role as Role;
  if (config.MFA_ENFORCED && MFA_REQUIRED_ROLES.includes(role) && !auth.mfaEnabled) {
    return next(forbidden("La double authentification est obligatoire pour votre rôle", "mfa_required"));
  }
  req.company = { companyId: m.companyId, role, accessExpiresAt: m.accessExpiresAt };
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.company || !roles.includes(req.company.role)) return next(forbidden());
    next();
  };
}

/** Transaction dans le contexte société de la requête (RLS). */
export function run<T>(req: Request, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant({ companyId: req.company!.companyId, userId: req.auth!.userId, ip: req.ip ?? null }, fn);
}

export function hasRole(req: Request, ...roles: Role[]) {
  return !!req.company && roles.includes(req.company.role);
}

export const noop = (_req: Request, _res: Response, next: NextFunction) => next();

/** Utilitaire SQL : somme numérique sûre. */
export const sumNum = (col: unknown) => sql<number>`coalesce(sum(${col}), 0)::float`;
