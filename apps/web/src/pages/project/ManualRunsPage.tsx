import { MANUAL_RUN_STATUSES, type ManualRunSummaryDto } from "@testpulse/shared";
import { ListChecks, Loader2, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { FilterSelect } from "@/components/FilterSelect";
import { LIST_ITEM_LINK_CLASS } from "@/components/listItemLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { ManualRunStatus } from "@/components/ManualStatus";
import { ManualSubTabs } from "@/components/ManualSubTabs";
import { RunProgress } from "@/components/RunProgress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { MANUAL_RUN_STATUS_LABEL, parseRunFilters, RUN_FILTER_KEYS, runCode, type RunFilters } from "@/lib/manual";
import { useCursorList } from "@/lib/useCursorList";
import { preloadPages } from "./lazyPages";
import { ProjectFrame } from "./ProjectFrame";

/** `/p/:slug/manual-runs`: daftar run manual (20 per halaman, terbaru dulu) dengan filter status dan versi di URL. */
export function ManualRunsPage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Run manual" tab="manual">
      {(project) => (
        <RunsView slug={project.slug} canCreate={project.myRole === "tester" || project.myRole === "admin"} />
      )}
    </ProjectFrame>
  );
}

function RunsView({ slug, canCreate }: { slug: string; canCreate: boolean }) {
  useEffect(() => {
    preloadPages("manualRun", "cases", ...(canCreate ? (["manualRunNew"] as const) : []));
  }, [canCreate]);
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseRunFilters(params), [params]);
  // Berdasarkan URL (bukan filter yang lolos validasi) agar "Atur ulang filter" juga membersihkan parameter yang tidak valid.
  const hasFilters = RUN_FILTER_KEYS.some((key) => params.has(key));

  /**
   * Menulis satu filter ke URL (kosong menghapusnya); filter lain tetap. Dasarnya adalah URL saat ini, bukan `params`
   * dari render terakhir: pembaruan navigasi React Router bisa tertunda (transition), sehingga dua perubahan beruntun
   * yang bertumpu pada `params` lama akan mengembalikan filter yang baru saja dihapus.
   */
  function setFilter(key: (typeof RUN_FILTER_KEYS)[number], value: string) {
    const next = new URLSearchParams(window.location.search);
    if (value === "" || (key === "status" && value === "all")) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  return (
    <section aria-labelledby="manual-runs-title" className="grid min-w-0 grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 id="manual-runs-title" className="text-2xl font-semibold tracking-tight">
          Run manual
        </h1>
        {canCreate ? (
          <Button asChild>
            <Link to={`/p/${encodeURIComponent(slug)}/manual-runs/new`} data-testid="manual-run-create">
              <Plus aria-hidden="true" />
              Buat run
            </Link>
          </Button>
        ) : null}
      </div>

      <ManualSubTabs slug={slug} active="runs" />

      <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3">
        <div className="grid min-w-0 gap-1.5 sm:w-56">
          <FilterSelect
            label="Status"
            testId="manual-runs-filter-status"
            allLabel="Semua status"
            value={filters.status === "all" ? "" : filters.status}
            options={MANUAL_RUN_STATUSES.map((status): [string, string] => [status, MANUAL_RUN_STATUS_LABEL[status]])}
            onChange={(value) => setFilter("status", value)}
          />
        </div>
        <VersionFilter value={filters.appVersion ?? ""} onSubmit={(value) => setFilter("appVersion", value)} />
      </div>

      <RunsList
        key={params.toString()}
        slug={slug}
        filters={filters}
        resetFilters={hasFilters ? () => setParams({}, { replace: true }) : undefined}
      />
    </section>
  );
}

/** Kolom versi aplikasi: diketik lokal, dikirim ke URL saat submit, dan mengikuti URL bila berubah dari luar. */
function VersionFilter({ value, onSubmit }: { value: string; onSubmit: (value: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  // Menyelaraskan state saat render (tanpa effect/remount) supaya kolom tetap fokus setelah submit.
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <form
      className="flex min-w-0 flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft.trim());
      }}
    >
      <div className="grid min-w-0 gap-1.5 sm:w-56">
        <Label htmlFor={id}>Versi aplikasi</Label>
        <Input
          id={id}
          name="appVersion"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={50}
          autoComplete="off"
          data-testid="manual-runs-filter-version"
        />
      </div>
      <Button type="submit" variant="outline" data-testid="manual-runs-filter-version-submit">
        <Search aria-hidden="true" />
        Terapkan
      </Button>
    </form>
  );
}

function RunsList({
  slug,
  filters,
  resetFilters,
}: {
  slug: string;
  filters: RunFilters;
  resetFilters: (() => void) | undefined;
}) {
  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page = await api.manual.runs.list(slug, { ...filters, cursor });
      return { items: page.items, nextCursor: page.nextCursor };
    },
    [slug, filters],
  );
  const list = useCursorList(fetchPage);

  if (list.state === "loading") return <Loading label="Memuat daftar run…" />;
  if (list.state === "error") {
    return <LoadError error={list.error} fallback="Gagal memuat daftar run. Coba lagi." onRetry={list.reload} />;
  }
  if (list.items.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title={resetFilters ? "Tidak ada run yang cocok" : "Belum ada run manual"}
        data-testid="manual-runs-empty"
        action={
          resetFilters ? (
            <Button type="button" variant="outline" size="sm" onClick={resetFilters} data-testid="manual-runs-filter-reset">
              Atur ulang filter
            </Button>
          ) : null
        }
      >
        <p>
          {resetFilters
            ? "Tidak ada run yang cocok dengan filter ini. Ubah atau atur ulang filter."
            : "Run manual yang dibuat tim akan muncul di sini. Pilih suite atau case, lalu eksekusi satu per satu."}
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0" data-testid="manual-runs-list">
        {list.items.map((run) => (
          <li key={run.number} data-testid={`manual-run-row-${run.number}`}>
            <RunRow slug={slug} run={run} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="m-0 text-sm text-muted-foreground">
          Menampilkan {list.items.length} run{list.hasMore ? "" : " (semua)"}
        </p>
        {resetFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={resetFilters} data-testid="manual-runs-filter-reset">
            Atur ulang filter
          </Button>
        ) : null}
      </div>
      {list.moreError ? (
        <LoadError error={list.moreError} fallback="Gagal memuat run berikutnya. Coba lagi." onRetry={list.loadMore} />
      ) : null}
      {list.hasMore ? (
        <div>
          <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore} data-testid="manual-runs-load-more">
            {list.loadingMore ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Muat lagi
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RunRow({ slug, run }: { slug: string; run: ManualRunSummaryDto }) {
  return (
    <Link to={`/p/${encodeURIComponent(slug)}/manual-runs/${run.number}`} className={LIST_ITEM_LINK_CLASS}>
      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-sm text-muted-foreground">{runCode(run.number)}</span>
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{run.name}</span>
        </span>
        <ManualRunStatus status={run.status} className="text-sm" />
      </span>
      <RunProgress counts={run.counts} total={run.total} />
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {run.appVersion ? <span className="min-w-0 font-mono [overflow-wrap:anywhere]">{run.appVersion}</span> : null}
        <span className="min-w-0 [overflow-wrap:anywhere]">Dibuat oleh {run.createdBy.name}</span>
        <time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time>
        {run.completedAt ? (
          <span>
            selesai <time dateTime={run.completedAt}>{formatDateTime(run.completedAt)}</time>
          </span>
        ) : null}
      </span>
    </Link>
  );
}
