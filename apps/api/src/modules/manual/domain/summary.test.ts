import { describe, expect, it } from "vitest";
import { summarize } from "./summary.js";

describe("summarize", () => {
  it("menghitung total dan progres", () => {
    expect(summarize({ untested: 2, passed: 5, failed: 1, blocked: 1, skipped: 1 })).toEqual({
      counts: { untested: 2, passed: 5, failed: 1, blocked: 1, skipped: 1 },
      total: 10,
      progress: 0.8,
    });
  });

  it("status yang tidak ada dihitung 0", () => {
    expect(summarize({ passed: 3, untested: 1 })).toEqual({
      counts: { untested: 1, passed: 3, failed: 0, blocked: 0, skipped: 0 },
      total: 4,
      progress: 0.75,
    });
  });

  it("run baru: semua belum diuji → progres 0", () => {
    const result = summarize({ untested: 12 });
    expect(result.total).toBe(12);
    expect(result.progress).toBe(0);
  });

  it("semua selesai → progres 1", () => {
    expect(summarize({ passed: 2, failed: 1 }).progress).toBe(1);
  });

  it("total 0 → progres 0 (bukan NaN)", () => {
    expect(summarize({})).toEqual({
      counts: { untested: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 },
      total: 0,
      progress: 0,
    });
  });
});
