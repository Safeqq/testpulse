import type { MyCrowdReportItemDto, PublicCycleDto } from "@testpulse/shared";
import { FileSearch, Loader2, LogOut, Send } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { CycleStatus } from "@/components/CycleStatus";
import { EmptyState } from "@/components/EmptyState";
import { ExternalLink } from "@/components/ExternalLink";
import { LazyMarkdown } from "@/components/LazyMarkdown";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { ME_STATE_COPY, REPORT_STATUS_LABEL, reportCode, reportPublicPath } from "@/lib/crowd";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/forms";
import { loginPathFor, registerPathFor } from "@/lib/navigation";
import { useCursorList } from "@/lib/useCursorList";
import { useLoad } from "@/lib/useLoad";
import { cn } from "@/lib/utils";

type TabId = "instruksi" | "masalah" | "leaderboard" | "laporan";

const TAB_LABEL: Record<TabId, string> = {
  instruksi: "Instruksi",
  masalah: "Masalah diketahui",
  leaderboard: "Leaderboard",
  laporan: "Laporan saya",
};

/** `/crowd/c/:id`: halaman cycle publik (spec Tahap 5 §9.2). */
export function CrowdCyclePage() {
  const { id = "" } = useParams();
  const cycle = useLoad(useCallback(() => api.crowd.cycle(id), [id]));
  useDocumentTitle(cycle.state === "ready" ? cycle.data.title : "Cycle crowdtesting");

  if (cycle.state === "loading") return <Loading label="Memuat cycle…" />;
  if (cycle.state === "error") {
    if (cycle.error instanceof ApiError && cycle.error.status === 404) {
      return (
        <EmptyState icon={FileSearch} title="Cycle tidak ditemukan" headingLevel="h1" data-testid="cycle-not-found">
          <p>
            Cycle ini tidak ada atau belum dipublikasikan. <Link to="/crowd">Lihat cycle lain</Link>
          </p>
        </EmptyState>
      );
    }
    return <LoadError error={cycle.error} fallback="Gagal memuat cycle. Coba lagi." onRetry={cycle.reload} />;
  }
  return <CycleView cycle={cycle.data} reload={cycle.reload} />;
}

function CycleView({ cycle, reload }: { cycle: PublicCycleDto; reload: () => void }) {
  const [params] = useSearchParams();
  const showReports = cycle.me.participantStatus !== null;
  const tabs: TabId[] = ["instruksi", "masalah", "leaderboard", ...(showReports ? (["laporan"] as const) : [])];
  const requested = params.get("tab") as TabId | null;
  const tab: TabId = requested && tabs.includes(requested) ? requested : "instruksi";
  const base = `/crowd/c/${encodeURIComponent(cycle.id)}`;

  return (
    <article aria-labelledby="cycle-title" className="grid min-w-0 grid-cols-1 gap-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link to="/crowd">Crowdtesting</Link>
      </nav>

      <header className="grid min-w-0 gap-2" data-testid="cycle-public-header">
        <h1 id="cycle-title" className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {cycle.title}
        </h1>
        <p className="m-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {cycle.project.slug ? (
            <Link to={`/p/${encodeURIComponent(cycle.project.slug)}`}>{cycle.project.name}</Link>
          ) : (
            cycle.project.name
          )}
        </p>
        <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <CycleStatus status={cycle.status} endsAt={cycle.endsAt} data-testid="cycle-public-status" />
          {cycle.endsAt ? <span className="text-muted-foreground">Sampai {formatDateTime(cycle.endsAt)}</span> : null}
          {cycle.appVersion ? <span className="font-mono text-muted-foreground">v{cycle.appVersion.replace(/^v/i, "")}</span> : null}
          <span className="text-muted-foreground">{cycle.stats.participants} peserta</span>
          <span className="text-muted-foreground">{cycle.stats.accepted} laporan diterima</span>
        </p>
        {cycle.summary !== "" ? <p className="m-0 max-w-prose [overflow-wrap:anywhere]">{cycle.summary}</p> : null}
      </header>

      <ActionBlock cycle={cycle} onChanged={reload} />

      <section aria-labelledby="cycle-links-title" className="grid min-w-0 gap-2">
        <h2 id="cycle-links-title" className="text-lg font-semibold">
          Aplikasi yang diuji
        </h2>
        <ul className="m-0 grid list-none gap-2 p-0">
          {cycle.links.map((link, i) => (
            <li key={`${link.url}-${i}`} className="min-w-0">
              <ExternalLink href={link.url} label={link.label} data-testid={`cycle-app-link-${i}`} />
            </li>
          ))}
        </ul>
      </section>

      <nav aria-label="Bagian cycle" className="flex min-w-0 gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <Link
            key={t}
            to={t === "instruksi" ? base : `${base}?tab=${t}`}
            replace
            aria-current={tab === t ? "page" : undefined}
            data-testid={`cycle-tab-${t}`}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium no-underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-hidden",
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      {tab === "instruksi" ? <Instructions cycle={cycle} /> : null}
      {tab === "masalah" ? <KnownIssues cycleId={cycle.id} /> : null}
      {tab === "leaderboard" ? <CycleLeaderboard cycleId={cycle.id} /> : null}
      {tab === "laporan" ? <MyReports cycleId={cycle.id} /> : null}
    </article>
  );
}

/** Blok aksi sesuai keadaan pengunjung (`me.state`, spec §9.2). */
function ActionBlock({ cycle, onChanged }: { cycle: PublicCycleDto; onChanged: () => void }) {
  const { pathname, search } = useLocation();
  const rulesId = useId();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = cycle.me.state;
  const here = `${pathname}${search}`;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Ikut cycle" className="grid min-w-0 gap-3 rounded-xl border bg-card p-4" data-testid="cycle-action">
      <p className="m-0 [overflow-wrap:anywhere]">{ME_STATE_COPY[state]}</p>

      {state === "anonymous" ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={loginPathFor(here)} data-testid="cycle-login">
              Masuk untuk ikut
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={registerPathFor(here)}>Daftar</Link>
          </Button>
        </div>
      ) : null}

      {state === "can_join" || state === "left" ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (accepted) void run(() => api.crowd.join(cycle.id));
          }}
        >
          <label htmlFor={rulesId} className="flex items-start gap-2 text-sm">
            <input
              id={rulesId}
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              data-testid="cycle-rules-checkbox"
            />
            <span>
              Saya sudah membaca instruksi dan cakupan, akan menguji hanya yang ada di cakupan, dan tidak akan
              mengirim laporan palsu atau spam.
            </span>
          </label>
          <div>
            <Button type="submit" disabled={!accepted || busy} data-testid="cycle-join">
              {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              {state === "left" ? "Ikut lagi" : "Ikut cycle ini"}
            </Button>
          </div>
        </form>
      ) : null}

      {state === "joined" ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={`/crowd/c/${encodeURIComponent(cycle.id)}/report`} data-testid="cycle-report">
              <Send aria-hidden="true" />
              Kirim laporan
            </Link>
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => api.crowd.leave(cycle.id))} data-testid="cycle-leave">
            <LogOut aria-hidden="true" />
            Keluar dari cycle
          </Button>
        </div>
      ) : null}

      <p role="alert" className={error ? "m-0 text-sm font-medium text-destructive" : "sr-only"} data-testid="cycle-action-error">
        {error}
      </p>
    </section>
  );
}

function Instructions({ cycle }: { cycle: PublicCycleDto }) {
  return (
    <div className="grid min-w-0 gap-6">
      <section aria-labelledby="cycle-instructions" className="grid min-w-0 gap-2">
        <h2 id="cycle-instructions" className="text-lg font-semibold">
          Instruksi
        </h2>
        {cycle.instructions.trim() !== "" ? (
          <LazyMarkdown source={cycle.instructions} />
        ) : (
          <p className="m-0 text-sm text-muted-foreground">Tidak ada instruksi khusus. Coba aplikasinya dan laporkan bug yang Anda temukan.</p>
        )}
      </section>
      <div className="grid min-w-0 gap-6 md:grid-cols-2">
        <section aria-labelledby="cycle-in-scope" className="grid min-w-0 content-start gap-2">
          <h2 id="cycle-in-scope" className="text-lg font-semibold">
            Yang diuji
          </h2>
          {cycle.inScope.trim() !== "" ? <LazyMarkdown source={cycle.inScope} /> : <p className="m-0 text-sm text-muted-foreground">–</p>}
        </section>
        <section aria-labelledby="cycle-out-scope" className="grid min-w-0 content-start gap-2">
          <h2 id="cycle-out-scope" className="text-lg font-semibold">
            Di luar cakupan
          </h2>
          {cycle.outOfScope.trim() !== "" ? <LazyMarkdown source={cycle.outOfScope} /> : <p className="m-0 text-sm text-muted-foreground">–</p>}
        </section>
      </div>
      {cycle.environments.length > 0 ? (
        <section aria-labelledby="cycle-envs" className="grid min-w-0 gap-2">
          <h2 id="cycle-envs" className="text-lg font-semibold">
            Lingkungan target
          </h2>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {cycle.environments.map((env) => (
              <li key={env} className="max-w-full rounded-md border px-2 py-0.5 text-sm [overflow-wrap:anywhere]">
                {env}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function KnownIssues({ cycleId }: { cycleId: string }) {
  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page = await api.crowd.knownIssues(cycleId, cursor);
      return { items: page.items, nextCursor: page.nextCursor };
    },
    [cycleId],
  );
  const list = useCursorList(fetchPage);
  if (list.state === "loading") return <Loading label="Memuat masalah yang sudah diketahui…" />;
  if (list.state === "error") return <LoadError error={list.error} fallback="Gagal memuat daftar. Coba lagi." onRetry={list.reload} />;
  return (
    <section aria-labelledby="known-title" className="grid min-w-0 gap-3" data-testid="known-issues">
      <h2 id="known-title" className="text-lg font-semibold">
        Masalah yang sudah diketahui
      </h2>
      <p className="m-0 text-sm text-muted-foreground">Cek daftar ini sebelum mengirim laporan agar tidak dobel.</p>
      {list.items.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">Belum ada laporan yang diterima.</p>
      ) : (
        <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0">
          {list.items.map((issue, i) => (
            <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2" data-testid={`known-issue-${i}`}>
              <SeverityBadge severity={issue.severity} />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{issue.title}</span>
              <span className="text-xs text-muted-foreground">{formatRelativeTime(issue.acceptedAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {list.moreError ? <LoadError error={list.moreError} fallback="Gagal memuat berikutnya. Coba lagi." onRetry={list.loadMore} /> : null}
      {list.hasMore ? (
        <div>
          <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore} data-testid="known-issues-more">
            Muat lagi
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function CycleLeaderboard({ cycleId }: { cycleId: string }) {
  const board = useLoad(useCallback(() => api.crowd.leaderboard(cycleId), [cycleId]));
  if (board.state === "loading") return <Loading label="Memuat leaderboard…" />;
  if (board.state === "error") return <LoadError error={board.error} fallback="Gagal memuat leaderboard. Coba lagi." onRetry={board.reload} />;
  return <LeaderboardTable data={board.data} caption="Leaderboard cycle ini" />;
}

function MyReports({ cycleId }: { cycleId: string }) {
  const reports = useLoad(useCallback(() => api.crowd.myReports(cycleId), [cycleId]));
  if (reports.state === "loading") return <Loading label="Memuat laporan saya…" />;
  if (reports.state === "error") return <LoadError error={reports.error} fallback="Gagal memuat laporan. Coba lagi." onRetry={reports.reload} />;
  if (reports.data.items.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground" data-testid="my-reports-empty">Anda belum mengirim laporan di cycle ini.</p>;
  }
  return (
    <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0" data-testid="my-reports">
      {reports.data.items.map((r) => (
        <li key={r.id}>
          <MyReportRow report={r} />
        </li>
      ))}
    </ul>
  );
}

function MyReportRow({ report }: { report: MyCrowdReportItemDto }) {
  return (
    <Link
      to={reportPublicPath(report.id)}
      className="grid min-w-0 gap-1 px-4 py-3 text-foreground no-underline hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-hidden"
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="font-mono text-sm text-muted-foreground">{reportCode(report.number)}</span>
        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{report.title}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{REPORT_STATUS_LABEL[report.status]}</span>
        <SeverityBadge severity={report.finalSeverity ?? report.suggestedSeverity} />
        {report.status === "accepted" ? <span>+{report.points} poin</span> : null}
        <span>{formatRelativeTime(report.submittedAt)}</span>
      </span>
    </Link>
  );
}
