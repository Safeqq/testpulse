import { describe, expect, it } from "vitest";
import { compareSentence, formatDurationChange, formatPassRateDelta, runLabel, versionLabel } from "./compareSummary";
import { formatDateTime } from "./format";

const NONE = { regressions: 0, fixed: 0, stillFailing: 0, slower: 0, added: 0, removed: 0 };

describe("compareSentence", () => {
  it("memberi peringatan bila ada regresi baru", () => {
    expect(compareSentence({ summary: { ...NONE, regressions: 2 }, baseLabel: "v1.0.0", targetLabel: "v1.0.1" })).toEqual({
      tone: "warning",
      text: "⚠ v1.0.1 punya 2 regresi baru dibanding v1.0.0. Periksa sebelum rilis.",
    });
  });

  it("menambahkan jumlah test yang kini lulus hanya bila ada yang diperbaiki", () => {
    expect(
      compareSentence({ summary: { ...NONE, regressions: 1, fixed: 3 }, baseLabel: "v1.0.0", targetLabel: "v1.0.1" }),
    ).toEqual({
      tone: "warning",
      text: "⚠ v1.0.1 punya 1 regresi baru dibanding v1.0.0. Periksa sebelum rilis, 3 test kini lulus.",
    });
  });

  it("tanpa regresi tetapi ada perbaikan menyebut perbaikannya", () => {
    expect(compareSentence({ summary: { ...NONE, fixed: 4 }, baseLabel: "v1.0.0", targetLabel: "v1.0.1" })).toEqual({
      tone: "success",
      text: "✓ Tidak ada regresi. 4 test yang dulu gagal kini lulus.",
    });
  });

  it("tanpa regresi dan perbaikan menyebut pembandingnya", () => {
    expect(
      compareSentence({
        summary: { ...NONE, stillFailing: 2, slower: 1, added: 5, removed: 1 },
        baseLabel: "v1.0.0",
        targetLabel: "v1.0.1",
      }),
    ).toEqual({ tone: "success", text: "✓ Tidak ada regresi dibanding v1.0.0." });
  });

  it("tanpa pembanding bernada netral", () => {
    expect(compareSentence({ summary: NONE, baseLabel: null, targetLabel: "v1.0.1" })).toEqual({
      tone: "neutral",
      text: "Belum ada run pembanding untuk v1.0.1.",
    });
  });
});

describe("versionLabel dan runLabel", () => {
  const run = { id: "0a1b2c3d-4e5f-6789-abcd-ef0123456789", createdAt: "2026-11-04T08:30:00.000Z" };

  it("menambahkan awalan v pada versi yang belum memilikinya", () => {
    expect(versionLabel("1.0.1")).toBe("v1.0.1");
    expect(runLabel({ ...run, version: "1.0.1" })).toBe("v1.0.1");
  });

  it("membiarkan versi yang sudah diawali v atau V", () => {
    expect(versionLabel("v1.0.1")).toBe("v1.0.1");
    expect(runLabel({ ...run, version: "V2.0.0" })).toBe("V2.0.0");
  });

  it("run tanpa versi diberi id pendek dan tanggal", () => {
    expect(runLabel({ ...run, version: null })).toBe(`run #0a1b2c3d · ${formatDateTime(run.createdAt)}`);
  });
});

describe("formatDurationChange", () => {
  it("menulis durasi sebelum dan sesudah beserta persentase perubahan", () => {
    expect(formatDurationChange(1200, 3400)).toBe("1,2 dtk → 3,4 dtk (+183%)");
    expect(formatDurationChange(2000, 1000)).toBe("2 dtk → 1 dtk (-50%)");
  });

  it("tanpa persentase bila durasi awal nol", () => {
    expect(formatDurationChange(0, 500)).toBe("0 md → 500 md");
  });

  it("memberi tanda nol tanpa plus", () => {
    expect(formatDurationChange(500, 500)).toBe("500 md → 500 md (0%)");
  });
});

describe("formatPassRateDelta", () => {
  it("menulis kenaikan dan penurunan dalam poin", () => {
    expect(formatPassRateDelta(2.1)).toEqual({ direction: "up", text: "▲ naik 2,1 poin" });
    expect(formatPassRateDelta(-4)).toEqual({ direction: "down", text: "▼ turun 4,0 poin" });
  });

  it("tanpa perubahan atau tanpa pembanding menjadi strip", () => {
    expect(formatPassRateDelta(0)).toEqual({ direction: "none", text: "–" });
    expect(formatPassRateDelta(null)).toEqual({ direction: "none", text: "–" });
    // Selisih yang terbulat ke 0,0 poin tidak ditampilkan sebagai naik/turun.
    expect(formatPassRateDelta(0.04)).toEqual({ direction: "none", text: "–" });
  });
});
