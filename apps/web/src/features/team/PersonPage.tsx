import { OPERATION_FUNCTION_LABELS, formatNumber, type OperationFunction, type PersonDto, type FileDto } from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { FileBox } from "../../components/files";
import { useToast } from "../../components/toast";
import { Button, ErrorText, Field, Input, Loading, PageHeader, Section, Table, td, th } from "../../components/ui";
import { errorMessage, get, put } from "../../lib/api";
import { usePermissions } from "../../lib/session";
import { PersonForm } from "./PersonForm";

type PersonDetail = PersonDto & {
  files: FileDto[];
  assignments: { projectId: string; projectCode: string; projectTitle: string; fiscalYearId: string; operationFunction: OperationFunction; contribution: string }[];
};

function SalaryBox({ person }: { person: PersonDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState(person.monthlyGrossSalary?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title="Salaire mensuel brut" description="Chiffré en base, visible par l'administrateur seul. Utilisé pour le chiffrage à partir de la V1.">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const n = value.trim() === "" ? null : Number(value.replace(",", "."));
            await put(`/people/${person.id}/salary`, { monthlyGrossSalary: n });
            await qc.invalidateQueries({ queryKey: ["person", person.id] });
            toast("Salaire enregistré");
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        <Field label="Montant (€)" className="w-48">
          <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Button type="submit">Enregistrer</Button>
        {person.monthlyGrossSalary != null && <span className="pb-2 text-sm text-graphite">Actuel : {formatNumber(person.monthlyGrossSalary)} €</span>}
      </form>
      <ErrorText error={error} />
    </Section>
  );
}

export function PersonPage() {
  const { id = "" } = useParams();
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["person", id], queryFn: () => get<PersonDetail>(`/people/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorText error={q.error} />;
  const p = q.data!;
  return (
    <div>
      <PageHeader title={`${p.firstName} ${p.lastName}`} description={p.jobTitle ?? undefined} back={{ to: "/equipe", label: "Équipe" }} />
      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div>
          <Section title="Identité, diplôme et période d'emploi">
            <PersonForm
              initial={p}
              disabled={!perms.manageTeam}
              submitLabel="Enregistrer"
              onSubmit={async (v) => {
                await put(`/people/${p.id}`, v);
                await qc.invalidateQueries({ queryKey: ["person", id] });
                await qc.invalidateQueries({ queryKey: ["people"] });
                toast("Fiche personne enregistrée");
              }}
            />
          </Section>
          {perms.isAdmin && <SalaryBox person={p} />}
          <Section title="Affectations aux projets" description="Gérées depuis l'onglet Équipe de chaque projet.">
            {p.assignments.length === 0 ? (
              <p className="text-sm text-graphite">Aucune affectation.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Projet</th>
                    <th className={th}>Fonction dans l'opération</th>
                    <th className={th}>Contribution directe</th>
                  </tr>
                </thead>
                <tbody>
                  {p.assignments.map((a) => (
                    <tr key={a.projectId}>
                      <td className={td}>
                        <Link to={`/projets/${a.projectId}`} className="font-semibold text-pen hover:underline">
                          {a.projectCode}
                        </Link>{" "}
                        <span className="text-graphite">{a.projectTitle}</span>
                      </td>
                      <td className={td}>{OPERATION_FUNCTION_LABELS[a.operationFunction]}</td>
                      <td className={td}>{a.contribution || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
        </div>
        <aside className="grid content-start gap-3">
          <p className="text-sm text-graphite">Pièces annexées au dossier (dernière version retenue).</p>
          <FileBox kind="person_cv" ownerId={p.id} canWrite={perms.manageTeam} label="CV" />
          <FileBox kind="person_diploma" ownerId={p.id} canWrite={perms.manageTeam} label="Copie du diplôme" />
          <FileBox kind="person_job_description" ownerId={p.id} canWrite={perms.manageTeam} label="Fiche de poste" />
        </aside>
      </div>
    </div>
  );
}
