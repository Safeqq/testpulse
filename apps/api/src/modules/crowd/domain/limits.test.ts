import { describe, expect, it } from "vitest";
import { submissionLimit } from "./limits.js";

describe("submissionLimit", () => {
  const ok = { submittedInCycle: 0, totalInCycle: 0, last24h: 0 };

  it("di bawah semua batas → null", () => {
    expect(submissionLimit({ submittedInCycle: 9, totalInCycle: 49, last24h: 29 })).toBeNull();
  });

  it.each([
    [{ ...ok, submittedInCycle: 10 }, "submitted"],
    [{ ...ok, submittedInCycle: 11 }, "submitted"],
    [{ ...ok, totalInCycle: 50 }, "total"],
    [{ ...ok, totalInCycle: 51 }, "total"],
    [{ ...ok, last24h: 30 }, "daily"],
    [{ ...ok, last24h: 31 }, "daily"],
  ])("%j → %s", (counts, expected) => {
    expect(submissionLimit(counts)).toBe(expected);
  });

  it("prioritas pelanggaran: submitted > total > daily", () => {
    expect(submissionLimit({ submittedInCycle: 10, totalInCycle: 50, last24h: 30 })).toBe("submitted");
    expect(submissionLimit({ submittedInCycle: 0, totalInCycle: 50, last24h: 30 })).toBe("total");
  });
});
