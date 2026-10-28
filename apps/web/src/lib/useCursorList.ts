import { useCallback, useState } from "react";
import { useLoad } from "./useLoad";

export interface CursorPage<I> {
  items: I[];
  nextCursor: string | null;
}

export type CursorList<I> =
  | { state: "loading"; reload: () => void }
  | { state: "error"; error: unknown; reload: () => void }
  | {
      state: "ready";
      items: I[];
      hasMore: boolean;
      /** Halaman berikutnya sedang dimuat. */
      loadingMore: boolean;
      /** Kegagalan memuat halaman berikutnya (daftar yang sudah ada tetap tampil). */
      moreError: unknown;
      loadMore: () => void;
      reload: () => void;
    };

interface Extra<I> {
  /** Halaman pertama yang menjadi dasar; hasil yang dasarnya sudah diganti (filter/muat ulang) dibuang. */
  base: CursorPage<I>;
  items: I[];
  nextCursor: string | null;
}

/**
 * Daftar berhalaman dengan cursor: halaman pertama dimuat saat `fetchPage` berubah (harus stabil, mis. `useCallback`),
 * halaman berikutnya ditambahkan lewat `loadMore()`. Mengganti `fetchPage` (mis. filter lain) atau `reload()` memulai
 * ulang dari halaman pertama; hasil `loadMore` yang terlambat dari daftar lama diabaikan.
 */
export function useCursorList<I>(fetchPage: (cursor?: string) => Promise<CursorPage<I>>): CursorList<I> {
  const fetchFirst = useCallback(() => fetchPage(), [fetchPage]);
  const first = useLoad(fetchFirst);
  const [extra, setExtra] = useState<Extra<I> | null>(null);
  const [busyBase, setBusyBase] = useState<CursorPage<I> | null>(null);
  const [failure, setFailure] = useState<{ base: CursorPage<I>; error: unknown } | null>(null);

  const base = first.state === "ready" ? first.data : null;
  const current = base !== null && extra?.base === base ? extra : null;
  const nextCursor = base === null ? null : current ? current.nextCursor : base.nextCursor;
  const loadingMore = base !== null && busyBase === base;

  const loadMore = useCallback(() => {
    if (base === null || nextCursor === null || busyBase === base) return;
    const previous = current?.items ?? [];
    setBusyBase(base);
    setFailure(null);
    fetchPage(nextCursor).then(
      (page) => setExtra({ base, items: [...previous, ...page.items], nextCursor: page.nextCursor }),
      (error: unknown) => setFailure({ base, error }),
    ).finally(() => setBusyBase((b) => (b === base ? null : b)));
  }, [base, busyBase, current, fetchPage, nextCursor]);

  if (first.state === "loading") return { state: "loading", reload: first.reload };
  if (first.state === "error") return { state: "error", error: first.error, reload: first.reload };
  return {
    state: "ready",
    items: [...first.data.items, ...(current?.items ?? [])],
    hasMore: nextCursor !== null,
    loadingMore,
    moreError: failure?.base === base ? failure.error : null,
    loadMore,
    reload: first.reload,
  };
}
