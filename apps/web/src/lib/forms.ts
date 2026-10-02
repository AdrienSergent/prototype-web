import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type DefaultValues, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import type { ZodType } from "zod";
import { ApiError } from "./api";

/** Formulaire validé par un schéma Zod partagé avec l'API. */
export function useZodForm<T extends FieldValues>(schema: ZodType<T, any, any>, defaultValues: DefaultValues<T>) {
  return useForm<T>({ resolver: zodResolver(schema as never) as never, defaultValues, mode: "onBlur" });
}

/** Reporte les erreurs de validation renvoyées par l'API sur les champs du formulaire. */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T>, e: unknown): string | null {
  if (e instanceof ApiError && e.details?.fields?.length) {
    for (const f of e.details.fields) form.setError(f.path as Path<T>, { message: f.message });
    return e.message;
  }
  return e instanceof Error ? e.message : "Erreur inattendue";
}

/** Champs optionnels vides → null (dates, emails). */
export function nullify<T extends Record<string, unknown>>(values: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) out[k] = v === "" ? null : v;
  return out as T;
}

/** Options d'enregistrement RHF : champ texte/date optionnel vide → null. */
export const optional = { setValueAs: (v: unknown) => (v === "" || v === undefined ? null : v) };
/** Nombre optionnel (vide → null), virgule décimale acceptée. */
export const optionalNumber = {
  setValueAs: (v: unknown) => {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : v;
  },
};
/** Nombre obligatoire, virgule décimale acceptée. */
export const number = {
  setValueAs: (v: unknown) => {
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : v;
  },
};
