import type { StepResult } from "@testpulse/shared";

/** Hasil awal run case: satu elemen belum terisi per langkah snapshot. */
export function emptyStepResults(stepCount: number): StepResult[] {
  return Array.from({ length: stepCount }, () => ({ status: null, note: "" }));
}

/** `stepResults` harus sepanjang langkah snapshot (spec §4.3); isi tiap elemen divalidasi schema shared. */
export function stepResultsMatch(results: readonly unknown[], stepCount: number): boolean {
  return results.length === stepCount;
}
