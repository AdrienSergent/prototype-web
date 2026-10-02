import type { FiscalYearDto, MeDto, Role } from "@cir/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, setCsrfToken } from "./api";

interface SessionState {
  authenticated: boolean;
  mfaPending: boolean;
  csrfToken: string | null;
  sso?: { google: boolean; microsoft: boolean };
}

interface SessionCtx {
  loading: boolean;
  session: SessionState | null;
  me: MeDto | null;
  role: Role | null;
  fiscalYears: FiscalYearDto[];
  fy: FiscalYearDto | null;
  setFyId: (id: string) => void;
  refresh: (opts?: { reset?: boolean }) => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

const fyKey = (companyId: string | null | undefined) => `cir.fy.${companyId ?? "none"}`;

function readStored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const sessionQ = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const s = await get<SessionState>("/auth/session");
      setCsrfToken(s.csrfToken);
      return s;
    },
    staleTime: 60_000,
  });
  const canLoadMe = !!sessionQ.data?.authenticated && !sessionQ.data.mfaPending;
  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const me = await get<MeDto>("/auth/me");
      setCsrfToken(me.csrfToken);
      return me;
    },
    enabled: canLoadMe,
    staleTime: 60_000,
    retry: false,
  });
  const me = meQ.data ?? null;
  const hasCompany = !!me?.activeCompanyId && !me.mfaRequired;
  const fyQ = useQuery({
    queryKey: ["fiscal-years", me?.activeCompanyId],
    queryFn: () => get<FiscalYearDto[]>("/fiscal-years"),
    enabled: hasCompany,
  });
  const fiscalYears = fyQ.data ?? [];
  const [fyId, setFyIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.activeCompanyId) return;
    setFyIdState(readStored(fyKey(me.activeCompanyId)));
  }, [me?.activeCompanyId]);

  const setFyId = useCallback(
    (id: string) => {
      setFyIdState(id);
      try {
        localStorage.setItem(fyKey(me?.activeCompanyId), id);
      } catch {
        /* stockage indisponible : choix conservé en mémoire */
      }
    },
    [me?.activeCompanyId],
  );

  const fy = useMemo(() => fiscalYears.find((f) => f.id === fyId) ?? fiscalYears[0] ?? null, [fiscalYears, fyId]);

  /** Recharge session, profil et exercices ; avec reset, oublie aussi toutes les données mises en cache (changement d'utilisateur ou de société). */
  const refresh = useCallback(
    async (opts?: { reset?: boolean }) => {
      if (opts?.reset) qc.removeQueries({ predicate: (q) => !["session", "me", "fiscal-years"].includes(String(q.queryKey[0])) });
      await qc.refetchQueries({ queryKey: ["session"], type: "all" });
      await qc.refetchQueries({ queryKey: ["me"], type: "all" });
      await qc.refetchQueries({ queryKey: ["fiscal-years"], type: "all" });
    },
    [qc],
  );

  const value: SessionCtx = {
    loading: sessionQ.isLoading || (canLoadMe && meQ.isLoading) || (hasCompany && fyQ.isLoading),
    session: sessionQ.data ?? null,
    me,
    role: me?.role ?? null,
    fiscalYears,
    fy,
    setFyId,
    refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("SessionProvider manquant");
  return ctx;
}

/** Exercice courant (garanti dans les pages sous FiscalYearGate). */
export function useFy() {
  const { fy } = useSession();
  if (!fy) throw new Error("Aucun exercice");
  return fy;
}

/** Droits d'écriture dérivés du rôle (matrice §3.2 du cahier des charges). */
export function usePermissions() {
  const { role, fy } = useSession();
  const editableFy = !!fy && (fy.status === "draft" || fy.status === "in_review");
  const is = (...roles: Role[]) => !!role && roles.includes(role);
  return {
    role,
    editableFy,
    isAdmin: is("admin"),
    isExpert: is("expert"),
    isContributor: is("contributeur"),
    manageCompany: is("admin"),
    manageTeam: is("admin", "redacteur"),
    writeProjects: is("admin", "redacteur") && editableFy,
    writeNotes: is("admin", "redacteur", "contributeur") && editableFy,
    writeSections: is("admin", "redacteur") && editableFy,
    comment: is("admin", "redacteur", "expert"),
    validateSections: is("admin") && editableFy,
    verdict: is("admin", "expert") && editableFy,
    readDossier: is("admin", "redacteur", "expert"),
    readAudit: is("admin", "expert"),
  };
}
