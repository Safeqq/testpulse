import { describe, expect, it } from "vitest";
import { mergeManualVersions } from "./versions.js";

const at = (day: number) => new Date(Date.UTC(2026, 10, day));
const manual = (appVersion: string, day: number) => ({ appVersion, latestAt: at(day) });
const labels = (rows: Array<{ version: string }>) => rows.map((r) => r.version);

describe("mergeManualVersions", () => {
  it("v0.4.0 manual cocok dengan 0.4.0 automated (satu baris)", () => {
    const { rows, matchOf } = mergeManualVersions({
      automated: ["0.3.0", "0.4.0"],
      manual: [manual("v0.4.0", 5)],
    });
    expect(rows).toEqual([
      { version: "0.3.0", automated: true },
      { version: "0.4.0", automated: true },
    ]);
    expect(matchOf("v0.4.0")).toBe("0.4.0");
  });

  it("0.4.0 manual cocok dengan v0.4.0 automated; +build diabaikan", () => {
    const { rows, matchOf } = mergeManualVersions({
      automated: ["v0.4.0"],
      manual: [manual("0.4.0+build.7", 5)],
    });
    expect(rows).toEqual([{ version: "v0.4.0", automated: true }]);
    expect(matchOf("0.4.0+build.7")).toBe("v0.4.0");
  });

  it("semver manual-saja disisipkan di posisi semver-nya", () => {
    const { rows, matchOf } = mergeManualVersions({
      automated: ["0.3.0", "0.4.0"],
      manual: [manual("0.3.5", 5)],
    });
    expect(rows).toEqual([
      { version: "0.3.0", automated: true },
      { version: "0.3.5", automated: false },
      { version: "0.4.0", automated: true },
    ]);
    expect(matchOf("0.3.5")).toBe("0.3.5");
  });

  it("semver manual-saja di bawah terendah dan di atas tertinggi", () => {
    const { rows } = mergeManualVersions({
      automated: ["0.3.0", "0.4.0"],
      manual: [manual("0.1.0", 1), manual("1.0.0", 2)],
    });
    expect(labels(rows)).toEqual(["0.1.0", "0.3.0", "0.4.0", "1.0.0"]);
  });

  it("dua penulisan semver yang sama di manual-saja digabung, berlabel yang terbaru", () => {
    const { rows, matchOf } = mergeManualVersions({
      automated: ["0.4.0"],
      manual: [manual("v0.5.0", 2), manual("0.5.0", 9)],
    });
    expect(rows).toEqual([
      { version: "0.4.0", automated: true },
      { version: "0.5.0", automated: false },
    ]);
    expect(matchOf("v0.5.0")).toBe("0.5.0");
    expect(matchOf("0.5.0")).toBe("0.5.0");
  });

  it("manual-saja non-semver (build-7) di bawah semua versi automated", () => {
    const { rows, matchOf } = mergeManualVersions({
      automated: ["0.3.0", "0.4.0"],
      manual: [manual("build-7", 5)],
    });
    expect(rows).toEqual([
      { version: "build-7", automated: false },
      { version: "0.3.0", automated: true },
      { version: "0.4.0", automated: true },
    ]);
    expect(matchOf("build-7")).toBe("build-7");
  });

  it("satu manual non-semver membuat semua manual-saja (termasuk semver) ditaruh di bawah", () => {
    const { rows } = mergeManualVersions({
      automated: ["0.3.0", "0.4.0"],
      manual: [manual("0.3.5", 8), manual("build-7", 2)],
    });
    // Terendah → tertinggi: manual-saja berurut waktu naik (build-7 lebih lama), lalu automated.
    expect(labels(rows)).toEqual(["build-7", "0.3.5", "0.3.0", "0.4.0"]);
  });

  it("manual non-semver yang cocok persis dengan automated tidak jadi baris baru", () => {
    const { rows, matchOf } = mergeManualVersions({
      automated: ["build-1", "build-2"],
      manual: [manual("build-2", 5)],
    });
    expect(rows).toEqual([
      { version: "build-1", automated: true },
      { version: "build-2", automated: true },
    ]);
    expect(matchOf("build-2")).toBe("build-2");
  });

  it("automated berisi non-semver → manual-saja di bawah, urut latestAt (lama → baru)", () => {
    const { rows } = mergeManualVersions({
      automated: ["build-1", "0.4.0"],
      manual: [manual("0.9.0", 9), manual("2.0.0", 3), manual("rc-x", 6)],
    });
    expect(rows).toEqual([
      { version: "2.0.0", automated: false },
      { version: "rc-x", automated: false },
      { version: "0.9.0", automated: false },
      { version: "build-1", automated: true },
      { version: "0.4.0", automated: true },
    ]);
  });

  it.each([
    [["build-b", "build-a"]],
    [["build-a", "build-b"]],
  ])("manual-saja non-semver dengan waktu sama diurutkan menurut string, apa pun urutan input (%j)", (versions) => {
    const { rows } = mergeManualVersions({ automated: ["0.4.0"], manual: versions.map((v) => manual(v, 4)) });
    expect(labels(rows)).toEqual(["build-a", "build-b", "0.4.0"]);
  });

  it("pencocokan berpasangan: automated berisi non-semver, v0.4.0 tetap cocok dengan 0.4.0", () => {
    const { rows, matchOf } = mergeManualVersions({
      automated: ["0.3.0", "build-5", "0.4.0"],
      manual: [manual("v0.4.0", 5), manual("build-5", 6)],
    });
    expect(rows).toEqual([
      { version: "0.3.0", automated: true },
      { version: "build-5", automated: true },
      { version: "0.4.0", automated: true },
    ]);
    expect(matchOf("v0.4.0")).toBe("0.4.0");
    expect(matchOf("build-5")).toBe("build-5");
  });

  it("pencocokan berpasangan: non-semver hanya cocok dengan string identik", () => {
    const { rows, matchOf } = mergeManualVersions({
      automated: ["build-1", "0.4.0"],
      manual: [manual("build-1x", 5)],
    });
    expect(labels(rows)).toEqual(["build-1x", "build-1", "0.4.0"]);
    expect(matchOf("build-1x")).toBe("build-1x");
  });

  it("seri waktu di manual-saja non-semver diurut menurut string", () => {
    const { rows } = mergeManualVersions({
      automated: ["0.1.0"],
      manual: [manual("zeta", 4), manual("alpha", 4)],
    });
    expect(labels(rows)).toEqual(["alpha", "zeta", "0.1.0"]);
  });

  it("string manual-saja yang sama digabung memakai waktu terbaru", () => {
    const { rows } = mergeManualVersions({
      automated: ["0.1.0"],
      manual: [manual("build-7", 2), manual("other", 5), manual("build-7", 9)],
    });
    expect(labels(rows)).toEqual(["other", "build-7", "0.1.0"]);
  });

  it("tanpa versi automated dan semua manual semver → urut semver", () => {
    const { rows } = mergeManualVersions({
      automated: [],
      manual: [manual("1.2.0", 1), manual("v1.0.0", 9), manual("1.10.0", 5)],
    });
    expect(rows).toEqual([
      { version: "v1.0.0", automated: false },
      { version: "1.2.0", automated: false },
      { version: "1.10.0", automated: false },
    ]);
  });

  it("tanpa versi automated dan ada manual non-semver → urut latestAt", () => {
    const { rows } = mergeManualVersions({
      automated: [],
      manual: [manual("1.2.0", 9), manual("build-7", 2)],
    });
    expect(labels(rows)).toEqual(["build-7", "1.2.0"]);
  });

  it("tanpa manual → hanya versi automated", () => {
    const { rows, matchOf } = mergeManualVersions({ automated: ["0.1.0", "0.2.0"], manual: [] });
    expect(rows).toEqual([
      { version: "0.1.0", automated: true },
      { version: "0.2.0", automated: true },
    ]);
    expect(matchOf("0.1.0")).toBeNull();
  });

  it("tanpa data sama sekali", () => {
    const { rows, matchOf } = mergeManualVersions({ automated: [], manual: [] });
    expect(rows).toEqual([]);
    expect(matchOf("anything")).toBeNull();
  });

  it("matchOf: versi yang tidak dikenal → null", () => {
    const { matchOf } = mergeManualVersions({ automated: ["0.1.0"], manual: [manual("0.2.0", 1)] });
    expect(matchOf("9.9.9")).toBeNull();
    expect(matchOf("nope")).toBeNull();
  });

  it("tidak mengubah input", () => {
    const automated = ["0.3.0", "0.4.0"];
    const manualRuns = [manual("0.3.5", 5)];
    mergeManualVersions({ automated, manual: manualRuns });
    expect(automated).toEqual(["0.3.0", "0.4.0"]);
    expect(manualRuns).toEqual([manual("0.3.5", 5)]);
  });
});
