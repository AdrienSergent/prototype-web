import { PERSON_STATUS_LABELS, formatDate, type PersonDto } from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Badge, Button, EmptyState, Loading, Modal, PageHeader, Table, td, th } from "../../components/ui";
import { useToast } from "../../components/toast";
import { get, post } from "../../lib/api";
import { usePermissions } from "../../lib/session";
import { PersonForm } from "./PersonForm";

export function TeamPage() {
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const people = useQuery({ queryKey: ["people"], queryFn: () => get<PersonDto[]>("/people") });
  if (people.isLoading) return <Loading />;
  const list = people.data ?? [];
  return (
    <div>
      <PageHeader
        title="Équipe"
        description="Personnel de R&D : diplôme, CV et affectations nourrissent la rubrique « Moyens » et les annexes du dossier."
        actions={perms.manageTeam && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            Ajouter une personne
          </Button>
        )}
      />
      {list.length === 0 ? (
        <EmptyState title="Aucune personne pour l'instant" action={perms.manageTeam && <Button variant="primary" onClick={() => setAdding(true)}>Ajouter une personne</Button>}>
          Ajoutez les chercheurs et techniciens qui contribuent aux travaux de R&D.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Nom</th>
              <th className={th}>Fonction</th>
              <th className={th}>Statut</th>
              <th className={th}>Diplôme</th>
              <th className={th}>Pièces</th>
              <th className={th}>Période</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="hover:bg-paper">
                <td className={td}>
                  <Link to={`/equipe/${p.id}`} className="font-semibold text-pen hover:underline">
                    {p.lastName.toUpperCase()} {p.firstName}
                  </Link>
                  {p.isSupportFunction && <Badge tone="warn" className="ml-2">Fonction support</Badge>}
                </td>
                <td className={td}>{p.jobTitle ?? "—"}</td>
                <td className={td}>{PERSON_STATUS_LABELS[p.status]}</td>
                <td className={td}>{p.degree ? <>{p.degree}<span className="block text-xs text-graphite">{p.degreeInstitution} {p.degreeDate && `(${formatDate(p.degreeDate)})`}</span></> : <Badge tone="bad">Manquant</Badge>}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={p.hasCv ? "ok" : "bad"}>CV</Badge>
                    <Badge tone={p.hasDiploma ? "ok" : "neutral"}>Diplôme</Badge>
                  </div>
                </td>
                <td className={td}>
                  {p.entryDate ? formatDate(p.entryDate) : "—"}
                  {p.exitDate && ` → ${formatDate(p.exitDate)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Ajouter une personne" wide>
        <PersonForm
          submitLabel="Ajouter"
          onSubmit={async (v) => {
            const p = await post<PersonDto>("/people", v);
            await qc.invalidateQueries({ queryKey: ["people"] });
            toast("Personne ajoutée : déposez maintenant son CV");
            setAdding(false);
            navigate(`/equipe/${p.id}`);
          }}
        />
      </Modal>
    </div>
  );
}
