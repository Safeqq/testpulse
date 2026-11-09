import type { ManualResultStatus, ManualRunStatus as RunStatusValue } from "@testpulse/shared";
import { Ban, CheckCircle2, CircleDashed, CircleDot, MinusCircle, XCircle } from "lucide-react";
import { MANUAL_RUN_STATUS_LABEL, MANUAL_STATUS_LABEL } from "@/lib/manual";
import { cn } from "@/lib/utils";

const STATUS = {
  untested: { Icon: CircleDashed, tone: "text-muted-foreground" },
  passed: { Icon: CheckCircle2, tone: "text-foreground" },
  failed: { Icon: XCircle, tone: "text-destructive" },
  blocked: { Icon: Ban, tone: "text-destructive" },
  skipped: { Icon: MinusCircle, tone: "text-muted-foreground" },
} as const;

/** Hasil eksekusi manual dengan ikon dan teks (tidak hanya warna). */
export function ManualStatus({ status, className }: { status: ManualResultStatus; className?: string }) {
  const { Icon, tone } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", tone, className)}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {MANUAL_STATUS_LABEL[status]}
    </span>
  );
}

const RUN_STATUS = {
  open: { Icon: CircleDot, tone: "text-foreground" },
  completed: { Icon: CheckCircle2, tone: "text-muted-foreground" },
} as const;

/** Status run manual (Terbuka / Selesai) dengan ikon dan teks. */
export function ManualRunStatus({ status, className, ...props }: { status: RunStatusValue; className?: string; "data-testid"?: string }) {
  const { Icon, tone } = RUN_STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", tone, className)} {...props}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {MANUAL_RUN_STATUS_LABEL[status]}
    </span>
  );
}
