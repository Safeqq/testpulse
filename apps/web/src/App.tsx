import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { HomeRoute } from "./pages/HomeRoute";
import { InvitePage } from "./pages/InvitePage";
import { LoginPage } from "./pages/LoginPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectPage } from "./pages/ProjectPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ProjectSettingsPage } from "./pages/settings/ProjectSettingsPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        {/* Beranda di luar RequireAuth: anonim melihat landing page, user masuk melihat daftar project (HomeRoute). */}
        <Route path="/" element={<HomeRoute />} />
        <Route element={<RequireAuth />}>
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
