import type { RunSummaryDto } from "@testpulse/shared";
import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type RunOutcome = "passed" | "failed" | "skipped";

/** Status ringkas satu run: ada yang gagal → gagal; selain itu ada yang lulus → lulus; selebihnya dilewati. */
export function runOutcome(run: Pick<RunSummaryDto, "passed" | "failed">): RunOutcome {
  if (run.failed > 0) return "failed";
  return run.passed > 0 ? "passed" : "skipped";
}

const OUTCOME = {
  passed: { label: "Lulus", Icon: CheckCircle2, tone: "text-foreground" },
  failed: { label: "Gagal", Icon: XCircle, tone: "text-destructive" },
  skipped: { label: "Dilewati", Icon: MinusCircle, tone: "text-muted-foreground" },
} as const;

/** Status dengan ikon dan teks (tidak hanya warna). */
export function RunStatus({ outcome, className }: { outcome: RunOutcome; className?: string }) {
  const { label, Icon, tone } = OUTCOME[outcome];
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", tone, className)}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
