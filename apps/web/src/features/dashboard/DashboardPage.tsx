import { formatDate, formatHours, formatPercent, type ChecklistDto, type CompanyDto } from "@cir/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Link } from "react-router";
import { Seal } from "../../components/seal";
import { ButtonLink, Loading, Progress, Section } from "../../components/ui";
import { get } from "../../lib/api";
import { targetLink } from "../../lib/links";
import { useFy, usePermissions, useSession } from "../../lib/session";

interface Dashboard {
  projects: { total: number; eligible: number; pending: number; cii: number; nonEligible: number };
  locks: { total: number; lifted: number };
  notes: { total: number; lastWeek: number };
  hours: { total: number; unlinkedRatio: number };
  people: number;
  me: { personId: string; notesLastWeek: number; hoursLastWeek: number; lastNoteDate: string | null } | null;
}

function Figure({ value, label, detail }: { value: string | number; label: string; detail?: string }) {
  return (
    <div className="border-l-2 border-line pl-4">
      <p className="font-serif text-3xl font-semibold leading-none text-ink">{value}</p>
      <p className="mt-1.5 text-sm font-medium text-ink-soft">{label}</p>
      {detail && <p className="text-xs text-graphite">{detail}</p>}
    </div>
  );
}

export function DashboardPage() {
  const fy = useFy();
  const { me } = useSession();
  const perms = usePermissions();
  const dash = useQuery({ queryKey: ["dashboard", fy.id], queryFn: () => get<Dashboard>(`/dashboard?fiscalYearId=${fy.id}`) });
  const checklist = useQuery({ queryKey: ["checklist", fy.id], queryFn: () => get<ChecklistDto>(`/fiscal-years/${fy.id}/checklist`), enabled: !perms.isContributor });
  const company = useQuery({ queryKey: ["company"], queryFn: () => get<CompanyDto>("/company"), enabled: perms.manageTeam });
  if (dash.isLoading) return <Loading />;
  const d = dash.data!;
  const remaining = checklist.data ? checklist.data.blockingTotal - checklist.data.blockingOk : null;
  const todo = checklist.data?.items.filter((i) => i.level === "blocking" && !i.ok).slice(0, 6) ?? [];

  const steps = [
    { label: "Compléter la fiche société et le référent du dossier", done: !!company.data?.referentName && !!company.data?.headcountTotal, to: "/parametres" },
    { label: "Ajouter l'équipe, ses diplômes et ses CV", done: d.people > 0, to: "/equipe" },
    { label: "Saisir ou importer les temps", done: d.hours.total > 0, to: "/temps/import" },
    { label: "Créer un projet et le qualifier sur les 5 critères de Frascati", done: d.projects.eligible > 0, to: "/projets" },
  ];
  const onboarding = perms.manageTeam && steps.some((s) => !s.done);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
        <div>
          <p className="text-sm text-graphite">Bonjour {me?.user.fullName.split(" ")[0]}</p>
          <h1 className="mt-1 text-[2rem] leading-tight">Exercice {fy.label}</h1>
          <p className="text-sm text-graphite">
            Du {formatDate(fy.startDate)} au {formatDate(fy.endDate)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <Seal status={fy.status} size={56} />
          {perms.writeNotes && (
            <ButtonLink to="/fiches/nouvelle" variant="primary">
              Saisir ma fiche du jour
            </ButtonLink>
          )}
        </div>
      </div>

      {checklist.data && (
        <Section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">Complétude du dossier : {checklist.data.progress} %</p>
            <Link to="/dossier/checklist" className="text-sm text-pen hover:underline">
              {remaining ? `${remaining} point${remaining > 1 ? "s" : ""} bloquant${remaining > 1 ? "s" : ""} à traiter` : "Tous les points bloquants sont levés"}
            </Link>
          </div>
          <Progress value={checklist.data.progress} className="mt-2" />
        </Section>
      )}

      {onboarding && (
        <Section title="Pour démarrer" description="Le parcours complet prend moins de 30 minutes.">
          <ol className="grid gap-2 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={s.label}>
                <Link to={s.to} className={clsx("flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm", s.done ? "border-ok/30 bg-ok-tint" : "border-line bg-surface hover:border-pen")}>
                  <span className={clsx("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", s.done ? "bg-ok text-white" : "border border-ink text-ink")}>
                    {s.done ? "✓" : i + 1}
                  </span>
                  <span className={s.done ? "text-ok" : "text-ink"}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="L'exercice en chiffres">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Figure value={d.projects.eligible} label="Projets éligibles CIR" detail={`${d.projects.pending} en attente de verdict, ${d.projects.total} au total`} />
          <Figure value={d.locks.total} label="Verrous suivis" detail={`${d.locks.lifted} levé${d.locks.lifted > 1 ? "s" : ""}`} />
          <Figure value={d.notes.total} label="Fiches de recherche" detail={`${d.notes.lastWeek} ces 7 derniers jours`} />
          <Figure value={formatHours(d.hours.total)} label="Temps R&D déclaré" detail={`${formatPercent(d.hours.unlinkedRatio)} non rattaché à une fiche`} />
        </div>
      </Section>

      {d.me && (
        <Section title="Mon activité">
          <p className="text-sm text-ink-soft">
            {d.me.notesLastWeek} fiche{d.me.notesLastWeek > 1 ? "s" : ""} et {formatHours(d.me.hoursLastWeek)} ces 7 derniers jours.{" "}
            {d.me.lastNoteDate ? `Dernière fiche le ${formatDate(d.me.lastNoteDate)}.` : "Aucune fiche pour l'instant."}{" "}
            <Link to="/fiches?mine=1" className="text-pen hover:underline">
              Voir mes fiches
            </Link>
          </p>
        </Section>
      )}

      {todo.length > 0 && (
        <Section title="À traiter en priorité">
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {todo.map((i, idx) => (
              <li key={idx}>
                <Link to={targetLink(i.target)} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-paper">
                  <span>{i.message}</span>
                  <span className="shrink-0 text-pen">Corriger</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
