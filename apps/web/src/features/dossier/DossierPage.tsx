import { MESR_PLAN, formatNumber, type ProjectDto, type SectionDto } from "@cir/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Link } from "react-router";
import { Badge, Loading, Notice, PageHeader, Section } from "../../components/ui";
import { get } from "../../lib/api";
import { useFy } from "../../lib/session";
import { VerdictBadge } from "../projects/ProjectsPage";

interface DossierSummary {
  status: string;
  partOne: SectionDto[];
  projects: { project: ProjectDto; included: boolean; sections: SectionDto[]; pages: { total: number; bcd: number; ef: number; limits: { total: number; bcd: number; ef: number } } }[];
}

export function SectionStatus({ s }: { s: SectionDto }) {
  if (!s.contentText.trim()) return <Badge tone="bad">Vide</Badge>;
  if (s.toUpdate) return <Badge tone="warn">À actualiser</Badge>;
  if (s.validatedAt) return <Badge tone="ok">Validée</Badge>;
  return <Badge tone="pen">Rédigée</Badge>;
}

function SectionList({ sections }: { sections: SectionDto[] }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {sections.map((s) => {
        const info = MESR_PLAN[s.rubrique];
        return (
          <li key={s.id}>
            <Link to={`/dossier/sections/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-paper">
              <span className="w-10 shrink-0 font-serif text-lg font-semibold text-graphite">{info.numero}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{info.label}</span>
                <span className="block text-xs text-graphite">{info.partie === "societe" ? (info.portee === "commune" ? "Reprise d'un exercice à l'autre" : "À mettre à jour chaque année") : info.portee === "commune" ? "Partie commune à l'opération" : "Enrichie chaque année"}</span>
              </span>
              {s.openCommentCount > 0 && <Badge tone="warn">{s.openCommentCount} commentaire{s.openCommentCount > 1 ? "s" : ""}</Badge>}
              <span className="w-20 text-right text-xs tabular-nums text-graphite">{s.pages ? `${formatNumber(s.pages, 1)} p.` : ""}</span>
              <SectionStatus s={s} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Pages({ value, limit, label }: { value: number; limit: number; label: string }) {
  return (
    <span className={clsx("text-xs", value > limit ? "font-semibold text-bad" : "text-graphite")}>
      {label} : {formatNumber(value, 1)} / {limit} p.
    </span>
  );
}

export function DossierPage() {
  const fy = useFy();
  const q = useQuery({ queryKey: ["dossier", fy.id], queryFn: () => get<DossierSummary>(`/dossier/${fy.id}`) });
  if (q.isLoading) return <Loading />;
  const d = q.data!;
  return (
    <div>
      <PageHeader title="Rédaction du dossier" description="Le plan du dossier justificatif du MESR est imposé : une section par rubrique, rédigée par ceux qui ont mené les travaux, validée par l'administrateur." />
      <Section title="1. Présentation de la société et de sa stratégie de R&D" description="Rescrits, agréments et référent du dossier se renseignent dans Administration, Société.">
        <SectionList sections={d.partOne} />
      </Section>
      <Section title="2. Travaux déclarés au CIR">
        {d.projects.length === 0 && <p className="text-sm text-graphite">Aucun projet sur cet exercice.</p>}
        <div className="grid gap-8">
          {d.projects.map(({ project: p, included, sections, pages }) => (
            <div key={p.id}>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h3 className="text-lg">
                  <Link to={`/projets/${p.id}`} className="hover:text-pen">
                    {p.code}, {p.title}
                  </Link>
                </h3>
                <VerdictBadge verdict={p.verdict} />
              </div>
              {!included ? (
                <p className="text-sm text-graphite">Hors du dossier CIR (verdict). Les contenus restent conservés.</p>
              ) : (
                <>
                  {!p.frascatiComplete && (
                    <Notice tone="warn" title="Rédaction bloquée" action={<Link to={`/projets/${p.id}?onglet=frascati`} className="text-sm font-semibold text-pen underline">Qualifier le projet</Link>}>
                      Les 5 critères de Frascati doivent être argumentés avant la rédaction.
                    </Notice>
                  )}
                  <div className="mb-2 flex flex-wrap gap-4">
                    <Pages value={pages.total} limit={pages.limits.total} label="Fiche scientifique" />
                    <Pages value={pages.bcd} limit={pages.limits.bcd} label="État de l'art, verrous, démarche" />
                    <Pages value={pages.ef} limit={pages.limits.ef} label="Travaux et contribution" />
                  </div>
                  <SectionList sections={sections} />
                  <p className="mt-2 text-xs text-graphite">g. Moyens : tableau du personnel généré depuis l'équipe et les temps (visible dans la vue consolidée).</p>
                </>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
