import { MAX_REPORTS_PER_CYCLE, MAX_REPORTS_PER_DAY, MAX_SUBMITTED_PER_CYCLE } from "@testpulse/shared";

// Spec Tahap 5 §5.5: batas anti-spam per tester.

export type SubmissionLimit = "submitted" | "total" | "daily";

/**
 * Batas yang akan terlampaui bila tester mengirim satu laporan lagi, atau `null`. `totalInCycle` termasuk laporan
 * yang ditarik; `last24h` dihitung di semua cycle. Bila beberapa batas tercapai, yang paling spesifik dilaporkan.
 */
export function submissionLimit(counts: {
  submittedInCycle: number;
  totalInCycle: number;
  last24h: number;
}): SubmissionLimit | null {
  if (counts.submittedInCycle >= MAX_SUBMITTED_PER_CYCLE) return "submitted";
  if (counts.totalInCycle >= MAX_REPORTS_PER_CYCLE) return "total";
  if (counts.last24h >= MAX_REPORTS_PER_DAY) return "daily";
  return null;
}
