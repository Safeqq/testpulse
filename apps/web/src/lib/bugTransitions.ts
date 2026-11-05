import type { BugStatus, TestHintDto } from "@testpulse/shared";

export interface TransitionOption {
  to: BugStatus;
  label: string;
  /** Masuk resolved/closed dari open/in_progress: server mewajibkan resolusi (spec Tahap 3 §3.2), dipilih inline. */
  needsResolution: boolean;
}

const START: TransitionOption = { to: "in_progress", label: "Mulai kerjakan", needsResolution: false };
const RESOLVE: TransitionOption = { to: "resolved", label: "Tandai selesai", needsResolution: true };
const CLOSE_WITH_RESOLUTION: TransitionOption = { to: "closed", label: "Tutup", needsResolution: true };
// Resolved → closed boleh tanpa resolusi: server memakai yang sudah ada.
const CLOSE_RESOLVED: TransitionOption = { to: "closed", label: "Tutup", needsResolution: false };
const REOPEN: TransitionOption = { to: "open", label: "Buka ulang", needsResolution: false };
const BACK_TO_OPEN: TransitionOption = { to: "open", label: "Kembalikan ke Open", needsResolution: false };

/** Transisi yang diizinkan dari status ini (cermin tabel spec Tahap 3 §3.2; server tetap memutuskan). */
export function transitionsFor(status: BugStatus): TransitionOption[] {
  switch (status) {
    case "open":
      return [START, RESOLVE, CLOSE_WITH_RESOLUTION];
    case "in_progress":
      return [BACK_TO_OPEN, RESOLVE, CLOSE_WITH_RESOLUTION];
    case "resolved":
      return [CLOSE_RESOLVED, REOPEN];
    case "closed":
      return [REOPEN];
  }
}

/** Kalimat petunjuk status test asal bug (spec Tahap 3 §6.2, §7.5). Hanya informasi; tidak mengubah status bug. */
export function describeTestHint(hint: TestHintDto): string {
  const where = hint.branch ? ` di ${hint.branch}` : "";
  switch (hint.lastStatus) {
    case null:
      return "Belum ada hasil untuk test ini";
    case "failed":
      return `Masih gagal di run terakhir${where}`;
    case "skipped":
      return `Dilewati di run terakhir${where}`;
    case "passed":
      return hint.consecutivePasses > 1
        ? `Lulus ${hint.consecutivePasses} run terakhir berturut-turut${where}`
        : `Lulus di run terakhir${where}`;
  }
}
