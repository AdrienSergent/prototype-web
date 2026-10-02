import { createCompanySchema, signupSchema, ROLE_LABELS, type Role } from "@cir/shared";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { Button, ErrorText, Field, Input, Loading, Notice } from "../../components/ui";
import { ApiError, errorMessage, get, post, setCsrfToken } from "../../lib/api";
import { applyServerErrors, useZodForm } from "../../lib/forms";
import { useSession } from "../../lib/session";

export function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <p className="mb-6 text-center font-serif text-xl font-semibold text-ink">Dossier CIR</p>
        <div className="rounded-lg border border-line bg-surface px-6 py-6">
          <h1 className="mb-4 text-2xl">{title}</h1>
          {children}
        </div>
        {footer && <div className="mt-4 text-center text-sm text-graphite">{footer}</div>}
      </div>
    </div>
  );
}

function SsoButtons() {
  const { session } = useSession();
  const sso = session?.sso;
  if (!sso?.google && !sso?.microsoft) return null;
  return (
    <div className="mt-4 grid gap-2 border-t border-line pt-4">
      {sso.google && (
        <a href="/api/v1/auth/oidc/google" className="flex h-9 items-center justify-center rounded-md border border-line-strong text-sm font-medium hover:border-ink-soft">
          Continuer avec Google
        </a>
      )}
      {sso.microsoft && (
        <a href="/api/v1/auth/oidc/microsoft" className="flex h-9 items-center justify-center rounded-md border border-line-strong text-sm font-medium hover:border-ink-soft">
          Continuer avec Microsoft
        </a>
      )}
    </div>
  );
}

export function LoginPage() {
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(z.object({ email: z.email({ message: "Email invalide" }), password: z.string().min(1, { message: "Mot de passe requis" }) }), { email: "", password: "" });
  if (session?.authenticated && !session.mfaPending) return <Navigate to="/" replace />;
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const r = await post<{ mfaPending: boolean; csrfToken: string }>("/auth/login", values);
      setCsrfToken(r.csrfToken);
      await refresh({ reset: true });
      navigate(r.mfaPending ? "/connexion/mfa" : ((location.state as { from?: string })?.from ?? "/"));
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  return (
    <AuthLayout
      title="Connexion"
      footer={
        <>
          Pas encore de compte ? <Link to="/inscription" className="font-semibold text-pen hover:underline">Inscrire ma société</Link>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-3" noValidate>
        <Field label="Email" error={form.formState.errors.email?.message} htmlFor="email">
          <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Field label="Mot de passe" error={form.formState.errors.password?.message} htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          Se connecter
        </Button>
      </form>
      <SsoButtons />
    </AuthLayout>
  );
}

export function MfaChallengePage() {
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (session && !session.authenticated) return <Navigate to="/connexion" replace />;
  return (
    <AuthLayout title="Double authentification">
      <p className="mb-4 text-sm text-graphite">Saisissez le code à 6 chiffres affiché par votre application d'authentification, ou un code de secours.</p>
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await post("/auth/mfa/verify", { code });
            await refresh();
            navigate("/");
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Code" htmlFor="code">
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" loading={busy}>
          Vérifier
        </Button>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(signupSchema, { fullName: "", email: "", password: "", company: { siren: "", name: "" } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const r = await post<{ csrfToken: string }>("/auth/signup", values);
      setCsrfToken(r.csrfToken);
      await refresh({ reset: true });
      navigate("/");
    } catch (err) {
      setError(applyServerErrors(form, err));
    }
  });
  return (
    <AuthLayout
      title="Inscrire ma société"
      footer={
        <>
          Déjà inscrit ? <Link to="/connexion" className="font-semibold text-pen hover:underline">Se connecter</Link>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-3" noValidate>
        <Field label="SIREN" error={e.company?.siren?.message} htmlFor="siren" hint="9 chiffres, clé de contrôle vérifiée">
          <Input id="siren" inputMode="numeric" {...form.register("company.siren")} />
        </Field>
        <Field label="Raison sociale" error={e.company?.name?.message} htmlFor="cname">
          <Input id="cname" {...form.register("company.name")} />
        </Field>
        <Field label="Votre nom" error={e.fullName?.message} htmlFor="fullName">
          <Input id="fullName" autoComplete="name" {...form.register("fullName")} />
        </Field>
        <Field label="Email professionnel" error={e.email?.message} htmlFor="email">
          <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Field label="Mot de passe" error={e.password?.message} htmlFor="password" hint="12 caractères minimum">
          <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          Créer l'espace de la société
        </Button>
        <p className="text-xs text-graphite">Vous devenez administrateur de l'espace. La double authentification vous sera demandée à la première connexion.</p>
      </form>
    </AuthLayout>
  );
}

export function OnboardingPage() {
  const { refresh, me } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(createCompanySchema, { siren: "", name: "" });
  if (me?.activeCompanyId) return <Navigate to="/" replace />;
  return (
    <AuthLayout title="Votre société">
      <p className="mb-4 text-sm text-graphite">Votre compte n'est rattaché à aucune société. Créez son espace, ou demandez une invitation à son administrateur.</p>
      <form
        className="grid gap-3"
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await post("/companies", values);
            await refresh();
            navigate("/");
          } catch (err) {
            setError(applyServerErrors(form, err));
          }
        })}
      >
        <Field label="SIREN" error={form.formState.errors.siren?.message} htmlFor="siren">
          <Input id="siren" {...form.register("siren")} />
        </Field>
        <Field label="Raison sociale" error={form.formState.errors.name?.message} htmlFor="name">
          <Input id="name" {...form.register("name")} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          Créer l'espace
        </Button>
      </form>
    </AuthLayout>
  );
}

export function InvitationPage() {
  const { token = "" } = useParams();
  const { refresh, session } = useSession();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => get<{ companyName: string; email: string; role: Role; userExists: boolean; loggedInAs: string | null }>(`/auth/invitations/${token}`),
    retry: false,
  });
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (info.isLoading) return <Loading />;
  if (info.error) return <AuthLayout title="Invitation">{<ErrorText error={info.error} />}</AuthLayout>;
  const inv = info.data!;
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/auth/invitations/accept", { token, ...(inv.userExists ? {} : { fullName, password }) });
      await refresh();
      navigate("/");
    } catch (e) {
      setError(e instanceof ApiError && e.code === "login_required" ? "Connectez-vous d'abord avec le compte invité, puis rouvrez ce lien." : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title={`Rejoindre ${inv.companyName}`}>
      <p className="mb-4 text-sm text-graphite">
        Vous êtes invité(e) en tant que <strong className="text-ink">{ROLE_LABELS[inv.role]}</strong> avec l'adresse {inv.email}.
      </p>
      {inv.userExists ? (
        session?.authenticated && inv.loggedInAs === inv.email ? (
          <Button variant="primary" onClick={accept} loading={busy}>
            Accepter l'invitation
          </Button>
        ) : (
          <Notice tone="pen" title="Un compte existe déjà pour cet email">
            <Link to="/connexion" state={{ from: `/invitation/${token}` }} className="font-semibold text-pen underline">
              Connectez-vous
            </Link>{" "}
            puis rouvrez ce lien pour accepter.
          </Notice>
        )
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            accept();
          }}
        >
          <Field label="Votre nom" htmlFor="fn">
            <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </Field>
          <Field label="Mot de passe" htmlFor="pw" hint="12 caractères minimum">
            <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} required />
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Créer mon compte et rejoindre
          </Button>
        </form>
      )}
      <div className="mt-3">
        <ErrorText error={error} />
      </div>
    </AuthLayout>
  );
}

/** Activation de la MFA : obligatoire pour administrateur et expert, proposée aux autres. */
export function MfaSetupPage() {
  const { me, refresh } = useSession();
  const navigate = useNavigate();
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return <Loading />;
  if (recovery)
    return (
      <AuthLayout title="Codes de secours">
        <p className="mb-3 text-sm text-graphite">Conservez ces codes hors ligne : chacun permet une connexion si vous perdez votre téléphone. Ils ne seront plus affichés.</p>
        <ul className="mb-4 grid grid-cols-2 gap-2 rounded-md border border-line bg-paper p-3 font-mono text-sm">
          {recovery.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button variant="primary" onClick={() => navigate("/")}>
          J'ai conservé mes codes
        </Button>
      </AuthLayout>
    );
  return (
    <AuthLayout title="Activer la double authentification">
      {me.mfaRequired && (
        <Notice tone="warn">Votre rôle (administrateur ou expert) exige la double authentification avant d'accéder au dossier.</Notice>
      )}
      {!setup ? (
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setSetup(await post("/auth/mfa/setup"));
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Générer le QR code
        </Button>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const r = await post<{ recoveryCodes: string[] }>("/auth/mfa/enable", { code });
              await refresh();
              setRecovery(r.recoveryCodes);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm text-graphite">Scannez ce code avec votre application (Authy, Google Authenticator, 1Password…), puis saisissez le code affiché.</p>
          <img src={setup.qrDataUrl} alt="QR code d'enrôlement" className="mx-auto size-44" />
          <p className="break-all text-center font-mono text-xs text-graphite">{setup.secret}</p>
          <Field label="Code à 6 chiffres" htmlFor="code">
            <Input id="code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Activer
          </Button>
        </form>
      )}
      <div className="mt-3">
        <ErrorText error={error} />
      </div>
    </AuthLayout>
  );
}
