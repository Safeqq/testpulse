import type { CaseCoverageDto, ManualCaseListItemDto, SuiteDto } from "@testpulse/shared";
import { Bot, ClipboardList, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CoverageMeter } from "@/components/CoverageMeter";
import { EmptyState } from "@/components/EmptyState";
import { FilterSelect } from "@/components/FilterSelect";
import { LIST_ITEM_LINK_CLASS } from "@/components/listItemLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { ManualSubTabs } from "@/components/ManualSubTabs";
import { NativeSelect } from "@/components/NativeSelect";
import { SearchForm } from "@/components/SearchForm";
import { SuiteMobileControls, SuiteSidebar } from "@/components/SuiteSidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { AUTOMATED_LABEL, CASE_FILTER_KEYS, CASE_PRIORITY_LABEL, caseCode, parseCaseFilters, type CaseFilters } from "@/lib/manual";
import { useCursorList } from "@/lib/useCursorList";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { preloadPages } from "./lazyPages";
import { ProjectFrame } from "./ProjectFrame";

/** `/p/:slug/cases`: sidebar/pilihan suite, meter cakupan otomasi, dan daftar test case dengan filter di URL (50 per halaman). */
export function CasesPage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Test manual" tab="manual">
      {(project) => (
        <CasesView
          slug={project.slug}
          canWrite={project.myRole === "tester" || project.myRole === "admin"}
          canDelete={project.myRole === "admin"}
        />
      )}
    </ProjectFrame>
  );
}

type SuitesState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; suites: SuiteDto[] };

/**
 * Daftar suite untuk sidebar dan pilihan suite. `refresh()` memuat ulang tanpa kembali ke "loading", agar sidebar tidak
 * berkedip (dan fokus tombol tidak hilang) setiap kali suite ditambah, diganti nama, atau dipindah.
 */
function useSuites(slug: string): { state: SuitesState; refresh: () => Promise<void> } {
  const [state, setState] = useState<SuitesState>({ status: "loading" });
  // Hanya respons permintaan terbaru yang dipakai (dua refresh beruntun bisa selesai tidak berurutan).
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const suites = await api.manual.suites.list(slug);
      if (request === latest.current) setState({ status: "ready", suites });
    } catch (error) {
      // Kegagalan memuat ulang tidak membuang daftar yang sudah tampil.
      if (request === latest.current) setState((prev) => (prev.status === "ready" ? prev : { status: "error", error }));
    }
  }, [slug]);
  useEffect(() => {
    void refresh();
    return () => {
      latest.current += 1;
    };
  }, [refresh]);
  return { state, refresh };
}

function CasesView({ slug, canWrite, canDelete }: { slug: string; canWrite: boolean; canDelete: boolean }) {
  useEffect(() => preloadPages("case", "caseForm", "manualRuns"), []);
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseCaseFilters(params), [params]);
  // Berdasarkan URL (bukan filter yang lolos validasi) agar "Atur ulang filter" juga membersihkan parameter yang tidak valid.
  const hasFilters = CASE_FILTER_KEYS.some((key) => params.has(key));
  const suites = useSuites(slug);
  // Cakupan seluruh project dari halaman pertama daftar; bertahan selagi daftar dimuat ulang oleh filter.
  const [coverage, setCoverage] = useState<CaseCoverageDto | null>(null);

  /**
   * Menulis satu filter ke URL (kosong menghapusnya); filter lain tetap. Dasarnya adalah URL saat ini, bukan `params`
   * dari render terakhir: pembaruan navigasi React Router bisa tertunda (transition), sehingga dua perubahan beruntun
   * yang bertumpu pada `params` lama akan mengembalikan filter yang baru saja dihapus.
   */
  function setFilter(key: (typeof CASE_FILTER_KEYS)[number], value: string) {
    const next = new URLSearchParams(window.location.search);
    if (value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  // Sidebar di layar lebar (Tailwind `md`), `suite-select` + kelola suite di HP; hanya satu yang dirender.
  const wide = useMediaQuery("(min-width: 768px)");
  const clearRemovedSuite = (id: string) => {
    if (parseCaseFilters(new URLSearchParams(window.location.search)).suite === id) setFilter("suite", "");
  };

  const createHref = `/p/${encodeURIComponent(slug)}/cases/new${filters.suite ? `?suite=${filters.suite}` : ""}`;

  return (
    <section aria-labelledby="cases-title" className="grid min-w-0 grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 id="cases-title" className="text-2xl font-semibold tracking-tight">
          Test manual
        </h1>
        {canWrite ? (
          <Button asChild>
            <Link to={createHref} data-testid="case-create">
              <Plus aria-hidden="true" />
              Buat case
            </Link>
          </Button>
        ) : null}
      </div>

      <ManualSubTabs slug={slug} active="cases" />

      {coverage ? <CoverageMeter active={coverage.active} automated={coverage.automated} /> : null}

      <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-[16rem_minmax(0,1fr)] md:items-start">
        <div className="min-w-0">
          {suites.state.status === "ready" ? (
            wide ? (
              <SuiteSidebar
                slug={slug}
                suites={suites.state.suites}
                selected={filters.suite ?? ""}
                onSelect={(id) => setFilter("suite", id)}
                canWrite={canWrite}
                canDelete={canDelete}
                onChanged={suites.refresh}
                onRemoved={clearRemovedSuite}
              />
            ) : (
              <div className="grid min-w-0 gap-4">
                <SuiteSelect
                  suites={suites.state.suites}
                  value={filters.suite ?? ""}
                  onChange={(id) => setFilter("suite", id)}
                />
                <SuiteMobileControls
                  slug={slug}
                  suites={suites.state.suites}
                  selected={filters.suite ?? ""}
                  canWrite={canWrite}
                  canDelete={canDelete}
                  onChanged={suites.refresh}
                  onRemoved={clearRemovedSuite}
                />
              </div>
            )
          ) : suites.state.status === "error" ? (
            <LoadError error={suites.state.error} fallback="Gagal memuat daftar suite. Coba lagi." onRetry={() => void suites.refresh()} />
          ) : (
            <Loading label="Memuat suite…" />
          )}
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-6">
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
            <FilterSelect
              label="Prioritas"
              testId="cases-filter-priority"
              allLabel="Semua prioritas"
              value={filters.priority ?? ""}
              options={Object.entries(CASE_PRIORITY_LABEL)}
              onChange={(value) => setFilter("priority", value)}
            />
            <LabelFilter slug={slug} value={filters.label ?? ""} onChange={(value) => setFilter("label", value)} />
            <FilterSelect
              label="Otomasi"
              testId="cases-filter-automated"
              allLabel="Semua"
              value={filters.automated ?? ""}
              options={Object.entries(AUTOMATED_LABEL)}
              onChange={(value) => setFilter("automated", value)}
            />
          </div>

          <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <SearchForm value={filters.q ?? ""} onSubmit={(value) => setFilter("q", value.trim())} testId="cases-search" />
            <ArchivedToggle checked={filters.archived === "true"} onChange={(on) => setFilter("archived", on ? "true" : "")} />
          </div>

          <CasesList
            key={params.toString()}
            slug={slug}
            filters={filters}
            onCoverage={setCoverage}
            resetFilters={hasFilters ? () => setParams({}, { replace: true }) : undefined}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Pilihan suite untuk HP (< md), pengganti sidebar. Dirender oleh komponen halaman yang sama dengan sidebar, setelah
 * daftar suite dimuat: `<select>` baru dibuat saat halaman lazy sudah terpasang, bukan di dalam Suspense yang menunggu
 * (artefak guard CSP WebKit; lihat `BranchFilter`).
 */
function SuiteSelect({ suites, value, onChange }: { suites: SuiteDto[]; value: string; onChange: (id: string) => void }) {
  const id = useId();
  const known = value === "" || suites.some((suite) => suite.id === value);
  return (
    <div className="grid min-w-0 gap-1.5 [&>span]:w-full">
      <Label htmlFor={id}>Suite</Label>
      <NativeSelect id={id} data-testid="suite-select" value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
        <option value="">Semua suite</option>
        {known ? null : <option value={value}>Suite tidak dikenal</option>}
        {suites.map((suite) => (
          <option key={suite.id} value={suite.id}>
            {suite.name} ({suite.activeCount})
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function LabelFilter({ slug, value, onChange }: { slug: string; value: string; onChange: (value: string) => void }) {
  const [labels, setLabels] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    // Pemuatan label bersifat tambahan: bila gagal, filter lain tetap bisa dipakai.
    api.manual.cases.labels(slug).then(
      (list) => {
        if (active) setLabels(list);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [slug]);
  const options = value !== "" && !labels.includes(value) ? [...labels, value] : labels;
  // Tanpa label di project ini (atau gagal dimuat) pilihan ini tidak berguna, kecuali filter sudah ada di URL.
  if (options.length === 0) return null;
  return (
    <FilterSelect
      label="Label"
      testId="cases-filter-label"
      allLabel="Semua label"
      value={value}
      options={options.map((label): [string, string] => [label, label])}
      onChange={onChange}
    />
  );
}

/**
 * Saring ke case terarsip saja (server: `archived=true` hanya mengembalikan yang terarsip). Tanda centang dipegang lokal
 * dan mengikuti URL bila berubah dari luar: perubahan URL diterapkan React Router lewat transisi, jadi checkbox yang
 * sepenuhnya dikendalikan URL sempat kembali ke nilai lama sesaat setelah diklik.
 */
function ArchivedToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const [on, setOn] = useState(checked);
  const [seen, setSeen] = useState(checked);
  if (checked !== seen) {
    setSeen(checked);
    setOn(checked);
  }
  return (
    <label className="inline-flex h-9 items-center gap-2 text-sm font-medium">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          onChange(e.target.checked);
        }}
        data-testid="cases-filter-archived"
        className="size-4 accent-primary"
      />
      Hanya yang diarsipkan
    </label>
  );
}

function CasesList({
  slug,
  filters,
  onCoverage,
  resetFilters,
}: {
  slug: string;
  filters: CaseFilters;
  onCoverage: (coverage: CaseCoverageDto) => void;
  resetFilters: (() => void) | undefined;
}) {
  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page = await api.manual.cases.list(slug, { ...filters, cursor });
      // Cakupan dibaca dari halaman pertama saja; halaman berikutnya membawa angka yang sama.
      if (cursor === undefined) onCoverage(page.coverage);
      return { items: page.items, nextCursor: page.nextCursor };
    },
    [slug, filters, onCoverage],
  );
  const list = useCursorList(fetchPage);

  if (list.state === "loading") return <Loading label="Memuat daftar case…" />;
  if (list.state === "error") {
    return <LoadError error={list.error} fallback="Gagal memuat daftar case. Coba lagi." onRetry={list.reload} />;
  }
  if (list.items.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title={resetFilters ? "Tidak ada case yang cocok" : "Belum ada test case"}
        data-testid="cases-empty"
        action={
          resetFilters ? (
            <Button type="button" variant="outline" size="sm" onClick={resetFilters} data-testid="cases-filter-reset">
              Atur ulang filter
            </Button>
          ) : null
        }
      >
        <p>
          {resetFilters
            ? "Tidak ada case yang cocok dengan filter ini. Ubah atau atur ulang filter."
            : "Test case yang ditulis tim akan muncul di sini."}
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0" data-testid="cases-list">
        {list.items.map((item) => (
          <li key={item.number} data-testid={`case-row-${item.number}`}>
            <CaseRow slug={slug} item={item} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="m-0 text-sm text-muted-foreground">
          Menampilkan {list.items.length} case{list.hasMore ? "" : " (semua)"}
        </p>
        {resetFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={resetFilters} data-testid="cases-filter-reset">
            Atur ulang filter
          </Button>
        ) : null}
      </div>
      {list.moreError ? (
        <LoadError error={list.moreError} fallback="Gagal memuat case berikutnya. Coba lagi." onRetry={list.loadMore} />
      ) : null}
      {list.hasMore ? (
        <div>
          <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore} data-testid="cases-load-more">
            {list.loadingMore ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Muat lagi
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CaseRow({ slug, item }: { slug: string; item: ManualCaseListItemDto }) {
  return (
    <Link to={`/p/${encodeURIComponent(slug)}/cases/${item.number}`} className={LIST_ITEM_LINK_CLASS}>
      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-sm text-muted-foreground">{caseCode(item.number)}</span>
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{item.title}</span>
        </span>
        {item.automated || item.archived ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {item.automated ? (
              <Badge variant="secondary">
                <Bot aria-hidden="true" />
                Otomatis
              </Badge>
            ) : null}
            {item.archived ? <Badge variant="outline">Diarsipkan</Badge> : null}
          </span>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="min-w-0 [overflow-wrap:anywhere]">Suite {item.suite.name}</span>
        <span>Prioritas {CASE_PRIORITY_LABEL[item.priority]}</span>
        <span>{item.stepCount} langkah</span>
        <time dateTime={item.updatedAt}>diubah {formatRelativeTime(item.updatedAt)}</time>
      </span>
      {item.labels.length > 0 ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="sr-only">Label:</span>
          {item.labels.map((label) => (
            <Badge key={label} variant="secondary" className="max-w-full">
              <span className="min-w-0 truncate">{label}</span>
            </Badge>
          ))}
        </span>
      ) : null}
    </Link>
  );
}
