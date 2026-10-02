import { authenticator } from "otplib";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import { createApp } from "../app";
import { sentMails } from "../lib/mailer";

export const app = createApp();

export interface Client {
  agent: TestAgent;
  csrf: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  del: (url: string) => request.Test;
  me: () => Promise<Record<string, unknown>>;
}

export async function client(agent = request.agent(app)): Promise<Client> {
  const c: Client = {
    agent,
    csrf: "",
    get: (url) => agent.get(`/api/v1${url}`),
    post: (url, body) => agent.post(`/api/v1${url}`).set("x-csrf-token", c.csrf).send(body ?? {}),
    put: (url, body) => agent.put(`/api/v1${url}`).set("x-csrf-token", c.csrf).send(body ?? {}),
    patch: (url, body) => agent.patch(`/api/v1${url}`).set("x-csrf-token", c.csrf).send(body ?? {}),
    del: (url) => agent.delete(`/api/v1${url}`).set("x-csrf-token", c.csrf),
    me: async () => {
      const r = await agent.get("/api/v1/auth/me");
      if (r.status === 200) c.csrf = r.body.csrfToken;
      return r.body;
    },
  };
  return c;
}

/** SIREN valide (clé de Luhn) aléatoire. */
export function nextSiren(): string {
  const base = String(Math.floor(10_000_000 + Math.random() * 89_999_999));
  for (let d = 0; d <= 9; d++) {
    const s = base + d;
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let digit = Number(s[8 - i]);
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    if (sum % 10 === 0) return s;
  }
  return nextSiren();
}

export async function signup(email: string, companyName = "ACME R&D") {
  const c = await client();
  const r = await c.agent.post("/api/v1/auth/signup").send({ fullName: `Admin ${companyName}`, email, password: "motdepasse-solide-1", company: { siren: nextSiren(), name: companyName } });
  if (r.status !== 201) throw new Error(`signup ${r.status} ${JSON.stringify(r.body)}`);
  await c.me();
  return c;
}

/** Active la MFA (obligatoire pour administrateur et expert). */
export async function enableMfa(c: Client) {
  const setup = await c.post("/auth/mfa/setup");
  if (setup.status !== 200) throw new Error(`mfa setup ${setup.status} ${JSON.stringify(setup.body)}`);
  const code = authenticator.generate(setup.body.secret);
  const r = await c.post("/auth/mfa/enable", { code });
  if (r.status !== 200) throw new Error(`mfa enable ${r.status}`);
  await c.me();
  return setup.body.secret as string;
}

export function lastMailLink(to: string) {
  const mail = [...sentMails].reverse().find((m) => m.to === to);
  const m = mail ? /invitation\/([A-Za-z0-9_-]+)/.exec(mail.text) : null;
  return m?.[1] ?? null;
}

export const longText = (subject: string) =>
  `${subject}. ` + "Argumentation détaillée et étayée par des éléments datés, des hypothèses explicites et des résultats consignés dans les fiches de recherche. ".repeat(3);
