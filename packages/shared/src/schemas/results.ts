import { z } from "zod";
import { bugRefDto } from "./bugs.js";
import { RESULT_STATUSES } from "./result-status.js";

export { RESULT_STATUSES, type ResultStatus } from "./result-status.js";

// Versi aplikasi pada run (spec Tahap 3 §4.1): 1–50 karakter [A-Za-z0-9._+-].
export const runVersion = z
  .string()
  .min(1, "Versi wajib diisi")
  .max(50, "Versi maksimal 50 karakter")
  .regex(/^[A-Za-z0-9._+-]+$/, "Versi hanya boleh berisi huruf, angka, titik, garis bawah, plus, dan tanda hubung");

// Aturan nama branch dipakai bersama oleh query upload, daftar run, dan perbandingan.
export const branchName = z
  .string()
  .min(1, "Branch wajib diisi")
  .max(200, "Branch maksimal 200 karakter")
  .regex(/^[A-Za-z0-9._/-]+$/, "Branch hanya boleh berisi huruf, angka, titik, garis bawah, garis miring, dan tanda hubung");

// Query upload JUnit XML (spec §4). `commit` dipetakan ke `commitSha` pada output.
export const ingestQuery = z
  .object({
    branch: branchName,
    commit: z
      .string()
      .regex(/^[0-9a-fA-F]{7,40}$/, "Commit harus berupa hex 7–40 karakter")
      .optional(),
    ciUrl: z
      .string()
      .max(500, "URL CI maksimal 500 karakter")
      .refine((v) => {
        if (!/^https?:\/\//i.test(v)) return false;
        try {
          const { protocol, username, password } = new URL(v);
          return (protocol === "http:" || protocol === "https:") && username === "" && password === "";
        } catch {
          return false;
        }
      }, "URL CI harus berupa URL http atau https tanpa username/password")
      .optional(),
    name: z.string().max(120, "Nama maksimal 120 karakter").optional(),
    version: runVersion.optional(),
  })
  .transform(({ commit, ...rest }) => (commit === undefined ? rest : { ...rest, commitSha: commit.toLowerCase() }));
export type IngestQuery = z.infer<typeof ingestQuery>;

const totalsDto = z.object({
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  flaky: z.number(),
});

export const ingestResultDto = z.object({
  runId: z.string(),
  url: z.string(),
  totals: totalsDto,
});
export type IngestResultDto = z.infer<typeof ingestResultDto>;

export const runSummaryDto = z.object({
  id: z.string(),
  branch: z.string(),
  commitSha: z.string().nullable(),
  ciUrl: z.string().nullable(),
  name: z.string().nullable(),
  createdAt: z.string(),
  durationMs: z.number(),
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  flaky: z.number(),
  version: z.string().nullable(),
});
export type RunSummaryDto = z.infer<typeof runSummaryDto>;

export const runsPageDto = z.object({
  runs: z.array(runSummaryDto),
  nextCursor: z.string().nullable(),
});
export type RunsPageDto = z.infer<typeof runsPageDto>;

export const testResultDto = z.object({
  testCaseId: z.string(),
  suite: z.string(),
  name: z.string(),
  status: z.enum(RESULT_STATUSES),
  flakyInRun: z.boolean(),
  retries: z.number(),
  durationMs: z.number(),
  message: z.string().nullable(),
  bugs: z.array(bugRefDto),
});
export type TestResultDto = z.infer<typeof testResultDto>;

export const runDetailDto = z.object({
  run: runSummaryDto,
  results: z.array(testResultDto),
  nextCursor: z.string().nullable(),
});
export type RunDetailDto = z.infer<typeof runDetailDto>;

export const branchDto = z.object({
  branch: z.string(),
  lastRun: runSummaryDto,
});
export type BranchDto = z.infer<typeof branchDto>;

export const statsDto = z.object({
  branch: z.string().nullable(),
  points: z.array(
    z.object({
      runId: z.string(),
      createdAt: z.string(),
      passRate: z.number().nullable(),
      durationMs: z.number(),
    }),
  ),
  latest: runSummaryDto.nullable(),
});
export type StatsDto = z.infer<typeof statsDto>;

export const flakyTestDto = z.object({
  testCaseId: z.string(),
  suite: z.string(),
  name: z.string(),
  score: z.number(),
  lastStatus: z.enum(RESULT_STATUSES),
  bugs: z.array(bugRefDto),
});
export type FlakyTestDto = z.infer<typeof flakyTestDto>;

export const testHistoryDto = z.object({
  testCase: z.object({ id: z.string(), suite: z.string(), name: z.string(), bugs: z.array(bugRefDto) }),
  branch: z.string().nullable(),
  results: z.array(
    z.object({
      runId: z.string(),
      createdAt: z.string(),
      status: z.enum(RESULT_STATUSES),
      flakyInRun: z.boolean(),
      retries: z.number(),
      durationMs: z.number(),
    }),
  ),
});
export type TestHistoryDto = z.infer<typeof testHistoryDto>;
