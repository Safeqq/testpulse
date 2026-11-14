import { z } from "zod";
import { BUG_PRIORITIES, bugLabel, bugRefDto, hasControlChars, userRefDto } from "./bugs.js";
import { RESULT_STATUSES, runVersion } from "./results.js";

// Spec Tahap 4 §3 dan §4: test case manual, suite, run manual, dan run case.

export const CASE_PRIORITIES = BUG_PRIORITIES;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const MANUAL_RESULT_STATUSES = ["untested", "passed", "failed", "blocked", "skipped"] as const;
export type ManualResultStatus = (typeof MANUAL_RESULT_STATUSES)[number];

// Hasil per langkah: sama dengan hasil case tanpa `untested` (langkah yang belum diisi bernilai `null`).
export const STEP_RESULT_STATUSES = ["passed", "failed", "blocked", "skipped"] as const;
export type StepResultStatus = (typeof STEP_RESULT_STATUSES)[number];

export const MANUAL_RUN_STATUSES = ["open", "completed"] as const;
export type ManualRunStatus = (typeof MANUAL_RUN_STATUSES)[number];

export const MAX_STEPS = 50;
export const MAX_RUN_CASES = 500;
export const MAX_SUITES = 200;

const CONTROL_CHARS_MESSAGE = "Teks tidak boleh mengandung karakter kontrol";
const noControlChars = (value: string) => !hasControlChars(value);

// Optimistic concurrency (sama dengan updateBugBody).
const versionField = z.int("Versi tidak valid").min(1, "Versi tidak valid").max(2_147_483_647, "Versi tidak valid");

const hasChange = (body: object) =>
  Object.entries(body).some(([key, value]) => key !== "version" && value !== undefined);
const NO_CHANGE_MESSAGE = "Minimal satu field harus diubah";

const uuidField = (message: string) => z.uuid(message);

// --- Suite -----------------------------------------------------------------------------------------------------

const suiteName = z
  .string()
  .trim()
  .min(1, "Nama suite wajib diisi")
  .max(100, "Nama suite maksimal 100 karakter")
  .refine(noControlChars, CONTROL_CHARS_MESSAGE);
const suiteDescription = z
  .string()
  .max(2000, "Deskripsi maksimal 2000 karakter")
  .refine(noControlChars, CONTROL_CHARS_MESSAGE);

export const suiteBody = z.object({
  name: suiteName,
  description: suiteDescription.optional(),
});
export type SuiteBody = z.infer<typeof suiteBody>;

export const updateSuiteBody = z
  .object({
    name: suiteName.optional(),
    description: suiteDescription.optional(),
    position: z.int("Posisi tidak valid").min(0, "Posisi tidak valid").optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: NO_CHANGE_MESSAGE });
export type UpdateSuiteBody = z.infer<typeof updateSuiteBody>;

// --- Case ------------------------------------------------------------------------------------------------------

export const caseStep = z.object({
  action: z
    .string()
    .trim()
    .min(1, "Langkah wajib diisi")
    .max(2000, "Langkah maksimal 2000 karakter")
    .refine(noControlChars, CONTROL_CHARS_MESSAGE),
  expected: z
    .string()
    .max(2000, "Hasil yang diharapkan maksimal 2000 karakter")
    .refine(noControlChars, CONTROL_CHARS_MESSAGE),
});
export type CaseStep = z.infer<typeof caseStep>;

const caseSteps = z
  .array(caseStep)
  .min(1, "Minimal 1 langkah")
  .max(MAX_STEPS, `Maksimal ${MAX_STEPS} langkah`);

const caseTitle = z
  .string()
  .trim()
  .min(3, "Judul minimal 3 karakter")
  .max(200, "Judul maksimal 200 karakter")
  .refine(noControlChars, CONTROL_CHARS_MESSAGE);
const casePreconditions = z
  .string()
  .max(5000, "Prasyarat maksimal 5000 karakter")
  .refine(noControlChars, CONTROL_CHARS_MESSAGE);
const casePriority = z.enum(CASE_PRIORITIES);

// Aturan label persis label bug: dinormalisasi lalu keunikan diperiksa pada hasilnya.
const caseLabels = z
  .array(bugLabel)
  .max(10, "Maksimal 10 label")
  .refine((labels) => new Set(labels).size === labels.length, "Label tidak boleh duplikat");

const suiteIdField = uuidField("Suite tidak valid");
const automatedTestId = uuidField("Test otomatis tidak valid");

export const createCaseBody = z.object({
  suiteId: suiteIdField,
  title: caseTitle,
  preconditions: casePreconditions.optional(),
  steps: caseSteps,
  priority: casePriority.optional(),
  labels: caseLabels.optional(),
  automatedTestId: automatedTestId.nullable().optional(),
});
export type CreateCaseBody = z.infer<typeof createCaseBody>;

export const updateCaseBody = z
  .object({
    version: versionField,
    suiteId: suiteIdField.optional(),
    title: caseTitle.optional(),
    preconditions: casePreconditions.optional(),
    steps: caseSteps.optional(),
    priority: casePriority.optional(),
    labels: caseLabels.optional(),
    automatedTestId: automatedTestId.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine(hasChange, { message: NO_CHANGE_MESSAGE });
export type UpdateCaseBody = z.infer<typeof updateCaseBody>;

// Spec §7: `automated` = yes | no, `archived` = false (default) | true. `suite` berupa id suite.
export const caseListQuery = z.object({
  suite: uuidField("Suite tidak valid").optional(),
  q: z
    .string()
    .trim()
    .max(100, "Pencarian maksimal 100 karakter")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  priority: casePriority.optional(),
  label: bugLabel.optional(),
  automated: z.enum(["yes", "no"]).optional(),
  archived: z.enum(["false", "true"]).default("false"),
  cursor: z.string().optional(),
});
export type CaseListQuery = z.infer<typeof caseListQuery>;

export const testSearchQuery = z.object({
  q: z.string().trim().min(2, "Pencarian minimal 2 karakter").max(100, "Pencarian maksimal 100 karakter"),
});
export type TestSearchQuery = z.infer<typeof testSearchQuery>;

// --- Run manual ------------------------------------------------------------------------------------------------

const runName = z
  .string()
  .trim()
  .min(3, "Nama minimal 3 karakter")
  .max(120, "Nama maksimal 120 karakter")
  .refine(noControlChars, CONTROL_CHARS_MESSAGE);

const SELECTION_MESSAGE = `Pilih 1–${MAX_RUN_CASES} case aktif`;
const longerThan = (value: unknown, max: number) => Array.isArray(value) && value.length > max;

// Seleksi di luar 1–500 dilaporkan pada `selection` (spec §4.2), sama dengan hasil seleksi server: seleksi kosong, dan
// array yang sudah pasti melewati batas (lebih dari 500 nomor case, atau lebih dari 200 suite = batas suite per
// project). Validasi per item tetap pada `suiteIds`/`caseNumbers`; pemeriksaan panjang tetap berjalan walau ada item
// tidak sah (`when`), supaya kedua kesalahan terlihat sekaligus.
export const createManualRunBody = z
  .object({
    name: runName,
    appVersion: runVersion.optional(),
    suiteIds: z.array(uuidField("Suite tidak valid")).default([]),
    caseNumbers: z.array(z.int("Nomor case tidak valid").min(1, "Nomor case tidak valid")).default([]),
  })
  .refine((body) => body.suiteIds.length > 0 || body.caseNumbers.length > 0, {
    message: SELECTION_MESSAGE,
    path: ["selection"],
  })
  .refine((body) => !longerThan(body.caseNumbers, MAX_RUN_CASES) && !longerThan(body.suiteIds, MAX_SUITES), {
    message: SELECTION_MESSAGE,
    path: ["selection"],
    when: (payload) => typeof payload.value === "object" && payload.value !== null,
  });
export type CreateManualRunBody = z.infer<typeof createManualRunBody>;

export const updateManualRunBody = z
  .object({
    version: versionField,
    name: runName.optional(),
    // `null` menghapus versi aplikasi dari run.
    appVersion: runVersion.nullable().optional(),
    status: z.enum(MANUAL_RUN_STATUSES).optional(),
  })
  .refine(hasChange, { message: NO_CHANGE_MESSAGE });
export type UpdateManualRunBody = z.infer<typeof updateManualRunBody>;

export const manualRunListQuery = z.object({
  status: z.enum([...MANUAL_RUN_STATUSES, "all"]).default("all"),
  appVersion: runVersion.optional(),
  cursor: z.string().optional(),
});
export type ManualRunListQuery = z.infer<typeof manualRunListQuery>;

// --- Run case --------------------------------------------------------------------------------------------------

export const stepResult = z.object({
  status: z.enum(STEP_RESULT_STATUSES).nullable(),
  note: z
    .string()
    .max(1000, "Catatan langkah maksimal 1000 karakter")
    .refine(noControlChars, CONTROL_CHARS_MESSAGE)
    .default(""),
});
export type StepResult = z.infer<typeof stepResult>;

export const updateRunCaseBody = z
  .object({
    version: versionField,
    status: z.enum(MANUAL_RESULT_STATUSES).optional(),
    // Panjangnya harus sama dengan jumlah langkah snapshot; itu diperiksa server (`fields.stepResults`).
    stepResults: z.array(stepResult).max(MAX_STEPS, `Maksimal ${MAX_STEPS} langkah`).optional(),
    note: z.string().max(5000, "Catatan maksimal 5000 karakter").refine(noControlChars, CONTROL_CHARS_MESSAGE).optional(),
    assigneeId: uuidField("Assignee tidak valid").nullable().optional(),
  })
  .refine(hasChange, { message: NO_CHANGE_MESSAGE });
export type UpdateRunCaseBody = z.infer<typeof updateRunCaseBody>;

// `suite` = nama suite snapshot; `assignee` = uuid | me | none (seperti daftar bug).
export const runCaseListQuery = z.object({
  status: z.enum(MANUAL_RESULT_STATUSES).optional(),
  assignee: z.union([z.literal("me"), z.literal("none"), z.uuid()]).optional(),
  suite: z.string().max(100, "Nama suite maksimal 100 karakter").optional(),
  cursor: z.string().optional(),
});
export type RunCaseListQuery = z.infer<typeof runCaseListQuery>;

// --- DTO -------------------------------------------------------------------------------------------------------

// Tanggal diserialkan sebagai string ISO, seperti bugDto.
export const suiteDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  position: z.number(),
  activeCount: z.number(),
  archivedCount: z.number(),
});
export type SuiteDto = z.infer<typeof suiteDto>;

// Cakupan otomasi seluruh project (bukan hasil filter): case aktif dan yang sudah tertaut ke automated test.
export const caseCoverageDto = z.object({ active: z.number(), automated: z.number() });
export type CaseCoverageDto = z.infer<typeof caseCoverageDto>;

const suiteRefDto = z.object({ id: z.string(), name: z.string() });

export const manualCaseListItemDto = z.object({
  number: z.number(),
  title: z.string(),
  suite: suiteRefDto,
  priority: z.enum(CASE_PRIORITIES),
  labels: z.array(z.string()),
  stepCount: z.number(),
  automated: z.boolean(),
  archived: z.boolean(),
  updatedAt: z.string(),
});
export type ManualCaseListItemDto = z.infer<typeof manualCaseListItemDto>;

export const casesPageDto = z.object({
  items: z.array(manualCaseListItemDto),
  nextCursor: z.string().nullable(),
  coverage: caseCoverageDto,
});
export type CasesPageDto = z.infer<typeof casesPageDto>;

// Hasil terbaru case ini pada run manual (maks 10, terbaru dulu). `runCaseId` untuk tautan ke halaman eksekusi.
export const caseRecentResultDto = z.object({
  runCaseId: z.string(),
  runNumber: z.number(),
  runName: z.string(),
  appVersion: z.string().nullable(),
  status: z.enum(MANUAL_RESULT_STATUSES),
  executedAt: z.string().nullable(),
});
export type CaseRecentResultDto = z.infer<typeof caseRecentResultDto>;

export const manualCaseDto = z.object({
  number: z.number(),
  suite: suiteRefDto,
  title: z.string(),
  preconditions: z.string(),
  steps: z.array(caseStep),
  priority: z.enum(CASE_PRIORITIES),
  labels: z.array(z.string()),
  archivedAt: z.string().nullable(),
  createdBy: userRefDto,
  updatedBy: userRefDto,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
  // Spec §5.3: test otomatis tertaut beserta hasil terakhirnya di branch default project.
  automatedTest: z
    .object({
      id: z.string(),
      suite: z.string(),
      name: z.string(),
      lastResult: z
        .object({
          status: z.enum(RESULT_STATUSES),
          runId: z.string(),
          createdAt: z.string(),
          branch: z.string(),
        })
        .nullable(),
    })
    .nullable(),
  recentResults: z.array(caseRecentResultDto),
});
export type ManualCaseDto = z.infer<typeof manualCaseDto>;

export const testSearchItemDto = z.object({ id: z.string(), suite: z.string(), name: z.string() });
export type TestSearchItemDto = z.infer<typeof testSearchItemDto>;

export const manualCountsDto = z.object({
  untested: z.number(),
  passed: z.number(),
  failed: z.number(),
  blocked: z.number(),
  skipped: z.number(),
});
export type ManualCountsDto = z.infer<typeof manualCountsDto>;

export const manualRunSummaryDto = z.object({
  number: z.number(),
  name: z.string(),
  appVersion: z.string().nullable(),
  status: z.enum(MANUAL_RUN_STATUSES),
  total: z.number(),
  counts: manualCountsDto,
  // (total - untested) / total, 0 untuk run kosong.
  progress: z.number(),
  createdBy: userRefDto,
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type ManualRunSummaryDto = z.infer<typeof manualRunSummaryDto>;

// Detail run: ringkasan + field untuk concurrency dan audit.
export const manualRunDto = manualRunSummaryDto.extend({
  completedBy: userRefDto.nullable(),
  updatedAt: z.string(),
  version: z.number(),
});
export type ManualRunDto = z.infer<typeof manualRunDto>;

export const manualRunsPageDto = z.object({
  items: z.array(manualRunSummaryDto),
  nextCursor: z.string().nullable(),
});
export type ManualRunsPageDto = z.infer<typeof manualRunsPageDto>;

export const runCaseListItemDto = z.object({
  id: z.string(),
  position: z.number(),
  caseNumber: z.number(),
  title: z.string(),
  suiteName: z.string(),
  priority: z.enum(CASE_PRIORITIES),
  status: z.enum(MANUAL_RESULT_STATUSES),
  assignee: userRefDto.nullable(),
  executedAt: z.string().nullable(),
  // Bug non-`closed` yang tertaut ke run case ini (maks 5, terbaru dulu).
  bugs: z.array(bugRefDto),
});
export type RunCaseListItemDto = z.infer<typeof runCaseListItemDto>;

export const runCasesPageDto = z.object({
  items: z.array(runCaseListItemDto),
  nextCursor: z.string().nullable(),
});
export type RunCasesPageDto = z.infer<typeof runCasesPageDto>;

export const runCaseDto = runCaseListItemDto.extend({
  preconditions: z.string(),
  steps: z.array(caseStep),
  stepResults: z.array(stepResult),
  note: z.string(),
  executedBy: userRefDto.nullable(),
  version: z.number(),
  updatedAt: z.string(),
  // Run case `untested` berikutnya setelah posisi ini (berputar ke awal); `null` bila tidak ada.
  nextUntestedId: z.string().nullable(),
  // `null` bila case aslinya sudah dihapus.
  caseId: z.string().nullable(),
  // Status run induk, agar halaman eksekusi tahu kapan hanya-baca.
  runStatus: z.enum(MANUAL_RUN_STATUSES),
});
export type RunCaseDto = z.infer<typeof runCaseDto>;

// Rujukan run manual pada baris versi (spec §5.1).
export const manualRunRefDto = z.object({
  number: z.number(),
  name: z.string(),
  status: z.enum(MANUAL_RUN_STATUSES),
  total: z.number(),
  counts: manualCountsDto,
});
export type ManualRunRefDto = z.infer<typeof manualRunRefDto>;

// `GET /manual/summary` (spec §5.2).
export const manualSummaryDto = z.object({
  latestRun: manualRunSummaryDto.nullable(),
  coverage: caseCoverageDto,
});
export type ManualSummaryDto = z.infer<typeof manualSummaryDto>;
