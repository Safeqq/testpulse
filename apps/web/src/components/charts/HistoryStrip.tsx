import type { ResultStatus, TestHistoryDto } from "@testpulse/shared";
import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDateTime, formatDuration, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type HistoryResult = TestHistoryDto["results"][number];

// Kotak berwarna sekaligus berikon dan berlabel teks, jadi status tidak bergantung pada warna saja.
const CELL = {
  passed: { label: "Lulus", Icon: CheckCircle2, tone: "border-primary bg-primary text-primary-foreground" },
  failed: { label: "Gagal", Icon: XCircle, tone: "border-destructive bg-destructive text-destructive-foreground" },
  skipped: { label: "Dilewati", Icon: MinusCircle, tone: "border-border bg-muted text-muted-foreground" },
} as const satisfies Record<ResultStatus, { label: string; Icon: typeof XCircle; tone: string }>;

interface HistoryStripProps {
  /** Hasil dari yang terlama ke terbaru (urutan API). */
  results: HistoryResult[];
  runHref: (runId: string) => string;
}

/** Riwayat hasil satu test: satu kotak per run, terlama di kiri/atas, masing-masing menaut ke detail run-nya. */
export function HistoryStrip({ results, runHref }: HistoryStripProps) {
  return (
    <ol
      aria-label={`Riwayat ${results.length} hasil terakhir, dari yang terlama ke yang terbaru`}
      className="m-0 grid list-none grid-cols-4 gap-2 p-0 sm:grid-cols-5 md:grid-cols-10"
    >
      {results.map((result) => {
        const { label, Icon, tone } = CELL[result.status];
        return (
          <li key={result.runId} data-testid={`history-cell-${result.runId}`} className="min-w-0">
            <Link
              to={runHref(result.runId)}
              title={formatDateTime(result.createdAt)}
              className={cn(
                "flex h-full min-w-0 flex-col items-center gap-0.5 rounded-md border-2 px-1 py-2 text-center text-xs no-underline outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                result.flakyInRun && "border-dashed",
                tone,
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="font-semibold">{label}</span>
              {result.flakyInRun ? <span className="font-semibold">Flaky</span> : null}
              <span aria-hidden="true">{formatShortDate(result.createdAt)}</span>
              <span className="sr-only">, {formatDateTime(result.createdAt)}, </span>
              <span className="tabular-nums">{formatDuration(result.durationMs)}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
