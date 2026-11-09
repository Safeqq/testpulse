import { lazy } from "react";

// Pemuat chunk tiap halaman hasil test. Modul ini ada di bundle utama; halaman-halaman itu sendiri dipecah per chunk.
const loadRunsPage = () => import("./RunsPage").then((m) => ({ default: m.RunsPage }));
const loadRunPage = () => import("./RunPage").then((m) => ({ default: m.RunPage }));
const loadFlakyPage = () => import("./FlakyPage").then((m) => ({ default: m.FlakyPage }));
const loadTestHistoryPage = () => import("./TestHistoryPage").then((m) => ({ default: m.TestHistoryPage }));
const loadBugsPage = () => import("./BugsPage").then((m) => ({ default: m.BugsPage }));
const loadBugNewPage = () => import("./BugNewPage").then((m) => ({ default: m.BugNewPage }));
const loadComparePage = () => import("./ComparePage").then((m) => ({ default: m.ComparePage }));
const loadVersionsPage = () => import("./VersionsPage").then((m) => ({ default: m.VersionsPage }));
const loadCasesPage = () => import("./CasesPage").then((m) => ({ default: m.CasesPage }));
const loadCasePage = () => import("./CasePage").then((m) => ({ default: m.CasePage }));
const loadCaseFormPage = () => import("./CaseFormPage").then((m) => ({ default: m.CaseFormPage }));
const loadManualRunsPage = () => import("./ManualRunsPage").then((m) => ({ default: m.ManualRunsPage }));
const loadManualRunNewPage = () => import("./ManualRunNewPage").then((m) => ({ default: m.ManualRunNewPage }));
const loadManualRunPage = () => import("./ManualRunPage").then((m) => ({ default: m.ManualRunPage }));
const loadManualExecutePage = () => import("./ManualExecutePage").then((m) => ({ default: m.ManualExecutePage }));
const loadBugPage = () => import("./BugPage").then((m) => ({ default: m.BugPage }));

export const RunsPage = lazy(loadRunsPage);
export const RunPage = lazy(loadRunPage);
export const FlakyPage = lazy(loadFlakyPage);
export const TestHistoryPage = lazy(loadTestHistoryPage);
export const BugsPage = lazy(loadBugsPage);
export const BugNewPage = lazy(loadBugNewPage);
export const BugPage = lazy(loadBugPage);
export const CasesPage = lazy(loadCasesPage);
export const CasePage = lazy(loadCasePage);
export const CaseFormPage = lazy(loadCaseFormPage);
export const ManualRunsPage = lazy(loadManualRunsPage);
export const ManualRunNewPage = lazy(loadManualRunNewPage);
export const ManualRunPage = lazy(loadManualRunPage);
export const ManualExecutePage = lazy(loadManualExecutePage);
export const ComparePage = lazy(loadComparePage);
export const VersionsPage = lazy(loadVersionsPage);

const LOADERS = {
  runs: loadRunsPage,
  run: loadRunPage,
  flaky: loadFlakyPage,
  test: loadTestHistoryPage,
  bugs: loadBugsPage,
  bugNew: loadBugNewPage,
  bug: loadBugPage,
  compare: loadComparePage,
  versions: loadVersionsPage,
  cases: loadCasesPage,
  case: loadCasePage,
  caseForm: loadCaseFormPage,
  manualRuns: loadManualRunsPage,
  manualRunNew: loadManualRunNewPage,
  manualRun: loadManualRunPage,
  manualExecute: loadManualExecutePage,
};

/**
 * Mengunduh chunk halaman tujuan yang mungkin dibuka berikutnya, supaya navigasi klien tidak menunggu unduhan
 * (React menahan tampilan lama sampai chunk lazy siap). Kegagalan diabaikan: navigasi sungguhan akan mencobanya lagi.
 */
export function preloadPages(...pages: (keyof typeof LOADERS)[]): void {
  for (const page of pages) LOADERS[page]().catch(() => undefined);
}
