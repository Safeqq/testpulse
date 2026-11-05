import type { BugRefDto } from "@testpulse/shared";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BUG_STATUS_META } from "./BugStatus";

/** Tautan ringkas ke satu bug ("Bug #12 · Open"); judul lengkap ada di `title` (tooltip). */
export function BugBadge({ bug, slug, className }: { bug: BugRefDto; slug: string; className?: string }) {
  const { label, Icon, tone } = BUG_STATUS_META[bug.status];
  return (
    <Badge asChild variant="outline" className={cn("max-w-full", className)}>
      <Link
        to={`/p/${encodeURIComponent(slug)}/bugs/${bug.number}`}
        title={bug.title}
        data-testid={`bug-badge-${bug.number}`}
        className="text-foreground outline-hidden hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <Icon className={cn("shrink-0", tone)} aria-hidden="true" />
        Bug #{bug.number} · {label}
      </Link>
    </Badge>
  );
}
