import { MAX_VERSIONS, type RunSummaryDto, type VersionDto } from "@testpulse/shared";
import { Tag } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { api } from "@/lib/api";
import { formatPassRateDelta, runLabel, versionLabel } from "@/lib/compareSummary";
import { formatDateTime, formatPassRate } from "@/lib/format";
import { compareHref } from "@/lib/navigation";
import { useLoad } from "@/lib/useLoad";
import { cn } from "@/lib/utils";
import { BranchFilter } from "./BranchFilter";
import { preloadPages } from "./lazyPages";
import { ProjectFrame } from "./ProjectFrame";
import { defaultBranch } from "./ProjectResults";

/** `/p/:slug/versions?branch=`: tiap versi di satu branch dengan pass rate dan perubahannya dari versi sebelumnya. */
export function VersionsPage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Versi" tab="versi">
      {(project) => <VersionsView slug={project.slug} />}
    </ProjectFrame>
  );
}

function VersionsView({ slug }: { slug: string }) {
  useEffect(() => preloadPages("compare", "run"), []);
  const [params, setParams] = useSearchParams();
  const fetchBranches = useCallback(() => api.results.branches(slug), [slug]);
  const branches = useLoad(fetchBranches);

  const heading = (
    <h1 id="versions-title" className="text-2xl font-semibold tracking-tight">
      Versi
    </h1>
  );

  if (branches.state === "loading") {
    return (
      <section aria-labelledby="versions-title" className="grid min-w-0 grid-cols-1 gap-6">
        {heading}
        <Loading label="Memuat versi…" />
      </section>
    );
  }
  if (branches.state === "error") {
    return (
      <section aria-labelledby="versions-title" className="grid min-w-0 grid-cols-1 gap-6">
        {heading}
        <LoadError error={branches.error} fallback="Gagal memuat versi. Coba lagi." onRetry={branches.reload} />
      </section>
    );
  }
  if (branches.data.length === 0) {
    return (
      <section aria-labelledby="versions-title" className="grid min-w-0 grid-cols-1 gap-6">
        {heading}
        <EmptyState icon={Tag} title="Belum ada run" data-testid="versions-empty">
          <p>Versi muncul di sini setelah pipeline CI project ini mengunggah laporan dengan parameter versi.</p>
        </EmptyState>
      </section>
    );
  }

  const branch = params.get("branch") ?? defaultBranch(branches.data);
  return (
    <section aria-labelledby="versions-title" className="grid min-w-0 grid-cols-1 gap-6">
      {heading}
      <BranchFilter
        id="versions-branch"
        testId="versions-branch"
        branches={branches.data}
        value={branch}
        onChange={(next) => setParams({ branch: next }, { replace: true })}
      />
      <VersionsList key={branch} slug={slug} branch={branch} />
    </section>
  );
}

function VersionsList({ slug, branch }: { slug: string; branch: string }) {
  const fetchVersions = useCallback(() => api.results.versions(slug, branch), [slug, branch]);
  const versions = useLoad(fetchVersions);

  if (versions.state === "loading") return <Loading label="Memuat versi…" />;
  if (versions.state === "error") {
    return <LoadError error={versions.error} fallback="Gagal memuat versi. Coba lagi." onRetry={versions.reload} />;
  }
  if (versions.data.length === 0) {
    return (
      <EmptyState icon={Tag} title="Belum ada run dengan versi" data-testid="versions-empty">
        <p>
          Sertakan versi aplikasi saat mengunggah laporan (parameter <code className="font-mono">version</code>, atau{" "}
          <code className="font-mono">--app-version</code> pada reporter) agar run branch ini muncul di sini.
        </p>
      </EmptyState>
    );
  }
  return <VersionsTable slug={slug} branch={branch} versions={versions.data} />;
}

const TH_CLASS = "px-4 py-2.5 text-left text-sm font-semibold text-muted-foreground";
const TD_CLASS = "px-4 py-3 align-top text-sm";

function VersionsTable({ slug, branch, versions }: { slug: string; branch: string; versions: VersionDto[] }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
      <table className="w-full border-collapse text-left" data-testid="versions-table">
        <caption className="sr-only">Versi di branch {branch}, dari yang terbaru</caption>
        <thead className="border-b bg-muted/50">
          <tr>
            <th scope="col" className={TH_CLASS}>
              Versi
            </th>
            <th scope="col" className={cn(TH_CLASS, "hidden md:table-cell")}>
              Run terakhir
            </th>
            <th scope="col" className={cn(TH_CLASS, "hidden md:table-cell")}>
              Jumlah run
            </th>
            <th scope="col" className={TH_CLASS}>
              Pass rate
            </th>
            <th scope="col" className={cn(TH_CLASS, "hidden md:table-cell")}>
              Perubahan
            </th>
            <th scope="col" className={TH_CLASS}>
              Perbandingan
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {versions.map((entry, index) => (
            // Daftar terbaru dulu: pembanding = versi automated berikutnya (baris manual-saja tidak punya run CI).
            <VersionRow
              key={entry.version}
              slug={slug}
              branch={branch}
              entry={entry}
              previousRun={versions.slice(index + 1).find((below) => below.run !== null)?.run ?? null}
              capped={versions.length >= MAX_VERSIONS}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeltaText({ delta }: { delta: number | null }) {
  const change = formatPassRateDelta(delta);
  return (
    <span
      className={cn(
        change.direction === "up" && "text-success",
        change.direction === "down" && "text-destructive",
        change.direction === "none" && "text-muted-foreground",
      )}
    >
      {change.text}
    </span>
  );
}

function VersionRow({
  slug,
  branch,
  entry,
  previousRun,
  capped,
}: {
  slug: string;
  branch: string;
  entry: VersionDto;
  previousRun: RunSummaryDto | null;
  /** Daftar terpotong di batas API (`MAX_VERSIONS`): baris terakhir mungkin masih punya versi sebelumnya yang tidak terlihat. */
  capped: boolean;
}) {
  const { run } = entry;
  // Versi yang hanya punya run manual (Tahap 4 §5.1): kolom automated berisi "–".
  const date = run === null ? "–" : formatDateTime(run.createdAt);
  return (
    <tr data-testid={`version-row-${entry.version}`}>
      <th scope="row" className={cn(TD_CLASS, "font-semibold [overflow-wrap:anywhere]")}>
        <span className="font-mono">{versionLabel(entry.version)}</span>
        {/* Di layar sempit tanggal dan jumlah run pindah ke bawah versi agar tabel muat tanpa scroll mendatar. */}
        <span className="mt-1 grid gap-0.5 text-xs font-normal text-muted-foreground md:hidden">
          <span>{date}</span>
          <span>{entry.runCount} run</span>
        </span>
      </th>
      <td className={cn(TD_CLASS, "hidden md:table-cell")}>
        {run === null ? (
          date
        ) : (
          <Link to={`/p/${encodeURIComponent(slug)}/runs/${run.id}`} className={INLINE_LINK_CLASS}>
            {date}
          </Link>
        )}
      </td>
      <td className={cn(TD_CLASS, "hidden font-mono tabular-nums md:table-cell")}>{entry.runCount}</td>
      <td className={TD_CLASS}>
        <span className="font-mono tabular-nums">{formatPassRate(entry.passRate)}</span>
        <span className="mt-1 block text-xs md:hidden">
          <DeltaText delta={entry.passRateDelta} />
        </span>
      </td>
      <td className={cn(TD_CLASS, "hidden md:table-cell")}>
        <DeltaText delta={entry.passRateDelta} />
      </td>
      <td className={TD_CLASS}>
        {run === null ? (
          <span className="text-muted-foreground">–</span>
        ) : previousRun || capped ? (
          <Link
            // Tanpa baris sebelumnya di daftar terpotong, pembanding default (versi di bawahnya) dipilih server.
            to={compareHref(slug, previousRun ? { base: previousRun.id, target: run.id, branch } : { target: run.id, branch })}
            className={INLINE_LINK_CLASS}
            data-testid={`version-compare-${entry.version}`}
          >
            Bandingkan dengan versi sebelumnya
            <span className="sr-only"> untuk {runLabel(run)}</span>
          </Link>
        ) : (
          <span className="text-muted-foreground">Versi pertama</span>
        )}
      </td>
    </tr>
  );
}
