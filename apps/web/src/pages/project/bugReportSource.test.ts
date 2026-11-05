import type { RunDetailDto, TestHistoryDto } from "@testpulse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const history = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { results: { run, history } } };
});

const { ApiError } = await import("@/lib/api");
const { loadBugReportSource } = await import("./bugReportSource");

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

  it("kegagalan selain RUN_NOT_FOUND dilempar ke pemanggil", async () => {
    run.mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "Gagal"));
    await expect(loadBugReportSource("p", TEST_ID, RUN_ID)).rejects.toMatchObject({ status: 500 });
    expect(history).not.toHaveBeenCalled();
  });
});
