import { MFA_REQUIRED_ROLES, type MeDto, type MembershipDto, type Role } from "@cir/shared";
import argon2 from "argon2";
import { eq, sql } from "drizzle-orm";
import { authenticator } from "otplib";
import type { Request } from "express";
import { config } from "../../config";
import { db, schema, withTenant } from "../../db/client";
import { decrypt, hashToken, randomToken } from "../../lib/crypto";
import { getBillingState } from "../billing/service";

authenticator.options = { window: 1 };

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password).catch(() => false);

export async function myMemberships(userId: string): Promise<MembershipDto[]> {
  return withTenant({ companyId: null, userId }, async (tx) => {
    const r = await tx.execute<{ company_id: string; company_name: string; siren: string; role: Role; access_expires_at: string | null }>(
      sql`select * from app_my_memberships()`,
    );
    return r.rows.map((m) => ({
      companyId: m.company_id,
      companyName: m.company_name,
      siren: m.siren,
      role: m.role,
      accessExpiresAt: m.access_expires_at,
    }));
  });
}

export async function buildMe(req: Request): Promise<MeDto> {
  const auth = req.auth!;
  const memberships = await myMemberships(auth.userId);
  let activeCompanyId = auth.activeCompanyId;
  if (activeCompanyId && !memberships.some((m) => m.companyId === activeCompanyId)) activeCompanyId = null;
  if (!activeCompanyId && memberships[0]) {
    activeCompanyId = memberships[0].companyId;
    await db.update(schema.sessions).set({ activeCompanyId }).where(eq(schema.sessions.id, auth.sessionId));
  }
  const role = memberships.find((m) => m.companyId === activeCompanyId)?.role ?? null;
  const groups = await db
    .select({ id: schema.groups.id, name: schema.groups.name, role: schema.groupMembers.role })
    .from(schema.groupMembers)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
    .where(eq(schema.groupMembers.userId, auth.userId));
  const billing = activeCompanyId
    ? await withTenant({ companyId: activeCompanyId, userId: auth.userId }, (tx) => getBillingState(tx, activeCompanyId!))
    : null;
  return {
    user: { id: auth.userId, email: auth.email, fullName: auth.fullName, mfaEnabled: auth.mfaEnabled },
    memberships,
    groups: groups.map((g) => ({ ...g, role: g.role as "owner" | "reader" })),
    activeCompanyId,
    role,
    mfaRequired: config.MFA_ENFORCED && !!role && MFA_REQUIRED_ROLES.includes(role) && !auth.mfaEnabled,
    csrfToken: auth.csrfToken,
    billing,
    features: { sso: { google: !!config.GOOGLE_CLIENT_ID, microsoft: !!config.MICROSOFT_CLIENT_ID } },
  };
}

/** Vérifie un code TOTP ou consomme un code de secours. */
export async function verifyMfaCode(userId: string, code: string): Promise<boolean> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.mfaSecretEnc) return false;
  const clean = code.replace(/\s/g, "");
  if (/^\d{6}$/.test(clean)) return authenticator.verify({ token: clean, secret: decrypt(user.mfaSecretEnc) });
  const h = hashToken(clean.toLowerCase());
  if (user.mfaRecoveryHashes.includes(h)) {
    await db
      .update(schema.users)
      .set({ mfaRecoveryHashes: user.mfaRecoveryHashes.filter((x) => x !== h) })
      .where(eq(schema.users.id, userId));
    return true;
  }
  return false;
}

export function generateRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: 8 }, () => randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "x").slice(0, 8));
  return { plain, hashes: plain.map((p) => hashToken(p)) };
}
