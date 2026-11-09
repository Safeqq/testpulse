import { api, ApiError } from "@/lib/api";
import { buildBugReportDescription, buildBugReportTitle } from "@/lib/bugReport";
import { buildManualBugDescription, buildManualBugTitle } from "@/lib/manualBugReport";

/** Isian awal formulir bug: dari test otomatis yang gagal, atau dari run case manual yang gagal. */
export type BugReportPrefill = TestBugPrefill | ManualBugPrefill;

/** Isian awal formulir bug yang berasal dari satu test (dari tombol "Laporkan bug" di detail run). */
export interface TestBugPrefill {
  kind: "test";
  testCaseId: string;
  /** `undefined` bila run asal tidak dikenal lagi; bug tetap bisa dilaporkan untuk test itu. */
  runId: string | undefined;
  suite: string;
  testName: string;
  title: string;
  description: string;
}

/** Isian awal dari satu run case manual (tombol "Laporkan bug" di halaman eksekusi, spec Tahap 4 §5.4). */
export interface ManualBugPrefill {
  kind: "manual";
  manualRunCaseId: string;
  runNumber: number;
  runName: string;
  caseNumber: number;
  caseTitle: string;
  title: string;
  description: string;
}

/** Batas halaman hasil gagal yang dipindai mencari test (100 hasil per halaman); run dengan >1000 kegagalan jatuh ke riwayat test. */
const MAX_RESULT_PAGES = 10;

/**
 * Memuat data test untuk mengisi formulir. Pesan error dibaca dari run (tidak lewat URL): hasil gagal run dipindai
 * mencari `testCaseId`. Bila run tidak ada atau test tidak termasuk hasil gagalnya, nama dan suite diambil dari riwayat
 * test (tanpa pesan error); server tetap memvalidasi pasangan test dan run saat bug disimpan.
 */
export async function loadBugReportSource(
  slug: string,
  testCaseId: string,
  runId: string | undefined,
): Promise<TestBugPrefill> {
  let knownRunId = runId;
  if (runId !== undefined) {
    try {
      let cursor: string | undefined;
      for (let page = 0; page < MAX_RESULT_PAGES; page += 1) {
        const detail = await api.results.run(slug, runId, { status: "failed", cursor });
        const found = detail.results.find((result) => result.testCaseId === testCaseId);
        if (found) {
          return {
            kind: "test",
            testCaseId,
            runId,
            suite: found.suite,
            testName: found.name,
            title: buildBugReportTitle(found.name),
            description: buildBugReportDescription({
              suite: found.suite,
              branch: detail.run.branch,
              commitSha: detail.run.commitSha,
              ciUrl: detail.run.ciUrl,
              message: found.message,
            }),
          };
        }
        if (detail.nextCursor === null) break;
        cursor = detail.nextCursor;
      }
    } catch (err) {
      // Run yang sudah dihapus tidak menghalangi pelaporan; kegagalan lain dilempar ke pemanggil.
      if (!(err instanceof ApiError && err.code === "RUN_NOT_FOUND")) throw err;
      knownRunId = undefined;
    }
  }

  const history = await api.results.history(slug, testCaseId);
  const { suite, name } = history.testCase;
  return {
    kind: "test",
    testCaseId,
    runId: knownRunId,
    suite,
    testName: name,
    title: buildBugReportTitle(name),
    description: buildBugReportDescription({ suite, branch: history.branch, commitSha: null, ciUrl: null, message: null }),
  };
}

/**
 * Memuat run dan run case untuk mengisi formulir dari run case manual. Semua teks berasal dari snapshot run case (tidak
 * lewat URL); run yang sudah selesai tetap bisa dilaporkan (spec §4.4). Run atau run case yang tidak ada dilempar ke
 * pemanggil, yang menawarkan formulir tanpa tautan.
 */
export async function loadManualBugReportSource(slug: string, runNumber: number, runCaseId: string): Promise<ManualBugPrefill> {
  const [run, runCase] = await Promise.all([api.manual.runs.get(slug, runNumber), api.manual.runCases.get(slug, runNumber, runCaseId)]);
  return {
    kind: "manual",
    manualRunCaseId: runCase.id,
    runNumber: run.number,
    runName: run.name,
    caseNumber: runCase.caseNumber,
    caseTitle: runCase.title,
    title: buildManualBugTitle(runCase.caseNumber, runCase.title),
    description: buildManualBugDescription({
      runNumber: run.number,
      runName: run.name,
      appVersion: run.appVersion,
      suiteName: runCase.suiteName,
      preconditions: runCase.preconditions,
      steps: runCase.steps,
      stepResults: runCase.stepResults,
      note: runCase.note,
    }),
  };
}
