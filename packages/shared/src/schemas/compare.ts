import { z } from "zod";
import { bugRefDto } from "./bugs.js";
import { manualRunRefDto } from "./manual.js";
import { branchName, runSummaryDto } from "./results.js";
import { RESULT_STATUSES } from "./result-status.js";

// Urutan tampil kelompok perbandingan (spec §4.4 dan §7.2).
export const COMPARE_GROUPS = ["regressions", "fixed", "stillFailing", "slower", "added", "removed"] as const;
export type CompareGroup = (typeof COMPARE_GROUPS)[number];

// Batas daftar versi yang dijawab API (terbaru dulu); klien memakainya untuk mengenali daftar yang terpotong.
export const MAX_VERSIONS = 100;

const compareSideDto = z.object({
  status: z.enum(RESULT_STATUSES),
  durationMs: z.number(),
  message: z.string().nullable(),
  flakyInRun: z.boolean(),
});

// `base` null = test baru; `target` null = test hilang.
export const compareItemDto = z.object({
  testCaseId: z.string(),
  suite: z.string(),
  name: z.string(),
  base: compareSideDto.nullable(),
  target: compareSideDto.nullable(),
  bugs: z.array(bugRefDto),
});
export type CompareItemDto = z.infer<typeof compareItemDto>;

export const compareGroupPageDto = z.object({
  items: z.array(compareItemDto),
  nextCursor: z.string().nullable(),
});
export type CompareGroupPageDto = z.infer<typeof compareGroupPageDto>;

export const compareDto = z.object({
  base: runSummaryDto.nullable(),
  target: runSummaryDto.nullable(),
  summary: z.object({
    regressions: z.number(),
    fixed: z.number(),
    stillFailing: z.number(),
    slower: z.number(),
    added: z.number(),
    removed: z.number(),
  }),
  groups: z.object({
    regressions: compareGroupPageDto,
    fixed: compareGroupPageDto,
    stillFailing: compareGroupPageDto,
    slower: compareGroupPageDto,
    added: compareGroupPageDto,
    removed: compareGroupPageDto,
  }),
});
export type CompareDto = z.infer<typeof compareDto>;

// Tahap 4 §5.1: `run` null (dengan `runCount` 0, pass rate & delta null) untuk versi yang hanya punya run manual.
export const versionDto = z.object({
  version: z.string(),
  run: runSummaryDto.nullable(),
  runCount: z.number(),
  // `null` bila run terakhir versi itu tidak punya test yang dijalankan (lulus + gagal = 0).
  passRate: z.number().nullable(),
  // Selisih poin terhadap versi automated tepat di bawahnya; `null` bila tidak ada versi automated di bawahnya.
  passRateDelta: z.number().nullable(),
  // Run manual terbaru (nomor TR terbesar) berversi sama; `null` bila tidak ada.
  manual: manualRunRefDto.nullable(),
});
export type VersionDto = z.infer<typeof versionDto>;

// `base`/`target` berupa id run; id yang tidak dikenal dijawab 404 RUN_NOT_FOUND oleh API, bukan 400.
export const compareQuery = z
  .object({
    base: z.string().optional(),
    target: z.string().optional(),
    branch: branchName.optional(),
    group: z.enum(COMPARE_GROUPS).optional(),
    cursor: z.string().optional(),
    // "none": hanya ringkasan angka (semua kelompok kosong) untuk kartu dashboard dan panel detail run.
    groups: z.literal("none").optional(),
  })
  .refine((q) => q.cursor === undefined || q.group !== undefined, {
    message: "Kelompok wajib diisi bersama cursor",
    path: ["group"],
  })
  .refine((q) => q.groups === undefined || q.group === undefined, {
    message: "groups=none tidak dapat dipakai bersama group",
    path: ["groups"],
  });
export type CompareQuery = z.infer<typeof compareQuery>;
