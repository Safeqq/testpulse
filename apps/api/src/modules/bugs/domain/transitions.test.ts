import { describe, expect, it } from "vitest";
import { BUG_STATUSES, type BugResolution, type BugStatus } from "@testpulse/shared";
import { applyStatusChange, canTransition } from "./transitions.js";

const ALLOWED: Record<BugStatus, BugStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["open", "resolved", "closed"],
  resolved: ["closed", "open"],
  closed: ["open"],
};

const NOW = new Date("2026-11-04T10:00:00Z");

describe("canTransition", () => {
  const pairs = BUG_STATUSES.flatMap((from) => BUG_STATUSES.map((to) => [from, to] as const));

  it("covers all 16 from/to pairs", () => {
    expect(pairs).toHaveLength(16);
  });

  it.each(pairs)("%s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(ALLOWED[from].includes(to));
  });

  it("never allows a status to itself", () => {
    for (const s of BUG_STATUSES) expect(canTransition(s, s)).toBe(false);
  });
});

describe("applyStatusChange", () => {
  it("rejects a transition that is not allowed", () => {
    expect(applyStatusChange({ status: "closed", resolution: "fixed" }, { status: "resolved", resolution: "fixed" }, NOW)).toEqual({
      error: "INVALID_TRANSITION",
    });
    expect(applyStatusChange({ status: "open", resolution: null }, { status: "open" }, NOW)).toEqual({ error: "INVALID_TRANSITION" });
  });

  it("reports INVALID_TRANSITION before RESOLUTION_REQUIRED", () => {
    expect(applyStatusChange({ status: "resolved", resolution: "fixed" }, { status: "in_progress" }, NOW)).toEqual({
      error: "INVALID_TRANSITION",
    });
  });

  it.each(["open", "in_progress"] as const)("requires a resolution to go %s -> resolved", (from) => {
    expect(applyStatusChange({ status: from, resolution: null }, { status: "resolved" }, NOW)).toEqual({ error: "RESOLUTION_REQUIRED" });
    expect(applyStatusChange({ status: from, resolution: null }, { status: "resolved", resolution: null }, NOW)).toEqual({
      error: "RESOLUTION_REQUIRED",
    });
  });

  it.each(["open", "in_progress"] as const)("requires a resolution to go %s -> closed", (from) => {
    expect(applyStatusChange({ status: from, resolution: null }, { status: "closed" }, NOW)).toEqual({ error: "RESOLUTION_REQUIRED" });
  });

  it("sets resolution and resolvedAt when resolving", () => {
    expect(applyStatusChange({ status: "open", resolution: null }, { status: "resolved", resolution: "fixed" }, NOW)).toEqual({
      status: "resolved",
      resolution: "fixed",
      resolvedAt: NOW,
    });
  });

  it("sets resolution and closedAt when closing directly", () => {
    expect(applyStatusChange({ status: "in_progress", resolution: null }, { status: "closed", resolution: "wont_fix" }, NOW)).toEqual({
      status: "closed",
      resolution: "wont_fix",
      closedAt: NOW,
    });
  });

  it("returns no date columns for open <-> in_progress", () => {
    expect(applyStatusChange({ status: "open", resolution: null }, { status: "in_progress" }, NOW)).toEqual({
      status: "in_progress",
      resolution: null,
    });
    expect(applyStatusChange({ status: "in_progress", resolution: null }, { status: "open" }, NOW)).toEqual({
      status: "open",
      resolution: null,
    });
  });

  it("keeps the existing resolution on resolved -> closed without one, and fills closedAt only", () => {
    const result = applyStatusChange({ status: "resolved", resolution: "duplicate" }, { status: "closed" }, NOW);
    expect(result).toEqual({ status: "closed", resolution: "duplicate", closedAt: NOW });
    expect(result).not.toHaveProperty("resolvedAt");
  });

  it("replaces the resolution on resolved -> closed when one is given", () => {
    expect(applyStatusChange({ status: "resolved", resolution: "fixed" }, { status: "closed", resolution: "wont_fix" }, NOW)).toEqual({
      status: "closed",
      resolution: "wont_fix",
      closedAt: NOW,
    });
  });

  it.each(["open", "in_progress"] as const)("does not reuse a stale resolution on %s -> closed (only resolved may)", (from) => {
    expect(applyStatusChange({ status: from, resolution: "fixed" }, { status: "closed" }, NOW)).toEqual({ error: "RESOLUTION_REQUIRED" });
  });

  it("requires a resolution on resolved -> closed when none exists at all", () => {
    expect(applyStatusChange({ status: "resolved", resolution: null }, { status: "closed" }, NOW)).toEqual({ error: "RESOLUTION_REQUIRED" });
  });

  it("clears resolution, resolvedAt and closedAt when reopening from closed", () => {
    expect(applyStatusChange({ status: "closed", resolution: "fixed" }, { status: "open" }, NOW)).toEqual({
      status: "open",
      resolution: null,
      resolvedAt: null,
      closedAt: null,
    });
  });

  it("clears resolution and resolvedAt when reopening from resolved", () => {
    const result = applyStatusChange({ status: "resolved", resolution: "fixed" }, { status: "open" }, NOW);
    expect(result).toEqual({ status: "open", resolution: null, resolvedAt: null });
    expect(result).not.toHaveProperty("closedAt");
  });

  it("ignores a resolution supplied for a non-terminal target status", () => {
    const resolution: BugResolution = "fixed";
    expect(applyStatusChange({ status: "open", resolution: null }, { status: "in_progress", resolution }, NOW)).toEqual({
      status: "in_progress",
      resolution: null,
    });
    expect(applyStatusChange({ status: "closed", resolution: "fixed" }, { status: "open", resolution }, NOW)).toMatchObject({
      status: "open",
      resolution: null,
    });
  });
});
