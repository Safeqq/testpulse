import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";
import { Outlet, Route, Routes } from "react-router-dom";
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

// Halaman hasil test dipecah per halaman agar bundle utama tidak bertambah; kode bersama (kerangka project, daftar
// berhalaman) otomatis masuk chunk bersama yang hanya diunduh bersama halaman-halaman ini.
const RunsPage = lazy(() => import("./pages/project/RunsPage").then((m) => ({ default: m.RunsPage })));
const RunPage = lazy(() => import("./pages/project/RunPage").then((m) => ({ default: m.RunPage })));
const FlakyPage = lazy(() => import("./pages/project/FlakyPage").then((m) => ({ default: m.FlakyPage })));
const TestHistoryPage = lazy(() =>
  import("./pages/project/TestHistoryPage").then((m) => ({ default: m.TestHistoryPage })),
);

/** Kerangka netral selama chunk halaman diunduh. */
function LazyBoundary() {
  return (
    <Suspense
      fallback={
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          Memuat halaman…
        </p>
      }
    >
      <Outlet />
    </Suspense>
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
