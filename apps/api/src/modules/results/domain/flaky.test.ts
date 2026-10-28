import { describe, expect, it } from "vitest";
import type { ResultStatus } from "@testpulse/shared";
import { FLAKY_WINDOW, flakyScore } from "./flaky.js";

type Step = "L" | "G" | "S" | "R";

// L = lulus, G = gagal, S = skip, R = lulus dengan retry (flaky_in_run)
function seq(steps: string): Array<{ status: ResultStatus; flakyInRun: boolean }> {
  return steps
    .split(" ")
    .filter(Boolean)
    .map((s) => {
      const step = s as Step;
      if (step === "L") return { status: "passed", flakyInRun: false };
      if (step === "R") return { status: "passed", flakyInRun: true };
      if (step === "G") return { status: "failed", flakyInRun: false };
      return { status: "skipped", flakyInRun: false };
    });
}

describe("flakyScore", () => {
  it("memakai jendela 20 run", () => expect(FLAKY_WINDOW).toBe(20));

  it("L L L L -> 0", () => expect(flakyScore(seq("L L L L"))).toBe(0));
  it("G G G G (rusak konsisten) -> 0", () => expect(flakyScore(seq("G G G G"))).toBe(0));
  it("L G L G -> 75", () => expect(flakyScore(seq("L G L G"))).toBe(75));
  it("9x L + 1x L-dengan-retry -> 10", () => expect(flakyScore(seq("L L L L L L L L L R"))).toBe(10));
  it("hanya skip -> 0", () => expect(flakyScore(seq("S S S"))).toBe(0));

  it("kosong -> 0", () => expect(flakyScore([])).toBe(0));
  it("satu hasil gagal -> 0", () => expect(flakyScore(seq("G"))).toBe(0));
  it("L G -> 50", () => expect(flakyScore(seq("L G"))).toBe(50));
  it("skip di tengah diabaikan (L S G -> 50)", () => expect(flakyScore(seq("L S G"))).toBe(50));

  it("dibatasi maksimum 100", () => {
    // G R G R: flip 3 + flakyRuns 2 = 5 dari n = 4 -> 125 -> 100
    expect(flakyScore(seq("G R G R"))).toBe(100);
  });

  it("membulatkan ke bilangan bulat terdekat", () => {
    // L G L: flip 2 dari n = 3 -> 66.67 -> 67
    expect(flakyScore(seq("L G L"))).toBe(67);
  });

  it("flaky_in_run pada hasil skip tidak dihitung", () => {
    expect(flakyScore([{ status: "skipped", flakyInRun: true }, { status: "passed", flakyInRun: false }])).toBe(0);
  });
});
