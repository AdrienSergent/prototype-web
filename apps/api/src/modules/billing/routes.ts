import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import type Stripe from "stripe";
import { config } from "../../config";
import { db, schema, withTenant } from "../../db/client";
import { HttpError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { requireAuth, requireCompany, requireRole, run } from "../../middlewares/auth";
import { getBillingState, mapStripeStatus, stripe } from "./service";

export const billingRouter = Router();

function ensureStripe() {
  if (!stripe || !config.STRIPE_PRICE_ID) throw new HttpError(501, "billing_disabled", "Facturation non configurée");
  return stripe;
}

billingRouter.get("/billing", requireAuth, requireCompany, async (req, res) => {
  res.json(await run(req, (tx) => getBillingState(tx, req.company!.companyId)));
});

billingRouter.post("/billing/checkout", requireAuth, requireCompany, requireRole("admin"), async (req, res) => {
  const s = ensureStripe();
  const companyId = req.company!.companyId;
  const url = await run(req, async (tx) => {
    const [company] = await tx.select().from(schema.companies).where(eq(schema.companies.id, companyId));
    let [sub] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.companyId, companyId));
    if (!sub?.stripeCustomerId) {
      const customer = await s.customers.create({ name: company!.name, email: req.auth!.email, metadata: { company_id: companyId, siren: company!.siren } });
      [sub] = await tx
        .insert(schema.subscriptions)
        .values({ companyId, stripeCustomerId: customer.id, status: sub?.status ?? "none" })
        .onConflictDoUpdate({ target: schema.subscriptions.companyId, set: { stripeCustomerId: customer.id } })
        .returning();
    }
    const session = await s.checkout.sessions.create({
      mode: "subscription",
      customer: sub!.stripeCustomerId!,
      line_items: [{ price: config.STRIPE_PRICE_ID!, quantity: 1 }],
      subscription_data: { metadata: { company_id: companyId } },
      success_url: `${config.APP_URL}/parametres/abonnement?ok=1`,
      cancel_url: `${config.APP_URL}/parametres/abonnement`,
      locale: "fr",
    });
    return session.url;
  });
  res.json({ url });
});

billingRouter.post("/billing/portal", requireAuth, requireCompany, requireRole("admin"), async (req, res) => {
  const s = ensureStripe();
  const url = await run(req, async (tx) => {
    const [sub] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.companyId, req.company!.companyId));
    if (!sub?.stripeCustomerId) throw new HttpError(409, "no_customer", "Aucun abonnement Stripe");
    const portal = await s.billingPortal.sessions.create({ customer: sub.stripeCustomerId, return_url: `${config.APP_URL}/parametres/abonnement` });
    return portal.url;
  });
  res.json({ url });
});

/** Webhook Stripe (corps brut, signature vérifiée). Monté avant le parseur JSON. */
export async function stripeWebhook(req: import("express").Request, res: import("express").Response) {
  if (!stripe || !config.STRIPE_WEBHOOK_SECRET) return res.status(501).end();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, req.get("stripe-signature") ?? "", config.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send("Signature invalide");
  }
  if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    let companyId = sub.metadata?.company_id;
    if (!companyId) {
      const r = await db.execute<{ id: string | null }>(sql`select app_company_by_stripe_customer(${customerId}) as id`);
      companyId = r.rows[0]?.id ?? undefined;
    }
    if (!companyId) {
      logger.warn({ customerId }, "Webhook Stripe : société introuvable");
      return res.json({ received: true });
    }
    const status = event.type === "customer.subscription.deleted" ? "canceled" : mapStripeStatus(sub.status);
    const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items?.data?.[0]?.current_period_end;
    await withTenant({ companyId, userId: null }, async (tx) => {
      const [existing] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.companyId, companyId!));
      const pastDueSince = status === "past_due" ? (existing?.pastDueSince ?? new Date()) : null;
      await tx
        .insert(schema.subscriptions)
        .values({ companyId: companyId!, stripeCustomerId: customerId, stripeSubscriptionId: sub.id, status, currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null, pastDueSince })
        .onConflictDoUpdate({
          target: schema.subscriptions.companyId,
          set: { stripeCustomerId: customerId, stripeSubscriptionId: sub.id, status, currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null, pastDueSince, updatedAt: new Date() },
        });
    });
  }
  res.json({ received: true });
}
