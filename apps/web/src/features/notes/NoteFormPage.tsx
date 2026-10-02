import { NOTE_RESULT_KINDS, NOTE_RESULT_LABELS, type AssignmentDto, type NoteDto, type NoteResultKind } from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useToast } from "../../components/toast";
import { Button, ErrorText, Field, Input, Loading, Notice, Select, Textarea } from "../../components/ui";
import { ApiError, errorMessage, get, post, put } from "../../lib/api";
import { useFy, usePermissions } from "../../lib/session";

interface QuickContext {
  me: { id: string; name: string } | null;
  today: string;
  lastTopicId: string | null;
  topics: { id: string; code: string; title: string; hypothesis: string; lockCode: string; projectId: string; projectCode: string }[];
}

interface Draft {
  topicId: string;
  noteDate: string;
  authorPersonId: string;
  hypothesis: string;
  workDone: string;
  result: string;
  resultKind: NoteResultKind;
  conclusion: string;
  nextStep: string;
  links: { url: string; label: string }[];
  times: { personId: string; hours: string }[];
}

const RESULT_TONES: Record<NoteResultKind, string> = {
  succes: "border-ok text-ok bg-ok-tint",
  echec_partiel: "border-warn text-warn bg-warn-tint",
  echec: "border-bad text-bad bg-bad-tint",
  non_concluant: "border-graphite text-graphite bg-paper",
};

/** Saisie rapide d'une fiche de recherche (F5.3, F5.5) : une page, mobile d'abord, moins de 2 minutes. */
export function NoteFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const fy = useFy();
  const perms = usePermissions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const ctx = useQuery({ queryKey: ["quick-context", fy.id], queryFn: () => get<QuickContext>(`/notes/quick-context?fiscalYearId=${fy.id}`) });
  const existing = useQuery({ queryKey: ["note", id], queryFn: () => get<NoteDto>(`/notes/${id}`), enabled: editing });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (draft || !ctx.data) return;
    if (editing) {
      const n = existing.data;
      if (!n) return;
      setDraft({
        topicId: n.topicId,
        noteDate: n.noteDate,
        authorPersonId: n.authorPersonId,
        hypothesis: n.hypothesis,
        workDone: n.workDone,
        result: n.result,
        resultKind: n.resultKind,
        conclusion: n.conclusion,
        nextStep: n.nextStep,
        links: n.links.map((l) => ({ url: l.url, label: l.label })),
        times: n.times.map((t) => ({ personId: t.personId, hours: String(t.hours) })),
      });
      return;
    }
    const c = ctx.data;
    const wanted = params.get("sujet");
    const topic = c.topics.find((t) => t.id === wanted) ?? c.topics.find((t) => t.id === c.lastTopicId) ?? c.topics[0];
    setDraft({
      topicId: topic?.id ?? "",
      noteDate: c.today >= fy.startDate && c.today <= fy.endDate ? c.today : fy.endDate,
      authorPersonId: c.me?.id ?? "",
      hypothesis: topic?.hypothesis ?? "",
      workDone: "",
      result: "",
      resultKind: "non_concluant",
      conclusion: "",
      nextStep: "",
      links: [],
      times: c.me ? [{ personId: c.me.id, hours: "" }] : [],
    });
  }, [ctx.data, existing.data, editing, draft, params, fy.startDate, fy.endDate]);

  const topic = ctx.data?.topics.find((t) => t.id === draft?.topicId);
  const projectId = topic?.projectId ?? existing.data?.projectId;
  const team = useQuery({ queryKey: ["assignments", projectId], queryFn: () => get<AssignmentDto[]>(`/projects/${projectId}/assignments`), enabled: !!projectId });

  const grouped = useMemo(() => {
    const map = new Map<string, QuickContext["topics"]>();
    for (const t of ctx.data?.topics ?? []) map.set(`${t.projectCode} / ${t.lockCode}`, [...(map.get(`${t.projectCode} / ${t.lockCode}`) ?? []), t]);
    return [...map.entries()];
  }, [ctx.data]);

  if (ctx.isLoading || (editing && existing.isLoading) || !draft) return <Loading />;
  if (!perms.writeNotes) return <Notice tone="warn">Vous ne pouvez pas rédiger de fiche sur cet exercice.</Notice>;
  if (!editing && !ctx.data?.topics.length)
    return (
      <Notice tone="pen" title="Aucun sujet de recherche ouvert">
        Une fiche se rattache à un sujet de recherche, lui-même rattaché à un verrou. {perms.writeProjects ? <Link to="/projets" className="text-pen underline">Créez-en un depuis un projet.</Link> : "Demandez au rédacteur d'en créer un sur vos projets."}
      </Notice>
    );
  if (!perms.manageTeam && !ctx.data?.me) return <Notice tone="warn" title="Votre compte n'est relié à aucune fiche personne">Demandez à l'administrateur d'ajouter votre email sur votre fiche dans Équipe.</Notice>;

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const submit = async (force = false) => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...draft,
        links: draft.links.filter((l) => l.url.trim()),
        times: draft.times.filter((t) => t.personId && t.hours.trim()).map((t) => ({ personId: t.personId, hours: Number(t.hours.replace(",", ".")) })),
        force,
      };
      const n = editing ? await put<NoteDto>(`/notes/${id}`, body) : await post<NoteDto>("/notes", body);
      await qc.invalidateQueries({ queryKey: ["notes"] });
      await qc.invalidateQueries({ queryKey: ["note", n.id] });
      await qc.invalidateQueries({ queryKey: ["time-entries"] });
      toast(editing ? `Fiche ${n.ref} enregistrée` : `Fiche ${n.ref} créée`);
      navigate(`/fiches/${n.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "note_exists") setDuplicate((e.details as { noteId?: string })?.noteId ?? null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link to="/fiches" className="text-[13px] text-pen hover:underline">
          ‹ Fiches de recherche
        </Link>
        <h1 className="mt-1 text-[1.75rem]">{editing ? `Fiche ${existing.data?.ref}` : "Fiche du jour"}</h1>
      </div>
      <form
        className="notebook rounded-lg border border-line p-4 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
          <Field label="Sujet de recherche" required>
            <Select
              value={draft.topicId}
              disabled={editing}
              onChange={(e) => {
                const t = ctx.data?.topics.find((x) => x.id === e.target.value);
                set({ topicId: e.target.value, hypothesis: draft.hypothesis && draft.hypothesis !== topic?.hypothesis ? draft.hypothesis : (t?.hypothesis ?? "") });
              }}
            >
              {editing && existing.data && !topic && <option value={existing.data.topicId}>{existing.data.topicCode} {existing.data.topicTitle}</option>}
              {grouped.map(([label, topics]) => (
                <optgroup key={label} label={label}>
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} {t.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" value={draft.noteDate} min={fy.startDate} max={ctx.data!.today < fy.endDate ? ctx.data!.today : fy.endDate} onChange={(e) => set({ noteDate: e.target.value })} />
          </Field>
        </div>
        {perms.manageTeam && (
          <Field label="Auteur" className="mt-4 sm:max-w-sm">
            <Select value={draft.authorPersonId} onChange={(e) => set({ authorPersonId: e.target.value })}>
              <option value="">Choisir…</option>
              {(team.data ?? []).map((a) => (
                <option key={a.personId} value={a.personId}>
                  {a.personName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="mt-4 grid gap-4">
          <Field label="Hypothèse testée" required>
            <Textarea rows={2} value={draft.hypothesis} onChange={(e) => set({ hypothesis: e.target.value })} />
          </Field>
          <Field label="Travaux menés" required>
            <Textarea rows={4} value={draft.workDone} onChange={(e) => set({ workDone: e.target.value })} placeholder="Protocole, jeu de données, essais réalisés…" />
          </Field>
          <fieldset>
            <legend className="mb-1 text-[13px] font-semibold">Résultat</legend>
            <div className="mb-2 flex flex-wrap gap-2">
              {NOTE_RESULT_KINDS.map((k) => (
                <label key={k} className={clsx("cursor-pointer rounded-full border px-3 py-1 text-sm", draft.resultKind === k ? RESULT_TONES[k] : "border-line-strong bg-surface text-ink-soft")}>
                  <input type="radio" className="sr-only" name="resultKind" checked={draft.resultKind === k} onChange={() => set({ resultKind: k })} />
                  {NOTE_RESULT_LABELS[k]}
                </label>
              ))}
            </div>
            <Textarea rows={3} value={draft.result} onChange={(e) => set({ result: e.target.value })} placeholder="Mesures obtenues, y compris en cas d'échec : un échec consigné est un résultat." aria-label="Résultat" />
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Conclusion">
              <Textarea rows={2} value={draft.conclusion} onChange={(e) => set({ conclusion: e.target.value })} />
            </Field>
            <Field label="Prochaine étape">
              <Textarea rows={2} value={draft.nextStep} onChange={(e) => set({ nextStep: e.target.value })} />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1 text-[13px] font-semibold">Temps passés</legend>
            <div className="grid gap-2">
              {draft.times.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select
                    className="w-full sm:w-64"
                    value={t.personId}
                    aria-label="Personne"
                    onChange={(e) => set({ times: draft.times.map((x, j) => (j === i ? { ...x, personId: e.target.value } : x)) })}
                  >
                    <option value="">Personne…</option>
                    {(team.data ?? []).map((a) => (
                      <option key={a.personId} value={a.personId}>
                        {a.personName}
                      </option>
                    ))}
                  </Select>
                  <Input
                    className="w-24"
                    inputMode="decimal"
                    placeholder="heures"
                    aria-label="Heures"
                    value={t.hours}
                    onChange={(e) => set({ times: draft.times.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)) })}
                  />
                  <span className="text-sm text-graphite">h</span>
                  <Button size="sm" variant="ghost" onClick={() => set({ times: draft.times.filter((_, j) => j !== i) })}>
                    Retirer
                  </Button>
                </div>
              ))}
              <div>
                <Button size="sm" variant="ghost" onClick={() => set({ times: [...draft.times, { personId: "", hours: "" }] })}>
                  Ajouter un contributeur
                </Button>
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-[13px] font-semibold">Liens (PR, commit, notebook, document)</legend>
            <div className="grid gap-2">
              {draft.links.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input className="sm:w-40" placeholder="Libellé" value={l.label} onChange={(e) => set({ links: draft.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label="Libellé du lien" />
                  <Input className="min-w-0 flex-1" type="url" placeholder="https://" value={l.url} onChange={(e) => set({ links: draft.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} aria-label="Adresse du lien" />
                  <Button size="sm" variant="ghost" onClick={() => set({ links: draft.links.filter((_, j) => j !== i) })}>
                    Retirer
                  </Button>
                </div>
              ))}
              <div>
                <Button size="sm" variant="ghost" onClick={() => set({ links: [...draft.links, { url: "", label: "" }] })}>
                  Ajouter un lien
                </Button>
              </div>
            </div>
          </fieldset>
        </div>

        {duplicate && (
          <div className="mt-4">
            <Notice
              tone="warn"
              title="Une fiche existe déjà pour ce sujet à cette date"
              action={
                <div className="flex gap-2">
                  <Link to={`/fiches/${duplicate}/modifier`} className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-2.5 text-[13px] font-medium">
                    Compléter la fiche existante
                  </Link>
                  <Button size="sm" onClick={() => submit(true)}>
                    Créer quand même
                  </Button>
                </div>
              }
            >
              Une fiche par jour et par sujet est recommandée.
            </Notice>
          </div>
        )}
        {!duplicate && (
          <div className="mt-4">
            <ErrorText error={error} />
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button type="submit" variant="primary" loading={busy}>
            {editing ? "Enregistrer la fiche" : "Enregistrer la fiche du jour"}
          </Button>
          <p className="text-xs text-graphite">Pièces jointes : à déposer sur la fiche une fois enregistrée.</p>
        </div>
      </form>
    </div>
  );
}
