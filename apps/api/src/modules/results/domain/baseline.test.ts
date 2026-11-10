import { describe, expect, it } from "vitest";
import { pickBaseline, pickDefaultTarget, type RunRef } from "./baseline.js";

let seq = 0;
function run(id: string, version: string | null): RunRef {
  seq += 1;
  return { id, createdAt: new Date(Date.UTC(2026, 0, 1, 0, seq)), version };
}

describe("pickBaseline", () => {
  it("uses the last run of the version just below the target's version", () => {
    const a1 = run("a1", "1.0.0");
    const a2 = run("a2", "1.0.0");
    const t = run("t", "1.0.1");
    expect(pickBaseline(t, [a1, a2, t])?.id).toBe("a2");
  });

  it("skips over runs of the target's own version that sit in between", () => {
    const a = run("a", "1.0.0");
    const t1 = run("t1", "1.0.1");
    const b = run("b", "1.0.0");
    const t2 = run("t2", "1.0.1");
    expect(pickBaseline(t2, [a, t1, b, t2])?.id).toBe("b");
    expect(pickBaseline(t1, [a, t1, b, t2])?.id).toBe("b");
  });

  it("picks the version immediately below, not merely the previous run", () => {
    const v1 = run("v1", "1.0.0");
    const v2 = run("v2", "1.1.0");
    const v1b = run("v1b", "1.0.0");
    const t = run("t", "1.2.0");
    expect(pickBaseline(t, [v1, v2, v1b, t])?.id).toBe("v2");
  });

  it("treats v-prefixed and plain spellings as the same version", () => {
    const a = run("a", "v1.0.0");
    const b = run("b", "1.0.0");
    const t = run("t", "1.0.1");
    expect(pickBaseline(t, [a, b, t])?.id).toBe("b");
  });

  it("falls back to the run just before the target when the target has no version", () => {
    const a = run("a", "1.0.0");
    const b = run("b", null);
    const t = run("t", null);
    expect(pickBaseline(t, [a, b, t])?.id).toBe("b");
  });

  it("falls back to the run just before the target when its version is the lowest", () => {
    const first = run("first", "1.0.0");
    const other = run("other", null);
    const t = run("t", "1.0.0");
    expect(pickBaseline(t, [first, other, t])?.id).toBe("other");
  });

  it("falls back to the previous run when the target's version is the lowest but another run exists", () => {
    const hi = run("hi", "2.0.0");
    const t = run("t", "1.0.0");
    expect(pickBaseline(t, [hi, t])?.id).toBe("hi");
  });

  it("ignores unversioned runs when ordering versions", () => {
    const a = run("a", "1.0.0");
    const u = run("u", null);
    const t = run("t", "1.0.1");
    expect(pickBaseline(t, [a, u, t])?.id).toBe("a");
  });

  it("still applies the version rule when the target is absent from branchRuns", () => {
    const a = run("a", "1.0.0");
    const b = run("b", "1.1.0");
    const t = run("t", "1.1.0");
    expect(pickBaseline(t, [a, b])?.id).toBe("a");
  });

  it("returns null when the target is the only run", () => {
    const t = run("t", "1.0.0");
    expect(pickBaseline(t, [t])).toBeNull();
    expect(pickBaseline(run("u", null), [])).toBeNull();
  });

  it("returns null when the target is not in the branch runs and has no usable version", () => {
    expect(pickBaseline(run("ghost", null), [run("a", null)])).toBeNull();
  });

  it("uses recency order when a non-semver version exists on the branch", () => {
    const a = run("a", "1.0.0");
    const b = run("b", "build-42");
    const t = run("t", "0.9.0");
    // recency order: 1.0.0 < build-42 < 0.9.0, so just below 0.9.0 is build-42
    expect(pickBaseline(t, [a, b, t])?.id).toBe("b");
  });
});

describe("pickDefaultTarget", () => {
  it("returns null for no runs", () => {
    expect(pickDefaultTarget([])).toBeNull();
  });

  it("returns the latest run when no run has a version", () => {
    const a = run("a", null);
    const b = run("b", null);
    const c = run("c", null);
    expect(pickDefaultTarget([a, b, c])?.id).toBe("c");
  });

  it("returns the last run of the highest version, not the latest run", () => {
    const hi1 = run("hi1", "2.0.0");
    const hi2 = run("hi2", "2.0.0");
    const hi3 = run("hi3", "2.0.0");
    const lo = run("lo", "1.9.0");
    const none = run("none", null);
    expect(pickDefaultTarget([hi1, hi2, hi3, lo, none])?.id).toBe("hi3");
  });

  it("merges semver-equal spellings when finding the highest version", () => {
    const a = run("a", "v2.0.0");
    const b = run("b", "2.0.0");
    const c = run("c", "1.0.0");
    expect(pickDefaultTarget([a, b, c])?.id).toBe("b");
  });

  it("uses the most recent versioned run when a non-semver version exists", () => {
    const a = run("a", "2.0.0");
    const b = run("b", "nightly");
    const c = run("c", "1.0.0");
    expect(pickDefaultTarget([a, b, c])?.id).toBe("c");
  });
});
