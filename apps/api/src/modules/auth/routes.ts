import {
  acceptInvitationSchema,
  loginSchema,
  mfaCodeSchema,
  MFA_REQUIRED_ROLES,
  passwordSchema,
  reminderSchema,
  signupSchema,
} from "@cir/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { generators, Issuer, type Client } from "openid-client";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { z } from "zod";
import { config, isProd } from "../../config";
import { db, schema, withTenant } from "../../db/client";
import { encrypt, hashToken } from "../../lib/crypto";
import { conflict, forbidden, HttpError, notFound, parse, unauthorized } from "../../lib/errors";
import { uuidv7 } from "../../lib/ids";
import { createSession, requireAuth, SESSION_COOKIE, sessionCookieOptions } from "../../middlewares/auth";
import { buildMe, generateRecoveryCodes, hashPassword, myMemberships, verifyMfaCode, verifyPassword } from "./service";
import { param } from "../../lib/http";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.NODE_ENV === "test" ? 10_000 : 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { code: "rate_limited", title: "Trop de tentatives, réessayez plus tard" },
});

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

/* ------------------------------ Inscription ------------------------------ */

authRouter.post("/auth/signup", authLimiter, async (req, res) => {
  const input = parse(signupSchema, req.body);
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, input.email));
  if (existing) throw conflict("Un compte existe déjà avec cet email");
  const userId = uuidv7();
  const companyId = uuidv7();
  await db.insert(schema.users).values({ id: userId, email: input.email, fullName: input.fullName, passwordHash: await hashPassword(input.password) });
  try {
    await withTenant({ companyId, userId, ip: req.ip }, async (tx) => {
      await tx.insert(schema.companies).values({
        id: companyId,
        siren: input.company.siren,
        name: input.company.name,
        createdBy: userId,
        trialEndsAt: new Date(Date.now() + config.TRIAL_DAYS * 86_400_000),
      });
      await tx.insert(schema.memberships).values({ companyId, userId, role: "admin", createdBy: userId });
      await tx.insert(schema.subscriptions).values({ companyId, status: "none" });
    });
  } catch (e) {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
    if (code === "23505") throw conflict("Une société avec ce SIREN est déjà inscrite");
    throw e;
  }
  const { csrfToken } = await createSession(res, req, userId, { mfaVerified: true, activeCompanyId: companyId });
  res.status(201).json({ ok: true, csrfToken });
});

/* -------------------------------- Connexion -------------------------------- */

authRouter.post("/auth/login", authLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, input.email));
  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new HttpError(423, "locked", "Compte temporairement verrouillé après plusieurs échecs. Réessayez dans quelques minutes.");
  }
  const ok = !!user?.passwordHash && (await verifyPassword(user.passwordHash, input.password));
  if (!user || !ok) {
    if (user) {
      const failed = user.failedLogins + 1;
      await db
        .update(schema.users)
        .set({ failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
        .where(eq(schema.users.id, user.id));
    }
    throw unauthorized("Email ou mot de passe incorrect");
  }
  await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, user.id));
  const memberships = await myMemberships(user.id);
  const { csrfToken } = await createSession(res, req, user.id, { mfaVerified: !user.mfaEnabled, activeCompanyId: memberships[0]?.companyId ?? null });
  res.json({ mfaPending: user.mfaEnabled, csrfToken });
});

authRouter.post("/auth/logout", async (req, res) => {
  if (req.auth) await db.delete(schema.sessions).where(eq(schema.sessions.id, req.auth.sessionId));
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  res.status(204).end();
});

/** État de session, sans exiger d'authentification (utile pendant l'étape MFA). */
authRouter.get("/auth/session", (req, res) => {
  res.json({
    authenticated: !!req.auth,
    mfaPending: !!req.auth && req.auth.mfaEnabled && !req.auth.mfaVerified,
    csrfToken: req.auth?.csrfToken ?? null,
    sso: { google: !!config.GOOGLE_CLIENT_ID, microsoft: !!config.MICROSOFT_CLIENT_ID },
  });
});

authRouter.get("/auth/me", requireAuth, async (req, res) => {
  res.json(await buildMe(req));
});

authRouter.post("/auth/switch-company", requireAuth, async (req, res) => {
  const { companyId } = parse(z.object({ companyId: z.uuid() }), req.body);
  const memberships = await myMemberships(req.auth!.userId);
  if (!memberships.some((m) => m.companyId === companyId)) throw forbidden("Vous n'êtes pas membre de cette société");
  await db.update(schema.sessions).set({ activeCompanyId: companyId }).where(eq(schema.sessions.id, req.auth!.sessionId));
  req.auth!.activeCompanyId = companyId;
  res.json(await buildMe(req));
});

authRouter.put("/auth/password", requireAuth, async (req, res) => {
  const input = parse(z.object({ current: z.string(), next: passwordSchema }), req.body);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, req.auth!.userId));
  if (user?.passwordHash && !(await verifyPassword(user.passwordHash, input.current))) throw unauthorized("Mot de passe actuel incorrect");
  await db.update(schema.users).set({ passwordHash: await hashPassword(input.next) }).where(eq(schema.users.id, req.auth!.userId));
  await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, req.auth!.userId), sql`${schema.sessions.id} <> ${req.auth!.sessionId}`));
  res.status(204).end();
});

/* ----------------------------------- MFA ----------------------------------- */

authRouter.post("/auth/mfa/verify", authLimiter, async (req, res) => {
  if (!req.auth) throw unauthorized();
  const { code } = parse(mfaCodeSchema, req.body);
  if (!(await verifyMfaCode(req.auth.userId, code))) throw new HttpError(401, "mfa_invalid", "Code invalide");
  await db.update(schema.sessions).set({ mfaVerified: true }).where(eq(schema.sessions.id, req.auth.sessionId));
  res.json({ ok: true });
});

authRouter.post("/auth/mfa/setup", requireAuth, async (req, res) => {
  if (req.auth!.mfaEnabled) throw conflict("La double authentification est déjà activée");
  const secret = authenticator.generateSecret();
  await db.update(schema.users).set({ mfaSecretEnc: encrypt(secret) }).where(eq(schema.users.id, req.auth!.userId));
  const otpauthUrl = authenticator.keyuri(req.auth!.email, "Dossier CIR", secret);
  res.json({ secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl) });
});

authRouter.post("/auth/mfa/enable", requireAuth, async (req, res) => {
  const { code } = parse(mfaCodeSchema, req.body);
  if (!(await verifyMfaCode(req.auth!.userId, code))) throw new HttpError(401, "mfa_invalid", "Code invalide");
  const recovery = generateRecoveryCodes();
  await db.update(schema.users).set({ mfaEnabled: true, mfaRecoveryHashes: recovery.hashes }).where(eq(schema.users.id, req.auth!.userId));
  await db.update(schema.sessions).set({ mfaVerified: true }).where(eq(schema.sessions.id, req.auth!.sessionId));
  res.json({ recoveryCodes: recovery.plain });
});

authRouter.post("/auth/mfa/disable", requireAuth, async (req, res) => {
  const { code } = parse(mfaCodeSchema, req.body);
  const memberships = await myMemberships(req.auth!.userId);
  if (config.MFA_ENFORCED && memberships.some((m) => MFA_REQUIRED_ROLES.includes(m.role))) {
    throw forbidden("La double authentification est obligatoire pour votre rôle");
  }
  if (!(await verifyMfaCode(req.auth!.userId, code))) throw new HttpError(401, "mfa_invalid", "Code invalide");
  await db.update(schema.users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryHashes: [] }).where(eq(schema.users.id, req.auth!.userId));
  res.status(204).end();
});

/* -------------------------------- Rappels -------------------------------- */

authRouter.get("/auth/reminder", requireAuth, async (req, res) => {
  const [r] = await db.select().from(schema.reminders).where(eq(schema.reminders.userId, req.auth!.userId));
  res.json({ enabled: r?.enabled ?? false, hour: r?.hour ?? 17, weekdays: r?.weekdays ?? [1, 2, 3, 4, 5] });
});

authRouter.put("/auth/reminder", requireAuth, async (req, res) => {
  const input = parse(reminderSchema, req.body);
  await db
    .insert(schema.reminders)
    .values({ userId: req.auth!.userId, ...input })
    .onConflictDoUpdate({ target: schema.reminders.userId, set: input });
  res.json(input);
});

/* ------------------------------- Invitations ------------------------------- */

async function findInvitation(token: string) {
  const r = await withTenant({ companyId: null, userId: null }, (tx) =>
    tx.execute<{
      id: string;
      company_id: string;
      company_name: string;
      email: string;
      role: string;
      expires_at: Date;
      access_expires_at: string | null;
      accepted_at: Date | null;
      revoked_at: Date | null;
    }>(sql`select * from app_find_invitation(${hashToken(token)})`),
  );
  const inv = r.rows[0];
  if (!inv || inv.revoked_at || new Date(inv.expires_at).getTime() < Date.now()) throw notFound("Invitation invalide ou expirée");
  if (inv.accepted_at) throw conflict("Invitation déjà acceptée");
  return inv;
}

authRouter.get("/auth/invitations/:token", async (req, res) => {
  const inv = await findInvitation(param(req, "token"));
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, inv.email));
  res.json({ companyName: inv.company_name, email: inv.email, role: inv.role, userExists: !!user, loggedInAs: req.auth?.email ?? null });
});

authRouter.post("/auth/invitations/accept", authLimiter, async (req, res) => {
  const input = parse(acceptInvitationSchema, req.body);
  const inv = await findInvitation(input.token);
  let userId: string;
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, inv.email));
  if (existing) {
    if (!req.auth || req.auth.userId !== existing.id) throw new HttpError(409, "login_required", "Connectez-vous avec le compte invité pour accepter l'invitation");
    userId = existing.id;
  } else {
    if (!input.password || !input.fullName) throw new HttpError(422, "validation_error", "Nom et mot de passe requis pour créer votre compte");
    userId = uuidv7();
    await db.insert(schema.users).values({ id: userId, email: inv.email, fullName: input.fullName, passwordHash: await hashPassword(input.password) });
  }
  await withTenant({ companyId: inv.company_id, userId, ip: req.ip }, async (tx) => {
    await tx
      .insert(schema.memberships)
      .values({ companyId: inv.company_id, userId, role: inv.role, accessExpiresAt: inv.access_expires_at, createdBy: userId })
      .onConflictDoUpdate({
        target: [schema.memberships.companyId, schema.memberships.userId],
        set: { role: inv.role, accessExpiresAt: inv.access_expires_at },
      });
    await tx.update(schema.invitations).set({ acceptedAt: new Date() }).where(eq(schema.invitations.id, inv.id));
    await tx
      .update(schema.people)
      .set({ userId })
      .where(and(eq(schema.people.companyId, inv.company_id), sql`lower(${schema.people.email}) = ${inv.email}`, isNull(schema.people.userId)));
  });
  if (req.auth?.userId === userId) {
    await db.update(schema.sessions).set({ activeCompanyId: inv.company_id }).where(eq(schema.sessions.id, req.auth.sessionId));
  } else {
    await createSession(res, req, userId, { mfaVerified: true, activeCompanyId: inv.company_id });
  }
  res.json({ ok: true, companyId: inv.company_id });
});

/* ------------------------------ SSO OpenID Connect ------------------------------ */

const providers = {
  google: () =>
    config.GOOGLE_CLIENT_ID
      ? { issuer: "https://accounts.google.com", id: config.GOOGLE_CLIENT_ID, secret: config.GOOGLE_CLIENT_SECRET!, column: schema.users.googleSub, key: "googleSub" as const }
      : null,
  microsoft: () =>
    config.MICROSOFT_CLIENT_ID
      ? {
          issuer: `https://login.microsoftonline.com/${config.MICROSOFT_TENANT}/v2.0`,
          id: config.MICROSOFT_CLIENT_ID,
          secret: config.MICROSOFT_CLIENT_SECRET!,
          column: schema.users.microsoftSub,
          key: "microsoftSub" as const,
        }
      : null,
};
type ProviderName = keyof typeof providers;
const clients = new Map<ProviderName, Client>();

async function oidcClient(name: ProviderName) {
  const p = providers[name]?.();
  if (!p) throw notFound("Fournisseur SSO non configuré");
  let client = clients.get(name);
  if (!client) {
    const issuer = await Issuer.discover(p.issuer);
    client = new issuer.Client({
      client_id: p.id,
      client_secret: p.secret,
      redirect_uris: [`${config.API_URL}/api/v1/auth/oidc/${name}/callback`],
      response_types: ["code"],
    });
    clients.set(name, client);
  }
  return { client, p };
}

const OIDC_COOKIE = "cir_oidc";

authRouter.get("/auth/oidc/:provider", async (req: Request, res: Response) => {
  const name = param(req, "provider") as ProviderName;
  if (!(name in providers)) throw notFound();
  const { client } = await oidcClient(name);
  const state = generators.state();
  const nonce = generators.nonce();
  const verifier = generators.codeVerifier();
  res.cookie(OIDC_COOKIE, Buffer.from(JSON.stringify({ state, nonce, verifier })).toString("base64url"), {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 10 * 60_000,
    path: "/api/v1/auth/oidc",
  });
  res.redirect(
    client.authorizationUrl({ scope: "openid email profile", state, nonce, code_challenge: generators.codeChallenge(verifier), code_challenge_method: "S256" }),
  );
});

authRouter.get("/auth/oidc/:provider/callback", async (req: Request, res: Response) => {
  const name = param(req, "provider") as ProviderName;
  if (!(name in providers)) throw notFound();
  const { client, p } = await oidcClient(name);
  const raw = req.cookies?.[OIDC_COOKIE];
  if (!raw) throw unauthorized("Session SSO expirée");
  const { state, nonce, verifier } = JSON.parse(Buffer.from(raw, "base64url").toString());
  const tokenSet = await client.callback(`${config.API_URL}/api/v1/auth/oidc/${name}/callback`, client.callbackParams(req), { state, nonce, code_verifier: verifier });
  const claims = tokenSet.claims();
  const email = String(claims.email ?? claims.preferred_username ?? "").toLowerCase();
  if (!email || (name === "google" && claims.email_verified === false)) throw unauthorized("Email non vérifié par le fournisseur");
  let [user] = await db.select().from(schema.users).where(eq(p.column, claims.sub));
  if (!user) {
    [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    if (user) await db.update(schema.users).set({ [p.key]: claims.sub }).where(eq(schema.users.id, user.id));
    else
      [user] = await db
        .insert(schema.users)
        .values({ email, fullName: String(claims.name ?? email), [p.key]: claims.sub })
        .returning();
  }
  const memberships = await myMemberships(user!.id);
  await createSession(res, req, user!.id, { mfaVerified: !user!.mfaEnabled, activeCompanyId: memberships[0]?.companyId ?? null });
  res.clearCookie(OIDC_COOKIE, { path: "/api/v1/auth/oidc" });
  res.redirect(`${config.APP_URL}${user!.mfaEnabled ? "/connexion/mfa" : memberships.length ? "/" : "/onboarding"}`);
});
