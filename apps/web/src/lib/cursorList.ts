export interface CursorPage<I> {
  items: I[];
  nextCursor: string | null;
}

export type CursorListState<I> =
  | { state: "loading" }
  | { state: "error"; error: unknown }
  | {
      state: "ready";
      items: I[];
      hasMore: boolean;
      /** Halaman berikutnya sedang dimuat. */
      loadingMore: boolean;
      /** Kegagalan memuat halaman berikutnya (daftar yang sudah ada tetap tampil). */
      moreError: unknown;
    };

/**
 * Daftar berhalaman dengan cursor, tanpa ketergantungan React (agar mudah diuji). Setiap `load()`/`stop()` menaikkan
 * `generation`; respons yang datang untuk generation lama (muat ulang, filter berganti, komponen dilepas) dibuang,
 * baik halaman pertama maupun `loadMore()`.
 */
export class CursorListStore<I> {
  private snapshot: CursorListState<I> = { state: "loading" };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private items: I[] = [];
  private nextCursor: string | null = null;

  constructor(private readonly fetchPage: (cursor?: string) => Promise<CursorPage<I>>) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CursorListState<I> => this.snapshot;

  /** Mulai dari halaman pertama (juga dipakai untuk "coba lagi"/muat ulang). */
  load = (): void => {
    const generation = ++this.generation;
    this.items = [];
    this.nextCursor = null;
    this.publish({ state: "loading" });
    this.fetchPage().then(
      (page) => {
        if (generation !== this.generation) return;
        this.items = page.items;
        this.nextCursor = page.nextCursor;
        this.publish(this.ready(false, null));
      },
      (error: unknown) => {
        if (generation !== this.generation) return;
        this.publish({ state: "error", error });
      },
    );
  };

  /** Membuang semua respons yang masih berjalan (komponen dilepas). */
  stop = (): void => {
    this.generation += 1;
  };

  loadMore = (): void => {
    const cursor = this.nextCursor;
    if (this.snapshot.state !== "ready" || cursor === null || this.snapshot.loadingMore) return;
    const generation = this.generation;
    this.publish(this.ready(true, null));
    this.fetchPage(cursor).then(
      (page) => {
        if (generation !== this.generation) return;
        this.items = [...this.items, ...page.items];
        this.nextCursor = page.nextCursor;
        this.publish(this.ready(false, null));
      },
      (error: unknown) => {
        if (generation !== this.generation) return;
        this.publish(this.ready(false, error));
      },
    );
  };

  private ready(loadingMore: boolean, moreError: unknown): CursorListState<I> {
    return { state: "ready", items: this.items, hasMore: this.nextCursor !== null, loadingMore, moreError };
  }

  private publish(next: CursorListState<I>): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
