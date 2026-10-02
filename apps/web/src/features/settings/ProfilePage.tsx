import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "../../components/toast";
import { Badge, Button, ButtonLink, Checkbox, ErrorText, Field, Input, PageHeader, Section, Select } from "../../components/ui";
import { errorMessage, get, post, put } from "../../lib/api";
import { useSession } from "../../lib/session";

const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

export function ProfilePage() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const reminder = useQuery({ queryKey: ["reminder"], queryFn: () => get<{ enabled: boolean; hour: number; weekdays: number[] }>("/auth/reminder") });
  const [r, setR] = useState<{ enabled: boolean; hour: number; weekdays: number[] } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rem = r ?? reminder.data ?? { enabled: false, hour: 17, weekdays: [1, 2, 3, 4, 5] };
  if (!me) return null;
  return (
    <div className="max-w-2xl">
      <PageHeader title="Mon profil" description={`${me.user.fullName}, ${me.user.email}`} />
      <Section title="Rappel quotidien" description="Un email en fin de journée pour penser à consigner la fiche du jour (moins de 2 minutes).">
        <div className="grid gap-3">
          <Checkbox label="Recevoir le rappel" checked={rem.enabled} onChange={(e) => setR({ ...rem, enabled: e.target.checked })} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Heure" className="w-28">
              <Select value={rem.hour} onChange={(e) => setR({ ...rem, hour: Number(e.target.value) })}>
                {Array.from({ length: 16 }, (_, i) => i + 6).map((h) => (
                  <option key={h} value={h}>{h} h</option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-3 pb-2">
              {WEEKDAYS.map((d, i) => (
                <Checkbox key={d} label={d} checked={rem.weekdays.includes(i + 1)} onChange={(e) => setR({ ...rem, weekdays: e.target.checked ? [...rem.weekdays, i + 1].sort() : rem.weekdays.filter((x) => x !== i + 1) })} />
              ))}
            </div>
          </div>
          <Button
            className="justify-self-start"
            onClick={async () => {
              try {
                await put("/auth/reminder", rem);
                toast("Rappel enregistré");
              } catch (e) {
                toast(errorMessage(e), "bad");
              }
            }}
          >
            Enregistrer le rappel
          </Button>
        </div>
      </Section>
      <Section title="Double authentification">
        {me.user.mfaEnabled ? (
          <div className="grid gap-3">
            <p className="text-sm">
              <Badge tone="ok">Activée</Badge>
            </p>
            {me.role !== "admin" && me.role !== "expert" && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await post("/auth/mfa/disable", { code: mfaCode });
                    await refresh();
                    toast("Double authentification désactivée");
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                }}
              >
                <Field label="Code actuel pour désactiver" className="w-48">
                  <Input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
                </Field>
                <Button type="submit" variant="danger">Désactiver</Button>
              </form>
            )}
          </div>
        ) : (
          <ButtonLink to="/securite/mfa" variant="primary">Activer la double authentification</ButtonLink>
        )}
      </Section>
      <Section title="Mot de passe">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await put("/auth/password", pw);
              setPw({ current: "", next: "" });
              toast("Mot de passe modifié ; vos autres sessions sont déconnectées");
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <Field label="Mot de passe actuel">
            <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="Nouveau mot de passe" hint="12 caractères minimum">
            <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={12} required />
          </Field>
          <Button type="submit" className="justify-self-start">Modifier le mot de passe</Button>
        </form>
      </Section>
      <ErrorText error={error} />
    </div>
  );
}
