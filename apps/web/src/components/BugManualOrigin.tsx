import type { BugDto } from "@testpulse/shared";
import { ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { INLINE_LINK_CLASS as LINK_CLASS } from "@/components/inlineLink";
import { caseCode, runCode } from "@/lib/manual";

/**
 * Kartu asal bug dari test run manual (spec Tahap 4 §5.4, §8.9): "Dari test run manual TR-3 · TC-12" dengan tautan ke
 * halaman eksekusi run case itu, serta judul case dan nama run dari snapshot. Tidak tampil bila bug tidak berasal dari
 * run case (atau run-nya sudah dihapus).
 */
export function BugManualOrigin({ slug, bug }: { slug: string; bug: Pick<BugDto, "manualOrigin"> }) {
  const origin = bug.manualOrigin;
  if (!origin) return null;
  const href = `/p/${encodeURIComponent(slug)}/manual-runs/${origin.runNumber}/cases/${encodeURIComponent(origin.runCaseId)}`;
  return (
    <section aria-labelledby="bug-manual-origin-title" className="grid min-w-0 gap-2" data-testid="bug-manual-origin">
      <h2 id="bug-manual-origin-title" className="flex items-center gap-1.5 text-sm font-semibold">
        <ClipboardCheck className="size-4 shrink-0" aria-hidden="true" />
        Test manual asal
      </h2>
      <p className="m-0 text-sm">
        Dari test run manual{" "}
        <Link to={href} className={LINK_CLASS} data-testid="bug-manual-origin-link">
          {runCode(origin.runNumber)} · {caseCode(origin.caseNumber)}
        </Link>
      </p>
      <p className="m-0 min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{origin.caseTitle}</p>
      <p className="m-0 min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">{origin.runName}</p>
    </section>
  );
}
