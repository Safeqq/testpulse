import { describe, expect, it } from "vitest";
import { CYCLE_STATUSES, type CycleStatus } from "@testpulse/shared";
import { cycleTransition, effectiveCycleStatus } from "./cycles.js";

const now = new Date("2026-11-16T10:00:00.000Z");
const future = new Date("2026-11-20T00:00:00.000Z");
const past = new Date("2026-11-10T00:00:00.000Z");

describe("cycleTransition", () => {
  // Spec §3.2: draft→open, open→closed, closed→open; tidak pernah kembali ke draft.
  const allowed = new Set(["draft>open", "open>closed", "closed>open"]);

  for (const from of CYCLE_STATUSES) {
    for (const to of CYCLE_STATUSES) {
      const key = `${from}>${to}`;
      const expected = from === to ? "noop" : allowed.has(key) ? "ok" : "invalid";
      it(`${key} → ${expected}`, () => {
        expect(cycleTransition(from as CycleStatus, to as CycleStatus, { endsAt: null, now })).toBe(expected);
      });
    }
  }

  it("membuka cycle yang endsAt-nya sudah lewat → ends_at_passed", () => {
    expect(cycleTransition("closed", "open", { endsAt: past, now })).toBe("ends_at_passed");
    expect(cycleTransition("draft", "open", { endsAt: past, now })).toBe("ends_at_passed");
  });

  it("membuka cycle dengan endsAt di masa depan → ok", () => {
    expect(cycleTransition("closed", "open", { endsAt: future, now })).toBe("ok");
  });

  it("endsAt tepat sekarang dianggap sudah lewat", () => {
    expect(cycleTransition("closed", "open", { endsAt: now, now })).toBe("ends_at_passed");
  });

  it("menutup tidak peduli endsAt", () => {
    expect(cycleTransition("open", "closed", { endsAt: past, now })).toBe("ok");
  });
});

describe("effectiveCycleStatus", () => {
  it("open tanpa endsAt tetap open", () => {
    expect(effectiveCycleStatus({ status: "open", endsAt: null }, now)).toBe("open");
  });

  it("open dengan endsAt tepat sekarang → closed", () => {
    expect(effectiveCycleStatus({ status: "open", endsAt: now }, now)).toBe("closed");
  });

  it("open dengan endsAt 1 ms lagi → open", () => {
    expect(effectiveCycleStatus({ status: "open", endsAt: new Date(now.getTime() + 1) }, now)).toBe("open");
  });

  it("draft dan closed tidak berubah", () => {
    expect(effectiveCycleStatus({ status: "draft", endsAt: past }, now)).toBe("draft");
    expect(effectiveCycleStatus({ status: "closed", endsAt: future }, now)).toBe("closed");
  });
});
