import { describe, expect, it } from "vitest";
import { compareHref, safeExternalUrl, safeNext, withBranch } from "./navigation";

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

describe("compareHref", () => {
  it("menyematkan id run pembanding dan target serta branch yang di-encode", () => {
    expect(compareHref("demo", { base: "b-1", target: "t-1", branch: "feature/x" })).toBe(
      "/p/demo/compare?base=b-1&target=t-1&branch=feature%2Fx",
    );
  });

  it("melewatkan bagian yang tidak diisi", () => {
    expect(compareHref("demo", { target: "t-1" })).toBe("/p/demo/compare?target=t-1");
    expect(compareHref("demo", {})).toBe("/p/demo/compare");
  });
});

describe("safeExternalUrl", () => {
  it("hanya meloloskan http dan https", () => {
    expect(safeExternalUrl("https://ci.example.com/b/1")).toBe("https://ci.example.com/b/1");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

// Review Focus 1 (spec Tahap 5): `?next=` login/daftar hanya mengikuti path relatif di situs ini.
describe("safeNext", () => {
  it.each(["/crowd/c/1", "/p/x?tab=1#h", "/crowd/me"])("%j diikuti", (raw) => {
    expect(safeNext(raw)).toBe(raw);
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "%2F%2Fevil.com",
    "",
    "/crowd\u0000x",
    "/crowd\nx",
  ])("%j → /", (raw) => {
    expect(safeNext(raw)).toBe("/");
  });

  it("null dan undefined → /", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
