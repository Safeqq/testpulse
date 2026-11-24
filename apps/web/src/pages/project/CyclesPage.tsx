import type { TeamCycleDto } from "@testpulse/shared";
import { Loader2, Megaphone, Plus } from "lucide-react";
import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { CycleStatus } from "@/components/CycleStatus";
import { EmptyState } from "@/components/EmptyState";
import { LIST_ITEM_LINK_CLASS } from "@/components/listItemLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cycleCode } from "@/lib/crowd";
import { formatDateTime } from "@/lib/format";
import { useCursorList } from "@/lib/useCursorList";
import { ProjectFrame } from "./ProjectFrame";

/** `/p/:slug/cycles`: daftar cycle crowdtesting tim (spec Tahap 5 §9.3), terbaru dulu. */
export function CyclesPage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Crowdtesting" tab="crowd">
      {(project) => <CyclesView slug={project.slug} isAdmin={project.myRole === "admin"} />}
    </ProjectFrame>
  );
}

function CyclesView({ slug, isAdmin }: { slug: string; isAdmin: boolean }) {
  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page = await api.cycles.list(slug, cursor ? { cursor } : {});
      return { items: page.items, nextCursor: page.nextCursor };
    },
    [slug],
  );
  const list = useCursorList(fetchPage);

  return (
    <section aria-labelledby="cycles-title" className="grid min-w-0 grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 id="cycles-title" className="text-2xl font-semibold tracking-tight">
          Crowdtesting
        </h1>
        {isAdmin ? (
          <Button asChild>
            <Link to={`/p/${encodeURIComponent(slug)}/cycles/new`} data-testid="cycle-create">
              <Plus aria-hidden="true" />
              Buat cycle
            </Link>
          </Button>
        ) : null}
      </div>
      <p className="m-0 max-w-prose text-muted-foreground">
        Buka test cycle publik agar tester dari luar tim mencoba aplikasi Anda dan mengirim laporan bug untuk ditriase.
      </p>

      {list.state === "loading" ? <Loading label="Memuat cycle…" /> : null}
      {list.state === "error" ? <LoadError error={list.error} fallback="Gagal memuat cycle. Coba lagi." onRetry={list.reload} /> : null}
      {list.state === "ready" && list.items.length === 0 ? (
        <EmptyState icon={Megaphone} title="Belum ada cycle" data-testid="cycles-empty">
          <p>{isAdmin ? "Buat cycle pertama: tulis instruksi, tautkan aplikasi yang diuji, lalu buka untuk publik." : "Admin project bisa membuat cycle crowdtesting."}</p>
        </EmptyState>
      ) : null}
      {list.state === "ready" && list.items.length > 0 ? (
        <div className="grid min-w-0 gap-4">
          <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0" data-testid="cycles-list">
            {list.items.map((cycle) => (
              <li key={cycle.id} data-testid={`cycle-row-${cycle.number}`}>
                <CycleRow slug={slug} cycle={cycle} />
              </li>
            ))}
          </ul>
          {list.moreError ? <LoadError error={list.moreError} fallback="Gagal memuat berikutnya. Coba lagi." onRetry={list.loadMore} /> : null}
          {list.hasMore ? (
            <div>
              <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore} data-testid="cycles-load-more">
                {list.loadingMore ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
                Muat lagi
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CycleRow({ slug, cycle }: { slug: string; cycle: TeamCycleDto }) {
  const awaiting = cycle.reportCounts.submitted;
  return (
    <Link to={`/p/${encodeURIComponent(slug)}/cycles/${cycle.number}`} className={LIST_ITEM_LINK_CLASS}>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-sm text-muted-foreground">{cycleCode(cycle.number)}</span>
        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{cycle.title}</span>
        {awaiting > 0 ? (
          <Badge variant="default" data-testid={`cycle-awaiting-${cycle.number}`}>
            {awaiting} menunggu triase
          </Badge>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <CycleStatus status={cycle.effectiveStatus} endsAt={cycle.endsAt} />
        {cycle.openedAt ? <span>Dibuka {formatDateTime(cycle.openedAt)}</span> : null}
        <span>{cycle.participants} peserta</span>
        <span>{cycle.reportCounts.accepted} diterima</span>
      </span>
    </Link>
  );
}
