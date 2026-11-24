import type { BugSeverity } from "@testpulse/shared";
import { AlertOctagon, AlertTriangle, CircleAlert, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BUG_SEVERITY_LABEL } from "@/lib/bugs";
import { cn } from "@/lib/utils";

const SEVERITY = {
  minor: { Icon: Info, tone: "" },
  major: { Icon: CircleAlert, tone: "" },
  critical: { Icon: AlertTriangle, tone: "border-destructive/50 text-destructive" },
  blocker: { Icon: AlertOctagon, tone: "border-destructive bg-destructive/10 text-destructive" },
} as const;

/** Severity laporan/bug dengan ikon dan teks (tidak hanya warna). */
export function SeverityBadge({ severity, className, ...props }: { severity: BugSeverity; className?: string; "data-testid"?: string }) {
  const { Icon, tone } = SEVERITY[severity];
  return (
    <Badge variant="outline" className={cn(tone, className)} {...props}>
      <Icon aria-hidden="true" />
      {BUG_SEVERITY_LABEL[severity]}
    </Badge>
  );
}
