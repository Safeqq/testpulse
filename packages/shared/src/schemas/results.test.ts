import { describe, expect, it } from "vitest";
import { RESULT_STATUSES, createTokenBody, ingestQuery } from "../index.js";

describe("ingestQuery", () => {
  it("menerima branch valid dan memetakan commit ke commitSha", () => {
    expect(
      ingestQuery.parse({
        branch: "feature/login-v2",
        commit: "abc1234",
        ciUrl: "https://ci.example.com/runs/1",
        name: "Nightly",
      }),
    ).toEqual({
      branch: "feature/login-v2",
      commitSha: "abc1234",
      ciUrl: "https://ci.example.com/runs/1",
      name: "Nightly",
    });
  });

  it("hanya branch yang wajib", () => expect(ingestQuery.parse({ branch: "main" })).toEqual({ branch: "main" }));

  it("menerima commit 40 hex dan http", () => {
    expect(ingestQuery.safeParse({ branch: "main", commit: "a".repeat(40), ciUrl: "http://ci.local/1" }).success).toBe(
      true,
    );
  });

  it.each([
    ["kosong", { branch: "" }],
    ["spasi", { branch: "a b" }],
    ["201 karakter", { branch: "a".repeat(201) }],
    ["tanpa branch", {}],
    ["commit bukan hex", { branch: "main", commit: "xyz1234" }],
    ["commit 5 karakter", { branch: "main", commit: "abc12" }],
    ["commit 41 karakter", { branch: "main", commit: "a".repeat(41) }],
    ["ciUrl javascript:", { branch: "main", ciUrl: "javascript:alert(1)" }],
    ["ciUrl 501 karakter", { branch: "main", ciUrl: `https://ci.example.com/${"a".repeat(501 - 23)}` }],
    ["name 121 karakter", { branch: "main", name: "a".repeat(121) }],
  ])("menolak %s", (_label, input) => expect(ingestQuery.safeParse(input).success).toBe(false));

  it("menerima branch 200 karakter, ciUrl 500 karakter, name 120 karakter", () => {
    expect(
      ingestQuery.safeParse({
        branch: "a".repeat(200),
        ciUrl: `https://ci.example.com/${"a".repeat(500 - 23)}`,
        name: "a".repeat(120),
      }).success,
    ).toBe(true);
  });
});

describe("createTokenBody", () => {
  it("memangkas spasi dan menerima 60 karakter", () => {
    expect(createTokenBody.parse({ name: "  CI utama  " })).toEqual({ name: "CI utama" });
    expect(createTokenBody.safeParse({ name: "a".repeat(60) }).success).toBe(true);
  });

  it.each([["   "], [""], ["a".repeat(61)]])("menolak %j", (name) =>
    expect(createTokenBody.safeParse({ name }).success).toBe(false),
  );
});

describe("RESULT_STATUSES", () => {
  it("berisi passed, failed, skipped", () => expect([...RESULT_STATUSES]).toEqual(["passed", "failed", "skipped"]));
});
