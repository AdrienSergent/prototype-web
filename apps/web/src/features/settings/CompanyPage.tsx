import { RESCRIT_TYPES, RESCRIT_TYPE_LABELS, companyUpdateSchema, formatDate, type CompanyDto, type RescritDto, type RescritType } from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { FileBox } from "../../components/files";
import { useToast } from "../../components/toast";
import { Button, ErrorText, Field, Input, Loading, Modal, PageHeader, Section, Select, Table, Textarea, td, th } from "../../components/ui";
import { del, errorMessage, get, post, put } from "../../lib/api";
import { applyServerErrors, number, optional, optionalNumber, useZodForm } from "../../lib/forms";
import { usePermissions } from "../../lib/session";

function CompanyForm({ company }: { company: CompanyDto }) {
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(companyUpdateSchema, {
    name: company.name,
    nafCode: company.nafCode,
    sector: company.sector,
    headcountTotal: company.headcountTotal,
    headcountRd: company.headcountRd,
    rdOrganization: company.rdOrganization,
    hoursPerDay: company.hoursPerDay,
    annualHoursCap: company.annualHoursCap,
    unlinkedThreshold: company.unlinkedThreshold,
    referentName: company.referentName,
    referentRole: company.referentRole,
    referentPhone: company.referentPhone,
    referentEmail: company.referentEmail,
  });
  useEffect(() => form.reset(form.getValues()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const e = form.formState.errors;
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await put("/company", v);
          await qc.invalidateQueries({ queryKey: ["company"] });
          toast("Société enregistrée");
        } catch (err) {
          setError(applyServerErrors(form, err));
        }
      })}
    >
      <fieldset disabled={!perms.manageCompany} className="grid gap-8">
        <Section title="Identité et organisation de la R&D" className="mb-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Raison sociale" required error={e.name?.message}>
              <Input {...form.register("name")} />
            </Field>
            <Field label="SIREN">
              <Input value={company.siren} disabled />
            </Field>
            <Field label="Code NAF" error={e.nafCode?.message}>
              <Input {...form.register("nafCode", optional)} />
            </Field>
            <Field label="Secteur" error={e.sector?.message}>
              <Input {...form.register("sector", optional)} />
            </Field>
            <Field label="Effectif total" error={e.headcountTotal?.message}>
              <Input inputMode="numeric" {...form.register("headcountTotal", optionalNumber)} />
            </Field>
            <Field label="Effectif R&D" error={e.headcountRd?.message} hint="Le ratio R&D / total figure dans la rubrique 1.2">
              <Input inputMode="numeric" {...form.register("headcountRd", optionalNumber)} />
            </Field>
            <Field label="Organisation de la R&D" className="sm:col-span-2">
              <Textarea rows={3} {...form.register("rdOrganization", optional)} />
            </Field>
          </div>
        </Section>
        <Section title="Référent du dossier justificatif" description="Exigé par le MESR : la personne à contacter pour le dossier." className="mb-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom">
              <Input {...form.register("referentName", optional)} />
            </Field>
            <Field label="Fonction">
              <Input {...form.register("referentRole", optional)} />
            </Field>
            <Field label="Téléphone">
              <Input {...form.register("referentPhone", optional)} />
            </Field>
            <Field label="Email" error={e.referentEmail?.message}>
              <Input type="email" {...form.register("referentEmail", optional)} />
            </Field>
          </div>
        </Section>
        <Section title="Paramètres des temps" className="mb-0">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Heures par jour" error={e.hoursPerDay?.message} hint="Conversion jours → heures et capacité journalière">
              <Input inputMode="decimal" {...form.register("hoursPerDay", number)} />
            </Field>
            <Field label="Plafond annuel (heures)" error={e.annualHoursCap?.message} hint="1 607 h par défaut">
              <Input inputMode="numeric" {...form.register("annualHoursCap", number)} />
            </Field>
            <Field label="Seuil d'alerte temps non rattachés (%)" error={e.unlinkedThreshold?.message}>
              <Input inputMode="numeric" {...form.register("unlinkedThreshold", number)} />
            </Field>
          </div>
        </Section>
      </fieldset>
      <div className="mt-4">
        <ErrorText error={error} />
        {perms.manageCompany && (
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting} className="mt-2">
            Enregistrer
          </Button>
        )}
      </div>
    </form>
  );
}

function Rescrits() {
  const perms = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["rescrits"], queryFn: () => get<RescritDto[]>("/company/rescrits") });
  const [edit, setEdit] = useState<Partial<RescritDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title="Rescrits et agréments" description="À déclarer dans la partie 1 du dossier : rescrit CIR, JEI, CICo, agréments." actions={perms.manageCompany && <Button onClick={() => setEdit({ type: "rescrit_cir", decision: "favorable", years: "" })}>Ajouter</Button>}>
      {(q.data ?? []).length === 0 ? (
        <p className="text-sm text-graphite">Aucun rescrit ni agrément.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Type</th>
              <th className={th}>Date de l'avis</th>
              <th className={th}>Décision</th>
              <th className={th}>Années</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className={td}>{RESCRIT_TYPE_LABELS[r.type]}</td>
                <td className={td}>{formatDate(r.decisionDate)}</td>
                <td className={td}>{{ favorable: "Favorable", defavorable: "Défavorable", en_attente: "En attente" }[r.decision]}</td>
                <td className={td}>{r.years}</td>
                <td className={td + " text-right"}>
                  {perms.manageCompany && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Modifier</Button>
                      <Button size="sm" variant="ghost" className="text-bad" onClick={async () => { await del(`/company/rescrits/${r.id}`); qc.invalidateQueries({ queryKey: ["rescrits"] }); }}>Supprimer</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Rescrit ou agrément"
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              setError(null);
              try {
                const body = { type: edit!.type, decisionDate: edit!.decisionDate || null, decision: edit!.decision, years: edit!.years ?? "" };
                if (edit!.id) await put(`/company/rescrits/${edit!.id}`, body);
                else await post("/company/rescrits", body);
                await qc.invalidateQueries({ queryKey: ["rescrits"] });
                setEdit(null);
                toast("Enregistré");
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Enregistrer
          </Button>
        }
      >
        {edit && (
          <div className="grid gap-3">
            <Field label="Type">
              <Select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as RescritType })}>
                {RESCRIT_TYPES.map((t) => (
                  <option key={t} value={t}>{RESCRIT_TYPE_LABELS[t]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date de l'avis">
              <Input type="date" value={edit.decisionDate ?? ""} onChange={(e) => setEdit({ ...edit, decisionDate: e.target.value })} />
            </Field>
            <Field label="Décision">
              <Select value={edit.decision} onChange={(e) => setEdit({ ...edit, decision: e.target.value as RescritDto["decision"] })}>
                <option value="favorable">Favorable</option>
                <option value="defavorable">Défavorable</option>
                <option value="en_attente">En attente</option>
              </Select>
            </Field>
            <Field label="Année(s) concernée(s)">
              <Input value={edit.years ?? ""} onChange={(e) => setEdit({ ...edit, years: e.target.value })} placeholder="2025, 2026" />
            </Field>
            <ErrorText error={error} />
          </div>
        )}
      </Modal>
    </Section>
  );
}

export function CompanyPage() {
  const perms = usePermissions();
  const q = useQuery({ queryKey: ["company"], queryFn: () => get<CompanyDto>("/company") });
  if (q.isLoading) return <Loading />;
  const c = q.data!;
  return (
    <div>
      <PageHeader title="Société" description="Ces informations alimentent la partie 1 du dossier : présentation, organisation de la R&D, effectifs, rescrits et référent." />
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <CompanyForm company={c} />
          <div className="mt-8">
            <Rescrits />
          </div>
        </div>
        <aside className="grid content-start gap-3">
          <FileBox kind="company_orgchart" ownerId={c.id} canWrite={perms.manageCompany} label="Organigramme de la société" latestOnly />
          <FileBox kind="company_rd_orgchart" ownerId={c.id} canWrite={perms.manageCompany} label="Organigramme de l'équipe R&D" latestOnly />
        </aside>
      </div>
    </div>
  );
}
