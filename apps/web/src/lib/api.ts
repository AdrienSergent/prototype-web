/** Client HTTP de l'API : cookie de session httpOnly + jeton CSRF en en-tête. */

let csrfToken = "";
export function setCsrfToken(token: string | null | undefined) {
  csrfToken = token ?? "";
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { fields?: { path: string; message: string }[]; [k: string]: unknown },
  ) {
    super(message);
  }
}

type Listener = (e: ApiError) => void;
const listeners = new Set<Listener>();
/** Abonnement global aux erreurs d'authentification (redirections). */
export function onAuthError(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") headers["x-csrf-token"] = csrfToken;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as T;
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new ApiError(res.status, data?.code ?? "error", data?.title ?? data?.detail ?? `Erreur ${res.status}`, data?.details);
    if ([401].includes(res.status) || ["mfa_required", "access_expired", "no_company"].includes(err.code)) listeners.forEach((l) => l(err));
    throw err;
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body ?? {} });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body: body ?? {} });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body: body ?? {} });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

export function upload<T>(path: string, fields: Record<string, string>, file: File) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", file);
  return api<T>(path, { method: "POST", form });
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Erreur inattendue";
}

export function qs(params: Record<string, string | number | undefined | null | boolean>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  });
  const str = s.toString();
  return str ? `?${str}` : "";
}
