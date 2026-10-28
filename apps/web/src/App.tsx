import { Suspense } from "react";
import { Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ChunkErrorBoundary } from "./components/ChunkErrorBoundary";
import { Layout } from "./components/Layout";
import { Loading } from "./components/Loading";
import { RequireAuth } from "./components/RequireAuth";
import { HomeRoute } from "./pages/HomeRoute";
import { InvitePage } from "./pages/InvitePage";
import { LoginPage } from "./pages/LoginPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectPage } from "./pages/ProjectPage";
import { RegisterPage } from "./pages/RegisterPage";
import { FlakyPage, RunPage, RunsPage, TestHistoryPage } from "./pages/project/lazyPages";
import { ProjectSettingsPage } from "./pages/settings/ProjectSettingsPage";

/** Kerangka netral selama chunk halaman diunduh; kegagalan mengunduh ditangkap agar aplikasi tidak menjadi layar kosong. */
function LazyBoundary() {
  const { pathname, search } = useLocation();
  return (
    <ChunkErrorBoundary resetKey={`${pathname}${search}`}>
      <Suspense fallback={<Loading label="Memuat halaman…" />}>
        <Outlet />
      </Suspense>
    </ChunkErrorBoundary>
  );
}

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
        <Route element={<LazyBoundary />}>
          <Route path="/p/:slug/runs" element={<RunsPage />} />
          <Route path="/p/:slug/runs/:runId" element={<RunPage />} />
          <Route path="/p/:slug/flaky" element={<FlakyPage />} />
          <Route path="/p/:slug/tests/:testCaseId" element={<TestHistoryPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
