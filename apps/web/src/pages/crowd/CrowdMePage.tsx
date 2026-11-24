import { Users } from "lucide-react";
import { useCallback } from "react";
import { Link } from "react-router-dom";
import { CycleStatus } from "@/components/CycleStatus";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cyclePublicPath, formatAcceptance, PARTICIPANT_STATUS_LABEL, testerPath } from "@/lib/crowd";
import { useDocumentTitle } from "@/lib/forms";
import { useLoad } from "@/lib/useLoad";

/** `/crowd/me`: cycle yang saya ikuti dan statistik saya (spec Tahap 5 §8.2). Butuh login (RequireAuth). */
export function CrowdMePage() {
  useDocumentTitle("Crowdtesting saya");
  const { user } = useAuth();
  const me = useLoad(useCallback(() => api.crowd.me(), []));

  if (me.state === "loading") return <Loading label="Memuat ringkasan…" />;
  if (me.state === "error") return <LoadError error={me.error} fallback="Gagal memuat ringkasan. Coba lagi." onRetry={me.reload} />;

  const data = me.data;
  return (
    <section aria-labelledby="crowd-me-title" className="grid min-w-0 grid-cols-1 gap-6" data-testid="crowd-me">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 id="crowd-me-title" className="text-2xl font-semibold tracking-tight">
          Crowdtesting saya
        </h1>
        {user ? (
          <Link to={testerPath(user.id)} className="text-sm font-medium">
            Profil publik saya
          </Link>
        ) : null}
      </div>
      <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1 rounded-lg border bg-card px-4 py-3">
          <dt className="text-sm text-muted-foreground">Poin</dt>
          <dd className="m-0 text-xl font-semibold tabular-nums" data-testid="crowd-me-points">
            {data.points}
          </dd>
        </div>
        <div className="grid gap-1 rounded-lg border bg-card px-4 py-3">
          <dt className="text-sm text-muted-foreground">Tingkat penerimaan</dt>
          <dd className="m-0 text-xl font-semibold tabular-nums">{formatAcceptance(data.acceptanceRate)}</dd>
        </div>
      </dl>
      {data.cycles.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Anda belum ikut cycle mana pun"
          action={
            <Button asChild>
              <Link to="/crowd">Cari cycle</Link>
            </Button>
          }
        >
          <p>Pilih cycle yang berlangsung di direktori, baca instruksinya, lalu ikut.</p>
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0" data-testid="crowd-me-cycles">
          {data.cycles.map((c) => (
            <li key={c.cycle.id} className="grid min-w-0 gap-1 px-4 py-3">
              <Link to={cyclePublicPath(c.cycle.id)} className="font-medium [overflow-wrap:anywhere]">
                {c.cycle.title}
              </Link>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <CycleStatus status={c.cycle.status} endsAt={null} />
                <span>Status: {PARTICIPANT_STATUS_LABEL[c.status]}</span>
                <span>
                  {c.reportCounts.submitted + c.reportCounts.accepted + c.reportCounts.rejected + c.reportCounts.duplicate + c.reportCounts.withdrawn}{" "}
                  laporan · {c.reportCounts.accepted} diterima
                </span>
                <span>{c.points} poin</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
