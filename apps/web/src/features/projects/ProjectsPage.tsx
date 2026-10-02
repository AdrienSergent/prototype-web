import { formatDate, formatHours, projectSchema, VERDICT_LABELS, type ProjectDto, type Verdict } from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { Badge, Button, EmptyState, ErrorText, Field, Input, Loading, Modal, PageHeader, Table, Textarea, td, th } from "../../components/ui";
import { get, post } from "../../lib/api";
import { applyServerErrors, optional, useZodForm } from "../../lib/forms";
import { useFy, usePermissions } from "../../lib/session";

export function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return <Badge tone="neutral">Verdict en attente</Badge>;
  return <Badge tone={verdict === "eligible_cir" ? "ok" : verdict === "piste_cii" ? "warn" : "bad"}>{VERDICT_LABELS[verdict]}</Badge>;
}

const formSchema = projectSchema.extend({ keywordsText: z.string().optional() }).omit({ keywords: true });

export function ProjectForm({ initial, onSubmit, submitLabel, disabled }: { initial?: ProjectDto; onSubmit: (v: z.input<typeof projectSchema>) => Promise<void>; submitLabel: string; disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(formSchema, {
    code: initial?.code ?? "",
    title: initial?.title ?? "",
    startDate: initial?.startDate ?? "",
    endDate: initial?.endDate ?? null,
    objectives: initial?.objectives ?? "",
    keywordsText: initial?.keywords.join(", ") ?? "",
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit(async ({ keywordsText, ...v }) => {
        setError(null);
        try {
          await onSubmit({ ...v, keywords: (keywordsText ?? "").split(",").map((k) => k.trim()).filter(Boolean) });
        } catch (err) {
          setError(applyServerErrors(form, err));
        }
      })}
    >
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <Field label="Code" required error={e.code?.message} hint="Utilisé dans les imports">
          <Input {...form.register("code")} className="uppercase" />
        </Field>
        <Field label="Titre" required error={e.title?.message}>
          <Input {...form.register("title")} />
        </Field>
        <Field label="Début des travaux" required error={e.startDate?.message} hint="Date de référence de l'état de l'art">
          <Input type="date" {...form.register("startDate")} />
        </Field>
        <Field label="Fin prévue ou effective" error={e.endDate?.message}>
          <Input type="date" {...form.register("endDate", optional)} className="sm:max-w-48" />
        </Field>
        <Field label="Objectifs scientifiques ou techniques" error={e.objectives?.message} className="sm:col-span-2">
          <Textarea rows={4} {...form.register("objectives")} />
        </Field>
        <Field label="Mots-clés" hint="Séparés par des virgules. Le domaine de la nomenclature scientifique sera sélectionnable en V1." className="sm:col-span-2">
          <Input {...form.register("keywordsText")} />
        </Field>
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

export function ProjectsPage() {
  const fy = useFy();
  const perms = usePermissions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["projects", fy.id], queryFn: () => get<ProjectDto[]>(`/projects?fiscalYearId=${fy.id}`) });
  if (q.isLoading) return <Loading />;
  const list = q.data ?? [];
  return (
    <div>
      <PageHeader
        title="Projets et verrous"
        description="La qualification précède la rédaction : chaque projet est évalué sur les 5 critères de Frascati avant qu'on y passe du temps."
        actions={perms.writeProjects && <Button variant="primary" onClick={() => setCreating(true)}>Nouveau projet</Button>}
      />
      {list.length === 0 ? (
        <EmptyState title="Aucun projet sur cet exercice" action={perms.writeProjects && <Button variant="primary" onClick={() => setCreating(true)}>Créer le premier projet</Button>}>
          Un projet regroupe un ou plusieurs verrous scientifiques ou techniques, et les travaux menés pour les lever.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Projet</th>
              <th className={th}>Début</th>
              <th className={th}>Qualification</th>
              <th className={clsx(th, "text-right")}>Verrous</th>
              <th className={clsx(th, "text-right")}>Fiches</th>
              <th className={clsx(th, "text-right")}>Temps</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="hover:bg-paper">
                <td className={td}>
                  <Link to={`/projets/${p.id}`} className="font-semibold text-pen hover:underline">
                    {p.code}
                  </Link>
                  <span className="block text-ink-soft">{p.title}</span>
                </td>
                <td className={td}>{formatDate(p.startDate)}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    <VerdictBadge verdict={p.verdict} />
                    {!p.frascatiComplete && <Badge tone="warn">Frascati incomplet</Badge>}
                  </div>
                </td>
                <td className={clsx(td, "text-right tabular-nums")}>{p.lockCount}</td>
                <td className={clsx(td, "text-right tabular-nums")}>{p.noteCount}</td>
                <td className={clsx(td, "text-right tabular-nums")}>{formatHours(p.hours)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nouveau projet" wide>
        <ProjectForm
          submitLabel="Créer le projet"
          onSubmit={async (v) => {
            const p = await post<ProjectDto>("/projects", { ...v, fiscalYearId: fy.id });
            await qc.invalidateQueries({ queryKey: ["projects", fy.id] });
            setCreating(false);
            navigate(`/projets/${p.id}?onglet=frascati`);
          }}
        />
      </Modal>
    </div>
  );
}
