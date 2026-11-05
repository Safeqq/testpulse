import type { BugPriority, BugResolution, BugSeverity, BugStatus } from "@testpulse/shared";

/** Istilah status bug dipertahankan dalam bahasa Inggris (Open, In progress, ...) sesuai spec Tahap 3 §7.5. */
export const BUG_STATUS_LABEL: Record<BugStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const BUG_RESOLUTION_LABEL: Record<BugResolution, string> = {
  fixed: "Diperbaiki",
  wont_fix: "Tidak akan diperbaiki",
  duplicate: "Duplikat",
  cannot_reproduce: "Tidak bisa direproduksi",
};

export const BUG_PRIORITY_LABEL: Record<BugPriority, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  urgent: "Mendesak",
};

export const BUG_SEVERITY_LABEL: Record<BugSeverity, string> = {
  minor: "Minor",
  major: "Major",
  critical: "Critical",
  blocker: "Blocker",
};
