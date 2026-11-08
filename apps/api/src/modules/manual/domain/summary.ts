import type { ManualCountsDto } from "@testpulse/shared";

/** Ringkasan run (spec §4.5): `progress = (total − untested) / total`, 0 untuk run kosong. */
export function summarize(counts: Partial<ManualCountsDto>): { counts: ManualCountsDto; total: number; progress: number } {
  const full: ManualCountsDto = {
    untested: counts.untested ?? 0,
    passed: counts.passed ?? 0,
    failed: counts.failed ?? 0,
    blocked: counts.blocked ?? 0,
    skipped: counts.skipped ?? 0,
  };
  const total = full.untested + full.passed + full.failed + full.blocked + full.skipped;
  return { counts: full, total, progress: total === 0 ? 0 : (total - full.untested) / total };
}
