import { describe, expect, it } from "vitest";
import {
  RESULT_STATUSES,
  createTokenBody,
  flakyTestDto,
  ingestQuery,
  runSummaryDto,
  runVersion,
  testHistoryDto,
  testResultDto,
} from "../index.js";

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

  it("memetakan commit ke huruf kecil", () =>
    expect(ingestQuery.parse({ branch: "main", commit: "ABCDEF1" })).toEqual({ branch: "main", commitSha: "abcdef1" }));

  it("menerima URL https biasa", () =>
    expect(ingestQuery.safeParse({ branch: "main", ciUrl: "https://ci.example.com/a/b?x=1" }).success).toBe(true));

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
    ["ciUrl tanpa //", { branch: "main", ciUrl: "http:foo" }],
    ["ciUrl dengan kredensial", { branch: "main", ciUrl: "https://user:pass@host/x" }],
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

describe("runVersion", () => {
  it.each(["1.0.1", "v2.0.0-beta.1+sha.5", "build-42", "rc_1", "a", "a".repeat(50)])("menerima %s", (v) =>
    expect(runVersion.safeParse(v).success).toBe(true),
  );
  it.each([["spasi", "1 0"], ["kosong", ""], ["51 karakter", "a".repeat(51)], ["garis miring", "1/0"], ["at", "1@0"]])(
    "menolak %s",
    (_label, v) => expect(runVersion.safeParse(v).success).toBe(false),
  );
});

describe("ingestQuery version", () => {
  it("menerima version dan meneruskannya", () =>
    expect(ingestQuery.parse({ branch: "main", version: "1.0.1" })).toEqual({ branch: "main", version: "1.0.1" }));
  it("version opsional", () => expect(ingestQuery.parse({ branch: "main" })).toEqual({ branch: "main" }));
  it.each(["1 0", "", "a".repeat(51)])("menolak version %j", (version) =>
    expect(ingestQuery.safeParse({ branch: "main", version }).success).toBe(false),
  );
});

describe("DTO hasil dengan versi dan bug", () => {
  const bug = { number: 3, title: "Bug", status: "open" };
  const run = {
    id: "r1",
    branch: "main",
    commitSha: null,
    ciUrl: null,
    name: null,
    createdAt: "2026-11-04T00:00:00.000Z",
    durationMs: 1,
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    flaky: 0,
  };

  it("runSummaryDto wajib memuat version (string atau null)", () => {
    expect(runSummaryDto.safeParse({ ...run, version: "1.0.1" }).success).toBe(true);
    expect(runSummaryDto.safeParse({ ...run, version: null }).success).toBe(true);
    expect(runSummaryDto.safeParse(run).success).toBe(false);
  });

  it("testResultDto wajib memuat bugs", () => {
    const result = {
      testCaseId: "t1",
      suite: "s",
      name: "n",
      status: "failed",
      flakyInRun: false,
      retries: 0,
      durationMs: 1,
      message: null,
    };
    expect(testResultDto.safeParse({ ...result, bugs: [bug] }).success).toBe(true);
    expect(testResultDto.safeParse(result).success).toBe(false);
  });

  it("flakyTestDto wajib memuat bugs", () => {
    const flaky = { testCaseId: "t1", suite: "s", name: "n", score: 0.5, lastStatus: "failed" };
    expect(flakyTestDto.safeParse({ ...flaky, bugs: [] }).success).toBe(true);
    expect(flakyTestDto.safeParse(flaky).success).toBe(false);
  });

  it("testHistoryDto.testCase wajib memuat bugs", () => {
    const history = (testCase: object) => ({ testCase, branch: "main", results: [] });
    expect(testHistoryDto.safeParse(history({ id: "t1", suite: "s", name: "n", bugs: [bug] })).success).toBe(true);
    expect(testHistoryDto.safeParse(history({ id: "t1", suite: "s", name: "n" })).success).toBe(false);
  });
});
