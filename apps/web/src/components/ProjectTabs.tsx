import { useEffect, useRef, type FocusEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { withBranch } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export type ProjectTab = "ringkasan" | "run" | "versi" | "bug" | "flaky" | "pengaturan";

interface TabDef {
  id: ProjectTab;
  label: string;
  /** Path di bawah `/p/:slug` ("" = ringkasan). */
  path: string;
  /** Halaman per branch (membaca `?branch=`): tautannya membawa branch dari URL saat ini. */
  branchScoped?: true;
}

const TABS: readonly TabDef[] = [
  { id: "ringkasan", label: "Ringkasan", path: "", branchScoped: true },
  { id: "run", label: "Run", path: "/runs", branchScoped: true },
  { id: "versi", label: "Versi", path: "/versions", branchScoped: true },
  { id: "bug", label: "Bug", path: "/bugs" },
  { id: "flaky", label: "Flaky", path: "/flaky", branchScoped: true },
  { id: "pengaturan", label: "Pengaturan", path: "/settings" },
];

/**
 * Browser tidak menggulirkan tab yang baru sebagian terlihat saat difokus (hanya yang sama sekali tersembunyi), padahal
 * pengguna keyboard perlu melihat tab yang sedang fokus utuh. `nearest` tidak menggeser apa pun bila sudah terlihat penuh.
 */
function revealOnFocus(event: FocusEvent<HTMLAnchorElement>): void {
  event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * Menggeser daftar tab (hanya sumbu mendatar, tanpa menggulir halaman) sampai tab aktif terlihat penuh. Tanpa ini, di
 * layar sempit tab aktif yang berada di ujung kanan (mis. Flaky) tersembunyi saat halaman dibuka. Tidak menggeser
 * apa pun bila tab itu sudah terlihat.
 */
function revealActive(list: HTMLElement): void {
  const active = list.querySelector<HTMLElement>('[aria-current="page"]');
  if (!active) return;
  const tab = active.getBoundingClientRect();
  const box = list.getBoundingClientRect();
  // Dibulatkan ke arah menggeser: scrollLeft sebagian browser (WebKit) bulat, sisa pecahan menyisakan tepi tab tersembunyi.
  if (tab.left < box.left) list.scrollLeft += Math.floor(tab.left - box.left);
  else if (tab.right > box.right) list.scrollLeft += Math.ceil(tab.right - box.right);
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
 * bisa difokus dengan keyboard, dan fokus menggulirkan tab ke dalam tampilan. Bila URL saat ini memuat `?branch=`, tab
 * halaman per branch (Ringkasan, Run, Versi, Flaky) membawanya agar pindah tab tetap di branch yang sama.
 */
export function ProjectTabs({ slug, active, canSeeSettings }: ProjectTabsProps) {
  const tabs = TABS.filter((tab) => tab.id !== "pengaturan" || canSeeSettings);
  const branch = new URLSearchParams(useLocation().search).get("branch");
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (list.current) revealActive(list.current);
  }, [active]);
  return (
    <nav aria-label="Navigasi project" data-testid="project-tabs" className="min-w-0 border-b">
      <ul ref={list} className="m-0 flex list-none gap-1 overflow-x-auto p-0">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                to={withBranch(`/p/${encodeURIComponent(slug)}${tab.path}`, tab.branchScoped ? branch : null)}
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
