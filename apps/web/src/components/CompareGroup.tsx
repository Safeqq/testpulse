import type { CompareGroup as CompareGroupName, CompareGroupPageDto, CompareItemDto, RunSummaryDto } from "@testpulse/shared";
import { ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { CompareRow } from "@/components/CompareRow";
import { LoadError } from "@/components/LoadError";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { COMPARE_GROUP_EMPTY, COMPARE_GROUP_LABEL } from "@/lib/compareSummary";

interface CompareGroupProps {
  group: CompareGroupName;
  /** Jumlah seluruh item kelompok (dari ringkasan); `page` hanya memuat sebagian bila kelompok besar. */
  count: number;
  page: CompareGroupPageDto;
  slug: string;
  base: RunSummaryDto;
  target: RunSummaryDto;
  canWriteBugs: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cursor tidak cocok dengan pasangan run (perbandingan berubah): muat ulang seluruh perbandingan. */
  onReload: () => void;
}

interface Extra {
  items: CompareItemDto[];
  nextCursor: string | null;
  loading: boolean;
  error: unknown;
}

/**
 * Satu kelompok perbandingan sebagai <details> (spec Tahap 3 §7.2 butir 4 dan 7). Kelompok kosong hanya satu baris.
 * Halaman berikutnya dimuat dengan id base/target dari perbandingan yang sedang tampil (cursor terikat pada pasangan
 * itu), bukan default yang bisa bergeser setelah upload baru.
 */
export function CompareGroup({ group, count, page, slug, base, target, canWriteBugs, open, onOpenChange, onReload }: CompareGroupProps) {
  const label = COMPARE_GROUP_LABEL[group];
  const [extra, setExtra] = useState<Extra>({ items: [], nextCursor: page.nextCursor, loading: false, error: null });

  if (count === 0 && page.items.length === 0) {
    return (
      <p
        id={`compare-group-${group}`}
        className="m-0 flex flex-wrap items-baseline gap-x-2 rounded-lg border bg-card px-4 py-3 text-sm"
        data-testid={`compare-group-${group}`}
      >
        <span className="font-semibold">
          {label} <span className="font-mono tabular-nums">(0)</span>
        </span>
        <span className="text-muted-foreground">{COMPARE_GROUP_EMPTY[group]}</span>
      </p>
    );
  }

  const items = [...page.items, ...extra.items];

  async function loadMore() {
    const cursor = extra.nextCursor;
    if (cursor === null || extra.loading) return;
    setExtra((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const next = await api.results.compareGroup(slug, { base: base.id, target: target.id, group, cursor });
      setExtra((prev) => ({ items: [...prev.items, ...next.items], nextCursor: next.nextCursor, loading: false, error: null }));
    } catch (error) {
      setExtra((prev) => ({ ...prev, loading: false, error }));
    }
  }

  const cursorStale = extra.error instanceof ApiError && extra.error.fields?.cursor !== undefined;

  return (
    <details
      id={`compare-group-${group}`}
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="group min-w-0 rounded-lg border bg-card"
      data-testid={`compare-group-${group}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 text-base font-semibold outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        <span>
          {label} <span className="font-mono tabular-nums">({count})</span>
        </span>
      </summary>
      {/* Baris hanya dirender saat kelompok terbuka: kelompok besar yang tertutup tidak membebani halaman. */}
      {open ? (
        <div className="grid min-w-0 gap-3 border-t">
          <ul className="m-0 grid list-none divide-y divide-border p-0">
            {items.map((item) => (
              <CompareRow key={item.testCaseId} item={item} slug={slug} base={base} target={target} canWriteBugs={canWriteBugs} />
            ))}
          </ul>
          {extra.error !== null ? (
            <div className="px-4">
              {cursorStale ? (
                <div
                  role="alert"
                  className="grid justify-items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
                >
                  <p>Perbandingan ini sudah berubah, sehingga daftar tidak bisa dilanjutkan.</p>
                  <Button type="button" variant="outline" size="sm" onClick={onReload}>
                    Muat ulang perbandingan
                  </Button>
                </div>
              ) : (
                <LoadError error={extra.error} fallback="Gagal memuat test berikutnya. Coba lagi." onRetry={loadMore} />
              )}
            </div>
          ) : null}
          {extra.nextCursor !== null && !cursorStale ? (
            <div className="px-4 pb-4">
              <Button
                type="button"
                variant="outline"
                onClick={loadMore}
                disabled={extra.loading}
                data-testid={`compare-more-${group}`}
              >
                {extra.loading ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
                Muat lagi
                <span className="sr-only"> {label.toLowerCase()}</span>
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
