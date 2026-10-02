import { MESR_PLAN, REFERENCE_TYPES, REFERENCE_TYPE_LABELS, formatDate, referenceSchema, type ReferenceDto } from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "../../components/toast";
import { Button, EmptyState, ErrorText, Field, Input, Loading, Modal, PageHeader, Select, Table, td, th } from "../../components/ui";
import { del, errorMessage, get, post, put } from "../../lib/api";
import { applyServerErrors, optional, useZodForm } from "../../lib/forms";
import { useFy, usePermissions } from "../../lib/session";

function RefForm({ initial, onDone }: { initial?: ReferenceDto; onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(referenceSchema, {
    refType: initial?.refType ?? "article",
    title: initial?.title ?? "",
    authors: initial?.authors ?? "",
    publishedOn: initial?.publishedOn ?? "",
    doi: initial?.doi ?? null,
    url: initial?.url ?? null,
    patentNumber: initial?.patentNumber ?? null,
  });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={form.handleSubmit(async (v) => {
        try {
          if (initial) await put(`/references/${initial.id}`, v);
          else await post("/references", v);
          await qc.invalidateQueries({ queryKey: ["references"] });
          onDone();
        } catch (err) {
          setError(applyServerErrors(form, err));
        }
      })}
    >
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <Field label="Type">
          <Select {...form.register("refType")}>
            {REFERENCE_TYPES.map((t) => (
              <option key={t} value={t}>{REFERENCE_TYPE_LABELS[t]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Titre" required error={e.title?.message}>
          <Input {...form.register("title")} />
        </Field>
        <Field label="Date de publication" required error={e.publishedOn?.message}>
          <Input type="date" {...form.register("publishedOn")} />
        </Field>
        <Field label="Auteurs" error={e.authors?.message}>
          <Input {...form.register("authors")} placeholder="Dupont A., Martin B." />
        </Field>
        <Field label="DOI" error={e.doi?.message}>
          <Input {...form.register("doi", optional)} />
        </Field>
        <Field label="URL" error={e.url?.message}>
          <Input type="url" {...form.register("url", optional)} />
        </Field>
        <Field label="N° de brevet" error={e.patentNumber?.message}>
          <Input {...form.register("patentNumber", optional)} />
        </Field>
      </div>
      <ErrorText error={error} />
      <div>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>Enregistrer</Button>
      </div>
    </form>
  );
}

export function ReferencesPage() {
  const fy = useFy();
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<ReferenceDto | "new" | null>(null);
  const q = useQuery({ queryKey: ["references", fy.id], queryFn: () => get<ReferenceDto[]>(`/references?fiscalYearId=${fy.id}`) });
  if (q.isLoading) return <Loading />;
  const list = q.data ?? [];
  const canEdit = perms.manageTeam;
  return (
    <div>
      <PageHeader
        title="Bibliographie datée"
        description="Les références de l'état de l'art doivent être antérieures au début des travaux du projet : une alerte signale toute référence postérieure."
        actions={canEdit && <Button variant="primary" onClick={() => setEdit("new")}>Ajouter une référence</Button>}
      />
      {list.length === 0 ? (
        <EmptyState title="Aucune référence">Articles, brevets, normes ou logiciels qui établissent l'état des connaissances au début des travaux.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Référence</th>
              <th className={th}>Type</th>
              <th className={th}>Publication</th>
              <th className={th}>Citée dans</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td className={td}>
                  <span className="font-serif text-[15px] italic">{r.title}</span>
                  <span className="block text-xs text-graphite">
                    {r.authors}
                    {r.doi && `, DOI ${r.doi}`}
                    {r.patentNumber && `, brevet ${r.patentNumber}`}
                  </span>
                  {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-pen underline">{r.url}</a>}
                </td>
                <td className={td}>{REFERENCE_TYPE_LABELS[r.refType]}</td>
                <td className={td}>{formatDate(r.publishedOn)}</td>
                <td className={td}>
                  {r.citedIn.length ? r.citedIn.map((c) => `${c.projectCode ?? "Société"} ${MESR_PLAN[c.rubrique].numero}`).join(", ") : <span className="text-graphite">Non citée</span>}
                </td>
                <td className={td + " whitespace-nowrap text-right"}>
                  {canEdit && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Modifier</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-bad"
                        onClick={async () => {
                          try {
                            await del(`/references/${r.id}`);
                            await qc.invalidateQueries({ queryKey: ["references"] });
                          } catch (e) {
                            toast(errorMessage(e), "bad");
                          }
                        }}
                      >
                        Supprimer
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Nouvelle référence" : "Modifier la référence"} wide>
        {edit && <RefForm initial={edit === "new" ? undefined : edit} onDone={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}
