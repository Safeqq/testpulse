import { UserRound } from "lucide-react";
import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { SeverityBadge } from "@/components/SeverityBadge";
import { api, ApiError } from "@/lib/api";
import { cyclePublicPath, formatAcceptance } from "@/lib/crowd";
import { formatRelativeTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/forms";
import { useLoad } from "@/lib/useLoad";

/** `/crowd/testers/:userId`: profil publik tester (spec Tahap 5 §6). Hanya nama tampilan, tanpa email. */
export function CrowdTesterPage() {
  const { userId = "" } = useParams();
  const profile = useLoad(useCallback(() => api.crowd.tester(userId), [userId]));
  useDocumentTitle(profile.state === "ready" ? profile.data.user.name : "Profil tester");

  if (profile.state === "loading") return <Loading label="Memuat profil…" />;
  if (profile.state === "error") {
    if (profile.error instanceof ApiError && profile.error.status === 404) {
      return (
        <EmptyState icon={UserRound} title="Tester tidak ditemukan" headingLevel="h1" data-testid="tester-not-found">
          <p>
            Profil ini tidak ada. <Link to="/crowd/leaderboard">Lihat leaderboard</Link>
          </p>
        </EmptyState>
      );
    }
    return <LoadError error={profile.error} fallback="Gagal memuat profil. Coba lagi." onRetry={profile.reload} />;
  }

  const p = profile.data;
  return (
    <section aria-labelledby="tester-title" className="grid min-w-0 grid-cols-1 gap-6" data-testid="tester-profile">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link to="/crowd/leaderboard">Leaderboard</Link>
      </nav>
      <h1 id="tester-title" className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
        {p.user.name}
      </h1>
      <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Poin" value={String(p.points)} testId="tester-points" />
        <Stat label="Tingkat penerimaan" value={formatAcceptance(p.acceptanceRate)} testId="tester-acceptance" />
        <Stat label="Cycle diikuti" value={String(p.cycles)} testId="tester-cycles" />
      </dl>
      <section aria-labelledby="tester-recent" className="grid min-w-0 gap-3">
        <h2 id="tester-recent" className="text-lg font-semibold">
          Laporan diterima terbaru
        </h2>
        {p.recentAccepted.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">Belum ada laporan yang diterima.</p>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0" data-testid="tester-recent">
            {p.recentAccepted.map((r, i) => (
              <li key={i} className="grid min-w-0 gap-1 px-4 py-3">
                <span className="font-medium [overflow-wrap:anywhere]">{r.title}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <SeverityBadge severity={r.severity} />
                  <Link to={cyclePublicPath(r.cycle.id)} className="[overflow-wrap:anywhere]">
                    {r.cycle.title}
                  </Link>
                  <span>{formatRelativeTime(r.acceptedAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-lg border bg-card px-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 text-xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
