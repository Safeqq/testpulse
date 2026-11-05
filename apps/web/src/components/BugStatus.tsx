import type { BugResolution, BugStatus as BugStatusValue } from "@testpulse/shared";
import { CheckCircle2, CircleDashed, CircleDot, Lock, type LucideIcon } from "lucide-react";
import { BUG_RESOLUTION_LABEL, BUG_STATUS_LABEL } from "@/lib/bugs";
import { cn } from "@/lib/utils";

export const BUG_STATUS_META: Record<BugStatusValue, { label: string; Icon: LucideIcon; tone: string }> = {
  open: { label: BUG_STATUS_LABEL.open, Icon: CircleDot, tone: "text-destructive" },
  in_progress: { label: BUG_STATUS_LABEL.in_progress, Icon: CircleDashed, tone: "text-foreground" },
  resolved: { label: BUG_STATUS_LABEL.resolved, Icon: CheckCircle2, tone: "text-foreground" },
  closed: { label: BUG_STATUS_LABEL.closed, Icon: Lock, tone: "text-muted-foreground" },
};

/** Status bug dengan ikon dan teks (tidak hanya warna); resolusi, bila ada, ditulis setelah status. */
export function BugStatus({
  status,
  resolution,
  className,
}: {
  status: BugStatusValue;
  resolution?: BugResolution | null | undefined;
  className?: string;
}) {
  const { label, Icon, tone } = BUG_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", tone, className)}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>
        {label}
        {resolution ? <span className="font-normal"> · {BUG_RESOLUTION_LABEL[resolution]}</span> : null}
      </span>
    </span>
  );
}
