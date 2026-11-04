import type { ResultStatus } from "@testpulse/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Queryable } from "../../db/client.js";
import { runs, testCases, testResults } from "../../db/schema.js";
import type { RunRecord } from "./repository.js";

// Query perbandingan & daftar versi (spec Tahap 3 §4.2–4.4). Pengurutan versi, pembanding default, dan
// pengelompokan dikerjakan domain (`versions.ts`, `baseline.ts`, `compare.ts`), bukan SQL.

/**
 * Semua run satu branch, urut lama → baru (`created_at`, `id`) — masukan `pickBaseline`/`pickDefaultTarget`
 * (Ruling T2-a: daftar lengkap, bukan halaman). Terbatas oleh retensi (maks 200 run per project).
 */
export async function listBranchRuns(db: Queryable, projectId: string, branch: string): Promise<RunRecord[]> {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.branch, branch)))
    .orderBy(asc(runs.createdAt), asc(runs.id));
}

export interface CompareResultRow {
  testCaseId: string;
  suite: string;
  name: string;
  status: ResultStatus;
  durationMs: number;
  message: string | null;
  flakyInRun: boolean;
}

/** Seluruh hasil test satu run (satu query per run) untuk diklasifikasi di domain. */
export async function listCompareResults(db: Queryable, runId: string): Promise<CompareResultRow[]> {
  const rows = await db
    .select({
      testCaseId: testResults.testCaseId,
      suite: testCases.suite,
      name: testCases.name,
      status: testResults.status,
      durationMs: testResults.durationMs,
      message: testResults.message,
      flakyInRun: testResults.flakyInRun,
    })
    .from(testResults)
    .innerJoin(testCases, eq(testCases.id, testResults.testCaseId))
    .where(eq(testResults.runId, runId));
  // Kolom status dibatasi CHECK constraint `test_results_status_check`.
  return rows.map((row) => ({ ...row, status: row.status as ResultStatus }));
}
