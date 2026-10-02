import { FISCAL_YEAR_STATUSES, FISCAL_YEAR_STATUS_LABELS, formatBytes, formatDateTime, type ArchiveDto, type ChecklistDto, type FiscalYearTransition } from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { Link } from "react-router";
import { Seal } from "../../components/seal";
import { useToast } from "../../components/toast";
import { Button, ErrorText, Field, Loading, Modal, Notice, PageHeader, Section, Table, Textarea, td, th } from "../../components/ui";
import { errorMessage, get, post } from "../../lib/api";
import { useFy, usePermissions, useSession } from "../../lib/session";

const STEP_HELP: Record<string, string> = {
  draft: "Rédaction, saisie des fiches et des temps.",
  in_review: "Relecture par l'expert ou le cabinet invité ; les contenus restent modifiables.",
  expert_validated: "Contenus figés après validation par l'expert.",
  sealed: "Archive scellée (contenus, pièces et empreintes SHA-256) : lecture seule définitive.",
};

export function ValidationPage() {
  const fy = useFy();
  const perms = usePermissions();
  const { refresh } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [comment, setComment] = useState("");
  const [confirmSeal, setConfirmSeal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checklist = useQuery({ queryKey: ["checklist", fy.id], queryFn: () => get<ChecklistDto>(`/fiscal-years/${fy.id}/checklist`) });
  const archives = useQuery({
    queryKey: ["archives", fy.id],
    queryFn: () => get<ArchiveDto[]>(`/fiscal-years/${fy.id}/archives`),
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === "pending") ? 2000 : false),
  });
  const [verify, setVerify] = useState<Record<string, { ok: boolean; actual: string }>>({});
  const currentIdx = FISCAL_YEAR_STATUSES.indexOf(fy.status);
  const complete = checklist.data && checklist.data.blockingOk === checklist.data.blockingTotal;

  const transition = async (action: FiscalYearTransition) => {
    setBusy(true);
    setError(null);
    try {
      await post(`/fiscal-years/${fy.id}/transition`, { action, comment: comment || undefined });
      await refresh();
      await qc.invalidateQueries({ queryKey: ["archives", fy.id] });
      await qc.invalidateQueries({ queryKey: ["checklist", fy.id] });
      setConfirmSeal(false);
      setComment("");
      toast("Statut de l'exercice mis à jour");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const done = archives.data?.find((a) => a.status === "done");

  return (
    <div>
      <PageHeader title="Validation et scellement" description="L'exercice passe en relecture, l'expert invité le valide, puis l'administrateur le scelle." actions={<Seal status={fy.status} size={48} hash={done?.sha256} />} />

      <Section>
        <ol className="grid gap-3 md:grid-cols-4">
          {FISCAL_YEAR_STATUSES.map((s, i) => (
            <li key={s} className={clsx("rounded-lg border p-3", i === currentIdx ? "border-pen bg-pen-tint" : i < currentIdx ? "border-ok/30 bg-ok-tint" : "border-line bg-surface")}>
              <p className="text-sm font-semibold">
                {i + 1}. {FISCAL_YEAR_STATUS_LABELS[s]}
              </p>
              <p className="mt-1 text-xs text-ink-soft">{STEP_HELP[s]}</p>
            </li>
          ))}
        </ol>
      </Section>

      {checklist.isLoading ? (
        <Loading />
      ) : (
        !complete &&
        fy.status !== "sealed" && (
          <Notice tone="warn" title={`Check-list incomplète : ${checklist.data!.blockingTotal - checklist.data!.blockingOk} point(s) bloquant(s)`} action={<Link to="/dossier/checklist" className="text-sm font-semibold text-pen underline">Voir la check-list</Link>}>
            L'expert ne peut valider l'exercice qu'une fois tous les points bloquants levés.
          </Notice>
        )
      )}

      {fy.expertValidationName && (
        <Section title="Validation de l'expert">
          <p className="text-sm">
            Validé par <strong>{fy.expertValidationName}</strong> le {formatDateTime(fy.expertValidatedAt)}.
          </p>
          {fy.expertComment && <p className="mt-1 font-serif text-[15px] italic text-ink-soft">« {fy.expertComment} »</p>}
        </Section>
      )}

      <Section title="Actions">
        <div className="grid max-w-2xl gap-3">
          {perms.isAdmin && fy.status === "draft" && (
            <Button variant="primary" className="justify-self-start" loading={busy} onClick={() => transition("submit_review")}>
              Passer en relecture
            </Button>
          )}
          {perms.isAdmin && fy.status === "in_review" && (
            <Button className="justify-self-start" loading={busy} onClick={() => transition("back_to_draft")}>
              Revenir en brouillon
            </Button>
          )}
          {perms.isExpert && fy.status === "in_review" && (
            <>
              <Field label="Commentaire de validation (conservé dans l'archive)">
                <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
              <Button variant="primary" className="justify-self-start" disabled={!complete} loading={busy} onClick={() => transition("expert_validate")}>
                Valider l'exercice
              </Button>
            </>
          )}
          {perms.isAdmin && fy.status === "expert_validated" && (
            <div className="flex flex-wrap gap-2">
              <Button variant="wax" loading={busy} onClick={() => setConfirmSeal(true)}>
                Sceller l'exercice
              </Button>
              <Button loading={busy} onClick={() => transition("reopen")}>
                Rouvrir (annule la validation)
              </Button>
            </div>
          )}
          {fy.status === "sealed" && <p className="text-sm text-graphite">Exercice scellé : plus aucune modification n'est possible.</p>}
          {!perms.isAdmin && !perms.isExpert && <p className="text-sm text-graphite">Les changements de statut sont réservés à l'administrateur et à l'expert invité.</p>}
          <ErrorText error={error} />
        </div>
      </Section>

      <Section title="Archives scellées">
        {archives.isLoading ? (
          <Loading />
        ) : (archives.data ?? []).length === 0 ? (
          <p className="text-sm text-graphite">Aucune archive.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Scellée le</th>
                <th className={th}>Statut</th>
                <th className={th}>Contenu</th>
                <th className={th}>Empreinte SHA-256</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {(archives.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td className={td}>
                    {formatDateTime(a.sealedAt)}
                    <span className="block text-xs text-graphite">{a.sealedByName}</span>
                  </td>
                  <td className={td}>{{ pending: "En cours…", done: "Scellée", failed: `Échec : ${a.error}` }[a.status]}</td>
                  <td className={td}>{a.fileCount ? `${a.fileCount} fichiers, ${formatBytes(a.size ?? 0)}` : "—"}</td>
                  <td className={td}>
                    <code className="break-all text-[11px]">{a.sha256 ?? "—"}</code>
                    {verify[a.id] && <span className={clsx("block text-xs font-semibold", verify[a.id]!.ok ? "text-ok" : "text-bad")}>{verify[a.id]!.ok ? "Empreinte vérifiée : archive intacte" : "Empreinte différente : archive altérée"}</span>}
                  </td>
                  <td className={td + " whitespace-nowrap text-right"}>
                    {a.status === "done" && (
                      <>
                        <a href={`/api/v1/archives/${a.id}/download`} className="mr-2 text-sm text-pen hover:underline">
                          Télécharger
                        </a>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const r = await get<{ ok: boolean; actual: string }>(`/archives/${a.id}/verify`);
                            setVerify((v) => ({ ...v, [a.id]: r }));
                          }}
                        >
                          Vérifier
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Modal
        open={confirmSeal}
        onClose={() => setConfirmSeal(false)}
        title="Sceller l'exercice"
        footer={
          <>
            <Button onClick={() => setConfirmSeal(false)}>Annuler</Button>
            <Button variant="wax" loading={busy} onClick={() => transition("seal")}>
              Sceller définitivement
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Le scellement produit une archive ZIP (contenus, vue consolidée, pièces annexées, manifeste des empreintes) stockée en mode non modifiable, et passe l'exercice {fy.label} en lecture seule
          définitive. Cette action est irréversible.
        </p>
      </Modal>
    </div>
  );
}
