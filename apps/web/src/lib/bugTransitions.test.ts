import { BUG_STATUSES, type BugStatus } from "@testpulse/shared";
import { describe, expect, it } from "vitest";
import { describeTestHint, transitionsFor } from "./bugTransitions";

// Cermin spec Tahap 3 §3.2: tabel transisi yang diizinkan server.
const ALLOWED: Record<BugStatus, BugStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["open", "resolved", "closed"],
  resolved: ["closed", "open"],
  closed: ["open"],
};

describe("transitionsFor", () => {
  it.each(BUG_STATUSES)("dari %s hanya menawarkan transisi yang diizinkan", (from) => {
    expect(transitionsFor(from).map((t) => t.to)).toEqual(expect.arrayContaining(ALLOWED[from]));
    expect(transitionsFor(from)).toHaveLength(ALLOWED[from].length);
  });

  it("memakai label Indonesia", () => {
    const labels = (from: BugStatus) => Object.fromEntries(transitionsFor(from).map((t) => [t.to, t.label]));
    expect(labels("open")).toEqual({ in_progress: "Mulai kerjakan", resolved: "Tandai selesai", closed: "Tutup" });
    expect(labels("in_progress").open).toBe("Kembalikan ke Open");
    expect(labels("resolved")).toEqual({ closed: "Tutup", open: "Buka ulang" });
    expect(labels("closed")).toEqual({ open: "Buka ulang" });
  });

  it("resolusi wajib hanya saat masuk resolved/closed dari open/in_progress", () => {
    const needs = (from: BugStatus) => transitionsFor(from).filter((t) => t.needsResolution).map((t) => t.to);
    expect(needs("open")).toEqual(["resolved", "closed"]);
    expect(needs("in_progress")).toEqual(["resolved", "closed"]);
    expect(needs("resolved")).toEqual([]);
    expect(needs("closed")).toEqual([]);
  });
});

describe("describeTestHint", () => {
  const hint = (lastStatus: "passed" | "failed" | "skipped" | null, consecutivePasses: number, branch: string | null = "main") => ({
    branch,
    results: lastStatus ? [{ runId: "r", createdAt: "2026-11-05T00:00:00Z", status: lastStatus }] : [],
    consecutivePasses,
    lastStatus,
  });

  it("gagal di run terakhir", () => {
    expect(describeTestHint(hint("failed", 0))).toBe("Masih gagal di run terakhir di main");
  });

  it("lulus berturut-turut", () => {
    expect(describeTestHint(hint("passed", 5))).toBe("Lulus 5 run terakhir berturut-turut di main");
    expect(describeTestHint(hint("passed", 1))).toBe("Lulus di run terakhir di main");
  });

  it("dilewati dan tanpa hasil", () => {
    expect(describeTestHint(hint("skipped", 0))).toBe("Dilewati di run terakhir di main");
    expect(describeTestHint(hint(null, 0, null))).toBe("Belum ada hasil untuk test ini");
  });

  it("tanpa branch kalimat tetap utuh", () => {
    expect(describeTestHint(hint("failed", 0, null))).toBe("Masih gagal di run terakhir");
  });
});
