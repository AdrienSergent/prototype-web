import type { Request } from "express";
import { badRequest } from "./errors";

/** Paramètre de route typé (Express 5 type les paramètres en string | string[]). */
export function param(req: Request, name = "id"): string {
  const v = req.params[name];
  if (typeof v !== "string" || !v) throw badRequest(`Paramètre ${name} manquant`);
  return v;
}
