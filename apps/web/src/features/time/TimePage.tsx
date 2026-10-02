import {
  addDays,
  formatDate,
  formatHours,
  formatMonth,
  formatPercent,
  todayParis,
  weekday,
  type CompanyDto,
  type PersonDto,
  type ProjectDto,
  type TimeAlertDto,
  type TimeEntryDto,
  type UnlinkedStatDto,
} from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useToast } from "../../components/toast";
import { Badge, Button, ButtonLink, EmptyState, ErrorText, Field, Input, Loading, Notice, PageHeader, Section, Select, Table, Tabs, td, th } from "../../components/ui";
import { del, errorMessage, get, post, put, qs } from "../../lib/api";
import { useFy, usePermissions, useSession } from "../../lib/session";

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function mondayOf(iso: string) {
  return addDays(iso, -((weekday(iso) + 6) % 7));
}

function usePeopleAndProjects() {
  const fy = useFy();
  const people = useQuery({ queryKey: ["people"], queryFn: () => get<PersonDto[]>("/people") });
  const projects = useQuery({ queryKey: ["projects", fy.id], queryFn: () => get<ProjectDto[]>(`/projects?fiscalYearId=${fy.id}`) });
  return { people: people.data ?? [], projects: projects.data ?? [], loading: people.isLoading || projects.isLoading };
}

/* ------------------------------ Feuille de la semaine ------------------------------ */

function WeekSheet() {
  const fy = useFy();
  const { me } = useSession();
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const { people, projects, loading } = usePeopleAndProjects();
  const company = useQuery({ queryKey: ["company"], queryFn: () => get<CompanyDto>("/company") });
  const myself = people.find((p) => p.userId === me?.user.id);
  const [personId, setPersonId] = useState<string>("");
  const today = todayParis();
  const initial = today >= fy.startDate && today <= fy.endDate ? today : fy.startDate;
  const [monday, setMonday] = useState(mondayOf(initial));
  const selectedId = personId || myself?.id || people[0]?.id || "";
  const person = people.find((p) => p.id === selectedId);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const entriesKey = ["time-entries", fy.id, selectedId, monday];
  const entries = useQuery({
    queryKey: entriesKey,
    queryFn: () => get<TimeEntryDto[]>(`/time-entries${qs({ fiscalYearId: fy.id, personId: selectedId, from: days[0], to: days[6] })}`),
    enabled: !!selectedId,
  });
  const rows = projects.filter((p) => person?.projectIds.includes(p.id));
  const canEdit = perms.editableFy && (perms.manageTeam || (perms.isContributor && selectedId === myself?.id));
  const hpd = company.data?.hoursPerDay ?? 7;

  if (loading) return <Loading />;
  if (!people.length) return <EmptyState title="Aucune personne">Ajoutez d'abord l'équipe.</EmptyState>;
  if (perms.isContributor && !myself) return <Notice tone="warn" title="Votre compte n'est relié à aucune fiche personne">Demandez à l'administrateur d'ajouter votre email sur votre fiche dans Équipe.</Notice>;

  const day = (d: string, projectId: string) => (entries.data ?? []).filter((e) => e.granularity === "day" && e.date === d && e.projectId === projectId);
  const manual = (d: string, projectId: string) => day(d, projectId).find((e) => !e.noteId && e.source !== "note");
  const linked = (d: string, projectId: string) => day(d, projectId).filter((e) => e.noteId).reduce((s, e) => s + e.hours, 0);
  const dayTotal = (d: string) => (entries.data ?? []).filter((e) => e.granularity === "day" && e.date === d).reduce((s, e) => s + e.hours, 0);

  const save = async (d: string, projectId: string, raw: string) => {
    const existing = manual(d, projectId);
    const value = raw.trim() === "" ? 0 : Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) return toast("Valeur invalide", "bad");
    if ((existing?.hours ?? 0) === value) return;
    try {
      if (existing && value === 0) await del(`/time-entries/${existing.id}`);
      else if (existing) await put(`/time-entries/${existing.id}`, { personId: selectedId, projectId, date: d, granularity: "day", quantity: value, unit: "hours", noteId: null });
      else if (value > 0) await post("/time-entries", { personId: selectedId, projectId, date: d, granularity: "day", quantity: value, unit: "hours" });
      await qc.invalidateQueries({ queryKey: ["time-entries"] });
    } catch (e) {
      toast(errorMessage(e), "bad");
      await qc.invalidateQueries({ queryKey: entriesKey });
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {perms.manageTeam || perms.isAdmin ? (
          <Field label="Personne" className="w-64">
            <Select value={selectedId} onChange={(e) => setPersonId(e.target.value)}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.lastName.toUpperCase()} {p.firstName}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-sm font-semibold">{person?.firstName} {person?.lastName}</p>
        )}
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={() => setMonday(addDays(monday, -7))} aria-label="Semaine précédente">‹</Button>
          <span className="min-w-[200px] text-center text-sm font-medium">
            Semaine du {formatDate(days[0])} au {formatDate(days[6])}
          </span>
          <Button size="sm" onClick={() => setMonday(addDays(monday, 7))} aria-label="Semaine suivante">›</Button>
          <Button size="sm" variant="ghost" onClick={() => setMonday(mondayOf(initial))}>Aujourd'hui</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Aucun projet affecté">Affectez cette personne à un projet (onglet Équipe du projet) pour saisir ses temps.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Projet</th>
              {days.map((d, i) => (
                <th key={d} className={clsx(th, "text-center", i >= 5 && "bg-line/40", d === today && "text-pen")}>
                  {DAY_LABELS[i]} {d.slice(8)}/{d.slice(5, 7)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={`${p.id}-${monday}-${entries.dataUpdatedAt}`}>
                <td className={clsx(td, "font-semibold")}>
                  {p.code}
                  <span className="block text-xs font-normal text-graphite">{p.title}</span>
                </td>
                {days.map((d, i) => {
                  const out = d < fy.startDate || d > fy.endDate || (person?.entryDate && d < person.entryDate) || (person?.exitDate && d > person.exitDate);
                  const l = linked(d, p.id);
                  return (
                    <td key={d} className={clsx(td, "w-[11%] text-center", i >= 5 && "bg-paper")}>
                      <input
                        aria-label={`${p.code}, ${formatDate(d)}`}
                        defaultValue={manual(d, p.id)?.hours ?? ""}
                        disabled={!canEdit || !!out}
                        inputMode="decimal"
                        onBlur={(e) => save(d, p.id, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        className="h-8 w-full max-w-16 rounded border border-line bg-surface text-center text-sm focus:border-pen focus:outline-none disabled:bg-transparent disabled:text-graphite"
                      />
                      {l > 0 && <span className="mt-0.5 block text-[11px] text-ok">+{formatHours(l)} fiche</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className={clsx(td, "text-sm text-graphite")}>Total du jour</td>
              {days.map((d) => {
                const t = dayTotal(d);
                return (
                  <td key={d} className={clsx(td, "text-center text-sm font-semibold", t > hpd ? "text-bad" : "text-ink-soft")}>
                    {t ? formatHours(t) : ""}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </Table>
      )}
      <p className="mt-2 text-xs text-graphite">
        Les cases contiennent les heures saisies directement ; les heures déclarées depuis une fiche de recherche apparaissent en vert. Capacité : {formatHours(hpd)} par jour.
      </p>
    </div>
  );
}

/* ------------------------------ Liste des saisies ------------------------------ */

function EntryList() {
  const fy = useFy();
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const { people, projects } = usePeopleAndProjects();
  const [filters, setFilters] = useState({ personId: "", projectId: "" });
  const entries = useQuery({
    queryKey: ["time-entries", fy.id, "list", filters],
    queryFn: () => get<TimeEntryDto[]>(`/time-entries${qs({ fiscalYearId: fy.id, ...filters })}`),
  });
  const [form, setForm] = useState({ personId: "", projectId: "", month: "", quantity: "", unit: "hours" });
  const [error, setError] = useState<string | null>(null);
  const total = useMemo(() => (entries.data ?? []).reduce((s, e) => s + e.hours, 0), [entries.data]);
  return (
    <div>
      {perms.editableFy && !perms.isExpert && (
        <Section title="Saisie mensuelle" description="Pour déclarer un volume d'heures sur un mois entier (sans détail par jour).">
          <form
            className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_150px_110px_120px_auto]"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await post("/time-entries", { personId: form.personId, projectId: form.projectId, date: `${form.month}-01`, granularity: "month", quantity: Number(form.quantity.replace(",", ".")), unit: form.unit });
                setForm({ ...form, quantity: "" });
                await qc.invalidateQueries({ queryKey: ["time-entries"] });
                toast("Temps mensuel enregistré");
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            <Field label="Personne">
              <Select value={form.personId} onChange={(e) => setForm({ ...form, personId: e.target.value })} required>
                <option value="">Choisir…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.lastName.toUpperCase()} {p.firstName}</option>
                ))}
              </Select>
            </Field>
            <Field label="Projet">
              <Select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} required>
                <option value="">Choisir…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.code}</option>
                ))}
              </Select>
            </Field>
            <Field label="Mois">
              <Input type="month" value={form.month} min={fy.startDate.slice(0, 7)} max={fy.endDate.slice(0, 7)} onChange={(e) => setForm({ ...form, month: e.target.value })} required />
            </Field>
            <Field label="Quantité">
              <Input inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
            </Field>
            <Field label="Unité">
              <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                <option value="hours">heures</option>
                <option value="days">jours</option>
              </Select>
            </Field>
            <Button type="submit" variant="primary">Ajouter</Button>
          </form>
          <div className="mt-2"><ErrorText error={error} /></div>
        </Section>
      )}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Personne" className="w-56">
          <Select value={filters.personId} onChange={(e) => setFilters({ ...filters, personId: e.target.value })}>
            <option value="">Toutes</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.lastName.toUpperCase()} {p.firstName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Projet" className="w-44">
          <Select value={filters.projectId} onChange={(e) => setFilters({ ...filters, projectId: e.target.value })}>
            <option value="">Tous</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.code}</option>
            ))}
          </Select>
        </Field>
        <p className="pb-2 text-sm text-graphite">{(entries.data ?? []).length} lignes, {formatHours(total)}</p>
      </div>
      {entries.isLoading ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Date</th>
              <th className={th}>Personne</th>
              <th className={th}>Projet</th>
              <th className={clsx(th, "text-right")}>Heures</th>
              <th className={th}>Fiche</th>
              <th className={th}>Origine</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {(entries.data ?? []).map((e) => (
              <tr key={e.id}>
                <td className={td}>{e.granularity === "month" ? `Mois ${formatMonth(e.date)}` : formatDate(e.date)}</td>
                <td className={td}>{e.personName}</td>
                <td className={td}>{e.projectCode}</td>
                <td className={clsx(td, "text-right tabular-nums")}>{formatHours(e.hours)}</td>
                <td className={td}>{e.noteId ? <Link to={`/fiches/${e.noteId}`} className="text-pen hover:underline">{e.noteRef}</Link> : <span className="text-graphite">—</span>}</td>
                <td className={td}>{{ manual: "Saisie", import: "Import", note: "Fiche" }[e.source]}</td>
                <td className={clsx(td, "text-right")}>
                  {perms.editableFy && perms.manageTeam && e.source !== "note" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-bad"
                      onClick={async () => {
                        try {
                          await del(`/time-entries/${e.id}`);
                          await qc.invalidateQueries({ queryKey: ["time-entries"] });
                        } catch (err) {
                          toast(errorMessage(err), "bad");
                        }
                      }}
                    >
                      Supprimer
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

/* ---------------------------------- Alertes ---------------------------------- */

function Alerts() {
  const fy = useFy();
  const q = useQuery({
    queryKey: ["time-alerts", fy.id],
    queryFn: () =>
      get<{ alerts: TimeAlertDto[]; unlinked: UnlinkedStatDto[]; byPerson: { personId: string; personName: string; totalHours: number; unlinkedHours: number; ratio: number }[]; threshold: number }>(
        `/time-entries/alerts?fiscalYearId=${fy.id}`,
      ),
  });
  if (q.isLoading) return <Loading />;
  const d = q.data!;
  return (
    <div>
      <Section title="Alertes" description="Temps R&D supérieur au temps de travail, temps hors période d'emploi, fonctions support.">
        {d.alerts.length === 0 ? (
          <Notice tone="ok">Aucune alerte sur l'exercice.</Notice>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {d.alerts.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>
                  <Link to={`/equipe/${a.personId}`} className="font-semibold text-pen hover:underline">{a.personName}</Link> : {a.message}
                </span>
                <Badge tone={a.kind === "support_function" ? "warn" : "bad"}>{a.kind === "support_function" ? "Fonction support" : a.kind === "outside_employment" ? "Hors emploi" : "Capacité"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Temps non rattachés à une fiche" description={`Un temps sans fiche ne démontre pas ce qui a été fait. Seuil d'alerte : ${formatPercent(d.threshold)}.`}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Table>
            <thead>
              <tr>
                <th className={th}>Projet</th>
                <th className={clsx(th, "text-right")}>Total</th>
                <th className={clsx(th, "text-right")}>Non rattaché</th>
              </tr>
            </thead>
            <tbody>
              {d.unlinked.map((u) => (
                <tr key={u.projectId}>
                  <td className={td}>{u.projectCode}</td>
                  <td className={clsx(td, "text-right tabular-nums")}>{formatHours(u.totalHours)}</td>
                  <td className={clsx(td, "text-right tabular-nums", u.ratio > d.threshold && "font-semibold text-bad")}>{formatPercent(u.ratio)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Table>
            <thead>
              <tr>
                <th className={th}>Personne</th>
                <th className={clsx(th, "text-right")}>Total</th>
                <th className={clsx(th, "text-right")}>Non rattaché</th>
              </tr>
            </thead>
            <tbody>
              {d.byPerson.map((u) => (
                <tr key={u.personId}>
                  <td className={td}>{u.personName}</td>
                  <td className={clsx(td, "text-right tabular-nums")}>{formatHours(u.totalHours)}</td>
                  <td className={clsx(td, "text-right tabular-nums", u.ratio > d.threshold && "font-semibold text-bad")}>{formatPercent(u.ratio)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Section>
    </div>
  );
}

export function TimePage() {
  const perms = usePermissions();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("onglet") as "semaine" | "liste" | "alertes") ?? "semaine";
  return (
    <div>
      <PageHeader
        title="Temps"
        description="Temps passés par personne, projet et jour (ou mois). Rattachez-les aux fiches de recherche : la fiche dit ce qui a été fait, le temps dit combien et par qui."
        actions={perms.manageTeam && perms.editableFy && <ButtonLink to="/temps/import">Importer un fichier</ButtonLink>}
      />
      <Tabs
        value={tab}
        onChange={(k) => setParams({ onglet: k })}
        tabs={[
          { key: "semaine", label: "Feuille de la semaine" },
          { key: "liste", label: "Toutes les saisies" },
          { key: "alertes", label: "Alertes" },
        ]}
      />
      {tab === "semaine" && <WeekSheet />}
      {tab === "liste" && <EntryList />}
      {tab === "alertes" && <Alerts />}
    </div>
  );
}
