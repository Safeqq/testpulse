import type { BugDto } from "@testpulse/shared";
import { Megaphone } from "lucide-react";
import { Link } from "react-router-dom";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { cycleCode, reportCode } from "@/lib/crowd";

/**
 * Asal bug dari crowdtesting (spec Tahap 5 §9.4): "Dari crowdtesting CY-2 · CR-14 oleh nama". Link ke halaman triase
 * hanya untuk anggota; pengunjung project publik melihat teksnya saja (data laporan hanya untuk anggota).
 */
export function BugCrowdOrigin({ slug, origin, isMember }: { slug: string; origin: NonNullable<BugDto["crowdOrigin"]>; isMember: boolean }) {
  const codes = `${cycleCode(origin.cycleNumber)} · ${reportCode(origin.reportNumber)}`;
  return (
    <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground" data-testid="bug-crowd-origin">
      <Megaphone className="size-4 shrink-0" aria-hidden="true" />
      <span>Dari crowdtesting</span>
      {isMember ? (
        <Link to={`/p/${encodeURIComponent(slug)}/crowd-reports/${origin.reportNumber}`} className={`${INLINE_LINK_CLASS} font-medium`}>
          {codes}
        </Link>
      ) : (
        <span className="font-medium text-foreground">{codes}</span>
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        oleh <span className="font-medium text-foreground">{origin.reporterName}</span>
      </span>
    </p>
  );
}
