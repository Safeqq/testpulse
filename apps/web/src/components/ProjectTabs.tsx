import type { FocusEvent } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export type ProjectTab = "ringkasan" | "run" | "versi" | "bug" | "flaky" | "pengaturan";

interface TabDef {
  id: ProjectTab;
  label: string;
  /** Path di bawah `/p/:slug` ("" = ringkasan). */
  path: string;
}

const TABS: readonly TabDef[] = [
  { id: "ringkasan", label: "Ringkasan", path: "" },
  { id: "run", label: "Run", path: "/runs" },
  { id: "versi", label: "Versi", path: "/versions" },
  { id: "bug", label: "Bug", path: "/bugs" },
  { id: "flaky", label: "Flaky", path: "/flaky" },
  { id: "pengaturan", label: "Pengaturan", path: "/settings" },
];

/**
 * Browser tidak menggulirkan tab yang baru sebagian terlihat saat difokus (hanya yang sama sekali tersembunyi), padahal
 * pengguna keyboard perlu melihat tab yang sedang fokus utuh. `nearest` tidak menggeser apa pun bila sudah terlihat penuh.
 */
function revealOnFocus(event: FocusEvent<HTMLAnchorElement>): void {
  event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
}

interface ProjectTabsProps {
  slug: string;
  /** Tab halaman ini; kosong untuk halaman turunan yang bukan salah satu tab (mis. riwayat test). */
  active?: ProjectTab | undefined;
  /** Pengaturan hanya untuk anggota project (`myRole != null`). */
  canSeeSettings: boolean;
}

/**
 * Navigasi antarhalaman project (spec Tahap 3 §7.1). Di layar sempit tab bisa digeser mendatar di dalam wadahnya
 * sendiri (`min-w-0` + `overflow-x-auto`), jadi halaman tidak ikut bergulir; setiap tab adalah tautan biasa yang
 * bisa difokus dengan keyboard, dan fokus menggulirkan tab ke dalam tampilan.
 */
export function ProjectTabs({ slug, active, canSeeSettings }: ProjectTabsProps) {
  const tabs = TABS.filter((tab) => tab.id !== "pengaturan" || canSeeSettings);
  return (
    <nav aria-label="Navigasi project" data-testid="project-tabs" className="min-w-0 border-b">
      <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                to={`/p/${encodeURIComponent(slug)}${tab.path}`}
                data-testid={`tab-${tab.id}`}
                aria-current={isActive ? "page" : undefined}
                onFocus={revealOnFocus}
                className={cn(
                  "inline-flex items-center border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap outline-hidden transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset",
                  isActive ? "border-foreground text-foreground" : "border-transparent text-muted-foreground",
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
