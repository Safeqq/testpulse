import { COMPARE_GROUPS, type CompareDto, type CompareGroup as CompareGroupName, type ProjectDto, type RunSummaryDto } from "@testpulse/shared";
import { ExternalLink, GitCompare } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CompareGroup } from "@/components/CompareGroup";
import { EmptyState } from "@/components/EmptyState";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { NativeSelect } from "@/components/NativeSelect";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { api, ApiError, type CompareParams } from "@/lib/api";
import { pairLabels, runLabel } from "@/lib/compareSummary";
import { formatDateTime } from "@/lib/format";
import { safeExternalUrl } from "@/lib/navigation";
import { useLoad } from "@/lib/useLoad";
import { CompareSummary } from "./CompareSummary";
import { ProjectFrame } from "./ProjectFrame";

/** Jumlah run terakhir di branch yang ditawarkan di pemilih (selain run tiap versi). */
const RECENT_RUN_OPTIONS = 50;

interface RunOptions {
  /** Run terakhir tiap versi di branch (terbaru dulu). */
  versionRuns: RunSummaryDto[];
  /** Run terakhir branch, sampai `RECENT_RUN_OPTIONS`. */
  recentRuns: RunSummaryDto[];
}

async function loadRunOptions(slug: string, branch: string): Promise<RunOptions> {
  const [versions, first] = await Promise.all([api.results.versions(slug, branch), api.results.runs(slug, { branch })]);
  let recentRuns = first.runs;
  let cursor = first.nextCursor;
  while (cursor !== null && recentRuns.length < RECENT_RUN_OPTIONS) {
    const page = await api.results.runs(slug, { branch, cursor });
    recentRuns = [...recentRuns, ...page.runs];
    cursor = page.nextCursor;
  }
  return { versionRuns: versions.map((v) => v.run), recentRuns: recentRuns.slice(0, RECENT_RUN_OPTIONS) };
}

/** `/p/:slug/compare?base=&target=&branch=`: perbandingan dua run, dapat dibagikan lewat URL. */
export function ComparePage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Perbandingan versi" tab="versi">
      {(project) => <CompareView project={project} />}
    </ProjectFrame>
  );
}

function CompareView({ project }: { project: ProjectDto }) {
  const { slug } = project;
  const canWriteBugs = project.myRole === "tester" || project.myRole === "admin";
  const [params, setParams] = useSearchParams();
  const base = params.get("base") ?? "";
  const target = params.get("target") ?? "";
  const branch = params.get("branch") ?? "";

  const fetchCompare = useCallback(() => {
    const query: CompareParams = {};
    if (base) query.base = base;
    if (target) query.target = target;
    if (branch) query.branch = branch;
    return api.results.compare(slug, query);
  }, [slug, base, target, branch]);
  const compare = useLoad(fetchCompare);

  // Perbandingan terakhir yang berhasil dimuat: pemilih tetap terpasang (fokus tidak hilang) selagi yang baru dimuat.
  const [shown, setShown] = useState<CompareDto | null>(null);
  if (compare.state === "ready" && compare.data !== shown) setShown(compare.data);

  const optionsBranch = shown?.target?.branch ?? (branch || null);
  const fetchOptions = useCallback(
    () => (optionsBranch === null ? Promise.resolve(null) : loadRunOptions(slug, optionsBranch)),
    [slug, optionsBranch],
  );
  const options = useLoad(fetchOptions);

  function select(role: "base" | "target", runId: string) {
    // Dari URL sebenarnya, bukan `params` render terakhir: navigasi React Router bisa tertinggal dari perubahan cepat.
    const next = new URLSearchParams(window.location.search);
    next.set(role, runId);
    // Target yang masih default dipasang di URL saat base diganti, supaya perbandingan tetap untuk target yang sama.
    if (role === "base" && !next.has("target") && shown?.target) next.set("target", shown.target.id);
    setParams(next, { replace: true });
  }

  // Judul dari perbandingan yang tampil (bukan yang sedang dimuat) agar tidak berkedip saat pemilih diganti.
  const titleLabels = compare.state !== "error" && shown?.target ? pairLabels(shown.base, shown.target) : null;
  const baseValue = base || shown?.base?.id || "";
  const targetValue = target || shown?.target?.id || "";

  return (
    <section aria-labelledby="compare-title" className="grid min-w-0 grid-cols-1 gap-6">
      <h1 id="compare-title" className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
        {titleLabels ? (
          titleLabels.base ? (
            <>
              <strong>{titleLabels.target}</strong> dibanding <strong>{titleLabels.base}</strong>
            </>
          ) : (
            <>
              Perbandingan <strong>{titleLabels.target}</strong>
            </>
          )
        ) : (
          "Perbandingan versi"
        )}
      </h1>
      {shown?.target ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <RunPicker
            role="base"
            title="Pembanding (sebelum)"
            run={shown.base}
            value={baseValue}
            disabledValue={targetValue}
            options={options.state === "ready" ? options.data : null}
            current={[shown.base, shown.target]}
            onChange={(id) => select("base", id)}
          />
          <RunPicker
            role="target"
            title="Target (sesudah)"
            run={shown.target}
            value={targetValue}
            disabledValue={base}
            options={options.state === "ready" ? options.data : null}
            current={[shown.base, shown.target]}
            onChange={(id) => select("target", id)}
          />
        </div>
      ) : null}
      <CompareContent slug={slug} canWriteBugs={canWriteBugs} compare={compare} />
    </section>
  );
}

function CompareContent({
  slug,
  canWriteBugs,
  compare,
}: {
  slug: string;
  canWriteBugs: boolean;
  compare: ReturnType<typeof useLoad<CompareDto>>;
}) {
  if (compare.state === "loading") return <Loading label="Memuat perbandingan…" />;
  if (compare.state === "error") {
    const { error } = compare;
    if (error instanceof ApiError && error.code === "RUN_NOT_FOUND") {
      return (
        <EmptyState icon={GitCompare} title="Run tidak ditemukan" data-testid="compare-not-found">
          <p>Salah satu run yang dibandingkan tidak ada atau sudah dihapus.</p>
          <Link to={`/p/${encodeURIComponent(slug)}/compare`} className={INLINE_LINK_CLASS}>
            Buka perbandingan default
          </Link>
        </EmptyState>
      );
    }
    if (error instanceof ApiError && error.fields?.base !== undefined) {
      return (
        <EmptyState icon={GitCompare} title="Pilih dua run yang berbeda" data-testid="compare-same-run">
          <p>Run pembanding dan target tidak boleh sama.</p>
          <Link to={`/p/${encodeURIComponent(slug)}/compare`} className={INLINE_LINK_CLASS}>
            Buka perbandingan default
          </Link>
        </EmptyState>
      );
    }
    return <LoadError error={error} fallback="Gagal memuat perbandingan. Coba lagi." onRetry={compare.reload} />;
  }
  const { data } = compare;
  if (!data.target) {
    return (
      <EmptyState icon={GitCompare} title="Belum ada run" data-testid="compare-empty">
        <p>Perbandingan tersedia setelah pipeline CI project ini mengunggah laporan pertamanya.</p>
      </EmptyState>
    );
  }
  return (
    <CompareBody
      key={`${data.base?.id ?? ""}:${data.target.id}`}
      slug={slug}
      data={data}
      canWriteBugs={canWriteBugs}
      onReload={compare.reload}
    />
  );
}

const DEFAULT_OPEN: Record<CompareGroupName, boolean> = {
  regressions: true,
  fixed: true,
  stillFailing: false,
  slower: false,
  added: false,
  removed: false,
};

function CompareBody({
  slug,
  data,
  canWriteBugs,
  onReload,
}: {
  slug: string;
  data: CompareDto;
  canWriteBugs: boolean;
  onReload: () => void;
}) {
  const { base, target } = data;
  const [open, setOpen] = useState(DEFAULT_OPEN);
  const short = base && target ? pairLabels(base, target, "short") : null;
  const labels = short?.base ? { base: short.base, target: short.target } : null;
  const setGroupOpen = (group: CompareGroupName, value: boolean) => setOpen((prev) => ({ ...prev, [group]: value }));
  if (!target) return null;

  return (
    <>
      <CompareSummary data={data} slug={slug} onGroupLink={(group) => setGroupOpen(group, true)} />
      {base && target && labels ? (
        <div className="grid min-w-0 grid-cols-1 gap-3">
          {COMPARE_GROUPS.map((group) => (
            <CompareGroup
              key={group}
              group={group}
              count={data.summary[group]}
              page={data.groups[group]}
              slug={slug}
              base={base}
              target={target}
              labels={labels}
              canWriteBugs={canWriteBugs}
              open={open[group]}
              onOpenChange={(value) => setGroupOpen(group, value)}
              onReload={onReload}
            />
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">
          Pilih run pembanding di atas untuk melihat perbedaannya dengan {runLabel(target)}.
        </p>
      )}
    </>
  );
}

interface RunPickerProps {
  role: "base" | "target";
  title: string;
  /** Run yang sedang dipilih (untuk tanggal, commit, dan tautan CI); `null` bila belum ada pembanding. */
  run: RunSummaryDto | null;
  value: string;
  /**
   * Run yang tidak boleh dipilih di sini karena base dan target tidak boleh sama: untuk pemilih base, target yang tampil;
   * untuk pemilih target, hanya base yang disematkan di URL (base default dihitung ulang untuk target baru).
   */
  disabledValue: string;
  options: RunOptions | null;
  /** Run yang sedang dibandingkan; ditambahkan ke daftar bila tidak termasuk pilihan branch (mis. base dari branch lain). */
  current: (RunSummaryDto | null)[];
  onChange: (runId: string) => void;
}

function optionText(run: RunSummaryDto): string {
  const parts = [runLabel(run)];
  if (run.version !== null) parts.push(formatDateTime(run.createdAt));
  if (run.commitSha) parts.push(run.commitSha.slice(0, 7));
  return parts.join(" · ");
}

/**
 * Pemilih run (versi tersedia + 50 run terakhir branch) dan keterangan run terpilih. Hanya dirender setelah
 * perbandingan pertama dimuat, lewat pembaruan state biasa: <select> yang dibuat di dalam subtree Suspense/transisi
 * router memicu artefak CSP WebKit (lihat BranchFilter).
 */
function RunPicker({ role, title, run, value, disabledValue, options, current, onChange }: RunPickerProps) {
  const id = `compare-${role}`;
  const versionRuns = options?.versionRuns ?? [];
  const versionIds = new Set(versionRuns.map((r) => r.id));
  const recentRuns = (options?.recentRuns ?? []).filter((r) => !versionIds.has(r.id));
  const listed = new Set([...versionIds, ...recentRuns.map((r) => r.id)]);
  const extra = current.filter((r): r is RunSummaryDto => r !== null && !listed.has(r.id));
  const ciUrl = run ? safeExternalUrl(run.ciUrl) : null;

  function renderOptions(runs: RunSummaryDto[]) {
    return runs.map((r) => (
      <option key={r.id} value={r.id} disabled={disabledValue !== "" && r.id === disabledValue}>
        {optionText(r)}
      </option>
    ));
  }

  return (
    <Card className="min-w-0 gap-3 p-4">
      <div className="grid w-full grid-cols-1 gap-1.5 [&>span]:w-full">
        <Label htmlFor={id}>{title}</Label>
        <NativeSelect id={id} data-testid={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
          {value === "" ? <option value="">Pilih run pembanding</option> : null}
          {versionRuns.length > 0 ? <optgroup label="Versi">{renderOptions(versionRuns)}</optgroup> : null}
          {recentRuns.length > 0 || extra.length > 0 ? (
            <optgroup label="Run terbaru">{renderOptions([...recentRuns, ...extra])}</optgroup>
          ) : null}
        </NativeSelect>
      </div>
      {run ? (
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" data-testid={`${id}-info`}>
          <span>{formatDateTime(run.createdAt)}</span>
          <span className="font-mono">{run.commitSha ? run.commitSha.slice(0, 7) : "tanpa commit"}</span>
          {ciUrl ? (
            <a href={ciUrl} target="_blank" rel="noopener noreferrer" className={`${INLINE_LINK_CLASS} inline-flex items-center gap-1`}>
              Buka di CI
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">(tab baru)</span>
            </a>
          ) : null}
        </p>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">Belum ada run pembanding.</p>
      )}
    </Card>
  );
}
