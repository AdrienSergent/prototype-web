import { ROLES, ROLE_LABELS, formatDate, formatDateTime, type InvitationDto, type MemberDto, type Role } from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "../../components/toast";
import { Badge, Button, ErrorText, Field, Input, Loading, Notice, PageHeader, Section, Select, Table, td, th } from "../../components/ui";
import { del, errorMessage, get, patch, post } from "../../lib/api";
import { useSession } from "../../lib/session";

const ROLE_HELP: Record<Role, string> = {
  admin: "Pilote la campagne, gère l'équipe, valide les rubriques et scelle l'exercice.",
  redacteur: "Rédige l'état de l'art, les verrous et les travaux ; structure projets et sujets.",
  contributeur: "Saisit ses fiches de recherche et ses temps sur ses projets.",
  expert: "Relit, commente, rend le verdict Frascati et valide l'exercice. Accès limité dans le temps.",
};

export function MembersPage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const members = useQuery({ queryKey: ["members"], queryFn: () => get<MemberDto[]>("/members") });
  const invitations = useQuery({ queryKey: ["invitations"], queryFn: () => get<InvitationDto[]>("/invitations") });
  const [form, setForm] = useState<{ email: string; role: Role; accessExpiresAt: string }>({ email: "", role: "contributeur", accessExpiresAt: "" });
  const [error, setError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  if (members.isLoading) return <Loading />;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["members"] }), qc.invalidateQueries({ queryKey: ["invitations"] })]);
  return (
    <div>
      <PageHeader title="Membres et invitations" description="Quatre rôles par société. La double authentification est obligatoire pour l'administrateur et l'expert." />
      <Section title="Inviter une personne">
        <form
          className="grid items-end gap-3 md:grid-cols-[1fr_200px_180px_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              const r = await post<InvitationDto & { devLink?: string }>("/invitations", { ...form, accessExpiresAt: form.role === "expert" && form.accessExpiresAt ? form.accessExpiresAt : null });
              setDevLink(r.devLink ?? null);
              setForm({ ...form, email: "" });
              await refresh();
              toast(`Invitation envoyée à ${r.email}`);
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <Field label="Email">
            <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Rôle">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Accès jusqu'au">
            <Input type="date" disabled={form.role !== "expert"} value={form.accessExpiresAt} onChange={(e) => setForm({ ...form, accessExpiresAt: e.target.value })} />
          </Field>
          <Button type="submit" variant="primary">Inviter</Button>
        </form>
        <p className="mt-2 text-xs text-graphite">{ROLE_HELP[form.role]}</p>
        <div className="mt-2"><ErrorText error={error} /></div>
        {devLink && <Notice tone="pen" title="Lien d'invitation (environnement de développement)"><code className="break-all text-xs">{devLink}</code></Notice>}
      </Section>
      <Section title="Membres">
        <Table>
          <thead>
            <tr>
              <th className={th}>Nom</th>
              <th className={th}>Rôle</th>
              <th className={th}>Accès jusqu'au</th>
              <th className={th}>Double authentification</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {(members.data ?? []).map((m) => (
              <tr key={m.id}>
                <td className={td}>
                  <span className="font-semibold">{m.fullName}</span>
                  <span className="block text-xs text-graphite">{m.email}</span>
                </td>
                <td className={td}>
                  <Select
                    className="w-44"
                    value={m.role}
                    disabled={m.userId === me?.user.id}
                    onChange={async (e) => {
                      try {
                        await patch(`/members/${m.id}`, { role: e.target.value, accessExpiresAt: m.accessExpiresAt });
                        await refresh();
                      } catch (err) {
                        toast(errorMessage(err), "bad");
                      }
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </Select>
                </td>
                <td className={td}>{m.accessExpiresAt ? formatDate(m.accessExpiresAt) : "—"}</td>
                <td className={td}>{m.mfaEnabled ? <Badge tone="ok">Activée</Badge> : <Badge tone={m.role === "admin" || m.role === "expert" ? "bad" : "neutral"}>Non activée</Badge>}</td>
                <td className={td + " text-right"}>
                  {m.userId !== me?.user.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-bad"
                      onClick={async () => {
                        if (!confirm(`Révoquer l'accès de ${m.fullName} ?`)) return;
                        try {
                          await del(`/members/${m.id}`);
                          await refresh();
                        } catch (err) {
                          toast(errorMessage(err), "bad");
                        }
                      }}
                    >
                      Révoquer
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
      <Section title="Invitations">
        {(invitations.data ?? []).length === 0 ? (
          <p className="text-sm text-graphite">Aucune invitation.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Email</th>
                <th className={th}>Rôle</th>
                <th className={th}>État</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {(invitations.data ?? []).map((i) => (
                <tr key={i.id}>
                  <td className={td}>{i.email}</td>
                  <td className={td}>{ROLE_LABELS[i.role]}</td>
                  <td className={td}>{i.acceptedAt ? `Acceptée le ${formatDateTime(i.acceptedAt)}` : new Date(i.expiresAt) < new Date() ? "Expirée" : `En attente jusqu'au ${formatDateTime(i.expiresAt)}`}</td>
                  <td className={td + " text-right"}>
                    {!i.acceptedAt && (
                      <Button size="sm" variant="ghost" className="text-bad" onClick={async () => { await del(`/invitations/${i.id}`); await refresh(); }}>
                        Annuler
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}
