import { useEffect, useMemo, useSyncExternalStore } from "react";
import { CursorListStore, type CursorListState, type CursorPage } from "./cursorList";

export type { CursorPage };

export type CursorList<I> = CursorListState<I> & { loadMore: () => void; reload: () => void };

/**
 * Daftar berhalaman dengan cursor: halaman pertama dimuat saat `fetchPage` berubah (harus stabil, mis. `useCallback`),
 * halaman berikutnya lewat `loadMore()`. Logika dan penanganan respons usang ada di `CursorListStore`.
 */
export function useCursorList<I>(fetchPage: (cursor?: string) => Promise<CursorPage<I>>): CursorList<I> {
  const store = useMemo(() => new CursorListStore(fetchPage), [fetchPage]);
  useEffect(() => {
    store.load();
    return store.stop;
  }, [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...snapshot, loadMore: store.loadMore, reload: store.load };
}
