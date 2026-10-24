import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { InvitePage } from "./pages/InvitePage";
import { LoginPage } from "./pages/LoginPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ProjectSettingsPage } from "./pages/settings/ProjectSettingsPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/p/:slug/settings" element={<ProjectSettingsPage />} />
        </Route>
        {/* Pratinjau undangan terbuka tanpa login; menerima baru meminta login (lihat InvitePage). */}
        <Route path="/invite/:token" element={<InvitePage />} />
        {/* Tanpa RequireAuth: project publik terbuka untuk anonim. */}
        <Route path="/p/:slug" element={<ProjectPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
