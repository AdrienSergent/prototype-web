import { NOTE_RESULT_LABELS, formatDate, formatDateTime, formatHours, type NoteDto } from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { FileBox } from "../../components/files";
import { useToast } from "../../components/toast";
import { Badge, Button, ButtonLink, ErrorText, Loading } from "../../components/ui";
import { del, errorMessage, get } from "../../lib/api";
import { usePermissions, useSession } from "../../lib/session";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-3 sm:grid-cols-[170px_1fr] sm:gap-4">
      <dt className="text-[13px] font-semibold text-graphite">{label}</dt>
      <dd className="whitespace-pre-wrap font-serif text-[16px] leading-relaxed text-ink">{children}</dd>
    </div>
  );
}

export function NotePage() {
  const { id = "" } = useParams();
  const perms = usePermissions();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["note", id], queryFn: () => get<NoteDto>(`/notes/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorText error={q.error} />;
  const n = q.data!;
  const canEdit = perms.writeNotes && (perms.manageTeam || n.createdByUserId === me?.user.id || perms.isContributor);
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/fiches" className="text-[13px] text-pen hover:underline">
        ‹ Fiches de recherche
      </Link>
      <article className="notebook mt-2 rounded-lg border border-line p-4 sm:p-6">
        <header className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-graphite">
              <Link to={`/projets/${n.projectId}`} className="hover:underline">{n.projectCode}</Link>,{" "}
              <Link to={`/verrous/${n.lockId}`} className="hover:underline">verrou {n.lockCode}</Link>, sujet {n.topicCode} {n.topicTitle}
            </p>
            <h1 className="mt-1 text-[1.75rem]">
              Fiche du {formatDate(n.noteDate)} <span className="text-graphite">{n.ref}</span>
            </h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge tone={n.resultKind === "succes" ? "ok" : n.resultKind === "echec" ? "bad" : n.resultKind === "echec_partiel" ? "warn" : "neutral"}>{NOTE_RESULT_LABELS[n.resultKind]}</Badge>
            {n.lateEntry && <Badge tone="warn">Saisie tardive</Badge>}
          </div>
        </header>
        <dl>
          <Row label="Auteur">{n.authorName}</Row>
          <Row label="Hypothèse testée">{n.hypothesis}</Row>
          <Row label="Travaux menés">{n.workDone}</Row>
          <Row label="Résultat">{n.result}</Row>
          <Row label="Conclusion">{n.conclusion || "—"}</Row>
          <Row label="Prochaine étape">{n.nextStep || "—"}</Row>
          <Row label="Liens">
            {n.links.length ? (
              <ul className="font-sans text-sm">
                {n.links.map((l) => (
                  <li key={l.id}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-pen underline">
                      {l.label || l.url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Temps rattachés">
            {n.times.length ? (
              <ul className="font-sans text-sm">
                {n.times.map((t) => (
                  <li key={t.id}>
                    {t.personName} : {formatHours(t.hours)}
                  </li>
                ))}
                <li className="mt-1 font-semibold">Total : {formatHours(n.totalHours)}</li>
              </ul>
            ) : (
              "Aucun temps rattaché"
            )}
          </Row>
        </dl>
        <p className="mt-3 text-xs text-graphite">Saisie le {formatDateTime(n.enteredAt)} (date conservée et non modifiable).</p>
      </article>
      <div className="mt-4">
        <FileBox kind="note_attachment" ownerId={n.id} canWrite={canEdit} label="Pièces jointes" />
      </div>
      {canEdit && (
        <div className="mt-4 flex gap-2">
          <ButtonLink to={`/fiches/${n.id}/modifier`}>Modifier</ButtonLink>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm("Supprimer cette fiche ? Les temps saisis depuis la fiche seront supprimés, les autres seront détachés.")) return;
              try {
                await del(`/notes/${n.id}`);
                await qc.invalidateQueries({ queryKey: ["notes"] });
                navigate("/fiches");
              } catch (e) {
                toast(errorMessage(e), "bad");
              }
            }}
          >
            Supprimer
          </Button>
        </div>
      )}
    </div>
  );
}
