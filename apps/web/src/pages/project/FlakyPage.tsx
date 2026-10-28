import type { BranchDto, FlakyTestDto } from "@testpulse/shared";
import { BarChart3, CheckCircle2 } from "lucide-react";
import { useCallback } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ScoreBar } from "@/components/charts/ScoreBar";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { withBranch } from "@/lib/navigation";
import { useLoad } from "@/lib/useLoad";
import { BranchFilter } from "./BranchFilter";
import { Loading, ProjectFrame } from "./ProjectFrame";
import { defaultBranch } from "./ProjectResults";

/** Batas daftar flaky dari API. */
const FLAKY_API_LIMIT = 50;

const LAST_STATUS_LABEL = { passed: "lulus", failed: "gagal", skipped: "dilewati" } as const;

/** `/p/:slug/flaky`: test flaky satu branch (`?branch=`, bawaan sama dengan dashboard), terurut menurut skor. */
export function FlakyPage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Test flaky" returnTo={`/p/${slug}/flaky`}>
      {(project) => <FlakyView slug={project.slug} />}
    </ProjectFrame>
  );
}

function FlakyView({ slug }: { slug: string }) {
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
          branch={params.get("branch") ?? defaultBranch(branches.data)}
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
          <FlakyRow key={test.testCaseId} slug={slug} branch={branch} test={test} />
        ))}
      </ul>
    </div>
  );
}

function FlakyRow({ slug, branch, test }: { slug: string; branch: string; test: FlakyTestDto }) {
  return (
    <li data-testid={`flaky-item-${test.testCaseId}`}>
      <Link
        to={withBranch(`/p/${slug}/tests/${test.testCaseId}`, branch)}
        className="grid min-w-0 gap-2 px-4 py-3 text-foreground no-underline outline-hidden hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{test.name}</span>
          <Badge variant="secondary" className="font-mono tabular-nums">
            Skor {test.score}
          </Badge>
        </span>
        <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{test.suite}</span>
        <ScoreBar score={test.score} />
        <span className="text-xs text-muted-foreground">Hasil terakhir: {LAST_STATUS_LABEL[test.lastStatus]}</span>
      </Link>
    </li>
  );
}
