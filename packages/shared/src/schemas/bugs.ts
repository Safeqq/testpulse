import { z } from "zod";
import { RESULT_STATUSES } from "./result-status.js";

export const BUG_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export const BUG_RESOLUTIONS = ["fixed", "wont_fix", "duplicate", "cannot_reproduce"] as const;
export type BugResolution = (typeof BUG_RESOLUTIONS)[number];

export const BUG_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type BugPriority = (typeof BUG_PRIORITIES)[number];

export const BUG_SEVERITIES = ["minor", "major", "critical", "blocker"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

// Label dinormalisasi (trim + huruf kecil) sebelum divalidasi, sehingga " UI " menjadi "ui".
export const bugLabel = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Label wajib diisi")
  .max(30, "Label maksimal 30 karakter")
  .regex(/^[a-z0-9-]+$/, "Label hanya boleh berisi huruf, angka, dan tanda hubung");

// Keunikan diperiksa pada keluaran bugLabel, jadi ["ui", "UI"] dianggap duplikat.
const bugLabels = z
  .array(bugLabel)
  .max(10, "Maksimal 10 label")
  .refine((labels) => new Set(labels).size === labels.length, "Label tidak boleh duplikat");

const bugUrl = z
  .string()
  .max(2000, "URL maksimal 2000 karakter")
  .refine((v) => {
    if (!/^https?:\/\//i.test(v)) return false;
    try {
      const { protocol, username, password } = new URL(v);
      return (protocol === "http:" || protocol === "https:") && username === "" && password === "";
    } catch {
      return false;
    }
  }, "URL harus berupa URL http atau https tanpa username/password");

export const bugLink = z.object({
  url: bugUrl,
  title: z.string().trim().max(100, "Judul link maksimal 100 karakter").optional(),
});
export type BugLink = z.infer<typeof bugLink>;

const bugLinks = z.array(bugLink).max(10, "Maksimal 10 link");

const bugTitle = z.string().trim().min(3, "Judul minimal 3 karakter").max(200, "Judul maksimal 200 karakter");
const bugDescription = z.string().max(20000, "Deskripsi maksimal 20.000 karakter");
const bugPriority = z.enum(BUG_PRIORITIES);
const bugSeverity = z.enum(BUG_SEVERITIES);
const assigneeId = z.uuid("Assignee tidak valid").nullable();

export const createBugBody = z
  .object({
    title: bugTitle,
    description: bugDescription.optional(),
    priority: bugPriority.optional(),
    severity: bugSeverity.optional(),
    assigneeId: assigneeId.optional(),
    labels: bugLabels.optional(),
    links: bugLinks.optional(),
    testCaseId: z.uuid("Test tidak valid").optional(),
    runId: z.uuid("Run tidak valid").optional(),
  })
  .refine((body) => body.runId === undefined || body.testCaseId !== undefined, {
    message: "Run hanya boleh diisi bersama test",
    path: ["runId"],
  });
export type CreateBugBody = z.infer<typeof createBugBody>;

export const updateBugBody = z
  .object({
    version: z.int("Versi tidak valid").min(1, "Versi tidak valid"),
    title: bugTitle.optional(),
    description: bugDescription.optional(),
    priority: bugPriority.optional(),
    severity: bugSeverity.optional(),
    assigneeId: assigneeId.optional(),
    labels: bugLabels.optional(),
    links: bugLinks.optional(),
    status: z.enum(BUG_STATUSES).optional(),
    resolution: z.enum(BUG_RESOLUTIONS).nullable().optional(),
  })
  .refine((body) => Object.entries(body).some(([key, value]) => key !== "version" && value !== undefined), {
    message: "Minimal satu field harus diubah",
  });
export type UpdateBugBody = z.infer<typeof updateBugBody>;

export const commentBody = z.object({
  body: z.string().trim().min(1, "Komentar wajib diisi").max(10000, "Komentar maksimal 10.000 karakter"),
});
export type CommentBody = z.infer<typeof commentBody>;

export const BUG_LIST_STATUSES = ["active", "done", "all", ...BUG_STATUSES] as const;
export const BUG_SORTS = ["updated", "created", "priority"] as const;

// Spec §6: status `active` = open + in_progress, `done` = resolved + closed. Label dinormalisasi seperti `bugLabel`
// agar `label=UI` menemukan bug berlabel "ui".
export const bugListQuery = z.object({
  status: z.enum(BUG_LIST_STATUSES).default("active"),
  assignee: z.union([z.literal("me"), z.literal("none"), z.uuid()]).optional(),
  priority: bugPriority.optional(),
  severity: bugSeverity.optional(),
  label: bugLabel.optional(),
  q: z.string().max(100, "Pencarian maksimal 100 karakter").optional(),
  sort: z.enum(BUG_SORTS).default("updated"),
  cursor: z.string().optional(),
});
export type BugListQuery = z.infer<typeof bugListQuery>;

const userRefDto = z.object({ id: z.string(), name: z.string() });

export const bugRefDto = z.object({
  number: z.number(),
  title: z.string(),
  status: z.enum(BUG_STATUSES),
});
export type BugRefDto = z.infer<typeof bugRefDto>;

export const bugSummaryDto = z.object({
  number: z.number(),
  title: z.string(),
  status: z.enum(BUG_STATUSES),
  resolution: z.enum(BUG_RESOLUTIONS).nullable(),
  priority: z.enum(BUG_PRIORITIES),
  severity: z.enum(BUG_SEVERITIES),
  assignee: userRefDto.nullable(),
  labels: z.array(z.string()),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type BugSummaryDto = z.infer<typeof bugSummaryDto>;

// Petunjuk status test untuk bug yang tertaut ke test (spec §6.2). Hanya informasi; tidak mengubah status bug.
export const testHintDto = z.object({
  // `null` bila run asal sudah dihapus dan test itu tidak punya hasil lagi.
  branch: z.string().nullable(),
  results: z.array(
    z.object({
      runId: z.string(),
      createdAt: z.string(),
      status: z.enum(RESULT_STATUSES),
    }),
  ),
  consecutivePasses: z.number(),
  lastStatus: z.enum(RESULT_STATUSES).nullable(),
});
export type TestHintDto = z.infer<typeof testHintDto>;

export const bugDto = bugSummaryDto.extend({
  description: z.string(),
  reporter: userRefDto,
  links: z.array(z.object({ url: z.string(), title: z.string().nullable() })),
  testCase: z.object({ id: z.string(), suite: z.string(), name: z.string() }).nullable(),
  runId: z.string().nullable(),
  version: z.number(),
  resolvedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  testHint: testHintDto.nullable(),
});
export type BugDto = z.infer<typeof bugDto>;

export const bugsPageDto = z.object({
  bugs: z.array(bugSummaryDto),
  nextCursor: z.string().nullable(),
});
export type BugsPageDto = z.infer<typeof bugsPageDto>;

// `body` null dan `deletedAt` terisi untuk komentar yang sudah dihapus (soft delete).
export const commentDto = z.object({
  id: z.string(),
  author: userRefDto,
  body: z.string().nullable(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
});
export type CommentDto = z.infer<typeof commentDto>;

// `id` berupa string karena kolom bigserial.
export const bugEventDto = z.object({
  id: z.string(),
  actor: userRefDto,
  field: z.string(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  createdAt: z.string(),
});
export type BugEventDto = z.infer<typeof bugEventDto>;

export const activityItemDto = z.discriminatedUnion("kind", [
  commentDto.extend({ kind: z.literal("comment") }),
  bugEventDto.extend({ kind: z.literal("event") }),
]);
export type ActivityItemDto = z.infer<typeof activityItemDto>;

export const activityPageDto = z.object({
  items: z.array(activityItemDto),
  nextCursor: z.string().nullable(),
});
export type ActivityPageDto = z.infer<typeof activityPageDto>;
