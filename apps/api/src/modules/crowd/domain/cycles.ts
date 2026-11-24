import type { CycleStatus } from "@testpulse/shared";

// Spec Tahap 5 §3.2: status cycle.

const ALLOWED = new Set<string>(["draft>open", "open>closed", "closed>open"]);

/**
 * Apakah status cycle boleh berubah dari `from` ke `to`. Status yang sama adalah `noop`. Membuka cycle (`→ open`)
 * ditolak dengan `ends_at_passed` bila `endsAt` sudah lewat (termasuk tepat sekarang): batas akhirnya harus diganti
 * dulu, kalau tidak cycle langsung selesai lagi.
 */
export function cycleTransition(
  from: CycleStatus,
  to: CycleStatus,
  ctx: { endsAt: Date | null; now: Date },
): "ok" | "noop" | "invalid" | "ends_at_passed" {
  if (from === to) return "noop";
  if (!ALLOWED.has(`${from}>${to}`)) return "invalid";
  if (to === "open" && ctx.endsAt !== null && ctx.endsAt.getTime() <= ctx.now.getTime()) return "ends_at_passed";
  return "ok";
}

/** Status yang berlaku: `open` dengan `endsAt ≤ sekarang` dianggap selesai (`closed`). */
export function effectiveCycleStatus(cycle: { status: CycleStatus; endsAt: Date | null }, now: Date): CycleStatus {
  if (cycle.status === "open" && cycle.endsAt !== null && cycle.endsAt.getTime() <= now.getTime()) return "closed";
  return cycle.status;
}
