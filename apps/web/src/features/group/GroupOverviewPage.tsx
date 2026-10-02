import { FISCAL_YEAR_STATUS_LABELS, type GroupOverviewRowDto } from "@cir/shared";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Seal } from "../../components/seal";
import { ErrorText, Loading, PageHeader, Progress, Table, td, th } from "../../components/ui";
import { get } from "../../lib/api";

export function GroupOverviewPage() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["group", id], queryFn: () => get<{ group: { name: string }; companies: GroupOverviewRowDto[] }>(`/groups/${id}/overview`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorText error={q.error} />;
  const d = q.data!;
  return (
    <div>
      <PageHeader title={`Groupe ${d.group.name}`} description="Avancement et statut du dernier exercice de chaque société. Le montant du CIR apparaîtra à partir de la V1, marqué « estimation » tant qu'un expert ne l'a pas validé." />
      <Table>
        <thead>
          <tr>
            <th className={th}>Société</th>
            <th className={th}>Exercice</th>
            <th className={th}>Statut</th>
            <th className={th}>Avancement</th>
            <th className={th}>Montant CIR</th>
          </tr>
        </thead>
        <tbody>
          {d.companies.map((c) => (
            <tr key={c.companyId}>
              <td className={td}>
                <span className="font-semibold">{c.companyName}</span>
                <span className="block text-xs text-graphite">SIREN {c.siren}</span>
              </td>
              <td className={td}>{c.fiscalYearLabel ?? "—"}</td>
              <td className={td}>{c.status ? <Seal status={c.status} size={26} /> : "Aucun exercice"}<span className="sr-only">{c.status ? FISCAL_YEAR_STATUS_LABELS[c.status] : ""}</span></td>
              <td className={td + " w-48"}>
                {c.progress !== null ? (
                  <>
                    <span className="text-sm">{c.progress} %</span>
                    <Progress value={c.progress} className="mt-1" />
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className={td + " text-graphite"}>V1</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
