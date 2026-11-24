import type { CycleDirectoryItemDto } from "@testpulse/shared";
import { Loader2, Search, Trophy, Users } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CycleStatus } from "@/components/CycleStatus";
import { EmptyState } from "@/components/EmptyState";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { LIST_ITEM_LINK_CLASS } from "@/components/listItemLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { cyclePublicPath } from "@/lib/crowd";
import { useDocumentTitle } from "@/lib/forms";
import { useCursorList } from "@/lib/useCursorList";
import { useLoad } from "@/lib/useLoad";
import { cn } from "@/lib/utils";

type Tab = "open" | "closed";

const TABS: { id: Tab; label: string }[] = [
  { id: "open", label: "Berlangsung" },
  { id: "closed", label: "Selesai" },
];

/** `/crowd`: direktori cycle publik (spec Tahap 5 §9.2) dengan tab dan pencarian di URL. */
export function CrowdDirectoryPage() {
  useDocumentTitle("Crowdtesting");
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("status") === "closed" ? "closed" : "open";
  const q = params.get("q") ?? "";

  function hrefFor(next: Tab): string {
    const query = new URLSearchParams();
    if (next === "closed") query.set("status", "closed");
    if (q !== "") query.set("q", q);
    const text = query.toString();
    return text === "" ? "/crowd" : `/crowd?${text}`;
  }

  function search(value: string) {
    const next = new URLSearchParams(window.location.search);
    if (value === "") next.delete("q");
    else next.set("q", value);
    setParams(next, { replace: true });
  }

  return (
    <section aria-labelledby="crowd-title" className="grid min-w-0 grid-cols-1 gap-6" data-testid="crowd-directory">
      <div className="grid min-w-0 gap-2">
        <h1 id="crowd-title" className="text-2xl font-semibold tracking-tight">
          Crowdtesting
        </h1>
        <p className="m-0 max-w-prose text-muted-foreground">
          Ikut menguji aplikasi dari tim yang membuka cycle publik, laporkan bug yang Anda temukan, dan kumpulkan poin
          reputasi dari laporan yang diterima.
        </p>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid min-w-0 content-start gap-4">
          <nav aria-label="Status cycle" className="flex min-w-0 gap-1 border-b">
            {TABS.map((t) => (
              <Link
                key={t.id}
                to={hrefFor(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                data-testid={`crowd-tab-${t.id}`}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium no-underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-hidden",
                  tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <SearchBox value={q} onSubmit={search} />
          <DirectoryList key={`${tab}|${q}`} status={tab} q={q} />
        </div>
        <GlobalTeaser />
      </div>
    </section>
  );
}

function SearchBox({ value, onSubmit }: { value: string; onSubmit: (value: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <form
      role="search"
      className="flex min-w-0 flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft.trim());
      }}
    >
      <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-sm">
        <Label htmlFor={id}>Cari cycle</Label>
        <Input
          id={id}
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={100}
          autoComplete="off"
          data-testid="crowd-search"
        />
      </div>
      <Button type="submit" variant="outline" data-testid="crowd-search-submit">
        <Search aria-hidden="true" />
        Cari
      </Button>
    </form>
  );
}

function DirectoryList({ status, q }: { status: Tab; q: string }) {
  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page = await api.crowd.directory({ status, ...(q !== "" ? { q } : {}), ...(cursor ? { cursor } : {}) });
      return { items: page.items, nextCursor: page.nextCursor };
    },
    [status, q],
  );
  const list = useCursorList(fetchPage);

  if (list.state === "loading") return <Loading label="Memuat cycle…" />;
  if (list.state === "error") {
    return <LoadError error={list.error} fallback="Gagal memuat daftar cycle. Coba lagi." onRetry={list.reload} />;
  }
  if (list.items.length === 0) {
    return (
      <EmptyState icon={Users} title={q !== "" ? "Tidak ada cycle yang cocok" : status === "open" ? "Belum ada cycle yang berlangsung" : "Belum ada cycle yang selesai"} data-testid="crowd-empty">
        <p>
          {q !== ""
            ? "Coba kata kunci lain."
            : status === "open"
              ? "Cycle yang dibuka tim akan muncul di sini."
              : "Cycle yang sudah ditutup akan muncul di sini."}
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="grid min-w-0 gap-4">
      <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0">
        {list.items.map((cycle) => (
          <li key={cycle.id} data-testid={`crowd-cycle-card-${cycle.id}`}>
            <CycleCard cycle={cycle} />
          </li>
        ))}
      </ul>
      {list.moreError ? (
        <LoadError error={list.moreError} fallback="Gagal memuat cycle berikutnya. Coba lagi." onRetry={list.loadMore} />
      ) : null}
      {list.hasMore ? (
        <div>
          <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore} data-testid="crowd-load-more">
            {list.loadingMore ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Muat lagi
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CycleCard({ cycle }: { cycle: CycleDirectoryItemDto }) {
  return (
    <Link to={cyclePublicPath(cycle.id)} className={LIST_ITEM_LINK_CLASS}>
      <span className="text-base font-semibold [overflow-wrap:anywhere]">{cycle.title}</span>
      <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{cycle.project.name}</span>
      {cycle.summary !== "" ? <span className="text-sm [overflow-wrap:anywhere]">{cycle.summary}</span> : null}
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <CycleStatus status={cycle.status} endsAt={cycle.endsAt} />
        <span className="text-muted-foreground">{cycle.participants} peserta</span>
        <span className="text-muted-foreground">{cycle.accepted} laporan diterima</span>
      </span>
    </Link>
  );
}

function GlobalTeaser() {
  const board = useLoad(useCallback(() => api.crowd.globalLeaderboard(), []));
  return (
    <aside aria-labelledby="crowd-teaser-title" className="grid min-w-0 content-start gap-3" data-testid="crowd-leaderboard-teaser">
      <h2 id="crowd-teaser-title" className="flex items-center gap-2 text-lg font-semibold">
        <Trophy className="size-5" aria-hidden="true" />
        Tester teratas
      </h2>
      {board.state === "loading" ? <Loading label="Memuat leaderboard…" /> : null}
      {board.state === "error" ? (
        <LoadError error={board.error} fallback="Gagal memuat leaderboard." onRetry={board.reload} />
      ) : null}
      {board.state === "ready" ? <LeaderboardTable data={board.data} caption="Lima tester teratas" limit={5} testId="leaderboard-teaser" /> : null}
      <Link to="/crowd/leaderboard" className="text-sm font-medium">
        Lihat semua
      </Link>
    </aside>
  );
}
