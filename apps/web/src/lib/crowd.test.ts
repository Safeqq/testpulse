import { describe, expect, it } from "vitest";
import { ME_STATE_COPY, cycleCode, endsLabel, formatAcceptance, reportCode } from "./crowd";

const now = new Date("2026-11-16T10:00:00.000Z").getTime();
const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();

describe("endsLabel", () => {
  it("tanpa batas akhir", () => {
    expect(endsLabel(null, now)).toBe("Tanpa batas akhir");
  });

  it("beberapa hari lagi dibulatkan ke atas", () => {
    expect(endsLabel(at(72), now)).toBe("Berakhir 3 hari lagi");
    expect(endsLabel(at(49), now)).toBe("Berakhir 3 hari lagi");
  });

  it("kurang dari sehari → jam; kurang dari sejam → menit", () => {
    expect(endsLabel(at(5), now)).toBe("Berakhir 5 jam lagi");
    expect(endsLabel(at(0.5), now)).toBe("Berakhir 30 menit lagi");
  });

  it("sudah lewat", () => {
    expect(endsLabel(at(-1), now)).toBe("Sudah berakhir");
    expect(endsLabel(at(0), now)).toBe("Sudah berakhir");
  });
});

describe("formatAcceptance", () => {
  it("persen dibulatkan; null → belum ada keputusan", () => {
    expect(formatAcceptance(12 / 15)).toBe("80%");
    expect(formatAcceptance(12 / 13)).toBe("92%");
    expect(formatAcceptance(null)).toBe("Belum ada keputusan");
  });
});

describe("kode dan salinan", () => {
  it("CY-n dan CR-n", () => {
    expect(cycleCode(2)).toBe("CY-2");
    expect(reportCode(14)).toBe("CR-14");
  });

  it("setiap me.state punya pesan", () => {
    for (const state of ["anonymous", "can_join", "joined", "left", "removed", "member", "closed"] as const) {
      expect(ME_STATE_COPY[state].length).toBeGreaterThan(0);
    }
    expect(ME_STATE_COPY.member).toContain("Anggota project");
  });
});
