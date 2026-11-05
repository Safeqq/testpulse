import type { CompareItemDto, RunSummaryDto } from "@testpulse/shared";
import { ArrowDown, ArrowRight, Bug } from "lucide-react";
import { Link } from "react-router-dom";
import { BugBadge } from "@/components/BugBadge";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { RunStatus } from "@/components/RunStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { formatDurationChange, runLabel } from "@/lib/compareSummary";
import { withBranch } from "@/lib/navigation";

type Side = CompareItemDto["base"];

interface CompareRowProps {
  item: CompareItemDto;
  slug: string;
  base: RunSummaryDto;
  target: RunSummaryDto;
  /** Tester/admin: boleh melaporkan bug dari test yang gagal di target. */
  canWriteBugs: boolean;
}

/** Satu sisi perbandingan: label run (tebal) lalu status dengan ikon dan teks; "Tidak ada" bila test tidak ada di sisi itu. */
function SideStatus({ label, side }: { label: string; side: Side }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <strong className="text-sm [overflow-wrap:anywhere]">{label}</strong>
      {side ? (
        <>
          <RunStatus outcome={side.status} className="text-sm" />
          {side.flakyInRun ? <Badge variant="outline">Flaky</Badge> : null}
        </>
      ) : (
        <span className="text-sm text-muted-foreground">Tidak ada</span>
      )}
    </div>
  );
}

function durationText(base: Side, target: Side): string | null {
  if (base && target) return formatDurationChange(base.durationMs, target.durationMs);
  const only = target ?? base;
  return only ? formatDuration(only.durationMs) : null;
}

/**
 * Baris satu test dalam kelompok perbandingan (spec Tahap 3 §7.2 butir 5): nama (besar) dan suite (kecil), status
 * sebelum → sesudah, perubahan durasi, pesan error dalam <details>, dan di kanan badge bug atau tombol "Laporkan bug".
 * Di layar sempit sisi sebelum dan sesudah bertumpuk.
 */
export function CompareRow({ item, slug, base, target, canWriteBugs }: CompareRowProps) {
  const nameId = `compare-name-${item.testCaseId}`;
  const baseLabel = runLabel(base);
  const targetLabel = runLabel(target);
  const duration = durationText(item.base, item.target);
  const messages = [
    { label: baseLabel, message: item.base?.status === "failed" ? item.base.message : null },
    { label: targetLabel, message: item.target?.status === "failed" ? item.target.message : null },
  ].filter((entry): entry is { label: string; message: string } => entry.message !== null && entry.message !== "");

  return (
    <li
      className="grid min-w-0 gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
      data-testid={`compare-row-${item.testCaseId}`}
    >
      <div className="grid min-w-0 gap-2">
        <div className="grid min-w-0 gap-0.5">
          <Link
            id={nameId}
            to={withBranch(`/p/${encodeURIComponent(slug)}/tests/${item.testCaseId}`, target.branch)}
            className={`${INLINE_LINK_CLASS} w-fit max-w-full text-base [overflow-wrap:anywhere]`}
          >
            {item.name}
          </Link>
          <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.suite}</span>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1.5">
          <SideStatus label={baseLabel} side={item.base} />
          <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-label="menjadi" role="img" />
          <ArrowDown className="size-4 shrink-0 text-muted-foreground sm:hidden" aria-label="menjadi" role="img" />
          <SideStatus label={targetLabel} side={item.target} />
        </div>
        {duration ? (
          <p className="m-0 text-xs text-muted-foreground">
            Durasi: <span className="font-mono tabular-nums">{duration}</span>
          </p>
        ) : null}
        {messages.map(({ label, message }) => (
          <details key={label} className="min-w-0">
            <summary className="w-fit max-w-full cursor-pointer rounded-sm text-sm font-medium text-link outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring">
              Lihat pesan error {label}
            </summary>
            <pre className="m-0 mt-2 rounded-md border bg-background p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
              {message}
            </pre>
          </details>
        ))}
      </div>
      <RowBugs item={item} slug={slug} targetRunId={target.id} nameId={nameId} canWriteBugs={canWriteBugs} />
    </li>
  );
}

/**
 * Bug aktif yang tertaut ke test ini (badge, maks 5) menggantikan tombol "Laporkan bug"; tombol hanya untuk
 * tester/admin pada test yang gagal di target, dan membawa run target sebagai run asal bug.
 */
function RowBugs({
  item,
  slug,
  targetRunId,
  nameId,
  canWriteBugs,
}: {
  item: CompareItemDto;
  slug: string;
  targetRunId: string;
  nameId: string;
  canWriteBugs: boolean;
}) {
  if (item.bugs.length > 0) {
    return (
      <p className="m-0 flex flex-wrap items-center gap-2 md:justify-end">
        {item.bugs.map((bug) => (
          <BugBadge key={bug.number} bug={bug} slug={slug} />
        ))}
      </p>
    );
  }
  if (!canWriteBugs || item.target?.status !== "failed") return null;
  const query = new URLSearchParams({ testCaseId: item.testCaseId, runId: targetRunId });
  return (
    <p className="m-0">
      <Button asChild variant="outline" size="sm">
        <Link
          to={`/p/${encodeURIComponent(slug)}/bugs/new?${query.toString()}`}
          data-testid={`report-bug-${item.testCaseId}`}
          aria-describedby={nameId}
        >
          <Bug aria-hidden="true" />
          Laporkan bug
        </Link>
      </Button>
    </p>
  );
}
