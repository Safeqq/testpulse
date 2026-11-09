import type { ManualSummaryDto } from "@testpulse/shared";
import { useCallback } from "react";
import { Link } from "react-router-dom";
import { CoverageMeter } from "@/components/CoverageMeter";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { ManualRunStatus } from "@/components/ManualStatus";
import { RunProgress } from "@/components/RunProgress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { runCode } from "@/lib/manual";
import { useLoad } from "@/lib/useLoad";

/**
 * Kartu "Test manual" di dashboard (spec Tahap 4 §5.2): run manual terbaru dengan progres dan cakupan otomasi. Tidak
 * terikat branch. Tidak tampil selama dimuat, bila gagal dimuat (kartu pelengkap; dashboard hasil CI tetap utuh), dan
 * bila project belum punya case maupun run manual.
 */
export function ManualCard({ slug }: { slug: string }) {
  const fetchSummary = useCallback(() => api.manual.summary(slug), [slug]);
  const load = useLoad(fetchSummary);
  if (load.state !== "ready") return null;
  const { latestRun, coverage } = load.data;
  if (coverage.active === 0 && latestRun === null) return null;
  return <ManualCardBody slug={slug} summary={load.data} />;
}

function ManualCardBody({ slug, summary }: { slug: string; summary: ManualSummaryDto }) {
  const { latestRun, coverage } = summary;
  const base = `/p/${encodeURIComponent(slug)}`;
  return (
    <Card className="min-w-0" data-testid="manual-card">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>
          <h2 className="text-lg font-semibold tracking-tight">Test manual</h2>
        </CardTitle>
        <Link to={`${base}/manual-runs`} className={INLINE_LINK_CLASS}>
          Lihat semua<span className="sr-only"> run manual</span>
        </Link>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        {latestRun === null ? (
          <p className="m-0 text-sm text-muted-foreground">Belum ada run manual.</p>
        ) : (
          <div className="grid min-w-0 gap-2" data-testid="manual-card-run">
            <p className="m-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
              <Link to={`${base}/manual-runs/${latestRun.number}`} className={INLINE_LINK_CLASS}>
                {runCode(latestRun.number)}
              </Link>
              <ManualRunStatus status={latestRun.status} />
            </p>
            <p className="m-0 text-sm [overflow-wrap:anywhere]">{latestRun.name}</p>
            <p className="m-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {latestRun.appVersion ? `${latestRun.appVersion} · ` : ""}
              {formatDateTime(latestRun.createdAt)}
            </p>
            <RunProgress counts={latestRun.counts} total={latestRun.total} />
          </div>
        )}
        <CoverageMeter active={coverage.active} automated={coverage.automated} />
      </CardContent>
    </Card>
  );
}
