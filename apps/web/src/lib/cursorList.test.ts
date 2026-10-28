import { describe, expect, it } from "vitest";
import { CursorListStore, type CursorPage } from "./cursorList";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const page = (items: string[], nextCursor: string | null): CursorPage<string> => ({ items, nextCursor });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Store dengan fetchPage terkendali: tiap panggilan menghasilkan promise yang diselesaikan test. */
function setup() {
  const calls: { cursor: string | undefined; result: Deferred<CursorPage<string>> }[] = [];
  const store = new CursorListStore<string>((cursor) => {
    const result = deferred<CursorPage<string>>();
    calls.push({ cursor, result });
    return result.promise;
  });
  return { store, calls };
}

function ready(store: CursorListStore<string>) {
  const snapshot = store.getSnapshot();
  if (snapshot.state !== "ready") throw new Error(`diharapkan ready, diterima ${snapshot.state}`);
  return snapshot;
}

describe("CursorListStore", () => {
  it("memuat halaman pertama lalu menambahkan halaman berikutnya sampai cursor habis", async () => {
    const { store, calls } = setup();
    store.load();
    expect(store.getSnapshot()).toEqual({ state: "loading" });

    calls[0]!.result.resolve(page(["a", "b"], "c1"));
    await tick();
    expect(ready(store)).toMatchObject({ items: ["a", "b"], hasMore: true, loadingMore: false, moreError: null });

    store.loadMore();
    expect(calls[1]!.cursor).toBe("c1");
    expect(ready(store).loadingMore).toBe(true);
    store.loadMore(); // diabaikan selagi memuat
    expect(calls).toHaveLength(2);

    calls[1]!.result.resolve(page(["c"], null));
    await tick();
    expect(ready(store)).toMatchObject({ items: ["a", "b", "c"], hasMore: false, loadingMore: false });
    store.loadMore(); // tidak ada halaman lagi
    expect(calls).toHaveLength(2);
  });

  it("membuang halaman pertama yang usang saat dimuat ulang", async () => {
    const { store, calls } = setup();
    store.load();
    store.load();

    calls[1]!.result.resolve(page(["baru"], null));
    await tick();
    calls[0]!.result.resolve(page(["lama"], "c-lama"));
    await tick();

    expect(ready(store)).toMatchObject({ items: ["baru"], hasMore: false });
  });

  it("membuang kegagalan halaman pertama yang usang", async () => {
    const { store, calls } = setup();
    store.load();
    store.load();

    calls[1]!.result.resolve(page(["baru"], null));
    await tick();
    calls[0]!.result.reject(new Error("lama"));
    await tick();

    expect(ready(store).items).toEqual(["baru"]);
  });

  it("membuang hasil loadMore yang usang setelah muat ulang", async () => {
    const { store, calls } = setup();
    store.load();
    calls[0]!.result.resolve(page(["a"], "c1"));
    await tick();
    store.loadMore();

    store.load(); // filter/muat ulang: daftar lama tak berlaku lagi
    calls[2]!.result.resolve(page(["x"], null));
    await tick();
    calls[1]!.result.resolve(page(["usang"], "c2"));
    await tick();

    expect(ready(store)).toMatchObject({ items: ["x"], hasMore: false, loadingMore: false });
  });

  it("membuang respons yang datang setelah stop (komponen dilepas)", async () => {
    const { store, calls } = setup();
    store.load();
    store.stop();
    calls[0]!.result.resolve(page(["a"], null));
    await tick();

    expect(store.getSnapshot()).toEqual({ state: "loading" });
  });

  it("kegagalan loadMore menyimpan daftar yang ada dan bisa diulang", async () => {
    const { store, calls } = setup();
    store.load();
    calls[0]!.result.resolve(page(["a"], "c1"));
    await tick();

    store.loadMore();
    const failure = new Error("jaringan");
    calls[1]!.result.reject(failure);
    await tick();
    expect(ready(store)).toMatchObject({ items: ["a"], hasMore: true, loadingMore: false, moreError: failure });

    store.loadMore();
    expect(ready(store).moreError).toBeNull();
    expect(calls[2]!.cursor).toBe("c1");
    calls[2]!.result.resolve(page(["b"], null));
    await tick();
    expect(ready(store)).toMatchObject({ items: ["a", "b"], hasMore: false, moreError: null });
  });

  it("kegagalan halaman pertama menjadi error dan reload memulihkan", async () => {
    const { store, calls } = setup();
    store.load();
    const failure = new Error("server");
    calls[0]!.result.reject(failure);
    await tick();
    expect(store.getSnapshot()).toEqual({ state: "error", error: failure });

    store.load();
    expect(store.getSnapshot()).toEqual({ state: "loading" });
    calls[1]!.result.resolve(page(["a"], null));
    await tick();
    expect(ready(store).items).toEqual(["a"]);
  });
});
