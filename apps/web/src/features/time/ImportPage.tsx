import { IMPORT_FIELDS, IMPORT_FIELD_LABELS, type ImportField, type ImportPreviewDto } from "@cir/shared";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { useToast } from "../../components/toast";
import { Badge, Button, ErrorText, Field, Notice, PageHeader, Section, Select, Table, td, th } from "../../components/ui";
import { ApiError, errorMessage, post, upload } from "../../lib/api";
import { useFy } from "../../lib/session";

const STEPS = ["Fichier", "Colonnes", "Contrôle", "Import"];

export function ImportPage() {
  const fy = useFy();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [unit, setUnit] = useState<"hours" | "days">("hours");
  const [duplicates, setDuplicates] = useState<"replace" | "skip">("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const step = !preview ? 0 : preview.status === "committed" ? 3 : checked ? 2 : 1;

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const p = await upload<ImportPreviewDto>("/imports", { fiscalYearId: fy.id }, file);
      setPreview(p);
      setMapping(p.mapping);
      setChecked(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const p = await post<ImportPreviewDto>(`/imports/${preview.id}/mapping`, { mapping, unit });
      setPreview(p);
      setChecked(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const p = await post<ImportPreviewDto>(`/imports/${preview.id}/commit`, { duplicates });
      setPreview(p);
      await qc.invalidateQueries({ queryKey: ["time-entries"] });
      toast(`${p.committedRows} lignes importées`);
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details?.errors)) setPreview({ ...preview, errors: e.details.errors as ImportPreviewDto["errors"] });
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Importer des temps"
        description="Fichier CSV ou Excel, 20 000 lignes au maximum. L'import est tout ou rien : une seule ligne en erreur et rien n'est importé."
        back={{ to: "/temps", label: "Temps" }}
      />
      <ol className="mb-6 flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s} className={clsx("flex items-center gap-2 rounded-full border px-3 py-1", i === step ? "border-pen bg-pen-tint font-semibold text-pen-dark" : i < step ? "border-ok/30 text-ok" : "border-line text-graphite")}>
            <span>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Section>
          <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
            <p className="font-serif text-lg">Déposez le fichier des temps</p>
            <p className="mt-1 text-sm text-graphite">Colonnes attendues : personne (email ou « Prénom Nom »), code projet, date (JJ/MM/AAAA) ou mois (MM/AAAA), heures, fiche (optionnel).</p>
            <input ref={input} type="file" accept=".csv,.xlsx,.txt" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => input.current?.click()} loading={busy}>
                Choisir un fichier
              </Button>
              <a className="inline-flex h-9 items-center rounded-md px-3 text-sm text-pen hover:bg-pen-tint" href="/api/v1/imports/template?format=xlsx">
                Modèle Excel
              </a>
              <a className="inline-flex h-9 items-center rounded-md px-3 text-sm text-pen hover:bg-pen-tint" href="/api/v1/imports/template?format=csv">
                Modèle CSV
              </a>
            </div>
          </div>
        </Section>
      )}

      {preview && step < 3 && (
        <>
          <Section title="Associer les colonnes" description={`${preview.filename} : ${preview.totalRows} lignes. L'association est mémorisée pour les prochains imports.`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((f: ImportField) => (
                <Field key={f} label={IMPORT_FIELD_LABELS[f]} required={f !== "note"}>
                  <Select
                    value={mapping[f] ?? ""}
                    onChange={(e) => {
                      setMapping({ ...mapping, [f]: e.target.value || null });
                      setChecked(false);
                    }}
                  >
                    <option value="">Non associée</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
              <Field label="La colonne quantité est en">
                <Select
                  value={unit}
                  onChange={(e) => {
                    setUnit(e.target.value as "hours" | "days");
                    setChecked(false);
                  }}
                >
                  <option value="hours">heures</option>
                  <option value="days">jours (convertis selon les heures par jour de la société)</option>
                </Select>
              </Field>
            </div>
            <div className="mt-4">
              <Button variant="primary" onClick={check} loading={busy}>
                Contrôler les lignes
              </Button>
            </div>
          </Section>
          <Section title="Aperçu">
            <Table>
              <thead>
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r, i) => (
                  <tr key={i}>
                    {preview.headers.map((h) => (
                      <td key={h} className={td}>
                        {r[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>
        </>
      )}

      {preview && checked && step === 2 && (
        <Section title="Résultat du contrôle">
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge tone="ok">{preview.validRows} lignes valides</Badge>
            {preview.duplicateRows > 0 && <Badge tone="warn">{preview.duplicateRows} déjà présentes</Badge>}
            <Badge tone={preview.errors.length ? "bad" : "neutral"}>{preview.errors.length} en erreur</Badge>
          </div>
          {preview.errors.length > 0 ? (
            <>
              <Notice tone="bad" title="Corrigez le fichier puis recommencez : rien ne sera importé tant qu'une ligne est en erreur." />
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Ligne</th>
                    <th className={th}>Erreur</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.errors.map((e, i) => (
                    <tr key={i}>
                      <td className={clsx(td, "tabular-nums")}>{e.row}</td>
                      <td className={td}>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="mt-3 flex gap-2">
                <a href={`/api/v1/imports/${preview.id}/report`} className="inline-flex h-9 items-center rounded-md border border-line-strong px-3 text-sm">
                  Télécharger le rapport
                </a>
                <Button onClick={() => setPreview(null)}>Déposer un autre fichier</Button>
              </div>
            </>
          ) : (
            <div className="grid gap-3">
              {preview.duplicateRows > 0 && (
                <Field label="Lignes déjà présentes (même personne, projet et date)" className="max-w-md">
                  <Select value={duplicates} onChange={(e) => setDuplicates(e.target.value as "replace" | "skip")}>
                    <option value="skip">Ignorer les lignes du fichier</option>
                    <option value="replace">Remplacer les saisies existantes</option>
                  </Select>
                </Field>
              )}
              <div>
                <Button variant="primary" onClick={commit} loading={busy}>
                  Importer {preview.validRows} lignes
                </Button>
              </div>
            </div>
          )}
        </Section>
      )}

      {preview && step === 3 && (
        <Notice tone="ok" title={`${preview.committedRows} lignes importées`} action={<Link to="/temps?onglet=liste" className="font-semibold text-pen underline">Voir les saisies</Link>}>
          <a href={`/api/v1/imports/${preview.id}/report`} className="text-pen underline">
            Télécharger le rapport d'import
          </a>
        </Notice>
      )}
      <ErrorText error={error} />
    </div>
  );
}
