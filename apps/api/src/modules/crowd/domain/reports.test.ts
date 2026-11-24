import { describe, expect, it } from "vitest";
import { CROWD_REPORT_STATUSES } from "@testpulse/shared";
import { duplicateTargetError, reportTransition, type ReportDecision } from "./reports.js";

describe("reportTransition", () => {
  // Spec §5.2.
  const table: Record<string, string | null> = {
    "submitted>accept": "accepted",
    "submitted>reject": "rejected",
    "submitted>duplicate": "duplicate",
    "submitted>withdraw": "withdrawn",
    "rejected>reopen": "submitted",
    "duplicate>reopen": "submitted",
  };
  const decisions: ReportDecision[] = ["accept", "reject", "duplicate", "reopen", "withdraw"];

  for (const from of CROWD_REPORT_STATUSES) {
    for (const decision of decisions) {
      const expected = table[`${from}>${decision}`] ?? null;
      it(`${from} + ${decision} → ${expected}`, () => {
        expect(reportTransition(from, decision)).toBe(expected);
      });
    }
  }
});

describe("duplicateTargetError", () => {
  const report = { id: "r5", cycleId: "c1", number: 5, submittedAt: new Date("2026-11-16T10:00:00Z") };
  const target = (over: Partial<{ id: string; cycleId: string; number: number; submittedAt: Date; status: string }>) => ({
    id: "r3",
    cycleId: "c1",
    number: 3,
    submittedAt: new Date("2026-11-16T09:00:00Z"),
    status: "submitted" as const,
    ...over,
  });

  it("target sah: cycle sama, lebih dulu, submitted atau accepted", () => {
    expect(duplicateTargetError(report, target({}))).toBeNull();
    expect(duplicateTargetError(report, target({ status: "accepted" as never }))).toBeNull();
  });

  it("cycle lain → other_cycle", () => {
    expect(duplicateTargetError(report, target({ cycleId: "c2" }))).toBe("other_cycle");
  });

  it("dirinya sendiri → self", () => {
    expect(duplicateTargetError(report, target({ id: "r5", number: 5, submittedAt: report.submittedAt }))).toBe("self");
  });

  it("dikirim lebih baru → not_earlier", () => {
    expect(duplicateTargetError(report, target({ number: 7, submittedAt: new Date("2026-11-16T11:00:00Z") }))).toBe("not_earlier");
  });

  it("waktu sama: nomor yang lebih kecil dianggap lebih dulu", () => {
    const same = report.submittedAt;
    expect(duplicateTargetError(report, target({ number: 4, submittedAt: same }))).toBeNull();
    expect(duplicateTargetError(report, target({ number: 6, submittedAt: same }))).toBe("not_earlier");
  });

  it.each(["withdrawn", "rejected", "duplicate"])("status %s → bad_status", (status) => {
    expect(duplicateTargetError(report, target({ status: status as never }))).toBe("bad_status");
  });
});
