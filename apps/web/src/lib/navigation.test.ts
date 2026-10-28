import { describe, expect, it } from "vitest";
import { withBranch } from "./navigation";

describe("withBranch", () => {
  it("menambahkan branch yang di-encode sebagai query", () => {
    expect(withBranch("/p/demo/runs", "main")).toBe("/p/demo/runs?branch=main");
    expect(withBranch("/p/demo/flaky", "feature/login-v2")).toBe("/p/demo/flaky?branch=feature%2Flogin-v2");
  });

  it("membiarkan jalur tanpa branch", () => {
    expect(withBranch("/p/demo/runs", undefined)).toBe("/p/demo/runs");
    expect(withBranch("/p/demo/runs", null)).toBe("/p/demo/runs");
    expect(withBranch("/p/demo/runs", "")).toBe("/p/demo/runs");
  });
});
