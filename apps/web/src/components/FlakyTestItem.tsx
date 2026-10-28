import type { FlakyTestDto } from "@testpulse/shared";
import { Link } from "react-router-dom";
import { ScoreBar } from "@/components/charts/ScoreBar";
import { Badge } from "@/components/ui/badge";
import { LAST_STATUS_LABEL } from "@/lib/flaky";
import { withBranch } from "@/lib/navigation";

const ITEM_LINK_CLASS =
  "grid min-w-0 gap-1 px-4 py-3 text-foreground no-underline outline-hidden hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring";

/** Satu baris test flaky (dashboard dan halaman flaky): nama, skor, suite, hasil terakhir; `showBar` menambah bar skor. */
export function FlakyTestItem({
  slug,
  branch,
  test,
  showBar = false,
}: {
  slug: string;
  branch: string;
  test: FlakyTestDto;
  showBar?: boolean;
}) {
  return (
    <li data-testid={`flaky-item-${test.testCaseId}`}>
      <Link to={withBranch(`/p/${slug}/tests/${test.testCaseId}`, branch)} className={ITEM_LINK_CLASS}>
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{test.name}</span>
          <Badge variant="secondary" className="font-mono tabular-nums">
            Skor {test.score}
          </Badge>
        </span>
        <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{test.suite}</span>
        {showBar ? <ScoreBar score={test.score} /> : null}
        <span className="text-xs text-muted-foreground">Hasil terakhir: {LAST_STATUS_LABEL[test.lastStatus]}</span>
      </Link>
    </li>
  );
}
