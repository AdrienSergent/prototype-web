import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Loading } from "./components/ui";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { ChecklistPage } from "./features/dossier/ChecklistPage";
import { ConsolidatedPage } from "./features/dossier/ConsolidatedPage";
import { DossierPage } from "./features/dossier/DossierPage";
import { ReferencesPage } from "./features/dossier/ReferencesPage";
import { ValidationPage } from "./features/dossier/ValidationPage";
import { GroupOverviewPage } from "./features/group/GroupOverviewPage";
import { InvitationPage, LoginPage, MfaChallengePage, MfaSetupPage, OnboardingPage, SignupPage } from "./features/auth/pages";
import { NoteFormPage } from "./features/notes/NoteFormPage";
import { NotePage } from "./features/notes/NotePage";
import { NotesPage } from "./features/notes/NotesPage";
import { LockPage } from "./features/projects/LockPage";
import { ProjectPage } from "./features/projects/ProjectPage";
import { ProjectsPage } from "./features/projects/ProjectsPage";
import { AuditPage } from "./features/settings/AuditPage";
import { BillingPage } from "./features/settings/BillingPage";
import { CompanyPage } from "./features/settings/CompanyPage";
import { FiscalYearsPage } from "./features/settings/FiscalYearsPage";
import { GroupSettingsPage } from "./features/settings/GroupSettingsPage";
import { MembersPage } from "./features/settings/MembersPage";
import { ProfilePage } from "./features/settings/ProfilePage";
import { PersonPage } from "./features/team/PersonPage";
import { TeamPage } from "./features/team/TeamPage";
import { ImportPage } from "./features/time/ImportPage";
import { TimePage } from "./features/time/TimePage";
import { AppLayout, FiscalYearGate } from "./layouts/AppLayout";

const SectionEditorPage = lazy(() => import("./features/dossier/SectionEditorPage"));

const fy = (el: React.ReactNode) => <FiscalYearGate>{el}</FiscalYearGate>;

export function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route path="/connexion/mfa" element={<MfaChallengePage />} />
      <Route path="/inscription" element={<SignupPage />} />
      <Route path="/invitation/:token" element={<InvitationPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/securite/mfa" element={<MfaSetupPage />} />
      <Route element={<AppLayout />}>
        <Route index element={fy(<DashboardPage />)} />
        <Route path="groupe/:id" element={<GroupOverviewPage />} />
        <Route path="fiches" element={fy(<NotesPage />)} />
        <Route path="fiches/nouvelle" element={fy(<NoteFormPage />)} />
        <Route path="fiches/:id" element={fy(<NotePage />)} />
        <Route path="fiches/:id/modifier" element={fy(<NoteFormPage />)} />
        <Route path="projets" element={fy(<ProjectsPage />)} />
        <Route path="projets/:id" element={fy(<ProjectPage />)} />
        <Route path="verrous/:id" element={fy(<LockPage />)} />
        <Route path="temps" element={fy(<TimePage />)} />
        <Route path="temps/import" element={fy(<ImportPage />)} />
        <Route path="equipe" element={<TeamPage />} />
        <Route path="equipe/:id" element={<PersonPage />} />
        <Route path="dossier" element={fy(<DossierPage />)} />
        <Route
          path="dossier/sections/:id"
          element={fy(
            <Suspense fallback={<Loading />}>
              <SectionEditorPage />
            </Suspense>,
          )}
        />
        <Route path="dossier/checklist" element={fy(<ChecklistPage />)} />
        <Route path="dossier/bibliographie" element={fy(<ReferencesPage />)} />
        <Route path="dossier/consolide" element={fy(<ConsolidatedPage />)} />
        <Route path="dossier/validation" element={fy(<ValidationPage />)} />
        <Route path="parametres" element={<CompanyPage />} />
        <Route path="parametres/exercices" element={<FiscalYearsPage />} />
        <Route path="parametres/membres" element={<MembersPage />} />
        <Route path="parametres/groupe" element={<GroupSettingsPage />} />
        <Route path="parametres/abonnement" element={<BillingPage />} />
        <Route path="parametres/journal" element={<AuditPage />} />
        <Route path="profil" element={<ProfilePage />} />
        <Route path="*" element={<p className="py-10 text-graphite">Page introuvable.</p>} />
      </Route>
    </Routes>
  );
}
