import { describe, expect, it } from "vitest";
import { coveragePercent, suggestStatus } from "./manual-logic.js";
import type { StepResult, StepResultStatus } from "./schemas/manual.js";

const step = (status: StepResultStatus | null): StepResult => ({ status, note: "" });
const steps = (...statuses: Array<StepResultStatus | null>): StepResult[] => statuses.map(step);

describe("suggestStatus (spec §4.3)", () => {
  it("aturan 1: ada langkah gagal → failed", () => {
    expect(suggestStatus(steps("passed", "failed", "passed"))).toBe("failed");
  });

  it("aturan 1 mengalahkan diblokir", () => {
    expect(suggestStatus(steps("blocked", "failed"))).toBe("failed");
  });

  it("aturan 1 berlaku walau ada langkah yang belum diisi", () => {
    expect(suggestStatus(steps(null, "failed"))).toBe("failed");
  });

  it("aturan 2: ada langkah diblokir (tanpa gagal) → blocked", () => {
    expect(suggestStatus(steps("passed", "blocked", "skipped"))).toBe("blocked");
  });

  it("aturan 2 berlaku walau ada langkah yang belum diisi", () => {
    expect(suggestStatus(steps(null, "blocked"))).toBe("blocked");
  });

  it("aturan 3: semua lulus → passed", () => {
    expect(suggestStatus(steps("passed", "passed"))).toBe("passed");
  });

  it("aturan 3: lulus + dilewati → passed", () => {
    expect(suggestStatus(steps("passed", "skipped", "passed"))).toBe("passed");
  });

  it("aturan 4: semua dilewati → skipped", () => {
    expect(suggestStatus(steps("skipped", "skipped"))).toBe("skipped");
  });

  it("aturan 5: satu langkah belum diisi → tidak ada saran", () => {
    expect(suggestStatus(steps("passed", null, "passed"))).toBeNull();
    expect(suggestStatus(steps("skipped", null))).toBeNull();
    expect(suggestStatus(steps(null))).toBeNull();
  });

  it("tanpa langkah → tidak ada saran", () => {
    expect(suggestStatus([])).toBeNull();
  });

  it("langkah tunggal", () => {
    expect(suggestStatus(steps("passed"))).toBe("passed");
    expect(suggestStatus(steps("skipped"))).toBe("skipped");
    expect(suggestStatus(steps("blocked"))).toBe("blocked");
    expect(suggestStatus(steps("failed"))).toBe("failed");
  });
});

describe("coveragePercent", () => {
  it.each([
    [40, 39, 97], // 97,5 dibulatkan ke bawah
    [40, 40, 100],
    [40, 0, 0],
    [3, 1, 33],
    [3, 2, 66],
    [200, 1, 0], // 0,5 → 0
  ])("active %i, automated %i → %i", (active, automated, expected) => {
    expect(coveragePercent(active, automated)).toBe(expected);
  });

  it("tanpa case aktif → null", () => {
    expect(coveragePercent(0, 0)).toBeNull();
  });
});
