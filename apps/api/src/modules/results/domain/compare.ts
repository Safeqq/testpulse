import type { CompareGroup, ResultStatus } from "@testpulse/shared";

// Spec Tahap 3 §4.4. "Lebih lambat": durasi target > 1,5 x base DAN selisih > 1000 ms (kedua batas eksklusif).
export const SLOWER_RATIO = 1.5;
export const SLOWER_MIN_DELTA_MS = 1000;

/** Hasil satu test di salah satu sisi. `passed` mencakup lulus-setelah-retry (`flakyInRun`). */
export type CompareSide = {
  testCaseId: string;
  status: ResultStatus;
  durationMs: number;
  flakyInRun: boolean;
};

/** Satu test yang dicocokkan lewat `testCaseId`; sisi yang tidak ada bernilai `null`. */
export type CompareMatch = {
  testCaseId: string;
  base: CompareSide | null;
  target: CompareSide | null;
};

/**
 * Mengelompokkan test base vs target. Urutan di tiap kelompok mengikuti input: urutan `target` untuk
 * semua kelompok kecuali `removed` (urutan `base`). Test `skipped` di salah satu sisi hanya mungkin
 * masuk `added`/`removed`, tidak pernah ke kelompok perbandingan status/durasi.
 */
export function classify(base: ReadonlyArray<CompareSide>, target: ReadonlyArray<CompareSide>): Record<CompareGroup, CompareMatch[]> {
  const groups: Record<CompareGroup, CompareMatch[]> = {
    regressions: [],
    fixed: [],
    stillFailing: [],
    slower: [],
    added: [],
    removed: [],
  };

  const baseById = new Map(base.map((s) => [s.testCaseId, s]));
  const targetIds = new Set<string>();

  for (const t of target) {
    targetIds.add(t.testCaseId);
    const b = baseById.get(t.testCaseId);
    if (!b) {
      groups.added.push({ testCaseId: t.testCaseId, base: null, target: t });
      continue;
    }
    const match: CompareMatch = { testCaseId: t.testCaseId, base: b, target: t };

    if (b.status === "passed" && t.status === "failed") groups.regressions.push(match);
    else if (b.status === "failed" && t.status === "passed") groups.fixed.push(match);
    else if (b.status === "failed" && t.status === "failed") groups.stillFailing.push(match);
    else if (b.status === "passed" && t.status === "passed" && isSlower(b.durationMs, t.durationMs)) groups.slower.push(match);
  }

  for (const b of base) {
    if (!targetIds.has(b.testCaseId)) groups.removed.push({ testCaseId: b.testCaseId, base: b, target: null });
  }
  return groups;
}

function isSlower(baseMs: number, targetMs: number): boolean {
  return targetMs > baseMs * SLOWER_RATIO && targetMs - baseMs > SLOWER_MIN_DELTA_MS;
}
