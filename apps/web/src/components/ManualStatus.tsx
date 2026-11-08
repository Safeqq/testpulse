import type { ManualResultStatus } from "@testpulse/shared";
import { Ban, CheckCircle2, CircleDashed, MinusCircle, XCircle } from "lucide-react";
import { MANUAL_STATUS_LABEL } from "@/lib/manual";
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
