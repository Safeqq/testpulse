import type { TestHistoryDto } from "@testpulse/shared";
import { FileSearch } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { HistoryStrip } from "@/components/charts/HistoryStrip";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { Badge } from "@/components/ui/badge";
import { api, ApiError } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { preloadPages } from "./lazyPages";
import { ProjectFrame } from "./ProjectFrame";

const LINK_CLASS =
  "rounded-sm font-medium text-link underline underline-offset-4 outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring";

/** `/p/:slug/tests/:testCaseId`: riwayat 20 hasil terakhir satu test (`?branch=` opsional; bawaan: branch run terbaru). */
export function TestHistoryPage() {
  const { slug = "", testCaseId = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Riwayat test">
      {(project) => <HistoryView key={testCaseId} slug={project.slug} testCaseId={testCaseId} />}
    </ProjectFrame>
  );
}

function HistoryView({ slug, testCaseId }: { slug: string; testCaseId: string }) {
  useEffect(() => preloadPages("run"), []);
  const [params] = useSearchParams();
  const branch = params.get("branch") ?? undefined;
  const fetchHistory = useCallback(() => api.results.history(slug, testCaseId, branch), [slug, testCaseId, branch]);
  const load = useLoad(fetchHistory);

  if (load.state === "loading") return <Loading label="Memuat riwayat test…" />;
  if (load.state === "error") {
    if (load.error instanceof ApiError && load.error.code === "TEST_NOT_FOUND") {
      return (
        <EmptyState icon={FileSearch} title="Test tidak ditemukan" headingLevel="h1" data-testid="test-not-found">
          <p>Test ini tidak ada di project ini.</p>
          <Link to={`/p/${slug}/flaky`} className={LINK_CLASS}>
            Ke daftar test flaky
          </Link>
        </EmptyState>
      );
    }
    return <LoadError error={load.error} fallback="Gagal memuat riwayat test. Coba lagi." onRetry={load.reload} />;
  }

  const { testCase, results } = load.data;
  return <HistoryContent slug={slug} testCase={testCase} branch={load.data.branch} results={results} />;
}

function HistoryContent({
  slug,
  testCase,
  branch,
  results,
}: {
  slug: string;
  testCase: { suite: string; name: string };
  branch: string | null;
  results: TestHistoryDto["results"];
}) {
  return (
    <section aria-labelledby="test-title" className="grid min-w-0 grid-cols-1 gap-6">
      <div className="grid min-w-0 gap-2">
        <h1 id="test-title" className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]" data-testid="test-title">
          {testCase.name}
        </h1>
        <p className="m-0 font-mono text-sm text-muted-foreground [overflow-wrap:anywhere]">{testCase.suite}</p>
        {branch ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Branch
            <Badge variant="outline" className="max-w-full font-mono" data-testid="test-branch">
              <span className="min-w-0 truncate">{branch}</span>
            </Badge>
          </div>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-3" data-testid="test-history">
        <h2 className="text-lg font-semibold tracking-tight">Riwayat hasil</h2>
        {results.length === 0 ? (
          <p className="m-0 rounded-lg border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Belum ada hasil untuk test ini{branch ? " di branch ini" : ""}.
          </p>
        ) : (
          <>
            <p className="m-0 text-sm text-muted-foreground">
              {results.length} hasil terakhir, dari yang terlama (kiri atau atas) ke yang terbaru. Pilih satu untuk
              membuka run-nya.
            </p>
            <HistoryStrip results={results} runHref={(runId) => `/p/${slug}/runs/${runId}`} />
          </>
        )}
      </div>
    </section>
  );
}
