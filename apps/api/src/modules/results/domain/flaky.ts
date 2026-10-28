import type { ResultStatus } from "@testpulse/shared";

/** Jumlah run terakhir per branch yang dipakai untuk menghitung skor (spec §6). */
export const FLAKY_WINDOW = 20;

/**
 * Skor flaky 0-100 untuk satu test pada satu branch. `results` berurutan dari lama ke baru
 * dan sudah dibatasi ke `FLAKY_WINDOW` run terakhir oleh pemanggil. Hasil `skipped` diabaikan.
 */
export function flakyScore(results: ReadonlyArray<{ status: ResultStatus; flakyInRun: boolean }>): number {
  const executed = results.filter((r) => r.status !== "skipped");
  if (executed.length === 0) return 0;

  let flips = 0;
  let flakyRuns = 0;
  executed.forEach((r, i) => {
    if (r.flakyInRun) flakyRuns += 1;
    const previous = executed[i - 1];
    if (previous && previous.status !== r.status) flips += 1;
  });

  return Math.min(100, Math.round((100 * (flips + flakyRuns)) / executed.length));
}
