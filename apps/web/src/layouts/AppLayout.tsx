import { ROLE_LABELS, formatDate } from "@cir/shared";
import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { Seal } from "../components/seal";
import { Loading, Notice } from "../components/ui";
import { onAuthError, post } from "../lib/api";
import { usePermissions, useSession } from "../lib/session";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  show?: boolean;
}

function NavGroup({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate: () => void }) {
  const visible = items.filter((i) => i.show !== false);
  if (!visible.length) return null;
  return (
    <div className="mb-5">
      <p className="mb-1 px-3 text-xs font-semibold text-graphite">{title}</p>
      <ul>
        {visible.map((i) => (
          <li key={i.to}>
            <NavLink
              to={i.to}
              end={i.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                clsx(
                  "block rounded-md px-3 py-1.5 text-sm",
                  isActive ? "bg-pen-tint font-semibold text-pen-dark" : "text-ink-soft hover:bg-paper hover:text-ink",
                )
              }
            >
              {i.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AppLayout() {
  const { loading, session, me, fiscalYears, fy, setFyId, refresh } = useSession();
  const perms = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(
    () =>
      onAuthError((e) => {
        if (e.code === "mfa_required") navigate("/securite/mfa");
        else if (e.status === 401) {
          refresh({ reset: true }).then(() => navigate("/connexion"));
        }
      }),
    [navigate, refresh],
  );

  if (loading) return <Loading />;
  if (!session?.authenticated) return <Navigate to="/connexion" state={{ from: location.pathname }} replace />;
  if (session.mfaPending) return <Navigate to="/connexion/mfa" replace />;
  if (!me) return <Loading />;
  if (!me.activeCompanyId) return <Navigate to="/onboarding" replace />;
  if (me.mfaRequired) return <Navigate to="/securite/mfa" replace />;

  const switchCompany = async (companyId: string) => {
    await post("/auth/switch-company", { companyId });
    await refresh({ reset: true });
    navigate("/");
  };
  const logout = async () => {
    await post("/auth/logout");
    await refresh({ reset: true });
    navigate("/connexion");
  };
  const company = me.memberships.find((m) => m.companyId === me.activeCompanyId);
  const close = () => setMenuOpen(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className={clsx("border-r border-line bg-surface lg:sticky lg:top-0 lg:block lg:h-dvh lg:overflow-y-auto", menuOpen ? "block" : "hidden")}>
        <div className="flex h-full flex-col px-3 py-4">
          <div className="mb-6 px-3">
            <p className="font-serif text-lg font-semibold leading-tight text-ink">Dossier CIR</p>
            <p className="text-xs text-graphite">Cahier de recherche et dossier justificatif</p>
          </div>
          <nav aria-label="Navigation principale" className="flex-1">
            <NavGroup
              title="Pilotage"
              onNavigate={close}
              items={[
                { to: "/", label: "Tableau de bord", end: true },
                ...me.groups.map((g) => ({ to: `/groupe/${g.id}`, label: `Groupe ${g.name}` })),
              ]}
            />
            <NavGroup
              title="Travaux de R&D"
              onNavigate={close}
              items={[
                { to: "/fiches", label: "Fiches de recherche" },
                { to: "/projets", label: "Projets et verrous" },
                { to: "/temps", label: "Temps", show: !perms.isExpert },
                { to: "/equipe", label: "Équipe" },
              ]}
            />
            <NavGroup
              title="Dossier justificatif"
              onNavigate={close}
              items={[
                { to: "/dossier", label: "Rédaction", end: true },
                { to: "/dossier/checklist", label: "Check-list" },
                { to: "/dossier/bibliographie", label: "Bibliographie" },
                { to: "/dossier/consolide", label: "Vue consolidée", show: perms.readDossier },
                { to: "/dossier/validation", label: "Validation et scellement", show: perms.readDossier },
              ]}
            />
            <NavGroup
              title="Administration"
              onNavigate={close}
              items={[
                { to: "/parametres", label: "Société", end: true },
                { to: "/parametres/exercices", label: "Exercices" },
                { to: "/parametres/membres", label: "Membres et invitations", show: perms.isAdmin },
                { to: "/parametres/groupe", label: "Groupe de sociétés", show: perms.isAdmin },
                { to: "/parametres/abonnement", label: "Abonnement", show: perms.isAdmin },
                { to: "/parametres/journal", label: "Journal d'audit", show: perms.readAudit },
              ]}
            />
          </nav>
          <div className="border-t border-line px-3 pt-3 text-sm">
            <NavLink to="/profil" onClick={close} className="block font-medium text-ink hover:text-pen">
              {me.user.fullName}
            </NavLink>
            <p className="text-xs text-graphite">{me.role ? ROLE_LABELS[me.role] : ""}</p>
            <button onClick={logout} className="mt-2 text-[13px] text-pen hover:underline">
              Se déconnecter
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-paper/95 px-4 py-2.5 backdrop-blur lg:px-8">
          <button className="rounded-md border border-line-strong px-2 py-1 text-sm lg:hidden" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
            Menu
          </button>
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Société</span>
            {me.memberships.length > 1 ? (
              <select
                value={me.activeCompanyId}
                onChange={(e) => switchCompany(e.target.value)}
                className="h-8 max-w-[220px] rounded-md border border-line-strong bg-surface px-2 text-sm font-semibold"
              >
                {me.memberships.map((m) => (
                  <option key={m.companyId} value={m.companyId}>
                    {m.companyName}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-semibold">{company?.companyName}</span>
            )}
          </label>
          {fiscalYears.length > 0 && fy && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-graphite">Exercice</span>
              <select value={fy.id} onChange={(e) => setFyId(e.target.value)} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm">
                {fiscalYears.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} ({formatDate(f.startDate)} – {formatDate(f.endDate)})
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="ml-auto">{fy && location.pathname !== "/" && <Seal status={fy.status} size={30} />}</div>
        </header>
        <main className="mx-auto max-w-[1180px] px-4 py-6 lg:px-8">
          {me.billing?.readOnly && (
            <Notice tone="warn" title="Espace en lecture seule">
              L'abonnement n'est plus actif : vos données restent consultables. Un administrateur peut le réactiver depuis Administration, Abonnement.
            </Notice>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Pages qui nécessitent un exercice : propose d'en créer un s'il n'y en a pas. */
export function FiscalYearGate({ children }: { children: ReactNode }) {
  const { fy } = useSession();
  const perms = usePermissions();
  if (!fy)
    return (
      <div className="mx-auto max-w-xl py-10">
        <Notice tone="pen" title="Aucun exercice fiscal">
          {perms.isAdmin ? (
            <>
              Commencez par créer l'exercice à documenter dans{" "}
              <NavLink to="/parametres/exercices" className="font-semibold text-pen underline">
                Exercices
              </NavLink>
              .
            </>
          ) : (
            "L'administrateur doit d'abord créer l'exercice à documenter."
          )}
        </Notice>
      </div>
    );
  return <>{children}</>;
}
