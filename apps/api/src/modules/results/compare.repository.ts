import type { ResultStatus } from "@testpulse/shared";
import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
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
  flakyInRun: boolean;
}

/**
 * Seluruh hasil test satu run (satu query per run) untuk diklasifikasi di domain. Tanpa `message` (bisa panjang):
 * pesan hanya diambil untuk item yang benar-benar dikembalikan, lewat `listResultMessages`.
 */
export async function listCompareResults(db: Queryable, runId: string): Promise<CompareResultRow[]> {
  const rows = await db
    .select({
      testCaseId: testResults.testCaseId,
      suite: testCases.suite,
      name: testCases.name,
      status: testResults.status,
      durationMs: testResults.durationMs,
      flakyInRun: testResults.flakyInRun,
    })
    .from(testResults)
    .innerJoin(testCases, eq(testCases.id, testResults.testCaseId))
    .where(eq(testResults.runId, runId));
  // Kolom status dibatasi CHECK constraint `test_results_status_check`.
  return rows.map((row) => ({ ...row, status: row.status as ResultStatus }));
}

/** Kunci peta pesan dari `listResultMessages`. */
export const messageKey = (runId: string, testCaseId: string) => `${runId}:${testCaseId}`;

/**
 * Pesan hasil test (yang tidak kosong) untuk test tertentu di run tertentu, dengan **satu** query untuk semua sisi
 * (base dan target). Kunci = `messageKey(runId, testCaseId)`.
 */
export async function listResultMessages(
  db: Queryable,
  sides: ReadonlyArray<{ runId: string; testCaseIds: readonly string[] }>,
): Promise<Map<string, string>> {
  const wanted = sides.filter((side) => side.testCaseIds.length > 0);
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ runId: testResults.runId, testCaseId: testResults.testCaseId, message: testResults.message })
    .from(testResults)
    .where(
      and(
        or(...wanted.map((side) => and(eq(testResults.runId, side.runId), inArray(testResults.testCaseId, [...side.testCaseIds])))),
        isNotNull(testResults.message),
      ),
    );
  return new Map(rows.map((row) => [messageKey(row.runId, row.testCaseId), row.message ?? ""]));
}
