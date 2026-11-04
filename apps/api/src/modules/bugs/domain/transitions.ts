import type { BugResolution, BugStatus } from "@testpulse/shared";

// Spec Tahap 3 §3.2.
const ALLOWED: Record<BugStatus, ReadonlyArray<BugStatus>> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["open", "resolved", "closed"],
  resolved: ["closed", "open"],
  closed: ["open"],
};

export function canTransition(from: BugStatus, to: BugStatus): boolean {
  return ALLOWED[from].includes(to);
}

export type StatusChangeError = { error: "INVALID_TRANSITION" } | { error: "RESOLUTION_REQUIRED" };

/** Kolom yang harus ditulis; `resolvedAt`/`closedAt` hanya ada bila nilainya berubah (`null` = dikosongkan). */
export type StatusChangeResult = {
  status: BugStatus;
  resolution: BugResolution | null;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
};

export function applyStatusChange(
  current: { status: BugStatus; resolution: BugResolution | null },
  change: { status: BugStatus; resolution?: BugResolution | null },
  now: Date,
): StatusChangeResult | StatusChangeError {
  const { status: from } = current;
  const { status: to } = change;
  if (!canTransition(from, to)) return { error: "INVALID_TRANSITION" };

  if (to === "open") {
    // Buka ulang: resolusi dan tanggalnya dikosongkan. Dari `resolved` hanya resolvedAt yang pernah terisi.
    return from === "closed"
      ? { status: to, resolution: null, resolvedAt: null, closedAt: null }
      : from === "resolved"
        ? { status: to, resolution: null, resolvedAt: null }
        : { status: to, resolution: null };
  }

  if (to === "in_progress") return { status: to, resolution: null };

  // resolved / closed: dari resolved -> closed resolusi lama boleh dipakai; selain itu wajib diberikan.
  const resolution = change.resolution ?? (from === "resolved" ? current.resolution : null);
  if (!resolution) return { error: "RESOLUTION_REQUIRED" };

  return to === "resolved" ? { status: to, resolution, resolvedAt: now } : { status: to, resolution, closedAt: now };
}
