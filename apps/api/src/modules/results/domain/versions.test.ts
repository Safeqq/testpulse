import { describe, expect, it } from "vitest";
import { compareSemver, groupRunsByVersion, isAllSemver, orderVersions, parseSemver, sameVersion } from "./versions.js";

function cmp(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`not semver: ${a} / ${b}`);
  return Math.sign(compareSemver(pa, pb));
}

describe("parseSemver", () => {
  it.each(["1.0.0", "v1.2.3", "V1.2.3", "1.0.0-beta", "1.0.0-alpha.1", "1.0.0+build.5", "1.0.0-rc.1+sha-abc", "1.0.0-0", "1.0.0+001", "0.0.0", "10.20.30"])(
    "accepts %s",
    (v) => {
      expect(parseSemver(v)).not.toBeNull();
    },
  );

  it.each([
    "",
    "1",
    "1.0",
    "1.0.0.0",
    "build-42",
    "01.0.0",
    "1.02.0",
    "1.0.0-",
    "1.0.0-01",
    "1.0.0-a..b",
    "1.0.0+",
    "1.0.0+a+b",
    "1.0.0+a..b",
    "vv1.0.0",
    "1.0.x",
    "1.0.0_beta",
    "-1.0.0",
  ])("rejects %j", (v) => {
    expect(parseSemver(v)).toBeNull();
  });

  it("parses the parts", () => {
    expect(parseSemver("v1.2.3-rc.1+meta")).toEqual({ major: "1", minor: "2", patch: "3", prerelease: ["rc", "1"] });
    expect(parseSemver("1.2.3")).toEqual({ major: "1", minor: "2", patch: "3", prerelease: [] });
  });

  it("handles a hyphenated build/prerelease boundary", () => {
    expect(parseSemver("1.0.0-a-b+c-d")?.prerelease).toEqual(["a-b"]);
  });

  it("rejects pathological input", () => {
    expect(parseSemver(`1.0.0-${"a.".repeat(25)}!`)).toBeNull();
  });
});

describe("compareSemver", () => {
  it("compares numerically, not lexically", () => {
    expect(cmp("1.0.10", "1.0.9")).toBe(1);
    expect(cmp("1.10.0", "1.9.0")).toBe(1);
    expect(cmp("2.0.0", "10.0.0")).toBe(-1);
  });

  it("compares very large numbers exactly", () => {
    expect(cmp("1.0.123456789012345678901", "1.0.123456789012345678902")).toBe(-1);
  });

  it("ranks a pre-release below its release", () => {
    expect(cmp("1.0.0-beta", "1.0.0")).toBe(-1);
    expect(cmp("1.0.0", "1.0.0-beta")).toBe(1);
  });

  it("orders numeric pre-release identifiers numerically", () => {
    expect(cmp("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(-1);
  });

  it("ranks a shorter pre-release below a longer one with the same prefix", () => {
    expect(cmp("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
  });

  it("ranks numeric identifiers below alphanumeric ones", () => {
    expect(cmp("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(cmp("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1);
  });

  it("compares alphanumeric identifiers in ASCII order", () => {
    expect(cmp("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(cmp("1.0.0-Beta", "1.0.0-alpha")).toBe(-1);
  });

  it("follows the semver 2.0 precedence example chain", () => {
    const chain = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
    for (let i = 1; i < chain.length; i += 1) expect(cmp(chain[i - 1]!, chain[i]!)).toBe(-1);
  });

  it("ignores the v prefix and build metadata", () => {
    expect(cmp("v1.2.3", "1.2.3")).toBe(0);
    expect(cmp("1.0.0+a", "1.0.0+b")).toBe(0);
  });

  it("returns 0 for identical versions", () => {
    expect(cmp("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
  });
});

describe("sameVersion", () => {
  it("treats semver-equal strings as the same when all versions are semver", () => {
    expect(sameVersion("v1.0.1", "1.0.1", true)).toBe(true);
    expect(sameVersion("1.0.0+a", "1.0.0+b", true)).toBe(true);
    expect(sameVersion("1.0.0", "1.0.1", true)).toBe(false);
  });

  it("requires identical raw strings when not all versions are semver", () => {
    expect(sameVersion("v1.0.1", "1.0.1", false)).toBe(false);
    expect(sameVersion("build-42", "build-42", false)).toBe(true);
    expect(sameVersion("build-42", "build-43", true)).toBe(false);
  });
});

describe("isAllSemver", () => {
  it("is true only when every version parses", () => {
    expect(isAllSemver(["1.0.0", "v2.0.0"])).toBe(true);
    expect(isAllSemver(["1.0.0", "build-42"])).toBe(false);
    expect(isAllSemver([])).toBe(true);
  });
});

describe("orderVersions", () => {
  const at = (iso: string) => new Date(iso);

  it("returns an empty list for no entries", () => {
    expect(orderVersions([])).toEqual([]);
  });

  it("orders semver ascending regardless of run time", () => {
    expect(
      orderVersions([
        { version: "1.0.10", latestRunAt: at("2026-01-01T00:00:00Z") },
        { version: "1.0.9", latestRunAt: at("2026-03-01T00:00:00Z") },
        { version: "1.0.0-beta", latestRunAt: at("2026-02-01T00:00:00Z") },
        { version: "1.0.0", latestRunAt: at("2026-04-01T00:00:00Z") },
      ]),
    ).toEqual(["1.0.0-beta", "1.0.0", "1.0.9", "1.0.10"]);
  });

  it("orders everything by latestRunAt when any version is not semver", () => {
    expect(
      orderVersions([
        { version: "build-42", latestRunAt: at("2026-01-01T00:00:00Z") },
        { version: "1.0.0", latestRunAt: at("2026-02-01T00:00:00Z") },
        { version: "0.9.0", latestRunAt: at("2026-03-01T00:00:00Z") },
      ]),
    ).toEqual(["build-42", "1.0.0", "0.9.0"]);
  });

  it("does not merge different spellings when any version is not semver", () => {
    expect(
      orderVersions([
        { version: "v1.0.1", latestRunAt: at("2026-01-01T00:00:00Z") },
        { version: "1.0.1", latestRunAt: at("2026-02-01T00:00:00Z") },
        { version: "nightly", latestRunAt: at("2026-03-01T00:00:00Z") },
      ]),
    ).toEqual(["v1.0.1", "1.0.1", "nightly"]);
  });

  it("merges semver-equal versions into one entry labelled with the most recent run's string", () => {
    expect(
      orderVersions([
        { version: "v1.0.1", latestRunAt: at("2026-01-01T00:00:00Z") },
        { version: "1.0.1", latestRunAt: at("2026-02-01T00:00:00Z") },
        { version: "1.0.0", latestRunAt: at("2026-03-01T00:00:00Z") },
      ]),
    ).toEqual(["1.0.0", "1.0.1"]);

    expect(
      orderVersions([
        { version: "1.0.1", latestRunAt: at("2026-01-01T00:00:00Z") },
        { version: "v1.0.1", latestRunAt: at("2026-02-01T00:00:00Z") },
      ]),
    ).toEqual(["v1.0.1"]);
  });

  it("merges +build variants", () => {
    expect(
      orderVersions([
        { version: "1.0.0+a", latestRunAt: at("2026-02-01T00:00:00Z") },
        { version: "1.0.0+b", latestRunAt: at("2026-01-01T00:00:00Z") },
      ]),
    ).toEqual(["1.0.0+a"]);
  });

  it("is independent of input order on timestamp ties", () => {
    const t = at("2026-01-01T00:00:00Z");
    const a = orderVersions([
      { version: "1.0.1", latestRunAt: t },
      { version: "v1.0.1", latestRunAt: t },
    ]);
    const b = orderVersions([
      { version: "v1.0.1", latestRunAt: t },
      { version: "1.0.1", latestRunAt: t },
    ]);
    expect(a).toEqual(b);
  });

  it("collapses identical raw strings in non-semver mode and orders ties by string", () => {
    const t = at("2026-01-01T00:00:00Z");
    expect(
      orderVersions([
        { version: "beta", latestRunAt: t },
        { version: "alpha", latestRunAt: t },
        { version: "alpha", latestRunAt: at("2025-12-01T00:00:00Z") },
      ]),
    ).toEqual(["alpha", "beta"]);
  });
});

describe("groupRunsByVersion", () => {
  let minute = 0;
  const run = (id: string, version: string | null) => {
    minute += 1;
    return { id, version, createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)) };
  };

  it("groups versioned runs lowest -> highest, merging semver-equal spellings, runs kept oldest -> newest", () => {
    const a = run("a", "1.10.0");
    const b = run("b", "v1.0.1");
    const u = run("u", null);
    const c = run("c", "1.0.1");
    const d = run("d", "1.2.0");
    const { groups, allSemver } = groupRunsByVersion([a, b, u, c, d]);
    expect(allSemver).toBe(true);
    expect(groups.map((g) => [g.version, g.runs.map((r) => r.id)])).toEqual([
      ["1.0.1", ["b", "c"]],
      ["1.2.0", ["d"]],
      ["1.10.0", ["a"]],
    ]);
  });

  it("orders by latest run time and only merges identical strings when a non-semver version exists", () => {
    const a = run("a", "nightly");
    const b = run("b", "1.0.0");
    const c = run("c", "v1.0.0");
    const d = run("d", "nightly");
    const { groups, allSemver } = groupRunsByVersion([a, b, c, d]);
    expect(allSemver).toBe(false);
    expect(groups.map((g) => [g.version, g.runs.map((r) => r.id)])).toEqual([
      ["1.0.0", ["b"]],
      ["v1.0.0", ["c"]],
      ["nightly", ["a", "d"]],
    ]);
  });

  it("returns no groups when no run has a version", () => {
    expect(groupRunsByVersion([run("a", null)])).toEqual({ groups: [], allSemver: true });
  });
});
