import type { CrowdReportStatus } from "@testpulse/shared";

// Spec Tahap 5 §5.2–§5.3: transisi laporan crowd dan validasi duplikat.

export type ReportDecision = "accept" | "reject" | "duplicate" | "reopen" | "withdraw";

const NEXT: Readonly<Record<string, CrowdReportStatus>> = {
  "submitted>accept": "accepted",
  "submitted>reject": "rejected",
  "submitted>duplicate": "duplicate",
  "submitted>withdraw": "withdrawn",
  "rejected>reopen": "submitted",
  "duplicate>reopen": "submitted",
};

/** Status laporan setelah keputusan, atau `null` bila keputusan itu tidak sah dari status `from`. */
export function reportTransition(from: CrowdReportStatus, decision: ReportDecision): CrowdReportStatus | null {
  return NEXT[`${from}>${decision}`] ?? null;
}

interface ReportRef {
  id: string;
  cycleId: string;
  number: number;
  submittedAt: Date;
}

/**
 * Mengapa `target` tidak boleh menjadi laporan asli dari `report` yang ditandai duplikat, atau `null` bila sah:
 * target harus di cycle yang sama, bukan laporan itu sendiri, dikirim lebih dulu (`submittedAt`, lalu nomor bila
 * waktunya sama), dan masih `submitted` atau sudah `accepted`.
 */
export function duplicateTargetError(
  report: ReportRef,
  target: ReportRef & { status: CrowdReportStatus },
): null | "other_cycle" | "not_earlier" | "self" | "bad_status" {
  if (target.id === report.id) return "self";
  if (target.cycleId !== report.cycleId) return "other_cycle";
  const targetTime = target.submittedAt.getTime();
  const reportTime = report.submittedAt.getTime();
  const earlier = targetTime < reportTime || (targetTime === reportTime && target.number < report.number);
  if (!earlier) return "not_earlier";
  if (target.status !== "submitted" && target.status !== "accepted") return "bad_status";
  return null;
}
