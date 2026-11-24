import {
  CROWD_REPORT_STATUSES,
  CROWD_SEVERITIES,
  type CrowdReportListItemDto,
  type CrowdReportStatus,
  type CrowdSeverity,
  type ParticipantDto,
  type ProjectDto,
  type TeamCycleDto,
} from "@testpulse/shared";
import { Copy, ExternalLink as ExternalIcon, FileSearch, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CycleStatus } from "@/components/CycleStatus";
import { EmptyState } from "@/components/EmptyState";
import { FilterSelect } from "@/components/FilterSelect";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { LIST_ITEM_LINK_CLASS } from "@/components/listItemLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { BUG_SEVERITY_LABEL } from "@/lib/bugs";
import { cycleCode, cyclePublicPath, PARTICIPANT_STATUS_LABEL, REPORT_STATUS_LABEL, reportCode } from "@/lib/crowd";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { errorMessage } from "@/lib/forms";
import { useCursorList } from "@/lib/useCursorList";
import { useLoad } from "@/lib/useLoad";
import { cn } from "@/lib/utils";
import { ProjectFrame } from "./ProjectFrame";

type TabId = "antrian" | "peserta" | "leaderboard";
const TAB_LABEL: Record<TabId, string> = { antrian: "Antrian triase", peserta: "Peserta", leaderboard: "Leaderboard" };

/** `/p/:slug/cycles/:number`: detail cycle untuk tim (spec Tahap 5 §9.3). */
export function CyclePage() {
  const { slug = "", number = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title={`Cycle ${cycleCode(Number(number))}`} tab="crowd">
      {(project) => <CycleLoader project={project} number={Number(number)} />}
    </ProjectFrame>
  );
}

function CycleLoader({ project, number }: { project: ProjectDto; number: number }) {
  const cycle = useLoad(useCallback(() => api.cycles.get(project.slug, number), [project.slug, number]));
  if (cycle.state === "loading") return <Loading label="Memuat cycle…" />;
  if (cycle.state === "error") {
    if (cycle.error instanceof ApiError && cycle.error.status === 404) {
      return (
        <EmptyState icon={FileSearch} title="Cycle tidak ditemukan" data-testid="cycle-not-found">
          <p>
            <Link to={`/p/${encodeURIComponent(project.slug)}/cycles`}>Kembali ke daftar cycle</Link>
          </p>
        </EmptyState>
      );
    }
    return <LoadError error={cycle.error} fallback="Gagal memuat cycle. Coba lagi." onRetry={cycle.reload} />;
  }
  return <CycleView project={project} cycle={cycle.data} reload={cycle.reload} />;
}

function CycleView({ project, cycle, reload }: { project: ProjectDto; cycle: TeamCycleDto; reload: () => void }) {
  const [params] = useSearchParams();
  const isMember = project.myRole !== null;
  const tabs: TabId[] = isMember ? ["antrian", "peserta", "leaderboard"] : ["leaderboard"];
  const requested = params.get("tab") as TabId | null;
  const tab: TabId = requested && tabs.includes(requested) ? requested : tabs[0]!;
  const base = `/p/${encodeURIComponent(project.slug)}/cycles/${cycle.number}`;

  return (
    <article aria-labelledby="cycle-title" className="grid min-w-0 grid-cols-1 gap-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link to={`/p/${encodeURIComponent(project.slug)}/cycles`}>Crowdtesting</Link>
      </nav>
      <header className="grid min-w-0 gap-2">
        <p className="m-0 font-mono text-sm text-muted-foreground">{cycleCode(cycle.number)}</p>
        <h1 id="cycle-title" className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {cycle.title}
        </h1>
        <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <CycleStatus status={cycle.effectiveStatus} endsAt={cycle.endsAt} data-testid="cycle-status" />
          {cycle.endsAt ? <span className="text-muted-foreground">Sampai {formatDateTime(cycle.endsAt)}</span> : null}
          <span className="text-muted-foreground">{cycle.participants} peserta aktif</span>
          <span className="text-muted-foreground">
            {cycle.reportCounts.submitted} menunggu · {cycle.reportCounts.accepted} diterima
          </span>
        </p>
      </header>

      <Controls project={project} cycle={cycle} reload={reload} />

      <nav aria-label="Bagian cycle" className="flex min-w-0 gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <Link
            key={t}
            to={t === tabs[0] ? base : `${base}?tab=${t}`}
            replace
            aria-current={tab === t ? "page" : undefined}
            data-testid={`cycle-team-tab-${t}`}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium no-underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-hidden",
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>
      {tab === "antrian" ? <TriageQueue slug={project.slug} cycleNumber={cycle.number} /> : null}
      {tab === "peserta" ? (
        <Participants slug={project.slug} cycleNumber={cycle.number} canRemove={project.myRole === "tester" || project.myRole === "admin"} onChanged={reload} />
      ) : null}
      {tab === "leaderboard" ? <TeamLeaderboard slug={project.slug} cycleNumber={cycle.number} /> : null}
    </article>
  );
}

/** Tombol status, salin link, lihat sebagai crowd tester, ubah, dan hapus (admin). */
function Controls({ project, cycle, reload }: { project: ProjectDto; cycle: TeamCycleDto; reload: () => void }) {
  const navigate = useNavigate();
  const isAdmin = project.myRole === "admin";
  const [confirm, setConfirm] = useState<"open" | "closed" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const publicPath = cyclePublicPath(cycle.id);
  const hasReports = Object.values(cycle.reportCounts).some((n) => n > 0);
  const base = `/p/${encodeURIComponent(project.slug)}/cycles`;

  async function changeStatus(status: "open" | "closed") {
    setBusy(true);
    setError(null);
    try {
      await api.cycles.update(project.slug, cycle.number, { version: cycle.version, status });
      setConfirm(null);
      reload();
    } catch (err) {
      setError(errorMessage(err, "Gagal mengubah status. Coba lagi."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.cycles.remove(project.slug, cycle.number);
      navigate(base);
    } catch (err) {
      setError(errorMessage(err, "Gagal menghapus cycle. Coba lagi."));
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(publicPath, window.location.origin).toString());
      setMessage("Link publik disalin.");
    } catch {
      setMessage("Tidak bisa menyalin otomatis. Salin dari tautan “Lihat sebagai crowd tester”.");
    }
  }

  const status = cycle.effectiveStatus;
  return (
    <section aria-label="Kelola cycle" className="grid min-w-0 gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap gap-2">
        {isAdmin && cycle.status === "draft" ? (
          <Button type="button" onClick={() => setConfirm("open")} data-testid="cycle-open">
            Buka untuk publik
          </Button>
        ) : null}
        {isAdmin && cycle.status === "open" ? (
          <Button type="button" variant="outline" onClick={() => setConfirm("closed")} data-testid="cycle-close">
            Tutup cycle
          </Button>
        ) : null}
        {isAdmin && cycle.status === "closed" ? (
          <Button type="button" variant="outline" onClick={() => setConfirm("open")} data-testid="cycle-reopen">
            Buka ulang
          </Button>
        ) : null}
        {cycle.status !== "draft" ? (
          <>
            <Button type="button" variant="outline" onClick={() => void copyLink()} data-testid="cycle-copy-link">
              <Copy aria-hidden="true" />
              Salin link publik
            </Button>
            <Button asChild variant="outline">
              <Link to={publicPath} data-testid="cycle-view-public">
                <ExternalIcon aria-hidden="true" />
                Lihat sebagai crowd tester
              </Link>
            </Button>
          </>
        ) : null}
        {isAdmin ? (
          <Button asChild variant="ghost">
            <Link to={`${base}/${cycle.number}/edit`} data-testid="cycle-edit">
              <Pencil aria-hidden="true" />
              Ubah
            </Link>
          </Button>
        ) : null}
        {isAdmin ? (
          <Button type="button" variant="ghost" disabled={hasReports} onClick={() => setConfirm("delete")} data-testid="cycle-delete" aria-describedby={hasReports ? "cycle-delete-hint" : undefined}>
            <Trash2 aria-hidden="true" />
            Hapus
          </Button>
        ) : null}
      </div>
      {isAdmin && hasReports ? (
        <p id="cycle-delete-hint" className="m-0 text-sm text-muted-foreground">
          Cycle yang sudah punya laporan tidak bisa dihapus agar poin tester tetap tersimpan. Tutup cycle ini saja.
        </p>
      ) : null}
      {cycle.status === "draft" ? <p className="m-0 text-sm text-muted-foreground">Draf hanya terlihat oleh anggota project sampai dibuka.</p> : null}

      {confirm !== null ? (
        <div role="group" aria-label="Konfirmasi" className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
          <span>
            {confirm === "delete"
              ? "Hapus cycle ini? Tidak bisa dibatalkan."
              : confirm === "closed"
                ? "Tutup cycle? Tester tidak bisa ikut atau mengirim laporan baru."
                : status === "draft"
                  ? "Buka cycle ini untuk publik? Cycle tampil di direktori /crowd."
                  : "Buka ulang cycle ini?"}
          </span>
          <Button
            type="button"
            size="sm"
            variant={confirm === "delete" ? "destructive" : "default"}
            disabled={busy}
            onClick={() => void (confirm === "delete" ? remove() : changeStatus(confirm))}
            data-testid={confirm === "delete" ? "cycle-delete-confirm" : "cycle-status-confirm"}
          >
            {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Ya
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
            Batal
          </Button>
        </div>
      ) : null}
      <p role="status" className={message ? "m-0 text-sm" : "sr-only"} data-testid="cycle-control-message">
        {message}
      </p>
      <p role="alert" className={error ? "m-0 text-sm font-medium text-destructive" : "sr-only"} data-testid="cycle-control-error">
        {error}
      </p>
    </section>
  );
}

function TriageQueue({ slug, cycleNumber }: { slug: string; cycleNumber: number }) {
  const searchId = useId();
  const [params, setParams] = useSearchParams();
  const status = (CROWD_REPORT_STATUSES as readonly string[]).includes(params.get("status") ?? "") ? (params.get("status") as CrowdReportStatus) : "submitted";
  const severity = (CROWD_SEVERITIES as readonly string[]).includes(params.get("severity") ?? "") ? (params.get("severity") as CrowdSeverity) : undefined;
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);

  function setFilter(key: "status" | "severity" | "q", value: string) {
    const next = new URLSearchParams(window.location.search);
    if (value === "" || (key === "status" && value === "submitted")) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page = await api.cycles.reports(slug, cycleNumber, { status, ...(severity ? { severity } : {}), ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) });
      return { items: page.items, nextCursor: page.nextCursor };
    },
    [slug, cycleNumber, status, severity, q],
  );
  const list = useCursorList(fetchPage);

  return (
    <section aria-label="Antrian triase" className="grid min-w-0 gap-4" data-testid="triage-queue">
      <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3">
        <div className="grid min-w-0 gap-1.5 sm:w-48">
          <FilterSelect label="Status" testId="triage-filter-status" allLabel="Dikirim" value={status === "submitted" ? "" : status} options={CROWD_REPORT_STATUSES.filter((s) => s !== "submitted").map((s): [string, string] => [s, REPORT_STATUS_LABEL[s]])} onChange={(v) => setFilter("status", v)} />
        </div>
        <div className="grid min-w-0 gap-1.5 sm:w-48">
          <FilterSelect label="Severity usulan" testId="triage-filter-severity" allLabel="Semua severity" value={severity ?? ""} options={CROWD_SEVERITIES.map((s): [string, string] => [s, BUG_SEVERITY_LABEL[s]])} onChange={(v) => setFilter("severity", v)} />
        </div>
        <form className="flex min-w-0 flex-wrap items-end gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setFilter("q", draft.trim()); }}>
          <div className="grid min-w-0 gap-1.5 sm:w-56">
            <Label htmlFor={searchId}>Cari judul</Label>
            <Input id={searchId} type="search" value={draft} maxLength={100} onChange={(e) => setDraft(e.target.value)} data-testid="triage-search" />
          </div>
          <Button type="submit" variant="outline">
            <Search aria-hidden="true" />
            Cari
          </Button>
        </form>
      </div>
      {list.state === "loading" ? <Loading label="Memuat laporan…" /> : null}
      {list.state === "error" ? <LoadError error={list.error} fallback="Gagal memuat laporan. Coba lagi." onRetry={list.reload} /> : null}
      {list.state === "ready" && list.items.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground" data-testid="triage-queue-empty">
          {status === "submitted" ? "Tidak ada laporan yang menunggu triase." : "Tidak ada laporan dengan status ini."}
        </p>
      ) : null}
      {list.state === "ready" && list.items.length > 0 ? (
        <>
          <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0">
            {list.items.map((report) => (
              <li key={report.id} data-testid={`triage-row-${report.number}`}>
                <QueueRow slug={slug} report={report} />
              </li>
            ))}
          </ul>
          {list.hasMore ? (
            <div>
              <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore}>
                Muat lagi
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function QueueRow({ slug, report }: { slug: string; report: CrowdReportListItemDto }) {
  return (
    <Link to={`/p/${encodeURIComponent(slug)}/crowd-reports/${report.number}`} className={LIST_ITEM_LINK_CLASS}>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="font-mono text-sm text-muted-foreground">{reportCode(report.number)}</span>
        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{report.title}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <SeverityBadge severity={report.finalSeverity ?? report.suggestedSeverity} />
        <span className="[overflow-wrap:anywhere]">{report.reporter.name}</span>
        <span>{formatRelativeTime(report.submittedAt)}</span>
      </span>
    </Link>
  );
}

function Participants({ slug, cycleNumber, canRemove, onChanged }: { slug: string; cycleNumber: number; canRemove: boolean; onChanged: () => void }) {
  const [reloadKey, setReloadKey] = useState(0);
  const fetchPage = useCallback(
    async (cursor?: string) => {
      void reloadKey;
      const page = await api.cycles.participants(slug, cycleNumber, cursor ? { cursor } : {});
      return { items: page.items, nextCursor: page.nextCursor };
    },
    [slug, cycleNumber, reloadKey],
  );
  const list = useCursorList(fetchPage);
  if (list.state === "loading") return <Loading label="Memuat peserta…" />;
  if (list.state === "error") return <LoadError error={list.error} fallback="Gagal memuat peserta. Coba lagi." onRetry={list.reload} />;
  if (list.items.length === 0) return <p className="m-0 text-sm text-muted-foreground">Belum ada peserta.</p>;
  return (
    <div className="grid min-w-0 gap-3">
      <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0" data-testid="participants-list">
        {list.items.map((p) => (
          <li key={p.user.id} data-testid={`participant-row-${p.user.id}`}>
            <ParticipantRow
              slug={slug}
              cycleNumber={cycleNumber}
              participant={p}
              canRemove={canRemove}
              onRemoved={() => {
                setReloadKey((k) => k + 1);
                onChanged();
              }}
            />
          </li>
        ))}
      </ul>
      {list.hasMore ? (
        <div>
          <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore}>
            Muat lagi
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ParticipantRow({
  slug,
  cycleNumber,
  participant,
  canRemove,
  onRemoved,
}: {
  slug: string;
  cycleNumber: number;
  participant: ParticipantDto;
  canRemove: boolean;
  onRemoved: () => void;
}) {
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const counts = participant.reportCounts;
  const total = counts.submitted + counts.accepted + counts.rejected + counts.duplicate + counts.withdrawn;

  async function remove() {
    setError(null);
    try {
      await api.cycles.removeParticipant(slug, cycleNumber, participant.user.id, reason.trim() ? { reason: reason.trim() } : {});
      onRemoved();
    } catch (err) {
      setError(errorMessage(err, "Gagal mengeluarkan peserta. Coba lagi."));
    }
  }

  return (
    <div className="grid min-w-0 gap-2 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="grid min-w-0 gap-0.5">
          <span className="font-medium [overflow-wrap:anywhere]">{participant.user.name}</span>
          <span className="text-sm text-muted-foreground">
            {PARTICIPANT_STATUS_LABEL[participant.status]} · bergabung {formatRelativeTime(participant.joinedAt)} · {total} laporan, {counts.accepted} diterima
          </span>
        </span>
        {canRemove && participant.status !== "removed" && !open ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid={`participant-remove-${participant.user.id}`}>
            Keluarkan
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="grid min-w-0 gap-2 rounded-md border bg-background p-3" role="group" aria-label={`Keluarkan ${participant.user.name}`}>
          <Label htmlFor={reasonId}>Alasan (opsional)</Label>
          <Input id={reasonId} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="participant-remove-reason" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={() => void remove()} data-testid="participant-remove-confirm">
              Keluarkan dari cycle
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Batal
            </Button>
          </div>
          <p role="alert" className={error ? "m-0 text-sm font-medium text-destructive" : "sr-only"}>
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function TeamLeaderboard({ slug, cycleNumber }: { slug: string; cycleNumber: number }) {
  const board = useLoad(useCallback(() => api.cycles.leaderboard(slug, cycleNumber), [slug, cycleNumber]));
  if (board.state === "loading") return <Loading label="Memuat leaderboard…" />;
  if (board.state === "error") return <LoadError error={board.error} fallback="Gagal memuat leaderboard. Coba lagi." onRetry={board.reload} />;
  return <LeaderboardTable data={board.data} caption="Leaderboard cycle" />;
}
