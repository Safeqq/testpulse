import { describe, expect, it } from "vitest";
import { COMPARE_GROUPS, compareDto, compareGroupPageDto, compareItemDto, compareQuery, versionDto } from "../index.js";

const run = {
  id: "r1",
  branch: "main",
  commitSha: null,
  ciUrl: null,
  name: null,
  createdAt: "2026-11-04T00:00:00.000Z",
  durationMs: 10,
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
  flaky: 0,
  version: "1.0.1",
};
const side = { status: "failed", durationMs: 5, message: "boom", flakyInRun: false };
const item = {
  testCaseId: "t1",
  suite: "s",
  name: "n",
  base: { ...side, status: "passed", message: null },
  target: side,
  bugs: [{ number: 1, title: "b", status: "open" }],
};
const page = { items: [item], nextCursor: null };

describe("COMPARE_GROUPS", () => {
  it("urutan sesuai spec §4.4", () =>
    expect(COMPARE_GROUPS).toEqual(["regressions", "fixed", "stillFailing", "slower", "added", "removed"]));
});

describe("compareItemDto", () => {
  it("menerima item regresi", () => expect(compareItemDto.safeParse(item).success).toBe(true));
  it("menerima sisi null (test baru/hilang)", () => {
    expect(compareItemDto.safeParse({ ...item, base: null }).success).toBe(true);
    expect(compareItemDto.safeParse({ ...item, target: null }).success).toBe(true);
  });
  it("menolak status tidak dikenal", () =>
    expect(compareItemDto.safeParse({ ...item, target: { ...side, status: "x" } }).success).toBe(false));
});

describe("compareGroupPageDto", () => {
  it("menerima items + nextCursor", () => {
    expect(compareGroupPageDto.safeParse({ items: [], nextCursor: "abc" }).success).toBe(true);
    expect(compareGroupPageDto.safeParse(page).success).toBe(true);
  });
  it("menolak tanpa nextCursor", () => expect(compareGroupPageDto.safeParse({ items: [] }).success).toBe(false));
});

describe("compareDto", () => {
  const empty = { items: [], nextCursor: null };
  const full = {
    base: run,
    target: { ...run, id: "r2" },
    summary: { regressions: 1, fixed: 0, stillFailing: 0, slower: 0, added: 0, removed: 0 },
    groups: { regressions: page, fixed: empty, stillFailing: empty, slower: empty, added: empty, removed: empty },
  };

  it("menerima perbandingan penuh", () => expect(compareDto.safeParse(full).success).toBe(true));
  it("menerima tanpa pembanding", () => expect(compareDto.safeParse({ ...full, base: null }).success).toBe(true));
  it("menolak bila satu kelompok hilang", () => {
    expect(compareDto.safeParse({ ...full, groups: { ...full.groups, removed: undefined } }).success).toBe(false);
  });
  it("menolak ringkasan tanpa salah satu kelompok", () => {
    expect(compareDto.safeParse({ ...full, summary: { ...full.summary, removed: undefined } }).success).toBe(false);
  });
});

describe("versionDto", () => {
  const v = { version: "1.0.1", run, runCount: 2, passRate: 97.5, passRateDelta: -2.5 };
  it("menerima versi dengan delta", () => expect(versionDto.safeParse(v).success).toBe(true));
  it("menerima passRate dan delta null", () =>
    expect(versionDto.safeParse({ ...v, passRate: null, passRateDelta: null }).success).toBe(true));
});

describe("compareQuery", () => {
  it("semua opsional", () => expect(compareQuery.parse({})).toEqual({}));
  it("menerima base, target, branch", () =>
    expect(compareQuery.safeParse({ base: "a", target: "b", branch: "feature/x" }).success).toBe(true));
  it("group boleh sendiri, tetapi cursor wajib bersama group", () => {
    expect(compareQuery.safeParse({ group: "fixed" }).success).toBe(true);
    expect(compareQuery.safeParse({ group: "fixed", cursor: "abc" }).success).toBe(true);
    const result = compareQuery.safeParse({ cursor: "abc" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["group"]);
  });
  it("menolak group tidak dikenal dan branch tidak sah", () => {
    expect(compareQuery.safeParse({ group: "x" }).success).toBe(false);
    expect(compareQuery.safeParse({ branch: "a b" }).success).toBe(false);
  });
});
