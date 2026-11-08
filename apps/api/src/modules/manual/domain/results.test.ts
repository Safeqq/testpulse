import { describe, expect, it } from "vitest";
import { emptyStepResults, stepResultsMatch } from "./results.js";

describe("emptyStepResults", () => {
  it("membuat satu hasil kosong per langkah", () => {
    expect(emptyStepResults(3)).toEqual([
      { status: null, note: "" },
      { status: null, note: "" },
      { status: null, note: "" },
    ]);
  });

  it("tanpa langkah → array kosong", () => {
    expect(emptyStepResults(0)).toEqual([]);
  });

  it("elemen tidak berbagi referensi", () => {
    const results = emptyStepResults(2);
    results[0]!.note = "diubah";
    expect(results[1]!.note).toBe("");
  });
});

describe("stepResultsMatch", () => {
  it("true bila panjang sama dengan jumlah langkah", () => {
    expect(stepResultsMatch(emptyStepResults(4), 4)).toBe(true);
    expect(stepResultsMatch([], 0)).toBe(true);
  });

  it("false bila panjang berbeda", () => {
    expect(stepResultsMatch(emptyStepResults(3), 4)).toBe(false);
    expect(stepResultsMatch(emptyStepResults(5), 4)).toBe(false);
    expect(stepResultsMatch([], 1)).toBe(false);
  });
});
