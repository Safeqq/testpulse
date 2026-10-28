import type { FlakyTestDto, RunSummaryDto, StatsDto } from "@testpulse/shared";
import { Loader2 } from "lucide-react";
import { useCallback, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TrendChart } from "@/components/charts/TrendChart";
import { LoadError } from "@/components/LoadError";
import { RunStatus, runOutcome } from "@/components/RunStatus";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatDateTime, formatDuration, formatPassRate, passRateOf } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";

const RECENT_RUNS = 5;
const TOP_FLAKY = 5;
/** Batas daftar flaky dari API; di titik ini jumlahnya "50 atau lebih". */
const FLAKY_API_LIMIT = 50;

const LINK_CLASS =
  "rounded-sm text-sm font-medium text-link underline underline-offset-4 outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring";

interface DashboardProps {
  slug: string;
  branch: string;
}

/** Ringkasan hasil test satu branch: kartu angka, tren, run terbaru, dan test paling flaky. */
export function Dashboard({ slug, branch }: DashboardProps) {
  // key: pindah branch memulai muat baru dengan status loading, bukan menampilkan angka branch sebelumnya.
  return <BranchSummary key={branch} slug={slug} branch={branch} />;
}

interface Summary {
  stats: StatsDto;
  runs: RunSummaryDto[];
  flaky: FlakyTestDto[];
}

function BranchSummary({ slug, branch }: { slug: string; branch: string }) {
  const fetchSummary = useCallback(async (): Promise<Summary> => {
    const [stats, runsPage, flaky] = await Promise.all([
      api.results.stats(slug, branch),
      api.results.runs(slug, { branch }),
      api.results.flaky(slug, branch),
    ]);
    return { stats, runs: runsPage.runs.slice(0, RECENT_RUNS), flaky };
  }, [slug, branch]);
  const load = useLoad(fetchSummary);

  if (load.state === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        Memuat hasil test…
      </p>
    );
  }
  if (load.state === "error") {
    return <LoadError error={load.error} fallback="Gagal memuat hasil test. Coba lagi." onRetry={load.reload} />;
  }

  const { stats, runs, flaky } = load.data;
  const { latest } = stats;
  if (!latest) {
    return <p className="text-sm text-muted-foreground">Belum ada hasil test untuk branch ini.</p>;
  }

  return (
    <>
      <dl className="m-0 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testId="stat-last-status" label="Status run terakhir" hint={formatDateTime(latest.createdAt)}>
          <RunStatus outcome={runOutcome(latest)} className="text-xl" />
        </StatCard>
        <StatCard
          testId="stat-pass-rate"
          label="Pass rate"
          hint={`${latest.passed} lulus · ${latest.failed} gagal`}
        >
          <span className="font-mono tabular-nums">{formatPassRate(passRateOf(latest.passed, latest.failed))}</span>
        </StatCard>
        <StatCard testId="stat-total" label="Jumlah test" hint="Lulus, gagal, dan dilewati">
          <span className="font-mono tabular-nums">{latest.total}</span>
        </StatCard>
        <StatCard testId="stat-flaky" label="Test flaky" hint="Hasilnya naik-turun di run terakhir">
          <span className="font-mono tabular-nums">
            {flaky.length >= FLAKY_API_LIMIT ? `${FLAKY_API_LIMIT}+` : flaky.length}
          </span>
        </StatCard>
      </dl>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg font-semibold tracking-tight">Tren pass rate</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart points={stats.points} />
        </CardContent>
      </Card>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentRuns slug={slug} runs={runs} />
        <TopFlaky slug={slug} flaky={flaky.slice(0, TOP_FLAKY)} />
      </div>
    </>
  );
}

function StatCard({
  testId,
  label,
  hint,
  children,
}: {
  testId: string;
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-1 p-4" data-testid={testId}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 text-2xl font-semibold">{children}</dd>
      <dd className="m-0 text-xs text-muted-foreground">{hint}</dd>
    </Card>
  );
}

function SectionCard({
  testId,
  title,
  viewAll,
  children,
}: {
  testId: string;
  title: string;
  viewAll: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0" data-testid={testId}>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        </CardTitle>
        <Link to={viewAll.to} className={LINK_CLASS}>
          Lihat semua<span className="sr-only"> {viewAll.label}</span>
        </Link>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const ITEM_LINK_CLASS =
  "grid min-w-0 gap-1 px-4 py-3 text-foreground no-underline outline-hidden hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring";

function RecentRuns({ slug, runs }: { slug: string; runs: RunSummaryDto[] }) {
  return (
    <SectionCard testId="recent-runs" title="Run terbaru" viewAll={{ to: `/p/${slug}/runs`, label: "run" }}>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada run.</p>
      ) : (
        <ul className="m-0 grid list-none divide-y divide-border rounded-lg border p-0">
          {runs.map((run) => (
            <li key={run.id} data-testid={`run-item-${run.id}`}>
              <Link to={`/p/${slug}/runs/${run.id}`} className={ITEM_LINK_CLASS}>
                <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <RunStatus outcome={runOutcome(run)} className="text-sm" />
                  <span className="font-mono text-sm">{run.commitSha ? run.commitSha.slice(0, 7) : "tanpa commit"}</span>
                </span>
                {run.name ? <span className="text-sm [overflow-wrap:anywhere]">{run.name}</span> : null}
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(run.createdAt)} · {run.passed}/{run.total} lulus · {formatDuration(run.durationMs)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

const LAST_STATUS_LABEL = { passed: "lulus", failed: "gagal", skipped: "dilewati" } as const;

function TopFlaky({ slug, flaky }: { slug: string; flaky: FlakyTestDto[] }) {
  return (
    <SectionCard testId="top-flaky" title="Test paling flaky" viewAll={{ to: `/p/${slug}/flaky`, label: "test flaky" }}>
      {flaky.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada test flaky pada branch ini.</p>
      ) : (
        <ul className="m-0 grid list-none divide-y divide-border rounded-lg border p-0">
          {flaky.map((test) => (
            <li key={test.testCaseId} data-testid={`flaky-item-${test.testCaseId}`}>
              <Link to={`/p/${slug}/tests/${test.testCaseId}`} className={ITEM_LINK_CLASS}>
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{test.name}</span>
                  <Badge variant="secondary" className="font-mono tabular-nums">
                    Skor {test.score}
                  </Badge>
                </span>
                <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{test.suite}</span>
                <span className="text-xs text-muted-foreground">Hasil terakhir: {LAST_STATUS_LABEL[test.lastStatus]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
