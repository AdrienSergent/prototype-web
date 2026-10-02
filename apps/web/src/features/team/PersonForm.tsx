import { PERSON_STATUSES, PERSON_STATUS_LABELS, personSchema, type PersonDto, type PersonInput } from "@cir/shared";
import { useState } from "react";
import { Button, Checkbox, ErrorText, Field, Input, Select } from "../../components/ui";
import { applyServerErrors, optional, useZodForm } from "../../lib/forms";

export function PersonForm({ initial, onSubmit, submitLabel, disabled }: { initial?: PersonDto; onSubmit: (v: PersonInput) => Promise<void>; submitLabel: string; disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(personSchema, {
    firstName: initial?.firstName ?? "",
    lastName: initial?.lastName ?? "",
    email: initial?.email ?? null,
    jobTitle: initial?.jobTitle ?? null,
    degree: initial?.degree ?? null,
    degreeInstitution: initial?.degreeInstitution ?? null,
    degreeDate: initial?.degreeDate ?? null,
    status: initial?.status ?? "chercheur",
    entryDate: initial?.entryDate ?? null,
    exitDate: initial?.exitDate ?? null,
    thesisDate: initial?.thesisDate ?? null,
    cdiDate: initial?.cdiDate ?? null,
    isSupportFunction: initial?.isSupportFunction ?? false,
  });
  const e = form.formState.errors;
  const status = form.watch("status");
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await onSubmit(v);
        } catch (err) {
          setError(applyServerErrors(form, err));
        }
      })}
    >
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom" required error={e.firstName?.message}>
          <Input {...form.register("firstName")} />
        </Field>
        <Field label="Nom" required error={e.lastName?.message}>
          <Input {...form.register("lastName")} />
        </Field>
        <Field label="Email" error={e.email?.message} hint="Relie la personne à son compte utilisateur (fiches et temps)">
          <Input type="email" {...form.register("email", optional)} />
        </Field>
        <Field label="Fonction dans l'entreprise" error={e.jobTitle?.message}>
          <Input {...form.register("jobTitle", optional)} />
        </Field>
        <Field label="Diplôme le plus élevé" error={e.degree?.message}>
          <Input {...form.register("degree", optional)} placeholder="Doctorat en informatique" />
        </Field>
        <Field label="Établissement de délivrance" error={e.degreeInstitution?.message}>
          <Input {...form.register("degreeInstitution", optional)} />
        </Field>
        <Field label="Date d'obtention du diplôme" error={e.degreeDate?.message}>
          <Input type="date" {...form.register("degreeDate", optional)} />
        </Field>
        <Field label="Statut" required error={e.status?.message}>
          <Select {...form.register("status")}>
            {PERSON_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PERSON_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date d'entrée" error={e.entryDate?.message}>
          <Input type="date" {...form.register("entryDate", optional)} />
        </Field>
        <Field label="Date de sortie" error={e.exitDate?.message}>
          <Input type="date" {...form.register("exitDate", optional)} />
        </Field>
        {status === "jeune_docteur" && (
          <>
            <Field label="Date de soutenance de thèse" required error={e.thesisDate?.message}>
              <Input type="date" {...form.register("thesisDate", optional)} />
            </Field>
            <Field label="Date d'embauche en CDI" required error={e.cdiDate?.message}>
              <Input type="date" {...form.register("cdiDate", optional)} />
            </Field>
          </>
        )}
        <div className="sm:col-span-2">
          <Checkbox label="Fonction support (administratif, commercial, juridique, direction…) : ses heures ne sont pas du temps de personnel R&D" {...form.register("isSupportFunction")} />
        </div>
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
