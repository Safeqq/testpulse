import type { RunSummaryDto } from "@testpulse/shared";
import { History, Loader2 } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { LIST_ITEM_LINK_CLASS } from "@/components/listItemLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { RunStatus, runOutcome } from "@/components/RunStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useCursorList } from "@/lib/useCursorList";
import { useLoad } from "@/lib/useLoad";
import { BranchFilter } from "./BranchFilter";
import { preloadPages } from "./lazyPages";
import { ProjectFrame } from "./ProjectFrame";

/** `/p/:slug/runs`: semua run project, dapat difilter per branch (`?branch=`), dimuat 20 per halaman. */
export function RunsPage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Daftar run">
      {(project) => <RunsView slug={project.slug} />}
    </ProjectFrame>
  );
}

function RunsView({ slug }: { slug: string }) {
  useEffect(() => preloadPages("run"), []);
  const [params, setParams] = useSearchParams();
  const branch = params.get("branch") ?? "";
  const fetchBranches = useCallback(() => api.results.branches(slug), [slug]);
  const branches = useLoad(fetchBranches);

  return (
    <section aria-labelledby="runs-title" className="grid min-w-0 grid-cols-1 gap-6">
      <h1 id="runs-title" className="text-2xl font-semibold tracking-tight">
        Daftar run
      </h1>
      {/* Pilihan branch bersifat tambahan: bila gagal dimuat, daftar run (semua branch) tetap bisa dipakai. */}
      {branches.state === "ready" && branches.data.length > 0 ? (
        <BranchFilter
          id="runs-branch"
          testId="runs-branch"
          branches={branches.data}
          value={branch}
          allLabel="Semua branch"
          onChange={(next) => setParams(next ? { branch: next } : {}, { replace: true })}
        />
      ) : null}
      <RunsList key={branch} slug={slug} branch={branch} />
    </section>
  );
}

function RunsList({ slug, branch }: { slug: string; branch: string }) {
  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page = await api.results.runs(slug, { branch, cursor });
      return { items: page.runs, nextCursor: page.nextCursor };
    },
    [slug, branch],
  );
  const list = useCursorList(fetchPage);

  if (list.state === "loading") return <Loading label="Memuat daftar run…" />;
  if (list.state === "error") {
    return <LoadError error={list.error} fallback="Gagal memuat daftar run. Coba lagi." onRetry={list.reload} />;
  }
  if (list.items.length === 0) {
    return (
      <EmptyState icon={History} title="Belum ada run" data-testid="runs-empty">
        <p>
          {branch
            ? "Belum ada run untuk branch ini."
            : "Run akan muncul di sini setelah pipeline CI project ini mengunggah laporan pertamanya."}
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <ul
        className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0"
        data-testid="runs-list"
      >
        {list.items.map((run) => (
          <li key={run.id} data-testid={`run-item-${run.id}`}>
            <RunRow slug={slug} run={run} />
          </li>
        ))}
      </ul>
      <p role="status" className="text-sm text-muted-foreground">
        Menampilkan {list.items.length} run{list.hasMore ? "" : " (semua)"}
      </p>
      {list.moreError ? (
        <LoadError error={list.moreError} fallback="Gagal memuat run berikutnya. Coba lagi." onRetry={list.loadMore} />
      ) : null}
      {list.hasMore ? (
        <div>
          <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore} data-testid="runs-load-more">
            {list.loadingMore ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Muat lebih banyak
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RunRow({ slug, run }: { slug: string; run: RunSummaryDto }) {
  return (
    <Link
      to={`/p/${slug}/runs/${run.id}`}
      className={LIST_ITEM_LINK_CLASS}
    >
      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <RunStatus outcome={runOutcome(run)} className="text-sm" />
        <span className="font-mono text-sm">{run.commitSha ? run.commitSha.slice(0, 7) : "tanpa commit"}</span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="outline" className="max-w-full font-mono">
          <span className="min-w-0 truncate">{run.branch}</span>
        </Badge>
        {run.name ? <span className="min-w-0 text-sm [overflow-wrap:anywhere]">{run.name}</span> : null}
      </span>
      <span className="text-xs text-muted-foreground">
        {formatDateTime(run.createdAt)} · {run.passed}/{run.total} lulus
        {run.failed > 0 ? ` · ${run.failed} gagal` : ""}
        {run.flaky > 0 ? ` · ${run.flaky} flaky` : ""} · {formatDuration(run.durationMs)}
      </span>
    </Link>
  );
}
