import { useCallback } from "react";
import { Link } from "react-router-dom";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { api } from "@/lib/api";
import { useDocumentTitle } from "@/lib/forms";
import { useLoad } from "@/lib/useLoad";

/** `/crowd/leaderboard`: leaderboard global semua cycle publik (spec Tahap 5 §6). */
export function CrowdLeaderboardPage() {
  useDocumentTitle("Leaderboard crowdtesting");
  const board = useLoad(useCallback(() => api.crowd.globalLeaderboard(), []));
  return (
    <section aria-labelledby="leaderboard-title" className="grid min-w-0 grid-cols-1 gap-4">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link to="/crowd">Crowdtesting</Link>
      </nav>
      <h1 id="leaderboard-title" className="text-2xl font-semibold tracking-tight">
        Leaderboard
      </h1>
      <p className="m-0 max-w-prose text-muted-foreground">
        Poin dari laporan yang diterima tim di semua cycle publik: minor 1, major 3, critical 5, blocker 8.
      </p>
      {board.state === "loading" ? <Loading label="Memuat leaderboard…" /> : null}
      {board.state === "error" ? (
        <LoadError error={board.error} fallback="Gagal memuat leaderboard. Coba lagi." onRetry={board.reload} />
      ) : null}
      {board.state === "ready" ? <LeaderboardTable data={board.data} caption="Leaderboard global crowdtesting" /> : null}
    </section>
  );
}
