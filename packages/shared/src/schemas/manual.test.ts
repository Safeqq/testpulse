import { describe, expect, it } from "vitest";
import {
  CASE_PRIORITIES,
  MANUAL_RESULT_STATUSES,
  MANUAL_RUN_STATUSES,
  MAX_RUN_CASES,
  MAX_STEPS,
  MAX_SUITES,
  STEP_RESULT_STATUSES,
  bugDto,
  caseListQuery,
  caseStep,
  casesPageDto,
  createBugBody,
  createCaseBody,
  createManualRunBody,
  manualCaseDto,
  manualRunListQuery,
  manualRunRefDto,
  manualSummaryDto,
  runCaseDto,
  runCaseListQuery,
  stepResult,
  suiteBody,
  testSearchQuery,
  updateCaseBody,
  updateManualRunBody,
  updateRunCaseBody,
  updateSuiteBody,
} from "../index.js";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, input: unknown) =>
  schema.safeParse(input).success;

const pathsOf = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[] }[] } } }, input: unknown) =>
  (schema.safeParse(input).error?.issues ?? []).map((issue) => issue.path.map(String).join("."));

const UUID_A = "0b8f3c2e-6f0a-4c1d-9a63-0d6f4c1d2e3f";
const UUID_B = "1b8f3c2e-6f0a-4c1d-9a63-0d6f4c1d2e3f";

const step = { action: "Buka halaman login", expected: "Form tampil" };
const stepsOf = (n: number) => Array.from({ length: n }, () => step);
const caseBase = { suiteId: UUID_A, title: "Login berhasil", steps: [step] };

describe("konstanta & enum manual", () => {
  it("nilainya sesuai spec §3 dan §4", () => {
    expect(CASE_PRIORITIES).toEqual(["low", "medium", "high", "urgent"]);
    expect(MANUAL_RESULT_STATUSES).toEqual(["untested", "passed", "failed", "blocked", "skipped"]);
    expect(STEP_RESULT_STATUSES).toEqual(["passed", "failed", "blocked", "skipped"]);
    expect(MANUAL_RUN_STATUSES).toEqual(["open", "completed"]);
    expect([MAX_STEPS, MAX_RUN_CASES, MAX_SUITES]).toEqual([50, 500, 200]);
  });
});

describe("caseStep", () => {
  it("men-trim action dan menerima expected kosong", () => {
    expect(caseStep.parse({ action: "  Klik  ", expected: "" })).toEqual({ action: "Klik", expected: "" });
  });
  it("menolak action hanya spasi, kosong, atau 2001 karakter", () => {
    expect(ok(caseStep, { action: "   ", expected: "" })).toBe(false);
    expect(ok(caseStep, { action: "", expected: "" })).toBe(false);
    expect(ok(caseStep, { action: "a".repeat(2001), expected: "" })).toBe(false);
  });
  it("menerima 2000 karakter pada action dan expected", () => {
    expect(ok(caseStep, { action: "a".repeat(2000), expected: "b".repeat(2000) })).toBe(true);
  });
  it("menolak expected 2001 karakter", () => {
    expect(ok(caseStep, { action: "a", expected: "b".repeat(2001) })).toBe(false);
  });
  it("menolak karakter kontrol (NUL ditolak Postgres)", () => {
    expect(ok(caseStep, { action: "a\u0000b", expected: "" })).toBe(false);
    expect(ok(caseStep, { action: "a", expected: "b\u0000" })).toBe(false);
  });
  it("mempertahankan teks panjang tanpa spasi, emoji, dan blok kode apa adanya", () => {
    const action = `${"x".repeat(500)} 🙂\n\`\`\`js\nconsole.log(1)\n\`\`\``;
    expect(caseStep.parse({ action, expected: action }).expected).toBe(action);
  });
});

describe("suiteBody & updateSuiteBody", () => {
  it("nama 1 dan 100 karakter diterima, 0 dan 101 ditolak", () => {
    expect(ok(suiteBody, { name: "a" })).toBe(true);
    expect(ok(suiteBody, { name: "a".repeat(100) })).toBe(true);
    expect(ok(suiteBody, { name: "" })).toBe(false);
    expect(ok(suiteBody, { name: "   " })).toBe(false);
    expect(ok(suiteBody, { name: "a".repeat(101) })).toBe(false);
  });
  it("men-trim nama; deskripsi opsional maks 2000", () => {
    expect(suiteBody.parse({ name: " Login " })).toEqual({ name: "Login" });
    expect(ok(suiteBody, { name: "a", description: "d".repeat(2000) })).toBe(true);
    expect(ok(suiteBody, { name: "a", description: "d".repeat(2001) })).toBe(false);
  });
  it("update: minimal satu field; position bilangan bulat >= 0", () => {
    expect(ok(updateSuiteBody, {})).toBe(false);
    expect(ok(updateSuiteBody, { name: "Baru" })).toBe(true);
    expect(ok(updateSuiteBody, { description: "" })).toBe(true);
    expect(ok(updateSuiteBody, { position: 0 })).toBe(true);
    expect(ok(updateSuiteBody, { position: -1 })).toBe(false);
    expect(ok(updateSuiteBody, { position: 1.5 })).toBe(false);
    expect(ok(updateSuiteBody, { name: "" })).toBe(false);
  });
});

describe("createCaseBody", () => {
  it("hanya suiteId, title, dan steps yang wajib", () => {
    expect(createCaseBody.parse(caseBase)).toEqual(caseBase);
  });
  it("menerima 1 dan 50 langkah, menolak 0 dan 51", () => {
    expect(ok(createCaseBody, { ...caseBase, steps: stepsOf(1) })).toBe(true);
    expect(ok(createCaseBody, { ...caseBase, steps: stepsOf(50) })).toBe(true);
    expect(ok(createCaseBody, { ...caseBase, steps: [] })).toBe(false);
    expect(ok(createCaseBody, { ...caseBase, steps: stepsOf(51) })).toBe(false);
  });
  it("action spasi saja dilaporkan pada steps.<i>.action", () => {
    const steps = [step, step, { action: "   ", expected: "" }];
    expect(pathsOf(createCaseBody, { ...caseBase, steps })).toEqual(["steps.2.action"]);
  });
  it("expected kosong diterima; 2001 karakter ditolak", () => {
    expect(ok(createCaseBody, { ...caseBase, steps: [{ action: "a", expected: "" }] })).toBe(true);
    expect(ok(createCaseBody, { ...caseBase, steps: [{ action: "a", expected: "e".repeat(2001) }] })).toBe(false);
    expect(ok(createCaseBody, { ...caseBase, steps: [{ action: "a".repeat(2001), expected: "" }] })).toBe(false);
  });
  it("judul 3–200 karakter setelah trim", () => {
    expect(ok(createCaseBody, { ...caseBase, title: " ab " })).toBe(false);
    expect(ok(createCaseBody, { ...caseBase, title: "abc" })).toBe(true);
    expect(ok(createCaseBody, { ...caseBase, title: "a".repeat(200) })).toBe(true);
    expect(ok(createCaseBody, { ...caseBase, title: "a".repeat(201) })).toBe(false);
  });
  it("prasyarat maks 5000 karakter", () => {
    expect(ok(createCaseBody, { ...caseBase, preconditions: "p".repeat(5000) })).toBe(true);
    expect(ok(createCaseBody, { ...caseBase, preconditions: "p".repeat(5001) })).toBe(false);
  });
  it("label dinormalisasi seperti bug (trim, huruf kecil, unik, maks 10)", () => {
    expect(createCaseBody.parse({ ...caseBase, labels: [" UI ", "api"] }).labels).toEqual(["ui", "api"]);
    expect(ok(createCaseBody, { ...caseBase, labels: ["ui", "UI"] })).toBe(false);
    expect(ok(createCaseBody, { ...caseBase, labels: ["ui_x"] })).toBe(false);
    expect(ok(createCaseBody, { ...caseBase, labels: Array.from({ length: 10 }, (_, i) => `l${i}`) })).toBe(true);
    expect(ok(createCaseBody, { ...caseBase, labels: Array.from({ length: 11 }, (_, i) => `l${i}`) })).toBe(false);
  });
  it("priority, suiteId, dan automatedTestId divalidasi", () => {
    expect(ok(createCaseBody, { ...caseBase, priority: "urgent" })).toBe(true);
    expect(ok(createCaseBody, { ...caseBase, priority: "kritis" })).toBe(false);
    expect(ok(createCaseBody, { ...caseBase, suiteId: "bukan-uuid" })).toBe(false);
    expect(ok(createCaseBody, { ...caseBase, automatedTestId: UUID_B })).toBe(true);
    expect(ok(createCaseBody, { ...caseBase, automatedTestId: null })).toBe(true);
    expect(ok(createCaseBody, { ...caseBase, automatedTestId: "x" })).toBe(false);
  });
  it("menolak karakter kontrol pada judul dan prasyarat", () => {
    expect(ok(createCaseBody, { ...caseBase, title: "ab\u0000c" })).toBe(false);
    expect(ok(createCaseBody, { ...caseBase, preconditions: "a\u0007b" })).toBe(false);
  });
});

describe("updateCaseBody", () => {
  it("hanya version ditolak", () => expect(ok(updateCaseBody, { version: 1 })).toBe(false));
  it("version wajib dan bilangan bulat positif", () => {
    expect(ok(updateCaseBody, { title: "abc" })).toBe(false);
    expect(ok(updateCaseBody, { version: 0, title: "abc" })).toBe(false);
    expect(ok(updateCaseBody, { version: 1.5, title: "abc" })).toBe(false);
  });
  it("menerima satu field apa pun, termasuk archived false dan automatedTestId null", () => {
    expect(ok(updateCaseBody, { version: 2, archived: false })).toBe(true);
    expect(ok(updateCaseBody, { version: 2, automatedTestId: null })).toBe(true);
    expect(ok(updateCaseBody, { version: 2, preconditions: "" })).toBe(true);
    expect(ok(updateCaseBody, { version: 2, steps: stepsOf(2), labels: [], priority: "low", suiteId: UUID_A })).toBe(true);
  });
  it("aturan field sama dengan pembuatan", () => {
    expect(ok(updateCaseBody, { version: 1, steps: [] })).toBe(false);
    expect(ok(updateCaseBody, { version: 1, title: "ab" })).toBe(false);
    expect(pathsOf(updateCaseBody, { version: 1, steps: [{ action: " ", expected: "" }] })).toEqual(["steps.0.action"]);
  });
});

describe("caseListQuery", () => {
  it("default archived=false dan semua filter opsional", () => {
    expect(caseListQuery.parse({})).toEqual({ archived: "false" });
  });
  it("menerima semua filter", () => {
    expect(
      caseListQuery.parse({ suite: UUID_A, q: " login ", priority: "high", label: "UI", automated: "yes", archived: "true", cursor: "abc" }),
    ).toEqual({ suite: UUID_A, q: "login", priority: "high", label: "ui", automated: "yes", archived: "true", cursor: "abc" });
  });
  it.each([
    ["suite bukan uuid", { suite: "x" }],
    ["automated tidak dikenal", { automated: "maybe" }],
    ["archived tidak dikenal", { archived: "all" }],
    ["priority tidak dikenal", { priority: "x" }],
    ["q 101 karakter", { q: "a".repeat(101) }],
    ["label tidak sah", { label: "a_b" }],
  ])("menolak %s", (_label, input) => expect(ok(caseListQuery, input)).toBe(false));
  it("q kosong dianggap tidak ada", () => expect(caseListQuery.parse({ q: "  " }).q).toBeUndefined());
});

describe("testSearchQuery", () => {
  it("q 2–100 karakter", () => {
    expect(ok(testSearchQuery, { q: "a" })).toBe(false);
    expect(ok(testSearchQuery, { q: "ab" })).toBe(true);
    expect(ok(testSearchQuery, { q: "a".repeat(100) })).toBe(true);
    expect(ok(testSearchQuery, { q: "a".repeat(101) })).toBe(false);
    expect(ok(testSearchQuery, {})).toBe(false);
  });
});

describe("createManualRunBody", () => {
  const run = { name: "Regresi rilis 1.0" };
  it("default kedua array [] lalu ditolak bila keduanya kosong, pada field selection", () => {
    expect(ok(createManualRunBody, run)).toBe(false);
    expect(ok(createManualRunBody, { ...run, suiteIds: [], caseNumbers: [] })).toBe(false);
    expect(pathsOf(createManualRunBody, { ...run, suiteIds: [], caseNumbers: [] })).toEqual(["selection"]);
  });
  it("menerima salah satu atau keduanya, dengan default [] untuk yang lain", () => {
    expect(createManualRunBody.parse({ ...run, suiteIds: [UUID_A] })).toEqual({ ...run, suiteIds: [UUID_A], caseNumbers: [] });
    expect(createManualRunBody.parse({ ...run, caseNumbers: [3] })).toEqual({ ...run, suiteIds: [], caseNumbers: [3] });
    expect(ok(createManualRunBody, { ...run, suiteIds: [UUID_A], caseNumbers: [1, 2] })).toBe(true);
  });
  it("appVersion `1 0` ditolak, `v1.0.0` diterima", () => {
    expect(ok(createManualRunBody, { ...run, suiteIds: [UUID_A], appVersion: "1 0" })).toBe(false);
    expect(ok(createManualRunBody, { ...run, suiteIds: [UUID_A], appVersion: "v1.0.0" })).toBe(true);
    expect(ok(createManualRunBody, { ...run, suiteIds: [UUID_A], appVersion: "a".repeat(51) })).toBe(false);
  });
  it("nama 3–120 karakter setelah trim", () => {
    expect(ok(createManualRunBody, { name: " ab ", suiteIds: [UUID_A] })).toBe(false);
    expect(ok(createManualRunBody, { name: "abc", suiteIds: [UUID_A] })).toBe(true);
    expect(ok(createManualRunBody, { name: "a".repeat(120), suiteIds: [UUID_A] })).toBe(true);
    expect(ok(createManualRunBody, { name: "a".repeat(121), suiteIds: [UUID_A] })).toBe(false);
  });
  it("menolak suiteIds bukan uuid dan caseNumbers bukan bilangan bulat positif", () => {
    expect(ok(createManualRunBody, { ...run, suiteIds: ["x"] })).toBe(false);
    expect(ok(createManualRunBody, { ...run, caseNumbers: [0] })).toBe(false);
    expect(ok(createManualRunBody, { ...run, caseNumbers: [1.5] })).toBe(false);
  });
});

describe("updateManualRunBody", () => {
  it("version wajib; minimal satu field lain", () => {
    expect(ok(updateManualRunBody, { name: "Baru" })).toBe(false);
    expect(ok(updateManualRunBody, { version: 1 })).toBe(false);
    expect(ok(updateManualRunBody, { version: 1, status: "completed" })).toBe(true);
    expect(ok(updateManualRunBody, { version: 1, name: "Baru" })).toBe(true);
  });
  it("appVersion boleh null (menghapus) tetapi harus valid bila diisi", () => {
    expect(ok(updateManualRunBody, { version: 1, appVersion: null })).toBe(true);
    expect(ok(updateManualRunBody, { version: 1, appVersion: "1.2.3" })).toBe(true);
    expect(ok(updateManualRunBody, { version: 1, appVersion: "1 0" })).toBe(false);
  });
  it("menolak status tidak dikenal", () => expect(ok(updateManualRunBody, { version: 1, status: "done" })).toBe(false));
});

describe("manualRunListQuery", () => {
  it("default status=all", () => expect(manualRunListQuery.parse({})).toEqual({ status: "all" }));
  it("menerima filter status, appVersion, cursor", () => {
    expect(manualRunListQuery.parse({ status: "open", appVersion: "v1.0.0", cursor: "c" })).toEqual({
      status: "open",
      appVersion: "v1.0.0",
      cursor: "c",
    });
  });
  it("menolak status/appVersion tidak sah", () => {
    expect(ok(manualRunListQuery, { status: "x" })).toBe(false);
    expect(ok(manualRunListQuery, { appVersion: "1 0" })).toBe(false);
  });
});

describe("stepResult", () => {
  it("note default kosong; status boleh null", () => {
    expect(stepResult.parse({ status: null })).toEqual({ status: null, note: "" });
    expect(stepResult.parse({ status: "failed", note: "Tombol hilang" })).toEqual({ status: "failed", note: "Tombol hilang" });
  });
  it("note 1000 diterima, 1001 ditolak", () => {
    expect(ok(stepResult, { status: null, note: "n".repeat(1000) })).toBe(true);
    expect(ok(stepResult, { status: null, note: "n".repeat(1001) })).toBe(false);
  });
  it("menolak status untested dan karakter kontrol", () => {
    expect(ok(stepResult, { status: "untested", note: "" })).toBe(false);
    expect(ok(stepResult, { status: null, note: "a\u0000" })).toBe(false);
  });
});

describe("updateRunCaseBody", () => {
  it("version wajib; hanya version ditolak", () => {
    expect(ok(updateRunCaseBody, { version: 1 })).toBe(false);
    expect(ok(updateRunCaseBody, { status: "passed" })).toBe(false);
  });
  it("menerima satu field apa pun", () => {
    expect(ok(updateRunCaseBody, { version: 1, status: "untested" })).toBe(true);
    expect(ok(updateRunCaseBody, { version: 1, note: "" })).toBe(true);
    expect(ok(updateRunCaseBody, { version: 1, assigneeId: null })).toBe(true);
    expect(ok(updateRunCaseBody, { version: 1, assigneeId: UUID_A })).toBe(true);
    expect(ok(updateRunCaseBody, { version: 1, stepResults: [{ status: "passed", note: "" }, { status: null, note: "" }] })).toBe(true);
  });
  it("menolak status tidak dikenal, note > 5000, note langkah > 1000, assignee bukan uuid", () => {
    expect(ok(updateRunCaseBody, { version: 1, status: "done" })).toBe(false);
    expect(ok(updateRunCaseBody, { version: 1, note: "n".repeat(5001) })).toBe(false);
    expect(ok(updateRunCaseBody, { version: 1, note: "n".repeat(5000) })).toBe(true);
    expect(ok(updateRunCaseBody, { version: 1, stepResults: [{ status: null, note: "n".repeat(1001) }] })).toBe(false);
    expect(ok(updateRunCaseBody, { version: 1, assigneeId: "x" })).toBe(false);
  });
  it("stepResults maksimal 50 elemen", () => {
    const results = (n: number) => Array.from({ length: n }, () => ({ status: null, note: "" }));
    expect(ok(updateRunCaseBody, { version: 1, stepResults: results(50) })).toBe(true);
    expect(ok(updateRunCaseBody, { version: 1, stepResults: results(51) })).toBe(false);
  });
});

describe("runCaseListQuery", () => {
  it("semua filter opsional", () => expect(runCaseListQuery.parse({})).toEqual({}));
  it("assignee: me, none, atau uuid", () => {
    for (const assignee of ["me", "none", UUID_A]) expect(ok(runCaseListQuery, { assignee })).toBe(true);
    expect(ok(runCaseListQuery, { assignee: "x" })).toBe(false);
  });
  it("status (termasuk untested) dan suite (nama snapshot)", () => {
    expect(ok(runCaseListQuery, { status: "untested", suite: "Login", cursor: "c" })).toBe(true);
    expect(ok(runCaseListQuery, { status: "all" })).toBe(false);
    expect(ok(runCaseListQuery, { suite: "s".repeat(101) })).toBe(false);
  });
});

describe("createBugBody dengan manualRunCaseId", () => {
  const base = { title: "TC-12 gagal: Login" };
  it("diterima sendirian", () => expect(ok(createBugBody, { ...base, manualRunCaseId: UUID_A })).toBe(true));
  it("manualRunCaseId harus uuid", () => expect(ok(createBugBody, { ...base, manualRunCaseId: "x" })).toBe(false));
  it("ditolak bersama testCaseId atau runId, dilaporkan pada manualRunCaseId", () => {
    expect(ok(createBugBody, { ...base, manualRunCaseId: UUID_A, testCaseId: UUID_B })).toBe(false);
    expect(ok(createBugBody, { ...base, manualRunCaseId: UUID_A, testCaseId: UUID_B, runId: UUID_B })).toBe(false);
    expect(pathsOf(createBugBody, { ...base, manualRunCaseId: UUID_A, testCaseId: UUID_B })).toEqual(["manualRunCaseId"]);
  });
});

describe("DTO manual", () => {
  const userRef = { id: UUID_A, name: "Budi" };
  const counts = { untested: 1, passed: 2, failed: 0, blocked: 0, skipped: 0 };

  it("manualRunRefDto dan manualSummaryDto", () => {
    expect(ok(manualRunRefDto, { number: 3, name: "Rilis", status: "open", total: 3, counts })).toBe(true);
    expect(ok(manualSummaryDto, { latestRun: null, coverage: { active: 0, automated: 0 } })).toBe(true);
  });

  it("casesPageDto membawa coverage", () => {
    expect(ok(casesPageDto, { items: [], nextCursor: null, coverage: { active: 40, automated: 12 } })).toBe(true);
    expect(ok(casesPageDto, { items: [], nextCursor: null })).toBe(false);
  });

  it("manualCaseDto menerima automatedTest dan recentResults", () => {
    const dto = {
      number: 12,
      suite: { id: UUID_A, name: "Login" },
      title: "Login berhasil",
      preconditions: "",
      steps: [step],
      priority: "medium",
      labels: ["ui"],
      archivedAt: null,
      createdBy: userRef,
      updatedBy: userRef,
      createdAt: "2026-11-08T00:00:00.000Z",
      updatedAt: "2026-11-08T00:00:00.000Z",
      version: 1,
      automatedTest: {
        id: UUID_B,
        suite: "auth",
        name: "login ok",
        lastResult: { status: "passed", runId: UUID_A, createdAt: "2026-11-08T00:00:00.000Z", branch: "main" },
      },
      recentResults: [
        { runCaseId: UUID_A, runNumber: 1, runName: "Rilis", appVersion: null, status: "passed", executedAt: "2026-11-08T00:00:00.000Z" },
      ],
    };
    expect(ok(manualCaseDto, dto)).toBe(true);
    expect(ok(manualCaseDto, { ...dto, automatedTest: null, recentResults: [] })).toBe(true);
  });

  it("runCaseDto membawa nextUntestedId, caseId, dan runStatus", () => {
    const dto = {
      id: UUID_A,
      position: 0,
      caseNumber: 12,
      title: "Login berhasil",
      suiteName: "Login",
      priority: "medium",
      status: "untested",
      assignee: null,
      executedAt: null,
      bugs: [{ number: 4, title: "Bug", status: "open" }],
      preconditions: "",
      steps: [step],
      stepResults: [{ status: null, note: "" }],
      note: "",
      executedBy: null,
      version: 1,
      updatedAt: "2026-11-08T00:00:00.000Z",
      nextUntestedId: null,
      caseId: null,
      runStatus: "open",
    };
    expect(ok(runCaseDto, dto)).toBe(true);
    expect(ok(runCaseDto, { ...dto, runStatus: undefined })).toBe(false);
  });

  it("bugDto membawa manualOrigin (nullable)", () => {
    const shape = bugDto.shape;
    expect(Object.keys(shape)).toContain("manualOrigin");
    expect(ok(shape.manualOrigin, null)).toBe(true);
    const origin = { runNumber: 3, runName: "Rilis", caseNumber: 12, caseTitle: "Login" };
    expect(ok(shape.manualOrigin, { ...origin, runCaseId: "44444444-4444-4444-8444-444444444444" })).toBe(true);
    // Tanpa `runCaseId` detail bug tidak bisa menaut ke halaman eksekusi.
    expect(ok(shape.manualOrigin, origin)).toBe(false);
    expect(ok(shape.manualOrigin, undefined)).toBe(false);
  });
});
