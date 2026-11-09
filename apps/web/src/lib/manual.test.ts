import { describe, expect, it } from "vitest";
import {
  caseCode,
  countSelection,
  groupBySuite,
  MANUAL_STATUS_LABEL,
  parseCaseFilters,
  parseCaseNumber,
  parseRunCaseFilters,
  parseRunFilters,
  parseRunNumber,
  runCode,
  runProgressLegend,
} from "./manual";

const SUITE = "6f1c2b3a-1d2e-4f50-8a9b-0c1d2e3f4a5b";

describe("caseCode", () => {
  it("memberi awalan TC-", () => {
    expect(caseCode(12)).toBe("TC-12");
  });
});

describe("parseCaseFilters", () => {
  it("tanpa parameter: hanya case aktif, tanpa filter lain", () => {
    expect(parseCaseFilters(new URLSearchParams())).toEqual({ archived: "false" });
  });

  it("membaca semua filter yang valid", () => {
    const params = new URLSearchParams({
      suite: SUITE,
      q: "login",
      priority: "high",
      label: "smoke",
      automated: "yes",
      archived: "true",
    });
    expect(parseCaseFilters(params)).toEqual({
      suite: SUITE,
      q: "login",
      priority: "high",
      label: "smoke",
      automated: "yes",
      archived: "true",
    });
  });

  it("kunci yang tidak valid digugurkan sendiri, filter lain tetap berlaku", () => {
    const params = new URLSearchParams({ suite: "bukan-uuid", priority: "genting", automated: "maybe", archived: "x", label: "ui" });
    expect(parseCaseFilters(params)).toEqual({ archived: "false", label: "ui" });
  });

  it("pencarian kosong dianggap tidak ada", () => {
    expect(parseCaseFilters(new URLSearchParams({ q: "   " }))).toEqual({ archived: "false" });
  });
});

describe("parseCaseNumber", () => {
  it("menerima bilangan bulat positif", () => {
    expect(parseCaseNumber("1")).toBe(1);
    expect(parseCaseNumber("2147483647")).toBe(2_147_483_647);
  });

  it("menolak nol, nol di depan, desimal, huruf, dan yang melebihi integer 32 bit", () => {
    for (const raw of ["0", "007", "1.5", "-1", "abc", "", "2147483648", "12345678901"]) expect(parseCaseNumber(raw)).toBeNull();
  });
});

describe("MANUAL_STATUS_LABEL", () => {
  it("memuat label untuk kelima status", () => {
    expect(Object.keys(MANUAL_STATUS_LABEL)).toEqual(["untested", "passed", "failed", "blocked", "skipped"]);
  });

  it("memakai istilah spec Tahap 4", () => {
    expect(Object.values(MANUAL_STATUS_LABEL)).toEqual(["Belum dites", "Lulus", "Gagal", "Diblokir", "Dilewati"]);
  });
});

describe("runCode", () => {
  it("memberi awalan TR-", () => {
    expect(runCode(3)).toBe("TR-3");
  });
});

describe("runProgressLegend", () => {
  it("menyebut yang sudah dieksekusi dan hanya status yang punya hitungan", () => {
    const counts = { untested: 7, passed: 15, failed: 2, blocked: 1, skipped: 0 };
    expect(runProgressLegend(counts, 25)).toBe("18/25 dieksekusi · 15 lulus · 2 gagal · 1 diblokir");
  });

  it("memuat dilewati bila ada, dan run yang belum dikerjakan hanya menyebut dieksekusi", () => {
    expect(runProgressLegend({ untested: 3, passed: 0, failed: 0, blocked: 0, skipped: 2 }, 5)).toBe("2/5 dieksekusi · 2 dilewati");
    expect(runProgressLegend({ untested: 4, passed: 0, failed: 0, blocked: 0, skipped: 0 }, 4)).toBe("0/4 dieksekusi");
  });
});

describe("parseRunFilters", () => {
  it("tanpa parameter: semua status, tanpa versi", () => {
    expect(parseRunFilters(new URLSearchParams())).toEqual({ status: "all" });
  });

  it("membaca status dan versi yang valid", () => {
    expect(parseRunFilters(new URLSearchParams({ status: "open", appVersion: "v0.4.0" }))).toEqual({
      status: "open",
      appVersion: "v0.4.0",
    });
  });

  it("kunci yang tidak valid digugurkan sendiri", () => {
    expect(parseRunFilters(new URLSearchParams({ status: "selesai", appVersion: "v 1" }))).toEqual({ status: "all" });
    expect(parseRunFilters(new URLSearchParams({ status: "completed", appVersion: "bad version" }))).toEqual({ status: "completed" });
  });
});

describe("parseRunCaseFilters", () => {
  it("tanpa parameter: tanpa filter", () => {
    expect(parseRunCaseFilters(new URLSearchParams())).toEqual({});
  });

  it("membaca status, assignee (me, none, uuid), dan nama suite", () => {
    expect(parseRunCaseFilters(new URLSearchParams({ status: "failed", assignee: "me", suite: "Login" }))).toEqual({
      status: "failed",
      assignee: "me",
      suite: "Login",
    });
    expect(parseRunCaseFilters(new URLSearchParams({ assignee: "none" }))).toEqual({ assignee: "none" });
    expect(parseRunCaseFilters(new URLSearchParams({ assignee: SUITE }))).toEqual({ assignee: SUITE });
  });

  it("nilai tidak valid digugurkan sendiri", () => {
    expect(parseRunCaseFilters(new URLSearchParams({ status: "x", assignee: "siapa", suite: "Checkout" }))).toEqual({ suite: "Checkout" });
  });
});

describe("countSelection", () => {
  const suites = [
    { id: "a", activeCount: 3 },
    { id: "b", activeCount: 2 },
  ];

  it("menjumlahkan case aktif suite terpilih", () => {
    expect(countSelection(suites, new Set(["a", "b"]), [])).toBe(5);
  });

  it("case satuan yang suitenya ikut terpilih tidak dihitung dua kali", () => {
    const picked = [
      { number: 1, suiteId: "a" },
      { number: 9, suiteId: "z" },
    ];
    expect(countSelection(suites, new Set(["a"]), picked)).toBe(4);
  });

  it("tanpa pilihan hasilnya 0; id suite yang sudah tidak ada diabaikan", () => {
    expect(countSelection(suites, new Set(), [])).toBe(0);
    expect(countSelection(suites, new Set(["hilang"]), [])).toBe(0);
  });
});

describe("groupBySuite", () => {
  const item = (id: string, suiteName: string) => ({ id, suiteName });

  it("mengelompokkan item berurutan yang suitenya sama, mempertahankan urutan", () => {
    const groups = groupBySuite([item("1", "Login"), item("2", "Login"), item("3", "Checkout"), item("4", "Login")]);
    expect(groups.map((g) => [g.suiteName, g.items.map((i) => i.id)])).toEqual([
      ["Login", ["1", "2"]],
      ["Checkout", ["3"]],
      ["Login", ["4"]],
    ]);
  });

  it("daftar kosong tidak menghasilkan kelompok", () => {
    expect(groupBySuite([])).toEqual([]);
  });
});

describe("parseRunNumber", () => {
  it("memakai aturan nomor yang sama dengan nomor case", () => {
    expect(parseRunNumber("3")).toBe(3);
    expect(parseRunNumber("0")).toBeNull();
    expect(parseRunNumber("abc")).toBeNull();
  });
});
