import type { ErrorRequestHandler } from "express";
import { ZodError, type ZodType, type z } from "zod";
import { logger } from "./logger";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentification requise") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "Action non autorisée pour votre rôle", code = "forbidden") => new HttpError(403, code, message);
export const notFound = (message = "Ressource introuvable") => new HttpError(404, "not_found", message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, "conflict", message, details);
export const unprocessable = (message: string, details?: unknown) => new HttpError(422, "validation_error", message, details);

/** Valide une entrée avec un schéma Zod ; lève une 422 avec le détail par champ. */
export function parse<S extends ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw zodToHttp(r.error);
  return r.data;
}

function zodToHttp(err: ZodError) {
  const fields = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  return unprocessable(fields[0]?.message ?? "Données invalides", { fields });
}

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

/** Erreurs au format RFC 9457 (application/problem+json). */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let e: HttpError;
  if (err instanceof HttpError) e = err;
  else if (err instanceof ZodError) e = zodToHttp(err);
  else if ((err as { type?: string }).type === "entity.parse.failed") e = badRequest("JSON invalide");
  else if ((err as { code?: string }).code === "LIMIT_FILE_SIZE") e = new HttpError(413, "file_too_large", "Fichier trop volumineux");
  else {
    const pgErr = (err as { cause?: PgError }).cause ?? (err as PgError);
    if (pgErr?.code === "23505") e = conflict("Cette valeur existe déjà", { constraint: pgErr.constraint });
    else if (pgErr?.code === "42501") e = forbidden("Accès refusé");
    else if (pgErr?.code === "23503") e = conflict("Élément référencé introuvable ou encore utilisé", { constraint: pgErr.constraint });
    else if (pgErr?.code === "23514") e = unprocessable("Valeur refusée par une contrainte", { constraint: pgErr.constraint });
    else {
      logger.error({ err, path: req.path }, "Erreur non gérée");
      e = new HttpError(500, "internal_error", "Erreur interne");
    }
  }
  res
    .status(e.status)
    .type("application/problem+json")
    .json({ type: `about:blank#${e.code}`, title: e.message, status: e.status, code: e.code, detail: e.message, ...(e.details ? { details: e.details } : {}) });
};
