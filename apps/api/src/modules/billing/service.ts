import type { SubscriptionStatus } from "@cir/shared";
import { eq } from "drizzle-orm";
import type { RequestHandler } from "express";
import Stripe from "stripe";
import { billingEnabled, config } from "../../config";
import { schema, withTenant, type Tx } from "../../db/client";
import { HttpError } from "../../lib/errors";

export const stripe = billingEnabled ? new Stripe(config.STRIPE_SECRET_KEY!) : null;

export interface BillingState {
  enabled: boolean;
  status: SubscriptionStatus;
  readOnly: boolean;
  trialEndsAt: string | null;
}

export async function getBillingState(tx: Tx, companyId: string): Promise<BillingState> {
  const [company] = await tx.select({ trialEndsAt: schema.companies.trialEndsAt }).from(schema.companies).where(eq(schema.companies.id, companyId));
  const [sub] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.companyId, companyId));
  const status = (sub?.status ?? "none") as SubscriptionStatus;
  const trialEndsAt = company?.trialEndsAt ?? null;
  if (!billingEnabled) return { enabled: false, status, readOnly: false, trialEndsAt: trialEndsAt?.toISOString() ?? null };
  const now = Date.now();
  let readOnly = true;
  if (status === "active" || status === "trialing") readOnly = false;
  else if (trialEndsAt && trialEndsAt.getTime() > now) readOnly = false;
  else if (status === "past_due" && sub?.pastDueSince && sub.pastDueSince.getTime() + config.GRACE_DAYS * 86_400_000 > now) readOnly = false;
  return { enabled: true, status, readOnly, trialEndsAt: trialEndsAt?.toISOString() ?? null };
}

/** Impayé au-delà du délai de grâce : lecture seule (jamais de perte de données). */
export const requireWritable: RequestHandler = async (req, _res, next) => {
  if (!billingEnabled || ["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.company) return next();
  const state = await withTenant({ companyId: req.company.companyId, userId: req.auth!.userId }, (tx) => getBillingState(tx, req.company!.companyId));
  if (state.readOnly) return next(new HttpError(402, "read_only", "Abonnement inactif : l'espace est en lecture seule"));
  next();
};

export function mapStripeStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
  switch (s) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "incomplete";
  }
}
