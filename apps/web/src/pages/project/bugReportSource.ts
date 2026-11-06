import { api, ApiError } from "@/lib/api";
import { buildBugReportDescription, buildBugReportTitle } from "@/lib/bugReport";

/** Isian awal formulir bug yang berasal dari satu test (dari tombol "Laporkan bug" di detail run). */
export interface BugReportPrefill {
  testCaseId: string;
  /** `undefined` bila run asal tidak dikenal lagi; bug tetap bisa dilaporkan untuk test itu. */
  runId: string | undefined;
  suite: string;
  testName: string;
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
): Promise<BugReportPrefill> {
  let knownRunId = runId;
  if (runId !== undefined) {
    try {
      let cursor: string | undefined;
      for (let page = 0; page < MAX_RESULT_PAGES; page += 1) {
        const detail = await api.results.run(slug, runId, { status: "failed", cursor });
        const found = detail.results.find((result) => result.testCaseId === testCaseId);
        if (found) {
          return {
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
    testCaseId,
    runId: knownRunId,
    suite,
    testName: name,
    title: buildBugReportTitle(name),
    description: buildBugReportDescription({ suite, branch: history.branch, commitSha: null, ciUrl: null, message: null }),
  };
}
