import type { ActivityItemDto, CommentDto } from "@testpulse/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Batas halaman yang dimuat ulang sekaligus setelah perubahan (50 item per halaman): riwayat lebih panjang memakai "Muat lagi". */
const MAX_REFRESH_PAGES = 20;

type ActivityState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; items: ActivityItemDto[]; nextCursor: string | null };

export interface BugActivity {
  state: ActivityState;
  /** Memuat halaman berikutnya; kegagalannya dicatat di `moreError` (bukan dilempar) agar tombol bisa menampilkannya. */
  loadMore: () => Promise<void>;
  loadingMore: boolean;
  moreError: unknown;
  /** Memuat ulang linimasa dari awal sampai akhir (setelah perubahan bug atau komentar baru); kegagalannya dicatat di `refreshError`. */
  refresh: () => Promise<void>;
  /** Galat pemuatan ulang terakhir (linimasa lama tetap tampil); `null` setelah pemuatan ulang berhasil. */
  refreshError: unknown;
  /** Mengganti satu komentar di tempat (setelah diedit atau dihapus) tanpa memuat ulang. */
  replaceComment: (comment: CommentDto) => void;
  retry: () => void;
}

const keyOf = (item: ActivityItemDto) => `${item.kind}:${item.id}`;

/**
 * Linimasa aktivitas satu bug (lama → baru): halaman pertama saat dibuka, "Muat lagi" untuk sisanya, dan `refresh` yang
 * memuat semuanya agar komentar baru atau event terbaru ikut tampil di akhir. Hasil permintaan yang sudah usang
 * (ada pemuatan yang lebih baru) dibuang.
 */
export function useBugActivity(slug: string, number: number): BugActivity {
  const [state, setState] = useState<ActivityState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    const mine = ++generation.current;
    api.bugs.activity(slug, number).then(
      (page) => {
        if (active && generation.current === mine) setState({ status: "ready", items: page.items, nextCursor: page.nextCursor });
      },
      (error: unknown) => {
        if (active && generation.current === mine) setState({ status: "error", error });
      },
    );
    return () => {
      active = false;
    };
  }, [slug, number, attempt]);

  const loadMore = useCallback(async () => {
    if (state.status !== "ready" || state.nextCursor === null) return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.bugs.activity(slug, number, state.nextCursor);
      if (generation.current !== mine) return;
      setState((current) => {
        if (current.status !== "ready") return current;
        const known = new Set(current.items.map(keyOf));
        const added = page.items.filter((item) => !known.has(keyOf(item)));
        return { status: "ready", items: [...current.items, ...added], nextCursor: page.nextCursor };
      });
    } catch (error) {
      if (generation.current === mine) setMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  }, [slug, number, state]);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const items: ActivityItemDto[] = [];
      let cursor: string | undefined;
      let nextCursor: string | null = null;
      for (let pages = 0; pages < MAX_REFRESH_PAGES; pages++) {
        const page = await api.bugs.activity(slug, number, cursor);
        items.push(...page.items);
        nextCursor = page.nextCursor;
        if (nextCursor === null) break;
        cursor = nextCursor;
      }
      if (generation.current === mine) {
        setState({ status: "ready", items, nextCursor });
        setRefreshError(null);
      }
    } catch (error) {
      // Linimasa yang sudah tampil dibiarkan dan galatnya ditampilkan bersama tombol coba lagi.
      if (generation.current === mine) {
        setRefreshError(error);
        setState((current) => (current.status === "ready" ? current : { status: "error", error }));
      }
    }
  }, [slug, number]);

  const replaceComment = useCallback((comment: CommentDto) => {
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            items: current.items.map((item) =>
              item.kind === "comment" && item.id === comment.id ? { ...comment, kind: "comment" } : item,
            ),
          }
        : current,
    );
  }, []);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, loadMore, loadingMore, moreError, refresh, refreshError, replaceComment, retry };
}
