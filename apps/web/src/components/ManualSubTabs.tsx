import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export type ManualSubTab = "cases" | "runs";

const SUB_TABS: readonly { id: ManualSubTab; label: string; path: string }[] = [
  { id: "cases", label: "Test case", path: "/cases" },
  { id: "runs", label: "Run manual", path: "/manual-runs" },
];

interface ManualSubTabsProps {
  slug: string;
  active: ManualSubTab;
}

/**
 * Sub-tab di dalam tab "Test manual" (spec Tahap 4 §8.1): Test case dan Run manual. Tautan biasa tanpa `?branch=`,
 * karena test manual tidak terikat branch.
 */
export function ManualSubTabs({ slug, active }: ManualSubTabsProps) {
  return (
    <nav aria-label="Bagian test manual" data-testid="manual-subtabs">
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {SUB_TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                to={`/p/${encodeURIComponent(slug)}${tab.path}`}
                data-testid={`manual-subtab-${tab.id}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium outline-hidden transition-colors focus-visible:ring-[3px] focus-visible:ring-ring",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
