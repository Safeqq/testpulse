import { lazy } from "react";

// Pemuat chunk tiap halaman hasil test. Modul ini ada di bundle utama; halaman-halaman itu sendiri dipecah per chunk.
const loadRunsPage = () => import("./RunsPage").then((m) => ({ default: m.RunsPage }));
const loadRunPage = () => import("./RunPage").then((m) => ({ default: m.RunPage }));
const loadFlakyPage = () => import("./FlakyPage").then((m) => ({ default: m.FlakyPage }));
const loadTestHistoryPage = () => import("./TestHistoryPage").then((m) => ({ default: m.TestHistoryPage }));

export const RunsPage = lazy(loadRunsPage);
export const RunPage = lazy(loadRunPage);
export const FlakyPage = lazy(loadFlakyPage);
export const TestHistoryPage = lazy(loadTestHistoryPage);

const LOADERS = { runs: loadRunsPage, run: loadRunPage, flaky: loadFlakyPage, test: loadTestHistoryPage };

/**
 * Mengunduh chunk halaman tujuan yang mungkin dibuka berikutnya, supaya navigasi klien tidak menunggu unduhan
 * (React menahan tampilan lama sampai chunk lazy siap). Kegagalan diabaikan: navigasi sungguhan akan mencobanya lagi.
 */
export function preloadPages(...pages: (keyof typeof LOADERS)[]): void {
  for (const page of pages) LOADERS[page]().catch(() => undefined);
}
