import {
  LOCK_OUTCOME_LABELS,
  NOTE_RESULT_LABELS,
  formatDate,
  formatDateTime,
  formatHours,
  topicSchema,
  type LockDto,
  type LockVersionDto,
  type NoteDto,
  type PersonDto,
  type AssignmentDto,
  type TimelineDto,
  type TopicDto,
} from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useToast } from "../../components/toast";
import { Badge, Button, ButtonLink, EmptyState, ErrorText, Field, Input, Loading, Modal, Notice, PageHeader, Section, Select, Table, Textarea, td, th } from "../../components/ui";
import { del, errorMessage, get, post, put } from "../../lib/api";
import { applyServerErrors, optional, useZodForm } from "../../lib/forms";
import { usePermissions } from "../../lib/session";
import { LockForm } from "./ProjectPage";
import { Timeline } from "./Timeline";

function TopicForm({ projectId, initial, onSubmit }: { projectId: string; initial?: TopicDto; onSubmit: (v: ReturnType<typeof topicSchema.parse>) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const team = useQuery({ queryKey: ["assignments", projectId], queryFn: () => get<AssignmentDto[]>(`/projects/${projectId}/assignments`) });
  const form = useZodForm(topicSchema, {
    title: initial?.title ?? "",
    hypothesis: initial?.hypothesis ?? "",
    approach: initial?.approach ?? "",
    ownerPersonId: initial?.ownerPersonId ?? null,
    status: initial?.status ?? "ouvert",
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit(async (v) => {
        try {
          await onSubmit(v);
        } catch (err) {
          setError(applyServerErrors(form, err));
        }
      })}
    >
      <Field label="Titre du sujet" required error={e.title?.message}>
        <Input {...form.register("title")} />
      </Field>
      <Field label="Hypothèse" required error={e.hypothesis?.message}>
        <Textarea rows={3} {...form.register("hypothesis")} />
      </Field>
      <Field label="Approche envisagée" error={e.approach?.message}>
        <Textarea rows={3} {...form.register("approach")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Responsable">
          <Select {...form.register("ownerPersonId", optional)}>
            <option value="">Aucun</option>
            {(team.data ?? []).map((a) => (
              <option key={a.personId} value={a.personId}>
                {a.personName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Statut">
          <Select {...form.register("status")}>
            <option value="ouvert">Ouvert</option>
            <option value="clos">Clos</option>
          </Select>
        </Field>
      </div>
      <ErrorText error={error} />
      <div>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}

export function LockPage() {
  const { id = "" } = useParams();
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState<TopicDto | "new" | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const lock = useQuery({ queryKey: ["lock", id], queryFn: () => get<LockDto>(`/locks/${id}`) });
  const topics = useQuery({ queryKey: ["topics", id], queryFn: () => get<TopicDto[]>(`/locks/${id}/topics`) });
  const timeline = useQuery({ queryKey: ["timeline", id], queryFn: () => get<TimelineDto>(`/locks/${id}/timeline`) });
  const notes = useQuery({ queryKey: ["notes", "lock", id], queryFn: () => get<NoteDto[]>(`/notes?lockId=${id}`) });
  const versions = useQuery({ queryKey: ["lock-versions", id], queryFn: () => get<LockVersionDto[]>(`/locks/${id}/versions`), enabled: showVersions });
  useQuery({ queryKey: ["people"], queryFn: () => get<PersonDto[]>("/people") });
  if (lock.isLoading) return <Loading />;
  if (lock.error) return <ErrorText error={lock.error} />;
  const l = lock.data!;
  const refresh = async () => {
    await Promise.all(["lock", "topics", "timeline", "locks"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };
  return (
    <div>
      <PageHeader
        title={`Verrou ${l.code}`}
        description={`Identifié le ${formatDate(l.identifiedOn)}. Version ${l.version}.`}
        back={{ to: `/projets/${l.projectId}?onglet=verrous`, label: "Verrous du projet" }}
        actions={
          <>
            <Badge tone={l.outcome === "leve" ? "ok" : l.outcome === "non_leve" ? "bad" : l.outcome === "partiel" ? "warn" : "pen"}>{LOCK_OUTCOME_LABELS[l.outcome]}</Badge>
            {perms.writeProjects && <Button onClick={() => setEditing(true)}>Modifier</Button>}
          </>
        }
      />
      {l.toUpdate && (
        <Notice
          tone="warn"
          title="Verrou repris de l'exercice précédent"
          action={
            perms.writeProjects && (
              <Button
                size="sm"
                onClick={async () => {
                  await post(`/locks/${l.id}/confirm`);
                  await refresh();
                  toast("Verrou confirmé pour cet exercice");
                }}
              >
                Confirmer sans modification
              </Button>
            )
          }
        >
          Actualisez-le ou confirmez qu'il reste exact : l'état de l'art et les verrous sont datés au début des travaux.
        </Notice>
      )}
      <Section>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-[13px] font-semibold text-graphite">Énoncé</p>
            <p className="mt-1 font-serif text-[17px] leading-relaxed">{l.statement}</p>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-graphite">Pourquoi l'état de l'art ne suffit pas</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{l.sotaGap}</p>
          </div>
        </div>
        <button className="mt-3 text-[13px] text-pen hover:underline" onClick={() => setShowVersions((s) => !s)}>
          {showVersions ? "Masquer l'historique" : "Historique des versions"}
        </button>
        {showVersions && (
          <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-surface text-sm">
            {(versions.data ?? []).map((v) => (
              <li key={v.version} className="px-3 py-2">
                <span className="font-semibold">Version {v.version}</span>
                <span className="ml-2 text-graphite">
                  {formatDateTime(v.createdAt)}, {v.authorName ?? "?"}, {LOCK_OUTCOME_LABELS[v.data.outcome]}
                </span>
                <p className="mt-1 text-ink-soft">{v.data.statement}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Sujets de recherche" actions={perms.writeProjects && <Button onClick={() => setTopic("new")}>Nouveau sujet</Button>}>
        {(topics.data ?? []).length === 0 ? (
          <EmptyState title="Aucun sujet">Un sujet porte une hypothèse et une approche pour lever le verrou ; les fiches quotidiennes s'y rattachent.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Sujet</th>
                <th className={th}>Hypothèse</th>
                <th className={th}>Responsable</th>
                <th className={th}>Fiches</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {(topics.data ?? []).map((t) => (
                <tr key={t.id}>
                  <td className={td}>
                    <span className="font-semibold">{t.code}</span> {t.title}
                    {t.status === "clos" && <Badge className="ml-2">Clos</Badge>}
                  </td>
                  <td className={td}>{t.hypothesis}</td>
                  <td className={td}>{t.ownerName ?? "—"}</td>
                  <td className={td}>
                    {t.noteCount}
                    {t.lastNoteDate && <span className="block text-xs text-graphite">dernière le {formatDate(t.lastNoteDate)}</span>}
                  </td>
                  <td className={td + " whitespace-nowrap text-right"}>
                    {perms.writeNotes && t.status === "ouvert" && (
                      <ButtonLink size="sm" variant="ghost" to={`/fiches/nouvelle?sujet=${t.id}`}>
                        Nouvelle fiche
                      </ButtonLink>
                    )}
                    {perms.writeProjects && (
                      <Button size="sm" variant="ghost" onClick={() => setTopic(t)}>
                        Modifier
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title="Frise" description="Fiches, heures et issue du verrou dans le temps : la matière de la rubrique « Démarche expérimentale ».">
        {timeline.data ? <Timeline data={timeline.data} /> : <Loading />}
      </Section>

      <Section title="Fiches de recherche du verrou">
        {(notes.data ?? []).length === 0 ? (
          <p className="text-sm text-graphite">Aucune fiche.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {(notes.data ?? []).map((n) => (
              <li key={n.id}>
                <Link to={`/fiches/${n.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-paper">
                  <span className="font-semibold text-pen">{n.ref}</span>
                  <span>{formatDate(n.noteDate)}</span>
                  <span className="text-graphite">{n.topicCode}</span>
                  <span className="min-w-0 flex-1 truncate">{n.hypothesis}</span>
                  <Badge tone={n.resultKind === "succes" ? "ok" : n.resultKind === "echec" ? "bad" : "warn"}>{NOTE_RESULT_LABELS[n.resultKind]}</Badge>
                  <span className="tabular-nums text-graphite">{formatHours(n.totalHours)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Modal open={editing} onClose={() => setEditing(false)} title={`Modifier ${l.code}`} wide>
        <p className="mb-3 text-sm text-graphite">Chaque modification crée une nouvelle version ; les précédentes restent consultables.</p>
        <LockForm
          initial={l}
          submitLabel="Enregistrer une nouvelle version"
          onSubmit={async (v) => {
            await put(`/locks/${l.id}`, v);
            await refresh();
            setEditing(false);
            toast("Nouvelle version enregistrée");
          }}
        />
        {perms.writeProjects && (
          <div className="mt-6 border-t border-line pt-3">
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                try {
                  await del(`/locks/${l.id}`);
                  history.back();
                } catch (e) {
                  toast(errorMessage(e), "bad");
                }
              }}
            >
              Supprimer le verrou
            </Button>
          </div>
        )}
      </Modal>
      <Modal open={!!topic} onClose={() => setTopic(null)} title={topic === "new" ? "Nouveau sujet de recherche" : "Modifier le sujet"} wide>
        {topic && (
          <TopicForm
            projectId={l.projectId}
            initial={topic === "new" ? undefined : topic}
            onSubmit={async (v) => {
              if (topic === "new") await post(`/locks/${l.id}/topics`, v);
              else await put(`/topics/${topic.id}`, v);
              await refresh();
              setTopic(null);
              toast("Sujet enregistré");
            }}
          />
        )}
      </Modal>
    </div>
  );
}
