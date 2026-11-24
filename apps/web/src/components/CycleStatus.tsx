import type { CycleStatus as CycleStatusValue } from "@testpulse/shared";
import { CheckCircle2, CircleDot, PencilLine } from "lucide-react";
import { CYCLE_STATUS_LABEL, endsLabel } from "@/lib/crowd";
import { cn } from "@/lib/utils";

const STATUS = {
  draft: { Icon: PencilLine, tone: "text-muted-foreground" },
  open: { Icon: CircleDot, tone: "text-foreground" },
  closed: { Icon: CheckCircle2, tone: "text-muted-foreground" },
} as const;

/** Status efektif cycle dengan ikon dan teks; untuk cycle berlangsung ditambah sisa waktunya. */
export function CycleStatus({
  status,
  endsAt,
  className,
  ...props
}: {
  status: CycleStatusValue;
  endsAt: string | null;
  className?: string;
  "data-testid"?: string;
}) {
  const { Icon, tone } = STATUS[status];
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium", tone, className)} {...props}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {CYCLE_STATUS_LABEL[status]}
      {status === "open" ? <span className="font-normal text-muted-foreground">· {endsLabel(endsAt)}</span> : null}
    </span>
  );
}
