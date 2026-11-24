import type { CrowdSummaryDto } from "@testpulse/shared";
import { useCallback } from "react";
import { Link } from "react-router-dom";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

/**
 * Kartu "Crowdtesting" di dashboard (spec Tahap 5 §9.4): cycle berlangsung, laporan menunggu triase, dan laporan diterima
 * 30 hari terakhir. Seperti kartu Test manual: tidak tampil selama dimuat, bila gagal dimuat, bila bukan anggota, dan
 * bila project belum punya cycle (`null`).
 */
export function CrowdCard({ slug, isMember }: { slug: string; isMember: boolean }) {
  if (!isMember) return null;
  return <CrowdCardLoader slug={slug} />;
}

function CrowdCardLoader({ slug }: { slug: string }) {
  const load = useLoad(useCallback(() => api.cycles.summary(slug), [slug]));
  if (load.state !== "ready" || load.data === null) return null;
  return <CrowdCardBody slug={slug} summary={load.data} />;
}

function CrowdCardBody({ slug, summary }: { slug: string; summary: NonNullable<CrowdSummaryDto> }) {
  const base = `/p/${encodeURIComponent(slug)}/cycles`;
  return (
    <Card className="min-w-0" data-testid="crowd-card">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>
          <h2 className="text-lg font-semibold tracking-tight">Crowdtesting</h2>
        </CardTitle>
        <Link to={base} className={INLINE_LINK_CLASS}>
          Lihat semua<span className="sr-only"> cycle crowdtesting</span>
        </Link>
      </CardHeader>
      <CardContent>
        <ul className="m-0 grid list-none gap-2 p-0 text-sm sm:grid-cols-3">
          <li data-testid="crowd-card-open">
            <span className="text-2xl font-semibold tabular-nums">{summary.openCycles}</span> cycle berlangsung
          </li>
          <li data-testid="crowd-card-awaiting">
            <span className={summary.awaitingTriage > 0 ? "text-2xl font-semibold tabular-nums text-foreground" : "text-2xl font-semibold tabular-nums"}>
              {summary.awaitingTriage}
            </span>{" "}
            menunggu triase
          </li>
          <li data-testid="crowd-card-accepted">
            <span className="text-2xl font-semibold tabular-nums">{summary.accepted30d}</span> diterima 30 hari terakhir
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
