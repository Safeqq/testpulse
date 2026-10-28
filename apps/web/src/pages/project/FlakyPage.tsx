import type { BranchDto } from "@testpulse/shared";
import { BarChart3, CheckCircle2 } from "lucide-react";
import { useCallback, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { FlakyTestItem } from "@/components/FlakyTestItem";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { api } from "@/lib/api";
import { FLAKY_API_LIMIT } from "@/lib/flaky";
import { useLoad } from "@/lib/useLoad";
import { BranchFilter } from "./BranchFilter";
import { preloadPages } from "./lazyPages";
import { ProjectFrame } from "./ProjectFrame";
import { defaultBranch } from "./ProjectResults";

/** `/p/:slug/flaky`: test flaky satu branch (`?branch=`, bawaan sama dengan dashboard), terurut menurut skor. */
export function FlakyPage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Test flaky">
      {(project) => <FlakyView slug={project.slug} />}
    </ProjectFrame>
  );
}

function FlakyView({ slug }: { slug: string }) {
  useEffect(() => preloadPages("test"), []);
  const [params, setParams] = useSearchParams();
  const fetchBranches = useCallback(() => api.results.branches(slug), [slug]);
  const branches = useLoad(fetchBranches);

  return (
    <section aria-labelledby="flaky-title" className="grid min-w-0 grid-cols-1 gap-6">
      <h1 id="flaky-title" className="text-2xl font-semibold tracking-tight">
        Test flaky
      </h1>
      {branches.state === "loading" ? <Loading label="Memuat test flaky…" /> : null}
      {branches.state === "error" ? (
        <LoadError error={branches.error} fallback="Gagal memuat test flaky. Coba lagi." onRetry={branches.reload} />
      ) : null}
      {branches.state === "ready" && branches.data.length === 0 ? (
        <EmptyState icon={BarChart3} title="Belum ada hasil test" data-testid="flaky-empty">
          <p>Daftar test flaky akan tampil setelah pipeline CI project ini mengunggah laporan.</p>
        </EmptyState>
      ) : null}
      {branches.state === "ready" && branches.data.length > 0 ? (
        <FlakyBranch
          slug={slug}
          branches={branches.data}
          branch={params.get("branch") || defaultBranch(branches.data)}
          onBranchChange={(next) => setParams({ branch: next }, { replace: true })}
        />
      ) : null}
    </section>
  );
}

function FlakyBranch({
  slug,
  branches,
  branch,
  onBranchChange,
}: {
  slug: string;
  branches: BranchDto[];
  branch: string;
  onBranchChange: (branch: string) => void;
}) {
  return (
    <>
      <BranchFilter id="flaky-branch" testId="flaky-branch" branches={branches} value={branch} onChange={onBranchChange} />
      <FlakyList key={branch} slug={slug} branch={branch} />
    </>
  );
}

function FlakyList({ slug, branch }: { slug: string; branch: string }) {
  const fetchFlaky = useCallback(() => api.results.flaky(slug, branch), [slug, branch]);
  const load = useLoad(fetchFlaky);

  if (load.state === "loading") return <Loading label="Memuat test flaky…" />;
  if (load.state === "error") {
    return <LoadError error={load.error} fallback="Gagal memuat test flaky. Coba lagi." onRetry={load.reload} />;
  }
  if (load.data.length === 0) {
    return (
      <EmptyState icon={CheckCircle2} title="Tidak ada test flaky" data-testid="flaky-empty">
        <p>Tidak ada test dengan hasil naik-turun di 20 run terakhir branch ini.</p>
      </EmptyState>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <p className="m-0 text-sm text-muted-foreground">
        Diurutkan dari skor tertinggi. Skor menggabungkan perubahan hasil lulus↔gagal dan percobaan ulang pada 20 run
        terakhir.
        {load.data.length >= FLAKY_API_LIMIT ? ` Hanya ${FLAKY_API_LIMIT} test teratas yang ditampilkan.` : ""}
      </p>
      <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0" data-testid="flaky-list">
        {load.data.map((test) => (
          <FlakyTestItem key={test.testCaseId} slug={slug} branch={branch} test={test} showBar />
        ))}
      </ul>
    </div>
  );
}
