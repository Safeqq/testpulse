import { describe, expect, it } from "vitest";
import { selectRunCases } from "./selection.js";

const suites = [
  { id: "s-login", position: 0 },
  { id: "s-cart", position: 1 },
  { id: "s-pay", position: 2 },
];

// Id case sengaja tidak urut menurut nomor agar pengurutan terlihat.
const cases = [
  { id: "c1", number: 1, suiteId: "s-login", archived: false },
  { id: "c2", number: 2, suiteId: "s-cart", archived: false },
  { id: "c3", number: 3, suiteId: "s-login", archived: false },
  { id: "c4", number: 4, suiteId: "s-login", archived: true },
  { id: "c5", number: 5, suiteId: "s-pay", archived: false },
  { id: "c6", number: 6, suiteId: "s-cart", archived: true },
];

const select = (suiteIds: string[], caseNumbers: number[]) =>
  selectRunCases({ suites, cases, suiteIds, caseNumbers });

describe("selectRunCases", () => {
  it("memilih semua case aktif di suite terpilih, urut nomor", () => {
    expect(select(["s-login"], [])).toEqual({ ok: true, caseIds: ["c1", "c3"] });
  });

  it("suite + case satuan dari suite yang sama tidak menggandakan case", () => {
    expect(select(["s-login"], [3, 1, 3])).toEqual({ ok: true, caseIds: ["c1", "c3"] });
  });

  it("menggabungkan suite dan case satuan dari suite lain", () => {
    expect(select(["s-login"], [5])).toEqual({ ok: true, caseIds: ["c1", "c3", "c5"] });
  });

  it("case satu suite yang masuk tidak urut tetap diurutkan menurut nomor", () => {
    const unordered = [
      { id: "c9", number: 9, suiteId: "s-login", archived: false },
      { id: "c7", number: 7, suiteId: "s-login", archived: false },
      { id: "c8", number: 8, suiteId: "s-login", archived: false },
    ];
    expect(selectRunCases({ suites, cases: unordered, suiteIds: ["s-login"], caseNumbers: [] })).toEqual({
      ok: true,
      caseIds: ["c7", "c8", "c9"],
    });
  });

  it("mengurutkan menurut posisi suite lalu nomor, bukan urutan input", () => {
    expect(select(["s-pay", "s-login"], [2])).toEqual({ ok: true, caseIds: ["c1", "c3", "c2", "c5"] });
    expect(select([], [5, 2, 1])).toEqual({ ok: true, caseIds: ["c1", "c2", "c5"] });
  });

  it("posisi suite menentukan urutan walau nomor case lebih kecil di suite berikutnya", () => {
    const reordered = [
      { id: "s-login", position: 5 },
      { id: "s-cart", position: 1 },
    ];
    const result = selectRunCases({ suites: reordered, cases, suiteIds: ["s-login", "s-cart"], caseNumbers: [] });
    expect(result).toEqual({ ok: true, caseIds: ["c2", "c1", "c3"] });
  });

  it("membuang case arsip di suite terpilih", () => {
    expect(select(["s-cart"], [])).toEqual({ ok: true, caseIds: ["c2"] });
  });

  it("suite yang semua case-nya arsip → selection", () => {
    const onlyArchived = cases.map((c) => (c.suiteId === "s-pay" ? { ...c, archived: true } : c));
    expect(selectRunCases({ suites, cases: onlyArchived, suiteIds: ["s-pay"], caseNumbers: [] })).toEqual({
      ok: false,
      field: "selection",
    });
  });

  it("suite kosong → selection", () => {
    expect(selectRunCases({ suites, cases: [], suiteIds: ["s-pay"], caseNumbers: [] })).toEqual({
      ok: false,
      field: "selection",
    });
  });

  it("nomor case arsip → caseNumbers", () => {
    expect(select([], [4])).toEqual({ ok: false, field: "caseNumbers" });
    expect(select(["s-login"], [1, 4])).toEqual({ ok: false, field: "caseNumbers" });
  });

  it("nomor case tak dikenal → caseNumbers", () => {
    expect(select([], [999])).toEqual({ ok: false, field: "caseNumbers" });
  });

  it("id suite tak dikenal → suiteIds", () => {
    expect(select(["s-ghost"], [])).toEqual({ ok: false, field: "suiteIds" });
    expect(select(["s-login", "s-ghost"], [1])).toEqual({ ok: false, field: "suiteIds" });
  });

  it("suite tak dikenal dilaporkan lebih dulu daripada nomor case yang salah", () => {
    expect(select(["s-ghost"], [999])).toEqual({ ok: false, field: "suiteIds" });
  });

  it("tanpa pilihan sama sekali → selection", () => {
    expect(select([], [])).toEqual({ ok: false, field: "selection" });
  });

  describe("batas 500", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `m${i + 1}`, number: i + 1, suiteId: "s-big", archived: false }));
    const bigSuites = [{ id: "s-big", position: 0 }];

    it("tepat 500 diterima", () => {
      const result = selectRunCases({ suites: bigSuites, cases: many(500), suiteIds: ["s-big"], caseNumbers: [] });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.caseIds).toHaveLength(500);
        expect(result.caseIds[0]).toBe("m1");
        expect(result.caseIds[499]).toBe("m500");
      }
    });

    it("501 → selection", () => {
      expect(selectRunCases({ suites: bigSuites, cases: many(501), suiteIds: ["s-big"], caseNumbers: [] })).toEqual({
        ok: false,
        field: "selection",
      });
    });
  });
});
