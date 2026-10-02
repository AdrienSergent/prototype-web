import { NOTE_RESULT_LABELS, formatDate, formatHours, type NoteDto, type ProjectDto } from "@cir/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Link, useSearchParams } from "react-router";
import { Badge, ButtonLink, EmptyState, Field, Loading, PageHeader, Select, Table, td, th } from "../../components/ui";
import { get, qs } from "../../lib/api";
import { useFy, usePermissions } from "../../lib/session";

export function NotesPage() {
  const fy = useFy();
  const perms = usePermissions();
  const [params, setParams] = useSearchParams();
  const mine = params.get("mine") === "1";
  const projectId = params.get("projet") ?? "";
  const projects = useQuery({ queryKey: ["projects", fy.id], queryFn: () => get<ProjectDto[]>(`/projects?fiscalYearId=${fy.id}`) });
  const notes = useQuery({
    queryKey: ["notes", fy.id, mine, projectId],
    queryFn: () => get<NoteDto[]>(`/notes${qs({ fiscalYearId: fy.id, mine: mine ? "1" : undefined, projectId })}`),
  });
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next);
  };
  return (
    <div>
      <PageHeader
        title="Fiches de recherche"
        description="Une fiche par jour et par sujet : hypothèse testée, travaux, résultat (même un échec), prochaine étape, et les temps de chacun."
        actions={perms.writeNotes && <ButtonLink to="/fiches/nouvelle" variant="primary">Nouvelle fiche</ButtonLink>}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Projet" className="w-56">
          <Select value={projectId} onChange={(e) => update({ projet: e.target.value })}>
            <option value="">Tous les projets</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </Select>
        </Field>
        <label className="inline-flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" className="accent-pen" checked={mine} onChange={(e) => update({ mine: e.target.checked ? "1" : "" })} />
          Mes fiches uniquement
        </label>
      </div>
      {notes.isLoading ? (
        <Loading />
      ) : (notes.data ?? []).length === 0 ? (
        <EmptyState title="Aucune fiche" action={perms.writeNotes && <ButtonLink to="/fiches/nouvelle" variant="primary">Saisir une fiche</ButtonLink>}>
          Consigner les travaux au fil de l'eau est ce qui rend le dossier défendable en cas de contrôle.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Fiche</th>
              <th className={th}>Date</th>
              <th className={th}>Sujet</th>
              <th className={th}>Hypothèse testée</th>
              <th className={th}>Auteur</th>
              <th className={th}>Résultat</th>
              <th className={clsx(th, "text-right")}>Temps</th>
            </tr>
          </thead>
          <tbody>
            {(notes.data ?? []).map((n) => (
              <tr key={n.id} className="hover:bg-paper">
                <td className={td}>
                  <Link to={`/fiches/${n.id}`} className="font-semibold text-pen hover:underline">
                    {n.ref}
                  </Link>
                  {n.lateEntry && (
                    <Badge tone="warn" className="ml-1">
                      Saisie tardive
                    </Badge>
                  )}
                </td>
                <td className={clsx(td, "whitespace-nowrap")}>{formatDate(n.noteDate)}</td>
                <td className={clsx(td, "whitespace-nowrap")}>
                  {n.projectCode} {n.lockCode} {n.topicCode}
                </td>
                <td className={clsx(td, "max-w-[360px]")}>
                  <span className="line-clamp-2">{n.hypothesis}</span>
                </td>
                <td className={td}>{n.authorName}</td>
                <td className={td}>
                  <Badge tone={n.resultKind === "succes" ? "ok" : n.resultKind === "echec" ? "bad" : n.resultKind === "echec_partiel" ? "warn" : "neutral"}>{NOTE_RESULT_LABELS[n.resultKind]}</Badge>
                </td>
                <td className={clsx(td, "text-right tabular-nums")}>{formatHours(n.totalHours)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
