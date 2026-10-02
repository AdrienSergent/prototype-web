import type { ChecklistDto, ChecklistItemDto } from "@cir/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { Link } from "react-router";
import { Badge, Loading, Notice, PageHeader, Progress, Section } from "../../components/ui";
import { get } from "../../lib/api";
import { targetLink } from "../../lib/links";
import { useFy } from "../../lib/session";

function Items({ items }: { items: ChecklistItemDto[] }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {items.map((i, idx) => (
        <li key={idx} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
          <span aria-hidden className={clsx("flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", i.ok ? "bg-ok text-white" : i.level === "blocking" ? "border border-bad text-bad" : "border border-warn text-warn")}>
            {i.ok ? "✓" : "!"}
          </span>
          <span className={clsx("min-w-0 flex-1", i.ok && "text-graphite")}>{i.message}</span>
          {!i.ok && (
            <Link to={targetLink(i.target)} className="text-pen hover:underline">
              Corriger
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ChecklistPage() {
  const fy = useFy();
  const [showOk, setShowOk] = useState(false);
  const q = useQuery({ queryKey: ["checklist", fy.id], queryFn: () => get<ChecklistDto>(`/fiscal-years/${fy.id}/checklist`) });
  if (q.isLoading) return <Loading />;
  const c = q.data!;
  const blocking = c.items.filter((i) => i.level === "blocking" && !i.ok);
  const warnings = c.items.filter((i) => i.level === "warning");
  const done = c.items.filter((i) => i.ok);
  return (
    <div>
      <PageHeader title="Check-list de complétude" description="Chaque verrou a des sujets et des fiches, chaque intervenant a diplôme, CV et temps, chaque rubrique est rédigée et validée. L'expert ne peut valider l'exercice qu'à 100 % des points bloquants." />
      <Section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-serif text-2xl font-semibold">{c.progress} %</p>
          <p className="text-sm text-graphite">
            {c.blockingOk} points bloquants levés sur {c.blockingTotal}
          </p>
        </div>
        <Progress value={c.progress} className="mt-2" />
      </Section>
      <Section title={<span className="flex items-center gap-2">Points bloquants <Badge tone={blocking.length ? "bad" : "ok"}>{blocking.length}</Badge></span>}>
        {blocking.length ? <Items items={blocking} /> : <Notice tone="ok">Tous les points bloquants sont levés : l'exercice peut passer en relecture et être validé par l'expert.</Notice>}
      </Section>
      <Section title={<span className="flex items-center gap-2">Points d'attention <Badge tone={warnings.length ? "warn" : "ok"}>{warnings.length}</Badge></span>} description="Non bloquants, mais relevés en contrôle : référence postérieure au début des travaux, temps non rattachés, saisies tardives, dépassement de pages.">
        {warnings.length ? <Items items={warnings} /> : <p className="text-sm text-graphite">Aucun.</p>}
      </Section>
      <Section title="Points vérifiés">
        <button className="mb-2 text-sm text-pen hover:underline" onClick={() => setShowOk((s) => !s)}>
          {showOk ? "Masquer" : `Afficher les ${done.length} points vérifiés`}
        </button>
        {showOk && <Items items={done} />}
      </Section>
    </div>
  );
}
