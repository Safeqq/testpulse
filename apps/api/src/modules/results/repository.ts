import type { IngestQuery } from "@testpulse/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { projects, runs, testCases, testResults } from "../../db/schema.js";
import { touchToken } from "../tokens/auth.js";
import type { ParsedReport, ParsedResult } from "./domain/junit.js";

/** Jumlah run terbaru yang disimpan per project (spec Tahap 2 §4, retensi). */
export const RUN_RETENTION = 200;

/**
 * Baris per INSERT/SELECT. `test_results` punya 7 kolom berparameter → 7.000 parameter per statement, jauh di bawah
 * batas 65.535 parameter Postgres, bahkan untuk laporan 20.000 testcase.
 */
const CHUNK_SIZE = 1000;

export interface Totals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

/** Total run dari hasil yang sudah digabung (satu hasil per test). */
export function computeTotals(results: readonly ParsedResult[]): Totals {
  const totals: Totals = { total: results.length, passed: 0, failed: 0, skipped: 0, flaky: 0 };
  for (const result of results) {
    totals[result.status] += 1;
    if (result.flakyInRun) totals.flaky += 1;
  }
  return totals;
}

const identityKey = (test: { suite: string; name: string }) => `${test.suite}\u0000${test.name}`;

function compareIdentity(a: ParsedResult, b: ParsedResult): number {
  if (a.suite !== b.suite) return a.suite < b.suite ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return 0;
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Menyimpan satu run beserta hasilnya dalam satu transaksi:
 * 1. insert `runs` (dengan total);
 * 2. per potongan: upsert `test_cases` (`ON CONFLICT DO NOTHING`, lalu select id) dan insert `test_results`;
 * 3. hapus run di luar RUN_RETENTION terbaru project ini (cascade ke `test_results`);
 * 4. catat pemakaian token (`last_used_at`), agar run yang tersimpan tidak pernah diikuti kegagalan terpisah.
 *
 * Upload paralel aman: insert `test_cases` yang bentrok menunggu transaksi lain lalu tidak melakukan apa-apa, dan
 * select berikutnya (READ COMMITTED) melihat barisnya. Hasil diurutkan menurut (suite, name) agar semua transaksi
 * mengunci baris unik dalam urutan yang sama (tanpa deadlock). Sebelum retensi, baris project dikunci
 * (`FOR NO KEY UPDATE`, tidak memblokir insert anak) sehingga upload serentak menjalankan retensi bergantian dan
 * masing-masing melihat run yang sudah di-commit — tersisa tepat RUN_RETENTION run.
 */
export async function insertRun(
  db: Db,
  input: { projectId: string; tokenId: string; query: IngestQuery; report: ParsedReport },
): Promise<{ runId: string; totals: Totals }> {
  const { projectId, tokenId, query, report } = input;
  const totals = computeTotals(report.results);
  const results = [...report.results].sort(compareIdentity);

  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(runs)
      .values({
        projectId,
        branch: query.branch,
        commitSha: "commitSha" in query ? query.commitSha : null,
        ciUrl: query.ciUrl ?? null,
        name: query.name ?? null,
        durationMs: report.durationMs,
        ...totals,
        tokenId,
      })
      .returning({ id: runs.id });
    if (!run) throw new Error("insert run tidak mengembalikan baris");

    for (const chunk of chunked(results, CHUNK_SIZE)) {
      await tx
        .insert(testCases)
        .values(chunk.map((r) => ({ projectId, suite: r.suite, name: r.name })))
        .onConflictDoNothing({ target: [testCases.projectId, testCases.suite, testCases.name] });

      const identities = sql.join(
        chunk.map((r) => sql`(${r.suite}, ${r.name})`),
        sql`, `,
      );
      const rows = await tx
        .select({ id: testCases.id, suite: testCases.suite, name: testCases.name })
        .from(testCases)
        .where(and(eq(testCases.projectId, projectId), sql`(${testCases.suite}, ${testCases.name}) in (${identities})`));
      const ids = new Map(rows.map((row) => [identityKey(row), row.id]));

      await tx.insert(testResults).values(
        chunk.map((r) => {
          const testCaseId = ids.get(identityKey(r));
          if (!testCaseId) throw new Error("test_case hilang setelah upsert");
          return {
            runId: run.id,
            testCaseId,
            status: r.status,
            flakyInRun: r.flakyInRun,
            retries: r.retries,
            durationMs: r.durationMs,
            message: r.message,
          };
        }),
      );
    }

    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("no key update");
    const beyondRetention = tx
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.projectId, projectId))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .offset(RUN_RETENTION);
    await tx.delete(runs).where(inArray(runs.id, beyondRetention));

    await touchToken(tx, tokenId);

    return { runId: run.id, totals };
  });
}
