import type { ManualResultStatus, StepResult } from "./schemas/manual.js";

// Logika murni test manual yang dipakai bersama API dan web (spec Tahap 4 §4.3 dan §5.2).

/**
 * Saran status case dari hasil per langkah (spec §4.3). Hanya saran: UI menampilkannya, server tidak menyimpannya
 * otomatis. Urutan aturan penting: gagal mengalahkan diblokir, dan keduanya berlaku walau ada langkah yang belum diisi.
 */
export function suggestStatus(results: readonly StepResult[]): ManualResultStatus | null {
  if (results.length === 0) return null;
  if (results.some((r) => r.status === "failed")) return "failed";
  if (results.some((r) => r.status === "blocked")) return "blocked";
  if (results.some((r) => r.status === null)) return null;
  if (results.every((r) => r.status === "skipped")) return "skipped";
  // Tersisa: semua terisi dan hanya passed/skipped, dengan minimal satu passed.
  return "passed";
}

/** Persentase cakupan otomasi, dibulatkan ke bawah (39/40 → 97). Tanpa case aktif → `null` (bukan 0%). */
export function coveragePercent(active: number, automated: number): number | null {
  if (active === 0) return null;
  return Math.floor((automated * 100) / active);
}
