import { describe, expect, it } from "vitest";
import { caseCode, MANUAL_STATUS_LABEL, parseCaseFilters, parseCaseNumber } from "./manual";

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
});
