import { invitationSchema, memberUpdateSchema, ROLE_LABELS, type InvitationDto, type MemberDto, type Role } from "@cir/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Router } from "express";
import { config, isProd } from "../../config";
import { schema } from "../../db/client";
import { hashToken, randomToken } from "../../lib/crypto";
import { conflict, notFound, parse } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { sendMail } from "../../lib/mailer";
import { requireRole, run } from "../../middlewares/auth";
import { getCompany, iso } from "../common";
import { param } from "../../lib/http";

export const membersRouter = Router();
membersRouter.use(["/members", "/invitations"], requireRole("admin"));

membersRouter.get("/members", async (req, res) => {
  const rows = await run(req, (tx) =>
    tx
      .select({ m: schema.memberships, u: schema.users })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.companyId, req.company!.companyId))
      .orderBy(schema.users.fullName),
  );
  res.json(
    rows.map(
      ({ m, u }): MemberDto => ({ id: m.id, userId: u.id, email: u.email, fullName: u.fullName, role: m.role as Role, accessExpiresAt: m.accessExpiresAt, mfaEnabled: u.mfaEnabled }),
    ),
  );
});

membersRouter.patch("/members/:id", async (req, res) => {
  const input = parse(memberUpdateSchema, req.body);
  await run(req, async (tx) => {
    const [m] = await tx.select().from(schema.memberships).where(eq(schema.memberships.id, param(req)));
    if (!m) throw notFound();
    if (m.role === "admin" && input.role !== "admin") {
      const admins = await tx.select({ id: schema.memberships.id }).from(schema.memberships).where(eq(schema.memberships.role, "admin"));
      if (admins.length <= 1) throw conflict("La société doit garder au moins un administrateur");
    }
    await tx.update(schema.memberships).set({ role: input.role, accessExpiresAt: input.accessExpiresAt ?? null }).where(eq(schema.memberships.id, m.id));
  });
  res.status(204).end();
});

membersRouter.delete("/members/:id", async (req, res) => {
  await run(req, async (tx) => {
    const [m] = await tx.select().from(schema.memberships).where(eq(schema.memberships.id, param(req)));
    if (!m) throw notFound();
    if (m.userId === req.auth!.userId) throw conflict("Vous ne pouvez pas révoquer votre propre accès");
    if (m.role === "admin") {
      const admins = await tx.select({ id: schema.memberships.id }).from(schema.memberships).where(eq(schema.memberships.role, "admin"));
      if (admins.length <= 1) throw conflict("La société doit garder au moins un administrateur");
    }
    await tx.delete(schema.memberships).where(eq(schema.memberships.id, m.id));
  });
  res.status(204).end();
});

const invitationDto = (i: typeof schema.invitations.$inferSelect): InvitationDto => ({
  id: i.id,
  email: i.email,
  role: i.role as Role,
  expiresAt: iso(i.expiresAt)!,
  accessExpiresAt: i.accessExpiresAt,
  acceptedAt: iso(i.acceptedAt),
});

membersRouter.get("/invitations", async (req, res) => {
  const rows = await run(req, (tx) =>
    tx.select().from(schema.invitations).where(isNull(schema.invitations.revokedAt)).orderBy(desc(schema.invitations.createdAt)),
  );
  res.json(rows.map(invitationDto));
});

membersRouter.post("/invitations", async (req, res) => {
  const input = parse(invitationSchema, req.body);
  const token = randomToken(32);
  const { invitation, companyName } = await run(req, async (tx) => {
    const company = await getCompany(tx, req.company!.companyId);
    const existing = await tx
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.users.email, input.email), eq(schema.memberships.companyId, company.id)));
    if (existing.length) throw conflict("Cette personne est déjà membre de la société");
    const [row] = await tx
      .insert(schema.invitations)
      .values({
        companyId: company.id,
        createdBy: req.auth!.userId,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        accessExpiresAt: input.role === "expert" ? (input.accessExpiresAt ?? null) : null,
      })
      .returning();
    return { invitation: row!, companyName: company.name };
  });
  const link = `${config.APP_URL}/invitation/${token}`;
  try {
    await sendMail({
      to: input.email,
      subject: `Invitation au dossier CIR de ${companyName}`,
      text: `${req.auth!.fullName} vous invite à rejoindre le dossier CIR de ${companyName} en tant que ${ROLE_LABELS[input.role]}.\n\nLien valable 7 jours : ${link}`,
    });
  } catch (e) {
    logger.error({ err: e }, "Envoi de l'invitation impossible");
  }
  res.status(201).json({ ...invitationDto(invitation), ...(isProd ? {} : { devLink: link }) });
});

membersRouter.delete("/invitations/:id", async (req, res) => {
  await run(req, (tx) => tx.update(schema.invitations).set({ revokedAt: new Date() }).where(eq(schema.invitations.id, param(req))));
  res.status(204).end();
});
