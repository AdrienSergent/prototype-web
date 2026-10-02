import type { CompanyDto } from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { useToast } from "../../components/toast";
import { Button, ErrorText, Field, Input, Loading, Notice, PageHeader, Section } from "../../components/ui";
import { del, errorMessage, get, post } from "../../lib/api";
import { useSession } from "../../lib/session";

export function GroupSettingsPage() {
  const { me, refresh } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const company = useQuery({ queryKey: ["company"], queryFn: () => get<CompanyDto>("/company") });
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [reader, setReader] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (company.isLoading) return <Loading />;
  const c = company.data!;
  const owned = me?.groups.find((g) => g.id === c.groupId && g.role === "owner");
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["company"] });
      await refresh();
      toast(msg);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div>
      <PageHeader title="Groupe de sociétés" description="Un groupe voit, pour chaque société, l'avancement et le statut du dossier, sans accès aux données RH. Chaque société, holding comprise, garde son propre abonnement." />
      {c.groupId ? (
        <Section title={`Rattachée au groupe ${c.groupName}`}>
          <div className="flex flex-wrap gap-2">
            {me?.groups.some((g) => g.id === c.groupId) && <Link to={`/groupe/${c.groupId}`} className="inline-flex h-9 items-center rounded-md border border-line-strong px-3.5 text-sm font-medium">Vue groupe</Link>}
            {owned && (
              <Button onClick={() => run(async () => setShownCode((await post<{ joinCode: string }>(`/groups/${c.groupId}/join-code`)).joinCode), "Nouveau code généré")}>
                Générer un code de rattachement
              </Button>
            )}
            <Button variant="danger" onClick={() => run(() => del("/company/group"), "Société détachée du groupe")}>
              Détacher la société du groupe
            </Button>
          </div>
          {shownCode && (
            <Notice tone="pen" title={`Code de rattachement : ${shownCode}`}>
              Transmettez-le à l'administrateur de chaque filiale : il le saisit dans cette page de sa société. Ce code ne sera plus affiché.
            </Notice>
          )}
          {owned && (
            <form
              className="mt-4 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => post(`/groups/${c.groupId}/readers`, { email: reader }), "Lecteur ajouté au groupe");
                setReader("");
              }}
            >
              <Field label="Ajouter un lecteur du groupe (email d'un compte existant)" className="w-80">
                <Input type="email" value={reader} onChange={(e) => setReader(e.target.value)} required />
              </Field>
              <Button type="submit">Ajouter</Button>
            </form>
          )}
        </Section>
      ) : (
        <div className="grid gap-8 md:grid-cols-2">
          <Section title="Créer un groupe" description="Depuis la holding : la société active est rattachée au groupe créé.">
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); run(async () => setShownCode((await post<{ joinCode: string }>("/company/group", { name })).joinCode), "Groupe créé"); }}>
              <Field label="Nom du groupe">
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Button type="submit" variant="primary" className="justify-self-start">Créer le groupe</Button>
            </form>
          </Section>
          <Section title="Rejoindre un groupe" description="Saisissez le code de rattachement fourni par la holding.">
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => post("/company/group/join", { code }), "Société rattachée au groupe"); }}>
              <Field label="Code de rattachement">
                <Input value={code} onChange={(e) => setCode(e.target.value)} required />
              </Field>
              <Button type="submit" className="justify-self-start">Rattacher la société</Button>
            </form>
          </Section>
          {shownCode && <Notice tone="pen" title={`Code de rattachement : ${shownCode}`}>Transmettez-le aux administrateurs des filiales. Ce code ne sera plus affiché.</Notice>}
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}
