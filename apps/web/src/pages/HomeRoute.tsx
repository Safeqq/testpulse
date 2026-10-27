import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { LandingPage } from "./LandingPage";
import { ProjectsPage } from "./ProjectsPage";

/**
 * Beranda `/` (di luar RequireAuth): user masuk melihat daftar project, pengunjung anonim melihat landing page.
 * Selama sesi diperiksa tampil kerangka netral, dan bila sesi tidak dapat diperiksa (bukan 401) landing tidak
 * dirender; banner galat sesi dan tombol coba lagi ada di Layout. Tidak pernah mengalihkan.
 */
export function HomeRoute() {
  const { status } = useAuth();

  if (status === "authenticated") return <ProjectsPage />;
  if (status === "anonymous") return <LandingPage />;
  if (status === "loading") {
    return (
      <p
        role="status"
        className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
        data-testid="home-loading"
      >
        <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        Memuat…
      </p>
    );
  }
  return (
    <p role="status" className="py-16 text-center text-sm text-muted-foreground" data-testid="auth-pending">
      Sesi Anda belum dapat diperiksa.
    </p>
  );
}
