import type { ManualRunDto, RunCaseDto, RunDetailDto, TestHistoryDto } from "@testpulse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const history = vi.fn();
const manualRun = vi.fn();
const runCase = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: { results: { run, history }, manual: { runs: { get: manualRun }, runCases: { get: runCase } } },
  };
});

const { ApiError } = await import("@/lib/api");
const { loadBugReportSource, loadManualBugReportSource } = await import("./bugReportSource");

const TEST_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

const RUN_SUMMARY = {
  id: RUN_ID,
  branch: "main",
  commitSha: "abc1234",
  ciUrl: "https://ci.example.com/1",
  name: null,
  createdAt: "2026-11-05T00:00:00.000Z",
  durationMs: 1,
  total: 2,
  passed: 0,
  failed: 2,
  skipped: 0,
  flaky: 0,
  version: null,
};

const result = (testCaseId: string, name: string) => ({
  testCaseId,
  suite: "checkout",
  name,
  status: "failed" as const,
  flakyInRun: false,
  retries: 0,
  durationMs: 1,
  message: `pesan ${name}`,
  bugs: [],
});

const page = (results: ReturnType<typeof result>[], nextCursor: string | null): RunDetailDto => ({
  run: RUN_SUMMARY,
  results,
  nextCursor,
});

const HISTORY: TestHistoryDto = {
  testCase: { id: TEST_ID, suite: "checkout", name: "B gagal", bugs: [] },
  branch: "dev",
  results: [],
};

beforeEach(() => {
  run.mockReset();
  history.mockReset();
  manualRun.mockReset();
  runCase.mockReset();
});

describe("loadBugReportSource", () => {
  it("memindai halaman hasil gagal sampai menemukan test dan memakai pesan, branch, commit, dan CI run", async () => {
    run
      .mockResolvedValueOnce(page([result("x", "lain")], "c1"))
      .mockResolvedValueOnce(page([result(TEST_ID, "B gagal")], null));

    const prefill = await loadBugReportSource("p", TEST_ID, RUN_ID);

    expect(run).toHaveBeenNthCalledWith(1, "p", RUN_ID, { status: "failed", cursor: undefined });
    expect(run).toHaveBeenNthCalledWith(2, "p", RUN_ID, { status: "failed", cursor: "c1" });
    expect(history).not.toHaveBeenCalled();
    expect(prefill).toMatchObject({ testCaseId: TEST_ID, runId: RUN_ID, title: "B gagal", suite: "checkout" });
    expect(prefill.description).toContain("pesan B gagal");
    expect(prefill.description).toContain("`main`");
    expect(prefill.description).toContain("<https://ci.example.com/1>");
  });

  it("RUN_NOT_FOUND: memakai riwayat test dan membuang runId agar bug tidak tertaut ke run yang hilang", async () => {
    run.mockRejectedValue(new ApiError(404, "RUN_NOT_FOUND", "Run tidak ditemukan"));
    history.mockResolvedValue(HISTORY);

    const prefill = await loadBugReportSource("p", TEST_ID, RUN_ID);

    expect(prefill.runId).toBeUndefined();
    expect(prefill).toMatchObject({ testCaseId: TEST_ID, title: "B gagal", suite: "checkout" });
    expect(prefill.description).toContain("`dev`");
    expect(prefill.description).not.toContain("Pesan error");
  });

  it("test tidak termasuk hasil gagal run: riwayat test dipakai, runId tetap (server yang memvalidasi pasangannya)", async () => {
    run.mockResolvedValue(page([result("x", "lain")], null));
    history.mockResolvedValue(HISTORY);

    const prefill = await loadBugReportSource("p", TEST_ID, RUN_ID);

    expect(prefill.runId).toBe(RUN_ID);
    expect(prefill.title).toBe("B gagal");
  });

  it("tanpa runId langsung memakai riwayat test", async () => {
    history.mockResolvedValue(HISTORY);
    const prefill = await loadBugReportSource("p", TEST_ID, undefined);
    expect(run).not.toHaveBeenCalled();
    expect(prefill.runId).toBeUndefined();
  });

  it("judul awal dari nama test dibersihkan dan dipotong 200 karakter (hasil run maupun riwayat test)", async () => {
    const longName = `\u0085${"n".repeat(250)}`;
    run.mockResolvedValueOnce(page([result(TEST_ID, longName)], null));
    const fromRun = await loadBugReportSource("p", TEST_ID, RUN_ID);
    expect(fromRun.title).toBe("n".repeat(200));
    expect(fromRun.testName).toBe(longName);

    history.mockResolvedValue({ ...HISTORY, testCase: { ...HISTORY.testCase, name: `x\u0000${"m".repeat(300)}` } });
    const fromHistory = await loadBugReportSource("p", TEST_ID, undefined);
    expect(fromHistory.title).toBe(`x${"m".repeat(199)}`);
  });

  it("kegagalan selain RUN_NOT_FOUND dilempar ke pemanggil", async () => {
    run.mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "Gagal"));
    await expect(loadBugReportSource("p", TEST_ID, RUN_ID)).rejects.toMatchObject({ status: 500 });
    expect(history).not.toHaveBeenCalled();
  });
});

const USER = { id: "33333333-3333-4333-8333-333333333333", name: "Tester" };
const RUN_CASE_ID = "44444444-4444-4444-8444-444444444444";

const MANUAL_RUN: ManualRunDto = {
  number: 3,
  name: "Regresi rilis",
  appVersion: "v0.4.0",
  status: "completed",
  total: 1,
  counts: { untested: 0, passed: 0, failed: 1, blocked: 0, skipped: 0 },
  progress: 1,
  createdBy: USER,
  createdAt: "2026-11-05T00:00:00.000Z",
  completedAt: "2026-11-06T00:00:00.000Z",
  completedBy: USER,
  updatedAt: "2026-11-06T00:00:00.000Z",
  version: 2,
};

const RUN_CASE: RunCaseDto = {
  id: RUN_CASE_ID,
  position: 0,
  caseNumber: 12,
  title: "Bayar dengan kartu",
  suiteName: "Checkout",
  priority: "high",
  status: "failed",
  assignee: null,
  executedAt: "2026-11-05T01:00:00.000Z",
  bugs: [],
  preconditions: "Masuk",
  steps: [{ action: "Klik bayar", expected: "Sukses" }],
  stepResults: [{ status: "failed", note: "Tidak merespons" }],
  note: "Catatan",
  executedBy: USER,
  version: 2,
  updatedAt: "2026-11-05T01:00:00.000Z",
  nextUntestedId: null,
  caseId: null,
  runStatus: "completed",
};

describe("loadManualBugReportSource", () => {
  it("mengisi judul dan deskripsi dari snapshot run case serta nama dan versi run", async () => {
    manualRun.mockResolvedValue(MANUAL_RUN);
    runCase.mockResolvedValue(RUN_CASE);

    const prefill = await loadManualBugReportSource("p", 3, RUN_CASE_ID);

    expect(manualRun).toHaveBeenCalledWith("p", 3);
    expect(runCase).toHaveBeenCalledWith("p", 3, RUN_CASE_ID);
    expect(prefill).toMatchObject({
      kind: "manual",
      manualRunCaseId: RUN_CASE_ID,
      runNumber: 3,
      runName: "Regresi rilis",
      caseNumber: 12,
      caseTitle: "Bayar dengan kartu",
      title: "TC-12 gagal: Bayar dengan kartu",
    });
    expect(prefill.description).toContain("- **Run:** TR-3 · `Regresi rilis`");
    expect(prefill.description).toContain("- **Versi:** `v0.4.0`");
    expect(prefill.description).toContain("| 1 | `Klik bayar` | `Sukses` | **✗ Gagal** | `Tidak merespons` |");
  });

  it("run atau run case yang tidak ada dilempar ke pemanggil", async () => {
    manualRun.mockResolvedValue(MANUAL_RUN);
    runCase.mockRejectedValue(new ApiError(404, "RUN_CASE_NOT_FOUND", "Case di run ini tidak ditemukan"));
    await expect(loadManualBugReportSource("p", 3, RUN_CASE_ID)).rejects.toMatchObject({ code: "RUN_CASE_NOT_FOUND" });
  });
});

describe("loadBugReportSource (jenis)", () => {
  it("isian dari test bertanda kind test", async () => {
    history.mockResolvedValue(HISTORY);
    expect(await loadBugReportSource("p", TEST_ID, undefined)).toMatchObject({ kind: "test" });
  });
});
