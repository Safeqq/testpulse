import type { BugDto } from "@testpulse/shared";
import { FlaskConical } from "lucide-react";
import { Link } from "react-router-dom";
import { INLINE_LINK_CLASS as LINK_CLASS } from "@/components/inlineLink";
import { describeTestHint } from "@/lib/bugTransitions";
import { withBranch } from "@/lib/navigation";


/**
 * Kartu "Test asal" untuk bug yang tertaut ke test: nama dan suite test, petunjuk status terbarunya (hanya informasi,
 * status bug tidak pernah berubah otomatis), tautan ke riwayat test dan ke run asal (atau keterangan bila run itu sudah dihapus).
 */
export function BugTestOrigin({ slug, bug }: { slug: string; bug: Pick<BugDto, "testCase" | "runId" | "testHint"> }) {
  const { testCase, runId, testHint } = bug;
  if (!testCase) return null;
  const base = `/p/${encodeURIComponent(slug)}`;
  return (
    <section aria-labelledby="bug-test-origin-title" className="grid min-w-0 gap-2" data-testid="bug-test-hint">
      <h2 id="bug-test-origin-title" className="flex items-center gap-1.5 text-sm font-semibold">
        <FlaskConical className="size-4 shrink-0" aria-hidden="true" />
        Test asal
      </h2>
      <p className="m-0 min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{testCase.name}</p>
      <p className="m-0 min-w-0 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{testCase.suite}</p>
      {testHint ? <p className="m-0 text-sm">{describeTestHint(testHint)}</p> : null}
      <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link
          to={withBranch(`${base}/tests/${encodeURIComponent(testCase.id)}`, testHint?.branch)}
          className={LINK_CLASS}
          data-testid="bug-test-history-link"
        >
          Riwayat test
        </Link>
        {runId ? (
          <Link to={`${base}/runs/${encodeURIComponent(runId)}`} className={LINK_CLASS} data-testid="bug-test-run-link">
            Run asal
          </Link>
        ) : null}
      </p>
      {runId ? null : <p className="m-0 text-sm text-muted-foreground">Run asal sudah dihapus</p>}
    </section>
  );
}
