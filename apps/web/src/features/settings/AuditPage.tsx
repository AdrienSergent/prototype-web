import { formatDateTime, type AuditEntryDto } from "@cir/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Loading, Notice, PageHeader, Table, td, th } from "../../components/ui";
import { get, qs } from "../../lib/api";

export function AuditPage() {
  const [verify, setVerify] = useState<{ ok: boolean; total: number; broken: number; firstBrokenId: number | null } | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["audit"],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => get<AuditEntryDto[]>(`/audit${qs({ limit: 50, before: pageParam })}`),
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1]!.id : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  return (
    <div>
      <PageHeader
        title="Journal d'audit"
        description="Qui a créé, modifié, validé quoi et quand. Le journal est en insertion seule et chaque ligne est chaînée à la précédente par une empreinte SHA-256."
        actions={<Button onClick={async () => setVerify(await get("/audit/verify"))}>Vérifier l'intégrité</Button>}
      />
      {verify && (
        <Notice tone={verify.ok ? "ok" : "bad"} title={verify.ok ? `Chaîne intègre : ${verify.total} entrées vérifiées` : `${verify.broken} entrée(s) incohérente(s), à partir de la n° ${verify.firstBrokenId}`} />
      )}
      {q.isLoading ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Date</th>
              <th className={th}>Auteur</th>
              <th className={th}>Action</th>
              <th className={th}>Détail</th>
              <th className={th}>Empreinte</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={td + " whitespace-nowrap"}>{formatDateTime(r.createdAt)}</td>
                <td className={td}>{r.actorName ?? "—"}</td>
                <td className={td + " whitespace-nowrap"}>
                  {r.action} : {r.entity}
                </td>
                <td className={td}>{r.summary}</td>
                <td className={td}>
                  <code className="text-[11px] text-graphite" title={r.hash}>
                    {r.hash.slice(0, 12)}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {q.hasNextPage && (
        <div className="mt-3">
          <Button onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Entrées plus anciennes
          </Button>
        </div>
      )}
    </div>
  );
}
