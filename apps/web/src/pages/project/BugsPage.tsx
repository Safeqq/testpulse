import { bugListQuery, type BugListQuery, type BugSummaryDto, type MemberDto } from "@testpulse/shared";
import { Bug, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BugStatus } from "@/components/BugStatus";
import { EmptyState } from "@/components/EmptyState";
import { FilterSelect } from "@/components/FilterSelect";
import { LIST_ITEM_LINK_CLASS } from "@/components/listItemLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { SearchForm } from "@/components/SearchForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { BUG_PRIORITY_LABEL, BUG_SEVERITY_LABEL } from "@/lib/bugs";
import { formatRelativeTime } from "@/lib/format";
import { useCursorList } from "@/lib/useCursorList";
import { useLoad } from "@/lib/useLoad";
import { preloadPages } from "./lazyPages";
import { ProjectFrame } from "./ProjectFrame";

type StatusTab = "active" | "done" | "all";

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "active", label: "Aktif" },
  { value: "done", label: "Selesai" },
  { value: "all", label: "Semua" },
];

/** Parameter filter di URL selain `status` (yang default-nya `active` dan tidak ditulis). */
const FILTER_KEYS = ["priority", "severity", "assignee", "label", "q"] as const;

/** `/p/:slug/bugs`: daftar bug project dengan tab status dan filter yang tersimpan di URL (dimuat 25 per halaman). */
export function BugsPage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Bug" tab="bug">
      {(project) => (
        <BugsView
          slug={project.slug}
          isMember={project.myRole !== null}
          canCreate={project.myRole === "tester" || project.myRole === "admin"}
        />
      )}
    </ProjectFrame>
  );
}

type BugFilters = Pick<BugListQuery, "status" | "assignee" | "priority" | "severity" | "label" | "q">;

/**
 * Filter dari URL. Tiap kunci divalidasi sendiri dengan skema bersama: nilai yang tidak valid (mis. hasil suntingan
 * manual) hanya menggugurkan kunci itu, filter lain tetap berlaku.
 */
function parseFilters(params: URLSearchParams): BugFilters {
  const { shape } = bugListQuery;
  const status = shape.status.safeParse(params.get("status") ?? undefined);
  const filters: BugFilters = { status: status.success ? status.data : "active" };
  const priority = shape.priority.safeParse(params.get("priority") ?? undefined);
  if (priority.success && priority.data !== undefined) filters.priority = priority.data;
  const severity = shape.severity.safeParse(params.get("severity") ?? undefined);
  if (severity.success && severity.data !== undefined) filters.severity = severity.data;
  const assignee = shape.assignee.safeParse(params.get("assignee") ?? undefined);
  if (assignee.success && assignee.data !== undefined) filters.assignee = assignee.data;
  const label = shape.label.safeParse(params.get("label") ?? undefined);
  if (label.success && label.data !== undefined) filters.label = label.data;
  const q = shape.q.safeParse(params.get("q") ?? undefined);
  if (q.success && q.data !== undefined) filters.q = q.data;
  return filters;
}

function BugsView({ slug, isMember, canCreate }: { slug: string; isMember: boolean; canCreate: boolean }) {
  useEffect(() => {
    preloadPages("bug", ...(canCreate ? (["bugNew"] as const) : []));
  }, [canCreate]);
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const status = filters.status;
  // Berdasarkan URL (bukan filter yang lolos validasi) agar "Atur ulang filter" juga membersihkan parameter yang tidak valid.
  const hasFilters = FILTER_KEYS.some((key) => params.has(key));

  /**
   * Menulis satu filter ke URL (kosong menghapusnya); filter lain tetap. Dasarnya adalah URL saat ini, bukan `params`
   * dari render terakhir: pembaruan navigasi React Router bisa tertunda (transition), sehingga dua perubahan beruntun
   * yang bertumpu pada `params` lama akan mengembalikan filter yang baru saja dihapus.
   */
  function setFilter(key: (typeof FILTER_KEYS)[number] | "status", value: string) {
    const next = new URLSearchParams(window.location.search);
    if (value === "" || (key === "status" && value === "active")) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  return (
    <section aria-labelledby="bugs-title" className="grid min-w-0 grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 id="bugs-title" className="text-2xl font-semibold tracking-tight">
          Bug
        </h1>
        {canCreate ? (
          <Button asChild>
            <Link to={`/p/${encodeURIComponent(slug)}/bugs/new`} data-testid="bug-create">
              <Plus aria-hidden="true" />
              Buat bug
            </Link>
          </Button>
        ) : null}
      </div>

      <div role="group" aria-label="Status bug" className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.value}
            type="button"
            variant={status === tab.value ? "default" : "outline"}
            size="sm"
            aria-pressed={status === tab.value}
            data-testid={`bugs-filter-status-${tab.value}`}
            onClick={() => setFilter("status", tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          label="Prioritas"
          testId="bugs-filter-priority"
          allLabel="Semua prioritas"
          value={filters.priority ?? ""}
          options={Object.entries(BUG_PRIORITY_LABEL)}
          onChange={(value) => setFilter("priority", value)}
        />
        <FilterSelect
          label="Severity"
          testId="bugs-filter-severity"
          allLabel="Semua severity"
          value={filters.severity ?? ""}
          options={Object.entries(BUG_SEVERITY_LABEL)}
          onChange={(value) => setFilter("severity", value)}
        />
        <AssigneeFilter
          slug={slug}
          isMember={isMember}
          value={filters.assignee ?? ""}
          onChange={(value) => setFilter("assignee", value)}
        />
        <LabelFilter slug={slug} value={filters.label ?? ""} onChange={(value) => setFilter("label", value)} />
      </div>

      <SearchForm value={filters.q ?? ""} onSubmit={(value) => setFilter("q", value.trim())} testId="bugs-search" />

      <BugsList
        key={params.toString()}
        slug={slug}
        filters={filters}
        resetFilters={
          hasFilters
            ? () => setParams(status === "active" ? {} : { status }, { replace: true })
            : undefined
        }
      />
    </section>
  );
}

/**
 * Filter assignee. Daftar anggota hanya terbuka untuk anggota project (tidak pernah publik), jadi pengunjung lain
 * hanya mendapat "Belum di-assign"; "Bug saya" juga hanya bermakna bagi anggota.
 */
function AssigneeFilter({
  slug,
  isMember,
  value,
  onChange,
}: {
  slug: string;
  isMember: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const fetchMembers = useCallback(
    (): Promise<MemberDto[]> => (isMember ? api.members.list(slug) : Promise.resolve([])),
    [slug, isMember],
  );
  const members = useLoad(fetchMembers);
  // Pemuatan anggota bersifat tambahan: bila gagal, filter "Bug saya"/"Belum di-assign" tetap bisa dipakai.
  const list = members.state === "ready" ? members.data : [];
  const options: [string, ReactNode][] = [
    ...(isMember ? ([["me", "Bug saya"]] as [string, ReactNode][]) : []),
    ["none", "Belum di-assign"],
    ...list.map((member): [string, ReactNode] => [member.userId, member.name]),
  ];
  // Assignee dari URL yang tidak (atau belum) ada di daftar tetap ditampilkan agar pilihan tidak diam-diam berubah.
  if (value !== "" && !options.some(([optionValue]) => optionValue === value)) options.push([value, "Anggota lain"]);
  return (
    <FilterSelect
      label="Assignee"
      testId="bugs-filter-assignee"
      allLabel="Semua assignee"
      value={value}
      options={options}
      onChange={onChange}
    />
  );
}

function LabelFilter({ slug, value, onChange }: { slug: string; value: string; onChange: (value: string) => void }) {
  const fetchLabels = useCallback(() => api.bugs.labels(slug), [slug]);
  const labels = useLoad(fetchLabels);
  const list = labels.state === "ready" ? labels.data : [];
  const options = value !== "" && !list.includes(value) ? [...list, value] : list;
  // Tanpa label di project ini (atau gagal dimuat) pilihan ini tidak berguna, kecuali filter sudah ada di URL.
  if (options.length === 0) return null;
  return (
    <FilterSelect
      label="Label"
      testId="bugs-filter-label"
      allLabel="Semua label"
      value={value}
      options={options.map((label): [string, ReactNode] => [label, label])}
      onChange={onChange}
    />
  );
}

function BugsList({
  slug,
  filters,
  resetFilters,
}: {
  slug: string;
  filters: BugFilters;
  resetFilters: (() => void) | undefined;
}) {
  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page = await api.bugs.list(slug, { ...filters, cursor });
      return { items: page.bugs, nextCursor: page.nextCursor };
    },
    [slug, filters],
  );
  const list = useCursorList(fetchPage);

  if (list.state === "loading") return <Loading label="Memuat daftar bug…" />;
  if (list.state === "error") {
    return <LoadError error={list.error} fallback="Gagal memuat daftar bug. Coba lagi." onRetry={list.reload} />;
  }
  if (list.items.length === 0) {
    return (
      <EmptyState
        icon={Bug}
        title={resetFilters ? "Tidak ada bug yang cocok" : "Belum ada bug"}
        data-testid="bugs-empty"
        action={
          resetFilters ? (
            <Button type="button" variant="outline" size="sm" onClick={resetFilters} data-testid="bugs-filter-reset">
              Atur ulang filter
            </Button>
          ) : null
        }
      >
        <p>
          {resetFilters
            ? "Tidak ada bug yang cocok dengan filter ini. Ubah atau atur ulang filter."
            : filters.status === "done"
              ? "Belum ada bug yang selesai."
              : "Bug yang dilaporkan tim akan muncul di sini."}
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0" data-testid="bugs-list">
        {list.items.map((bug) => (
          <li key={bug.number} data-testid={`bug-row-${bug.number}`}>
            <BugRow slug={slug} bug={bug} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="m-0 text-sm text-muted-foreground">
          Menampilkan {list.items.length} bug{list.hasMore ? "" : " (semua)"}
        </p>
        {resetFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={resetFilters} data-testid="bugs-filter-reset">
            Atur ulang filter
          </Button>
        ) : null}
      </div>
      {list.moreError ? (
        <LoadError error={list.moreError} fallback="Gagal memuat bug berikutnya. Coba lagi." onRetry={list.loadMore} />
      ) : null}
      {list.hasMore ? (
        <div>
          <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore} data-testid="bugs-load-more">
            {list.loadingMore ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Muat lagi
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function BugRow({ slug, bug }: { slug: string; bug: BugSummaryDto }) {
  return (
    <Link to={`/p/${encodeURIComponent(slug)}/bugs/${bug.number}`} className={LIST_ITEM_LINK_CLASS}>
      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-sm text-muted-foreground">#{bug.number}</span>
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{bug.title}</span>
        </span>
        <BugStatus status={bug.status} resolution={bug.resolution} className="text-sm" />
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Prioritas {BUG_PRIORITY_LABEL[bug.priority]}</span>
        <span>Severity {BUG_SEVERITY_LABEL[bug.severity]}</span>
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {bug.assignee ? `Assignee ${bug.assignee.name}` : "Belum di-assign"}
        </span>
        <time dateTime={bug.updatedAt}>diubah {formatRelativeTime(bug.updatedAt)}</time>
      </span>
      {bug.labels.length > 0 ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="sr-only">Label:</span>
          {bug.labels.map((label) => (
            <Badge key={label} variant="secondary" className="max-w-full">
              <span className="min-w-0 truncate">{label}</span>
            </Badge>
          ))}
        </span>
      ) : null}
    </Link>
  );
}
