import type { ProjectDto, RunSummaryDto, TestResultDto } from "@testpulse/shared";
import { ExternalLink, FileSearch, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { FormError } from "@/components/FormError";
import { LoadError } from "@/components/LoadError";
import { RunStatus, runOutcome } from "@/components/RunStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/forms";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useCursorList, type CursorList } from "@/lib/useCursorList";
import { Loading, ProjectFrame } from "./ProjectFrame";

type Filter = "failed" | "flaky" | "all";

const FILTERS: { value: Filter; label: string; count: (run: RunSummaryDto) => number }[] = [
  { value: "failed", label: "Gagal", count: (run) => run.failed },
  { value: "flaky", label: "Flaky", count: (run) => run.flaky },
  { value: "all", label: "Semua", count: (run) => run.total },
];

const EMPTY_TEXT: Record<Filter, string> = {
  failed: "Tidak ada test yang gagal di run ini.",
  flaky: "Tidak ada test flaky di run ini.",
  all: "Run ini tidak memuat hasil test.",
};

const TEXT_LINK_CLASS =
  "rounded-sm font-medium text-link underline underline-offset-4 outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring";

/** Hanya URL http(s) yang dijadikan tautan; server sudah memvalidasi, tetapi nilai ini tetap diperlakukan sebagai teks tak tepercaya. */
function safeExternalUrl(url: string | null): string | null {
  return url !== null && /^https?:\/\//i.test(url) ? url : null;
}

/** `/p/:slug/runs/:runId`: ringkasan satu run dan hasil test-nya (filter Gagal/Flaky/Semua). */
export function RunPage() {
  const { slug = "", runId = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Detail run" returnTo={`/p/${slug}/runs/${runId}`}>
      {(project) => <RunView key={runId} project={project} runId={runId} />}
    </ProjectFrame>
  );
}

function RunView({ project, runId }: { project: ProjectDto; runId: string }) {
  const { slug } = project;
  const [filter, setFilter] = useState<Filter>("failed");
  // Ringkasan run ikut di setiap halaman hasil; disimpan agar header tetap tampil saat filter diganti.
  const [run, setRun] = useState<RunSummaryDto | null>(null);

  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page = await api.results.run(slug, runId, { status: filter, cursor });
      setRun(page.run);
      return { items: page.results, nextCursor: page.nextCursor };
    },
    [slug, runId, filter],
  );
  const list = useCursorList(fetchPage);

  if (run === null) {
    if (list.state === "error") {
      if (list.error instanceof ApiError && list.error.code === "RUN_NOT_FOUND") {
        return (
          <EmptyState icon={FileSearch} title="Run tidak ditemukan" headingLevel="h1" data-testid="run-not-found">
            <p>Run ini tidak ada atau sudah dihapus.</p>
            <Link to={`/p/${slug}/runs`} className={TEXT_LINK_CLASS}>
              Ke daftar run
            </Link>
          </EmptyState>
        );
      }
      return <LoadError error={list.error} fallback="Gagal memuat run. Coba lagi." onRetry={list.reload} />;
    }
    return <Loading label="Memuat run…" />;
  }

  const canDelete = project.myRole === "tester" || project.myRole === "admin";

  return (
    <section aria-labelledby="run-title" className="grid min-w-0 grid-cols-1 gap-6">
      <h1 id="run-title" className="text-2xl font-semibold tracking-tight">
        Detail run
      </h1>
      <RunHeader run={run} />
      {canDelete ? <DeleteRun slug={slug} runId={runId} /> : null}

      <div className="grid min-w-0 grid-cols-1 gap-4">
        <h2 id="results-title" className="text-lg font-semibold tracking-tight">
          Hasil test
        </h2>
        <div role="group" aria-labelledby="results-title" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              type="button"
              variant={filter === f.value ? "default" : "outline"}
              size="sm"
              aria-pressed={filter === f.value}
              data-testid={`run-filter-${f.value}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              <span className="font-mono tabular-nums">({f.count(run)})</span>
            </Button>
          ))}
        </div>
        <Results filter={filter} slug={slug} list={list} />
      </div>
    </section>
  );
}

function RunHeader({ run }: { run: RunSummaryDto }) {
  const ciUrl = safeExternalUrl(run.ciUrl);
  return (
    <Card className="min-w-0 gap-4 p-4" data-testid="run-header">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <RunStatus outcome={runOutcome(run)} className="text-xl" />
        {ciUrl ? (
          <a href={ciUrl} target="_blank" rel="noopener noreferrer" className={`${TEXT_LINK_CLASS} inline-flex items-center gap-1.5 text-sm`}>
            Buka di CI
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(tab baru)</span>
          </a>
        ) : null}
      </div>
      <dl className="m-0 grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Meta label="Branch">
          <Badge variant="outline" className="max-w-full font-mono">
            <span className="min-w-0 truncate">{run.branch}</span>
          </Badge>
        </Meta>
        <Meta label="Commit">
          {run.commitSha ? (
            <span className="font-mono [overflow-wrap:anywhere]" data-testid="run-commit">
              {run.commitSha}
            </span>
          ) : (
            <span className="text-muted-foreground">Tanpa commit</span>
          )}
        </Meta>
        {run.name ? (
          <Meta label="Nama">
            <span className="[overflow-wrap:anywhere]">{run.name}</span>
          </Meta>
        ) : null}
        <Meta label="Waktu">{formatDateTime(run.createdAt)}</Meta>
        <Meta label="Durasi">{formatDuration(run.durationMs)}</Meta>
        <Meta label="Total test">
          <span className="font-mono tabular-nums">{run.total}</span>{" "}
          <span className="text-muted-foreground">
            ({run.passed} lulus, {run.failed} gagal, {run.skipped} dilewati, {run.flaky} flaky)
          </span>
        </Meta>
      </dl>
    </Card>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

/** Hapus run (tester+) dengan langkah konfirmasi inline; sengaja bukan dialog (komponen dialog tidak diizinkan CSP/spec UI). */
function DeleteRun({ slug, runId }: { slug: string; runId: string }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Fokus berpindah mengikuti langkah: ke "Batal" (aksi aman) saat konfirmasi muncul, kembali ke "Hapus run" saat dibatalkan.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) deleteRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await api.results.deleteRun(slug, runId);
      navigate(`/p/${slug}/runs`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "RUN_NOT_FOUND") {
        navigate(`/p/${slug}/runs`);
        return;
      }
      setError(errorMessage(err, "Gagal menghapus run. Coba lagi."));
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-3">
      {confirming ? (
        <div className="grid gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4" role="group" aria-labelledby="delete-run-question">
          <p id="delete-run-question" className="m-0 text-sm font-medium">
            Hapus run ini beserta semua hasil test-nya? Tindakan ini tidak dapat dibatalkan.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={remove}
              disabled={pending}
              data-testid="run-delete-confirm"
            >
              {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              Ya, hapus run
            </Button>
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={pending}
              data-testid="run-delete-cancel"
            >
              Batal
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button ref={deleteRef} type="button" variant="outline" size="sm" onClick={() => setConfirming(true)} data-testid="run-delete">
            <Trash2 aria-hidden="true" />
            Hapus run
          </Button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}

function Results({ filter, slug, list }: { filter: Filter; slug: string; list: CursorList<TestResultDto> }) {
  if (list.state === "loading") return <Loading label="Memuat hasil test…" />;
  if (list.state === "error") {
    return <LoadError error={list.error} fallback="Gagal memuat hasil test. Coba lagi." onRetry={list.reload} />;
  }
  if (list.items.length === 0) {
    return (
      <p className="m-0 rounded-lg border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground" data-testid="results-empty">
        {EMPTY_TEXT[filter]}
      </p>
    );
  }
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0">
        {list.items.map((result) => (
          <ResultRow key={result.testCaseId} slug={slug} result={result} />
        ))}
      </ul>
      {list.moreError ? (
        <LoadError error={list.moreError} fallback="Gagal memuat hasil berikutnya. Coba lagi." onRetry={list.loadMore} />
      ) : null}
      {list.hasMore ? (
        <div>
          <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore} data-testid="results-load-more">
            {list.loadingMore ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Muat lebih banyak
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ResultRow({ slug, result }: { slug: string; result: TestResultDto }) {
  return (
    <li className="grid min-w-0 gap-1.5 px-4 py-3" data-testid={`result-row-${result.testCaseId}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <Link to={`/p/${slug}/tests/${result.testCaseId}`} className={`${TEXT_LINK_CLASS} min-w-0 text-sm [overflow-wrap:anywhere]`}>
          {result.name}
        </Link>
        <RunStatus outcome={result.status} className="text-sm" />
      </div>
      <p className="m-0 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{result.suite}</p>
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{formatDuration(result.durationMs)}</span>
        {result.flakyInRun ? <Badge variant="outline">Flaky</Badge> : null}
        {result.retries > 0 ? <span>{result.retries} percobaan ulang</span> : null}
      </p>
      {result.message ? (
        <details className="min-w-0">
          <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium text-link outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring">
            Lihat pesan error
          </summary>
          <pre className="m-0 mt-2 rounded-md border bg-background p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
            {result.message}
          </pre>
        </details>
      ) : null}
    </li>
  );
}
