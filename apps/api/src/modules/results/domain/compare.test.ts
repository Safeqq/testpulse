import { describe, expect, it } from "vitest";
import type { ResultStatus } from "@testpulse/shared";
import { SLOWER_MIN_DELTA_MS, SLOWER_RATIO, classify, type CompareSide } from "./compare.js";

function side(testCaseId: string, status: ResultStatus, durationMs = 100, flakyInRun = false): CompareSide {
  return { testCaseId, status, durationMs, flakyInRun };
}

const ids = (matches: ReadonlyArray<{ testCaseId: string }>) => matches.map((m) => m.testCaseId);

describe("classify", () => {
  it("exposes the spec thresholds", () => {
    expect(SLOWER_RATIO).toBe(1.5);
    expect(SLOWER_MIN_DELTA_MS).toBe(1000);
  });

  it("returns every group, empty, for empty input", () => {
    expect(classify([], [])).toEqual({ regressions: [], fixed: [], stillFailing: [], slower: [], added: [], removed: [] });
  });

  it("puts each case in its group with both sides attached", () => {
    const base = [side("reg", "passed"), side("fix", "failed"), side("still", "failed"), side("gone", "passed", 5), side("same", "passed")];
    const target = [side("reg", "failed"), side("fix", "passed"), side("still", "failed"), side("new", "failed", 7), side("same", "passed")];
    const groups = classify(base, target);

    expect(groups.regressions).toEqual([{ testCaseId: "reg", base: base[0], target: target[0] }]);
    expect(groups.fixed).toEqual([{ testCaseId: "fix", base: base[1], target: target[1] }]);
    expect(groups.stillFailing).toEqual([{ testCaseId: "still", base: base[2], target: target[2] }]);
    expect(groups.added).toEqual([{ testCaseId: "new", base: null, target: target[3] }]);
    expect(groups.removed).toEqual([{ testCaseId: "gone", base: base[3], target: null }]);
    expect(groups.slower).toEqual([]);
  });

  it("does not report unchanged passing tests anywhere", () => {
    const groups = classify([side("a", "passed")], [side("a", "passed")]);
    expect(Object.values(groups).flat()).toEqual([]);
  });

  it.each([
    ["passed", "skipped"],
    ["skipped", "passed"],
    ["failed", "skipped"],
    ["skipped", "failed"],
    ["skipped", "skipped"],
  ] as const)("keeps base %s / target %s out of regressions, fixed, stillFailing and slower", (b, t) => {
    const groups = classify([side("a", b, 100)], [side("a", t, 99999)]);
    expect(groups.regressions).toEqual([]);
    expect(groups.fixed).toEqual([]);
    expect(groups.stillFailing).toEqual([]);
    expect(groups.slower).toEqual([]);
    expect(groups.added).toEqual([]);
    expect(groups.removed).toEqual([]);
  });

  it("still lists skipped tests as added/removed when present on one side only", () => {
    const groups = classify([side("gone", "skipped")], [side("new", "skipped")]);
    expect(ids(groups.added)).toEqual(["new"]);
    expect(ids(groups.removed)).toEqual(["gone"]);
  });

  it("treats pass-after-retry as passed and forwards the flaky flag", () => {
    const groups = classify([side("a", "failed"), side("b", "passed")], [side("a", "passed", 100, true), side("b", "failed")]);
    expect(groups.fixed[0]?.target?.flakyInRun).toBe(true);
    expect(ids(groups.regressions)).toEqual(["b"]);
  });

  describe("slower threshold", () => {
    const slower = (baseMs: number, targetMs: number) => ids(classify([side("a", "passed", baseMs)], [side("a", "passed", targetMs)]).slower);

    it("1000 -> 1500 ms is not slower (ratio 1.5, delta 500)", () => expect(slower(1000, 1500)).toEqual([]));
    it("2000 -> 3001 ms is slower (ratio 1.5005, delta 1001)", () => expect(slower(2000, 3001)).toEqual(["a"]));
    it("2000 -> 3000 ms is not slower (ratio exactly 1.5)", () => expect(slower(2000, 3000)).toEqual([]));
    it("4000 -> 6000 ms is not slower (ratio exactly 1.5 although delta 2000)", () => expect(slower(4000, 6000)).toEqual([]));
    it("10000 -> 12000 ms is not slower (delta 2000 but ratio only 1.2)", () => expect(slower(10000, 12000)).toEqual([]));
    it("100 -> 1200 ms is slower (delta 1100, ratio 12)", () => expect(slower(100, 1200)).toEqual(["a"]));
    it("100 -> 1100 ms is not slower (delta exactly 1000)", () => expect(slower(100, 1100)).toEqual([]));
    it("faster is never slower", () => expect(slower(5000, 100)).toEqual([]));
    it("a zero-duration base can be slower past the delta", () => expect(slower(0, 1001)).toEqual(["a"]));
  });

  it("does not report slower when either side did not pass", () => {
    const groups = classify([side("a", "passed", 100), side("b", "failed", 100)], [side("a", "failed", 9000), side("b", "failed", 9000)]);
    expect(groups.slower).toEqual([]);
  });

  it("preserves input order: target order, then base order for removed", () => {
    const groups = classify(
      [side("r2", "passed"), side("r1", "passed"), side("x", "passed"), side("y", "passed")],
      [side("r1", "failed"), side("r2", "failed"), side("n2", "passed"), side("n1", "passed")],
    );
    expect(ids(groups.regressions)).toEqual(["r1", "r2"]);
    expect(ids(groups.added)).toEqual(["n2", "n1"]);
    expect(ids(groups.removed)).toEqual(["x", "y"]);
  });
});
