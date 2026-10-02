import {
  FRASCATI,
  FRASCATI_CRITERIA,
  FRASCATI_MIN_ARGUMENT_LENGTH,
  LOCK_OUTCOME_LABELS,
  OPERATION_FUNCTIONS,
  OPERATION_FUNCTION_LABELS,
  OPERATION_TYPES,
  OPERATION_TYPE_LABELS,
  SELF_ASSESSMENTS,
  SELF_ASSESSMENT_LABELS,
  VERDICTS,
  VERDICT_LABELS,
  formatDate,
  formatHours,
  lockSchema,
  todayParis,
  type AssignmentDto,
  type FrascatiAnswerDto,
  type LockDto,
  type OperationDto,
  type OperationFunction,
  type OperationType,
  type PersonDto,
  type ProjectDto,
  type SelfAssessment,
  type Verdict,
} from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useToast } from "../../components/toast";
import { Badge, Button, DefList, EmptyState, ErrorText, Field, Input, Loading, Modal, Notice, PageHeader, Section, Select, Table, Tabs, Textarea, td, th } from "../../components/ui";
import { del, errorMessage, get, post, put } from "../../lib/api";
import { applyServerErrors, useZodForm } from "../../lib/forms";
import { usePermissions, useSession } from "../../lib/session";
import { ProjectForm, VerdictBadge } from "./ProjectsPage";

type Tab = "fiche" | "frascati" | "equipe" | "operations" | "verrous";

/* ------------------------------- Frascati ------------------------------- */

function FrascatiTab({ project }: { project: ProjectDto }) {
  const perms = usePermissions();
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["frascati", project.id], queryFn: () => get<FrascatiAnswerDto[]>(`/projects/${project.id}/frascati`) });
  const [answers, setAnswers] = useState<FrascatiAnswerDto[]>([]);
  const [saving, setSaving] = useState(false);
  const [verdict, setVerdict] = useState<{ verdict: Verdict; justification: string; expertName: string; verdictDate: string }>({
    verdict: project.verdict ?? "eligible_cir",
    justification: project.verdictJustification ?? "",
    expertName: project.verdictExpertName ?? (perms.isExpert ? (me?.user.fullName ?? "") : ""),
    verdictDate: project.verdictDate ?? todayParis(),
  });
  const [verdictError, setVerdictError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setAnswers(q.data);
  }, [q.data]);
  if (q.isLoading) return <Loading />;
  const canEdit = perms.writeProjects;
  const set = (i: number, patch: Partial<FrascatiAnswerDto>) => setAnswers((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const complete = answers.length === 5 && answers.every((a) => a.argument.trim().length >= FRASCATI_MIN_ARGUMENT_LENGTH);

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
      <div>
        <Notice tone="pen" title="Les 5 critères sont cumulatifs">
          Un seul critère non rempli rend le projet inéligible au CIR. Argumentez chaque critère (au moins {FRASCATI_MIN_ARGUMENT_LENGTH} caractères) en vous appuyant sur l'état de l'art daté, les verrous et les fiches.
        </Notice>
        <ol className="grid gap-5">
          {FRASCATI_CRITERIA.map((c, i) => {
            const info = FRASCATI[c];
            const a = answers[i];
            if (!a) return null;
            const len = a.argument.trim().length;
            return (
              <li key={c} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg">
                    {i + 1}. {info.label}
                  </h3>
                  <span className={clsx("text-xs", len >= FRASCATI_MIN_ARGUMENT_LENGTH ? "text-ok" : "text-graphite")}>
                    {len} / {FRASCATI_MIN_ARGUMENT_LENGTH} caractères min.
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{info.exigence}</p>
                <p className="mt-3 font-serif text-[15px] italic text-ink">{info.question}</p>
                <Textarea
                  className="mt-2"
                  rows={5}
                  value={a.argument}
                  disabled={!canEdit}
                  onChange={(e) => set(i, { argument: e.target.value })}
                  aria-label={`Argumentation : ${info.label}`}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <fieldset className="flex flex-wrap gap-3 text-sm" disabled={!canEdit}>
                    <legend className="sr-only">Auto-évaluation</legend>
                    {SELF_ASSESSMENTS.map((s) => (
                      <label key={s} className="inline-flex items-center gap-1.5">
                        <input type="radio" name={`sa-${c}`} checked={a.selfAssessment === s} onChange={() => set(i, { selfAssessment: s as SelfAssessment })} className="accent-pen" />
                        {SELF_ASSESSMENT_LABELS[s]}
                      </label>
                    ))}
                  </fieldset>
                  <p className="text-xs text-graphite">Preuves attendues : {info.preuves}</p>
                </div>
                <p className="mt-2 text-xs text-warn">Signal d'inéligibilité : {info.signalIneligibilite}</p>
              </li>
            );
          })}
        </ol>
        {canEdit && (
          <div className="mt-4">
            <Button
              variant="primary"
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await put(`/projects/${project.id}/frascati`, { answers: answers.map(({ updatedAt: _u, ...a }) => a) });
                  await qc.invalidateQueries({ queryKey: ["frascati", project.id] });
                  await qc.invalidateQueries({ queryKey: ["project", project.id] });
                  toast("Questionnaire enregistré");
                } catch (e) {
                  toast(errorMessage(e), "bad");
                } finally {
                  setSaving(false);
                }
              }}
            >
              Enregistrer le questionnaire
            </Button>
          </div>
        )}
      </div>

      <aside>
        <div className="sticky top-20 rounded-lg border border-line bg-surface p-4">
          <h3 className="text-lg">Verdict</h3>
          <div className="mt-2">
            <VerdictBadge verdict={project.verdict} />
          </div>
          {project.verdict && (
            <div className="mt-3 text-sm">
              <DefList
                items={[
                  { term: "Expert", value: project.verdictExpertName },
                  { term: "Date", value: formatDate(project.verdictDate) },
                  { term: "Justification", value: project.verdictJustification },
                ]}
              />
            </div>
          )}
          {perms.verdict && (
            <form
              className="mt-4 grid gap-3 border-t border-line pt-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setVerdictError(null);
                try {
                  await post(`/projects/${project.id}/verdict`, verdict);
                  await qc.invalidateQueries({ queryKey: ["project", project.id] });
                  await qc.invalidateQueries({ queryKey: ["projects"] });
                  toast("Verdict enregistré");
                } catch (err) {
                  setVerdictError(errorMessage(err));
                }
              }}
            >
              {!complete && <p className="text-xs text-warn">Le verdict exige les 5 critères argumentés et enregistrés.</p>}
              <Field label="Verdict">
                <Select value={verdict.verdict} onChange={(e) => setVerdict({ ...verdict, verdict: e.target.value as Verdict })}>
                  {VERDICTS.map((v) => (
                    <option key={v} value={v}>
                      {VERDICT_LABELS[v]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Justification">
                <Textarea rows={4} value={verdict.justification} onChange={(e) => setVerdict({ ...verdict, justification: e.target.value })} required />
              </Field>
              <Field label="Nom de l'expert" hint={perms.isAdmin ? "Expert ou cabinet externe ayant rendu ce verdict" : undefined}>
                <Input value={verdict.expertName} disabled={perms.isExpert} onChange={(e) => setVerdict({ ...verdict, expertName: e.target.value })} required />
              </Field>
              <Field label="Date du verdict">
                <Input type="date" value={verdict.verdictDate} onChange={(e) => setVerdict({ ...verdict, verdictDate: e.target.value })} required />
              </Field>
              <ErrorText error={verdictError} />
              <Button type="submit" variant="primary">
                Rendre le verdict
              </Button>
            </form>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------- Équipe ------------------------------- */

function TeamTab({ project }: { project: ProjectDto }) {
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const people = useQuery({ queryKey: ["people"], queryFn: () => get<PersonDto[]>("/people") });
  const q = useQuery({ queryKey: ["assignments", project.id], queryFn: () => get<AssignmentDto[]>(`/projects/${project.id}/assignments`) });
  const [rows, setRows] = useState<{ personId: string; operationFunction: OperationFunction; contribution: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setRows(q.data.map((a) => ({ personId: a.personId, operationFunction: a.operationFunction, contribution: a.contribution })));
  }, [q.data]);
  if (q.isLoading || people.isLoading) return <Loading />;
  const canEdit = perms.writeProjects;
  const available = (people.data ?? []).filter((p) => !rows.some((r) => r.personId === p.id));
  const name = (id: string) => {
    const p = people.data?.find((x) => x.id === id);
    return p ? `${p.lastName.toUpperCase()} ${p.firstName}` : "?";
  };
  return (
    <Section description="Seules les personnes affectées peuvent recevoir du temps ou rédiger une fiche sur ce projet. Fonction et contribution alimentent le tableau du personnel exigé par le MESR.">
      {rows.length === 0 && <p className="mb-3 text-sm text-graphite">Aucune personne affectée.</p>}
      <div className="grid gap-3">
        {rows.map((r, i) => (
          <div key={r.personId} className="grid items-start gap-3 rounded-lg border border-line bg-surface p-3 md:grid-cols-[200px_200px_1fr_auto]">
            <p className="pt-2 text-sm font-semibold">{name(r.personId)}</p>
            <Select disabled={!canEdit} value={r.operationFunction} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, operationFunction: e.target.value as OperationFunction } : x)))} aria-label="Fonction dans l'opération">
              {OPERATION_FUNCTIONS.map((f) => (
                <option key={f} value={f}>
                  {OPERATION_FUNCTION_LABELS[f]}
                </option>
              ))}
            </Select>
            <Textarea
              rows={2}
              disabled={!canEdit}
              placeholder="Contribution directe à l'acquisition de connaissances nouvelles"
              value={r.contribution}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, contribution: e.target.value } : x)))}
            />
            {canEdit && (
              <Button variant="ghost" size="sm" className="text-bad" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                Retirer
              </Button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {available.length > 0 && (
            <Field label="Ajouter une personne" className="w-64">
              <Select value="" onChange={(e) => e.target.value && setRows([...rows, { personId: e.target.value, operationFunction: "chercheur", contribution: "" }])}>
                <option value="">Choisir…</option>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.lastName.toUpperCase()} {p.firstName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button
            variant="primary"
            onClick={async () => {
              setError(null);
              try {
                await put(`/projects/${project.id}/assignments`, { assignments: rows });
                await qc.invalidateQueries({ queryKey: ["assignments", project.id] });
                await qc.invalidateQueries({ queryKey: ["people"] });
                toast("Équipe du projet enregistrée");
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Enregistrer l'équipe
          </Button>
        </div>
      )}
      <div className="mt-3">
        <ErrorText error={error} />
      </div>
    </Section>
  );
}

/* ------------------------------- Opérations ------------------------------- */

function OperationsTab({ project }: { project: ProjectDto }) {
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["operations", project.id], queryFn: () => get<OperationDto[]>(`/projects/${project.id}/operations`) });
  const [edit, setEdit] = useState<Partial<OperationDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <Loading />;
  const save = async () => {
    if (!edit) return;
    setError(null);
    try {
      const body = { title: edit.title ?? "", type: edit.type ?? "rd", startDate: edit.startDate || null, endDate: edit.endDate || null };
      if (edit.id) await put(`/operations/${edit.id}`, body);
      else await post(`/projects/${project.id}/operations`, body);
      await qc.invalidateQueries({ queryKey: ["operations", project.id] });
      setEdit(null);
      toast("Opération enregistrée");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Section
      description="Seules les phases de R&D entrent dans le dossier : l'industrialisation et la maintenance sont exclues. L'intitulé d'une opération pluriannuelle reste identique d'une année sur l'autre."
      actions={perms.writeProjects && <Button onClick={() => setEdit({ type: "rd" })}>Ajouter une opération</Button>}
    >
      {(q.data ?? []).length === 0 ? (
        <p className="text-sm text-graphite">Aucune opération déclarée.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Intitulé</th>
              <th className={th}>Type</th>
              <th className={th}>Période</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((o) => (
              <tr key={o.id}>
                <td className={td}>
                  {o.title}
                  {o.titleLocked && <Badge className="ml-2">Intitulé verrouillé</Badge>}
                </td>
                <td className={td}>
                  <Badge tone={o.type === "rd" ? "ok" : o.type === "cii" ? "warn" : "neutral"}>{OPERATION_TYPE_LABELS[o.type]}</Badge>
                </td>
                <td className={td}>{o.startDate ? `${formatDate(o.startDate)} → ${formatDate(o.endDate)}` : "—"}</td>
                <td className={clsx(td, "text-right")}>
                  {perms.writeProjects && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(o)}>
                        Modifier
                      </Button>
                      {!o.titleLocked && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-bad"
                          onClick={async () => {
                            try {
                              await del(`/operations/${o.id}`);
                              await qc.invalidateQueries({ queryKey: ["operations", project.id] });
                            } catch (e) {
                              toast(errorMessage(e), "bad");
                            }
                          }}
                        >
                          Supprimer
                        </Button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Modifier l'opération" : "Nouvelle opération"}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Annuler</Button>
            <Button variant="primary" onClick={save}>
              Enregistrer
            </Button>
          </>
        }
      >
        {edit && (
          <div className="grid gap-3">
            <Field label="Intitulé" required hint={edit.titleLocked ? "Reprise d'un exercice précédent : intitulé non modifiable" : undefined}>
              <Input value={edit.title ?? ""} disabled={edit.titleLocked} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label="Type">
              <Select value={edit.type ?? "rd"} onChange={(e) => setEdit({ ...edit, type: e.target.value as OperationType })}>
                {OPERATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {OPERATION_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Début">
                <Input type="date" value={edit.startDate ?? ""} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} />
              </Field>
              <Field label="Fin">
                <Input type="date" value={edit.endDate ?? ""} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} />
              </Field>
            </div>
            <ErrorText error={error} />
          </div>
        )}
      </Modal>
    </Section>
  );
}

/* ------------------------------- Verrous ------------------------------- */

export function LockForm({ initial, onSubmit, submitLabel, disabled }: { initial?: Partial<LockDto>; onSubmit: (v: ReturnType<typeof lockSchema.parse>) => Promise<void>; submitLabel: string; disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(lockSchema, {
    statement: initial?.statement ?? "",
    sotaGap: initial?.sotaGap ?? "",
    identifiedOn: initial?.identifiedOn ?? todayParis(),
    outcome: initial?.outcome ?? "en_cours",
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await onSubmit(v);
        } catch (err) {
          setError(applyServerErrors(form, err));
        }
      })}
    >
      <fieldset disabled={disabled} className="grid gap-4">
        <Field label="Énoncé du verrou" required error={e.statement?.message} hint="Le problème scientifique ou technique qu'aucune solution connue ne résout.">
          <Textarea rows={3} {...form.register("statement")} />
        </Field>
        <Field label="Pourquoi l'état de l'art ne suffit pas" required error={e.sotaGap?.message}>
          <Textarea rows={4} {...form.register("sotaGap")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date d'identification" required error={e.identifiedOn?.message}>
            <Input type="date" {...form.register("identifiedOn")} />
          </Field>
          <Field label="Issue">
            <Select {...form.register("outcome")}>
              {Object.entries(LOCK_OUTCOME_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </fieldset>
      <ErrorText error={error} />
      {!disabled && (
        <div>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}

function LocksTab({ project }: { project: ProjectDto }) {
  const perms = usePermissions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["locks", project.id], queryFn: () => get<LockDto[]>(`/projects/${project.id}/locks`) });
  if (q.isLoading) return <Loading />;
  const list = q.data ?? [];
  return (
    <Section
      description="Chaîne de preuve : verrou → sujets de recherche → fiches quotidiennes → temps. C'est elle qui démontre la démarche systématique."
      actions={perms.writeProjects && <Button variant="primary" onClick={() => setCreating(true)}>Nouveau verrou</Button>}
    >
      {list.length === 0 ? (
        <EmptyState title="Aucun verrou">Décrivez ce que l'état de l'art ne permettait pas de résoudre au début des travaux.</EmptyState>
      ) : (
        <ul className="grid gap-3">
          {list.map((l) => (
            <li key={l.id}>
              <Link to={`/verrous/${l.id}`} className="block rounded-lg border border-line bg-surface p-4 hover:border-pen">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-serif text-lg font-semibold text-ink">{l.code}</span>
                  <Badge tone={l.outcome === "leve" ? "ok" : l.outcome === "non_leve" ? "bad" : l.outcome === "partiel" ? "warn" : "pen"}>{LOCK_OUTCOME_LABELS[l.outcome]}</Badge>
                  {l.toUpdate && <Badge tone="warn">À actualiser</Badge>}
                </div>
                <p className="mt-1 text-sm text-ink">{l.statement}</p>
                <p className="mt-2 text-xs text-graphite">
                  {l.topicCount} sujet{l.topicCount > 1 ? "s" : ""}, {l.noteCount} fiche{l.noteCount > 1 ? "s" : ""}, {formatHours(l.hours)} rattachées
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nouveau verrou" wide>
        <LockForm
          submitLabel="Créer le verrou"
          onSubmit={async (v) => {
            const l = await post<LockDto>(`/projects/${project.id}/locks`, v);
            await qc.invalidateQueries({ queryKey: ["locks", project.id] });
            setCreating(false);
            navigate(`/verrous/${l.id}`);
          }}
        />
      </Modal>
    </Section>
  );
}

/* ------------------------------- Page ------------------------------- */

export function ProjectPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("onglet") as Tab) ?? "fiche";
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["project", id], queryFn: () => get<ProjectDto>(`/projects/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorText error={q.error} />;
  const p = q.data!;
  return (
    <div>
      <PageHeader
        title={p.title}
        description={`Projet ${p.code}, travaux débutés le ${formatDate(p.startDate)}. ${p.lockCount} verrou(s), ${p.noteCount} fiche(s), ${formatHours(p.hours)} déclarées.`}
        back={{ to: "/projets", label: "Projets" }}
        actions={<VerdictBadge verdict={p.verdict} />}
      />
      {!p.frascatiComplete && tab !== "frascati" && (
        <Notice tone="warn" title="Projet non qualifié" action={<Button size="sm" onClick={() => setParams({ onglet: "frascati" })}>Qualifier</Button>}>
          La rédaction du dossier reste bloquée tant que les 5 critères de Frascati ne sont pas argumentés.
        </Notice>
      )}
      <Tabs
        value={tab}
        onChange={(k) => setParams({ onglet: k })}
        tabs={[
          { key: "fiche", label: "Fiche projet" },
          { key: "frascati", label: "Qualification Frascati" },
          { key: "equipe", label: "Équipe" },
          { key: "operations", label: "Opérations" },
          { key: "verrous", label: `Verrous (${p.lockCount})` },
        ]}
      />
      {tab === "fiche" && (
        <Section>
          <ProjectForm
            initial={p}
            disabled={!perms.writeProjects}
            submitLabel="Enregistrer"
            onSubmit={async (v) => {
              await put(`/projects/${p.id}`, v);
              await qc.invalidateQueries({ queryKey: ["project", id] });
              await qc.invalidateQueries({ queryKey: ["projects"] });
              toast("Projet enregistré");
            }}
          />
          {perms.writeProjects && (
            <div className="mt-8 border-t border-line pt-4">
              <Button
                variant="danger"
                onClick={async () => {
                  if (!confirm("Supprimer ce projet ? Il restera tracé dans le journal d'audit.")) return;
                  try {
                    await del(`/projects/${p.id}`);
                    await qc.invalidateQueries({ queryKey: ["projects"] });
                    navigate("/projets");
                  } catch (e) {
                    toast(errorMessage(e), "bad");
                  }
                }}
              >
                Supprimer le projet
              </Button>
            </div>
          )}
        </Section>
      )}
      {tab === "frascati" && <FrascatiTab project={p} />}
      {tab === "equipe" && <TeamTab project={p} />}
      {tab === "operations" && <OperationsTab project={p} />}
      {tab === "verrous" && <LocksTab project={p} />}
    </div>
  );
}
