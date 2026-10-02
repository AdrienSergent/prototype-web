import { formatDateTime } from "@cir/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, ErrorText, Loading, Notice, PageHeader, Section } from "../../components/ui";
import { errorMessage, get, post } from "../../lib/api";

interface Billing {
  enabled: boolean;
  status: string;
  readOnly: boolean;
  trialEndsAt: string | null;
}

const LABELS: Record<string, string> = { active: "Actif", trialing: "Essai", past_due: "Paiement en retard", canceled: "Résilié", incomplete: "Incomplet", none: "Aucun abonnement" };

export function BillingPage() {
  const q = useQuery({ queryKey: ["billing"], queryFn: () => get<Billing>("/billing") });
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <Loading />;
  const b = q.data!;
  const go = async (path: string) => {
    try {
      const { url } = await post<{ url: string }>(path);
      window.location.href = url;
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div>
      <PageHeader title="Abonnement" description="Abonnement mensuel, tarif unique par société. Un groupe paie un abonnement par société, holding comprise. Paiement par Stripe." />
      {!b.enabled ? (
        <Notice tone="pen" title="Facturation non configurée sur cet environnement">Renseignez les clés Stripe (STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET) pour l'activer.</Notice>
      ) : (
        <Section>
          <p className="text-sm">
            Statut : <Badge tone={b.readOnly ? "bad" : "ok"}>{LABELS[b.status] ?? b.status}</Badge>
          </p>
          {b.trialEndsAt && <p className="mt-2 text-sm text-graphite">Période d'essai jusqu'au {formatDateTime(b.trialEndsAt)}.</p>}
          {b.readOnly && <Notice tone="warn">L'espace est en lecture seule : aucune donnée n'est perdue, elles redeviennent modifiables dès la réactivation.</Notice>}
          <div className="mt-4 flex gap-2">
            {b.status === "active" || b.status === "past_due" ? (
              <Button onClick={() => go("/billing/portal")}>Gérer l'abonnement et les factures</Button>
            ) : (
              <Button variant="primary" onClick={() => go("/billing/checkout")}>S'abonner</Button>
            )}
          </div>
          <ErrorText error={error} />
        </Section>
      )}
    </div>
  );
}
