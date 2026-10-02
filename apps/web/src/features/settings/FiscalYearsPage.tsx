import { FISCAL_YEAR_STATUS_LABELS, formatDate, type FiscalYearDto } from "@cir/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Seal } from "../../components/seal";
import { useToast } from "../../components/toast";
import { Button, ErrorText, Field, Input, Modal, PageHeader, Section, Table, td, th } from "../../components/ui";
import { errorMessage, post } from "../../lib/api";
import { usePermissions, useSession } from "../../lib/session";

function nextYear(fy?: FiscalYearDto) {
  if (!fy) {
    const y = new Date().getFullYear();
    return { label: String(y), startDate: `${y}-01-01`, endDate: `${y}-12-31` };
  }
  const shift = (iso: string) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
  return { label: String(Number(fy.label) + 1 || `${fy.label} + 1`), startDate: shift(fy.startDate), endDate: shift(fy.endDate) };
}

export function FiscalYearsPage() {
  const { fiscalYears, setFyId, refresh } = useSession();
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<{ kind: "create" } | { kind: "duplicate"; source: FiscalYearDto } | null>(null);
  const [values, setValues] = useState(nextYear(fiscalYears[0]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (m: NonNullable<typeof mode>) => {
    setValues(nextYear(m.kind === "duplicate" ? m.source : fiscalYears[0]));
    setError(null);
    setMode(m);
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const fy = await post<FiscalYearDto>(mode?.kind === "duplicate" ? `/fiscal-years/${mode.source.id}/duplicate` : "/fiscal-years", values);
      await refresh();
      await qc.invalidateQueries();
      setFyId(fy.id);
      setMode(null);
      toast(`Exercice ${fy.label} créé`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Exercices fiscaux" description="Un dossier technique par exercice. La duplication reprend les projets pluriannuels : état de l'art et verrous sont repris et marqués « à actualiser »." actions={perms.isAdmin && <Button variant="primary" onClick={() => open({ kind: "create" })}>Nouvel exercice</Button>} />
      <Section>
        {fiscalYears.length === 0 ? (
          <p className="text-sm text-graphite">Aucun exercice.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Exercice</th>
                <th className={th}>Période</th>
                <th className={th}>Statut</th>
                <th className={th}>Complétude</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {fiscalYears.map((f) => (
                <tr key={f.id}>
                  <td className={td + " font-semibold"}>{f.label}</td>
                  <td className={td}>
                    {formatDate(f.startDate)} au {formatDate(f.endDate)}
                  </td>
                  <td className={td}>
                    <Seal status={f.status} size={26} />
                    <span className="sr-only">{FISCAL_YEAR_STATUS_LABELS[f.status]}</span>
                  </td>
                  <td className={td}>{f.progress} %</td>
                  <td className={td + " text-right"}>
                    {perms.isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => open({ kind: "duplicate", source: f })}>
                        Dupliquer vers l'exercice suivant
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      <Modal
        open={!!mode}
        onClose={() => setMode(null)}
        title={mode?.kind === "duplicate" ? `Dupliquer ${mode.source.label}` : "Nouvel exercice"}
        footer={
          <>
            <Button onClick={() => setMode(null)}>Annuler</Button>
            <Button variant="primary" loading={busy} onClick={submit}>
              {mode?.kind === "duplicate" ? "Dupliquer" : "Créer"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {mode?.kind === "duplicate" && (
            <p className="text-sm text-graphite">
              Sont repris : projets non clos, opérations (intitulé verrouillé), équipes, réponses Frascati, verrous et sujets ouverts, sections « État de l'art » et « Verrous ». Le verdict est à reconfirmer ; ni fiches ni temps ne sont copiés.
            </p>
          )}
          <Field label="Libellé">
            <Input value={values.label} onChange={(e) => setValues({ ...values, label: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Début">
              <Input type="date" value={values.startDate} onChange={(e) => setValues({ ...values, startDate: e.target.value })} />
            </Field>
            <Field label="Fin">
              <Input type="date" value={values.endDate} onChange={(e) => setValues({ ...values, endDate: e.target.value })} />
            </Field>
          </div>
          <ErrorText error={error} />
        </div>
      </Modal>
    </div>
  );
}
