import { z } from "zod";
import {
  BUG_PRIORITIES,
  BUG_SEVERITIES,
  CONTROL_CHARS_MESSAGE,
  bugLink,
  bugRefDto,
  bugUrl,
  noControlChars,
  userRefDto,
} from "./bugs.js";
import { runVersion } from "./results.js";

// Spec Tahap 5: crowdtesting — cycle publik, peserta, laporan, triase, dan reputasi.

export const CYCLE_STATUSES = ["draft", "open", "closed"] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const CROWD_REPORT_STATUSES = ["submitted", "accepted", "rejected", "duplicate", "withdrawn"] as const;
export type CrowdReportStatus = (typeof CROWD_REPORT_STATUSES)[number];

export const CROWD_SEVERITIES = BUG_SEVERITIES;
export type CrowdSeverity = (typeof CROWD_SEVERITIES)[number];

export const REJECT_REASONS = ["not_reproducible", "out_of_scope", "not_a_bug", "insufficient_info", "other"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const PARTICIPANT_STATUSES = ["active", "left", "removed"] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

// Status peserta yang dilihat dari sisi pengunjung halaman cycle publik (spec §8.2).
export const ME_STATES = ["anonymous", "can_join", "joined", "left", "removed", "member", "closed"] as const;
export type MeState = (typeof ME_STATES)[number];

export const SEVERITY_POINTS: Readonly<Record<CrowdSeverity, number>> = { minor: 1, major: 3, critical: 5, blocker: 8 };

export const MAX_CYCLE_LINKS = 5;
export const MAX_ENVIRONMENTS = 10;
export const MAX_SUBMITTED_PER_CYCLE = 10;
export const MAX_REPORTS_PER_CYCLE = 50;
export const MAX_REPORTS_PER_DAY = 30;
export const LEADERBOARD_SIZE = 50;

const versionField = z.int("Versi tidak valid").min(1, "Versi tidak valid").max(2_147_483_647, "Versi tidak valid");

const hasChange = (body: object) =>
  Object.entries(body).some(([key, value]) => key !== "version" && value !== undefined);
const NO_CHANGE_MESSAGE = "Minimal satu field harus diubah";

/** Teks bebas yang di-trim dengan batas panjang dan tanpa karakter kontrol. */
function text(min: number, max: number, label: string) {
  const base = z.string().trim();
  const sized = min > 0 ? base.min(min, `${label} minimal ${min} karakter`) : base;
  return sized
    .max(max, `${label} maksimal ${max.toLocaleString("id-ID")} karakter`)
    .refine(noControlChars, CONTROL_CHARS_MESSAGE);
}

// --- Cycle -----------------------------------------------------------------------------------------------------

export const cycleLink = z.object({
  url: bugUrl,
  label: text(1, 60, "Label link"),
});
export type CycleLink = z.infer<typeof cycleLink>;

const cycleLinks = z
  .array(cycleLink)
  .min(1, "Minimal satu link aplikasi")
  .max(MAX_CYCLE_LINKS, `Maksimal ${MAX_CYCLE_LINKS} link aplikasi`);

// Keunikan tanpa membedakan huruf besar/kecil, sama dengan index unik `lower(label)` di DB.
const environments = z
  .array(text(1, 40, "Lingkungan"))
  .max(MAX_ENVIRONMENTS, `Maksimal ${MAX_ENVIRONMENTS} lingkungan target`)
  .refine((labels) => new Set(labels.map((l) => l.toLowerCase())).size === labels.length, "Lingkungan tidak boleh duplikat");

const cycleTitle = text(3, 120, "Judul");
const cycleSummary = text(0, 280, "Ringkasan");
const instructions = z.string().max(10000, "Instruksi maksimal 10.000 karakter").refine(noControlChars, CONTROL_CHARS_MESSAGE);
const scope = z.string().max(2000, "Cakupan maksimal 2000 karakter").refine(noControlChars, CONTROL_CHARS_MESSAGE);
// Waktu ISO dengan zona; "harus di masa depan" diperiksa server terhadap jamnya sendiri (spec §3.1).
const endsAt = z.iso.datetime({ offset: true, message: "Waktu berakhir tidak valid" });

export const createCycleBody = z.object({
  title: cycleTitle,
  summary: cycleSummary.optional(),
  links: cycleLinks,
  instructions: instructions.optional(),
  inScope: scope.optional(),
  outOfScope: scope.optional(),
  environments: environments.optional(),
  appVersion: runVersion.nullable().optional(),
  endsAt: endsAt.nullable().optional(),
});
export type CreateCycleBody = z.infer<typeof createCycleBody>;

export const updateCycleBody = z
  .object({
    version: versionField,
    title: cycleTitle.optional(),
    summary: cycleSummary.optional(),
    links: cycleLinks.optional(),
    instructions: instructions.optional(),
    inScope: scope.optional(),
    outOfScope: scope.optional(),
    environments: environments.optional(),
    appVersion: runVersion.nullable().optional(),
    endsAt: endsAt.nullable().optional(),
    status: z.enum(CYCLE_STATUSES).optional(),
  })
  .refine(hasChange, { message: NO_CHANGE_MESSAGE });
export type UpdateCycleBody = z.infer<typeof updateCycleBody>;

export const joinBody = z.object({
  acceptRules: z.literal(true, "Setujui aturan cycle terlebih dahulu"),
});
export type JoinBody = z.infer<typeof joinBody>;

export const removeParticipantBody = z.object({
  reason: text(0, 500, "Alasan").optional(),
});
export type RemoveParticipantBody = z.infer<typeof removeParticipantBody>;

// --- Laporan ---------------------------------------------------------------------------------------------------

const reportTitle = text(5, 200, "Judul");
const reportSteps = text(10, 10000, "Langkah reproduksi");
const reportExpected = text(1, 2000, "Hasil yang diharapkan");
const reportActual = text(1, 2000, "Hasil yang terjadi");
const reportEnvironment = text(3, 200, "Lingkungan");
const reportSeverity = z.enum(CROWD_SEVERITIES);
const reportLinks = z.array(bugLink).max(5, "Maksimal 5 link bukti");

export const createCrowdReportBody = z.object({
  title: reportTitle,
  steps: reportSteps,
  expected: reportExpected,
  actual: reportActual,
  environment: reportEnvironment,
  suggestedSeverity: reportSeverity,
  links: reportLinks.optional(),
});
export type CreateCrowdReportBody = z.infer<typeof createCrowdReportBody>;

export const updateCrowdReportBody = z
  .object({
    version: versionField,
    title: reportTitle.optional(),
    steps: reportSteps.optional(),
    expected: reportExpected.optional(),
    actual: reportActual.optional(),
    environment: reportEnvironment.optional(),
    suggestedSeverity: reportSeverity.optional(),
    links: reportLinks.optional(),
  })
  .refine(hasChange, { message: NO_CHANGE_MESSAGE });
export type UpdateCrowdReportBody = z.infer<typeof updateCrowdReportBody>;

const triageNote = text(0, 1000, "Catatan");

export const triageBody = z.discriminatedUnion("decision", [
  z.object({
    version: versionField,
    decision: z.literal("accept"),
    severity: reportSeverity.optional(),
    priority: z.enum(BUG_PRIORITIES).optional(),
  }),
  z
    .object({
      version: versionField,
      decision: z.literal("reject"),
      reason: z.enum(REJECT_REASONS, "Pilih alasan penolakan"),
      note: triageNote.optional(),
    })
    .refine((body) => body.reason !== "other" || (body.note ?? "") !== "", {
      message: "Catatan wajib diisi untuk alasan lainnya",
      path: ["note"],
    }),
  z.object({
    version: versionField,
    decision: z.literal("duplicate"),
    duplicateOf: z.int("Nomor laporan tidak valid").min(1, "Nomor laporan tidak valid").max(2_147_483_647, "Nomor laporan tidak valid"),
  }),
  z.object({ version: versionField, decision: z.literal("reopen") }),
]);
export type TriageBody = z.infer<typeof triageBody>;
export type TriageDecision = TriageBody["decision"];

export const hideBody = z.object({ version: versionField, hideFromKnownIssues: z.boolean() });
export type HideBody = z.infer<typeof hideBody>;

export const crowdCommentBody = z.object({ body: text(1, 5000, "Komentar") });
export type CrowdCommentBody = z.infer<typeof crowdCommentBody>;

// --- Query -----------------------------------------------------------------------------------------------------

const search = z
  .string()
  .trim()
  .max(100, "Pencarian maksimal 100 karakter")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

export const crowdDirectoryQuery = z.object({
  status: z.enum(["open", "closed"]).default("open"),
  q: search,
  cursor: z.string().optional(),
});
export type CrowdDirectoryQuery = z.infer<typeof crowdDirectoryQuery>;

export const teamCyclesQuery = z.object({
  status: z.enum(CYCLE_STATUSES).optional(),
  cursor: z.string().optional(),
});
export type TeamCyclesQuery = z.infer<typeof teamCyclesQuery>;

export const teamReportsQuery = z.object({
  status: z.enum(CROWD_REPORT_STATUSES).default("submitted"),
  severity: reportSeverity.optional(),
  q: search,
  cursor: z.string().optional(),
});
export type TeamReportsQuery = z.infer<typeof teamReportsQuery>;

export const participantsQuery = z.object({
  status: z.enum(PARTICIPANT_STATUSES).optional(),
  cursor: z.string().optional(),
});
export type ParticipantsQuery = z.infer<typeof participantsQuery>;

// --- DTO -------------------------------------------------------------------------------------------------------
// Privasi (spec §6): DTO crowd tidak memuat email. Objek zod default "strip", jadi field tak dikenal terbuang.

export const crowdReportCountsDto = z.object({
  submitted: z.number(),
  accepted: z.number(),
  rejected: z.number(),
  duplicate: z.number(),
  withdrawn: z.number(),
});
export type CrowdReportCountsDto = z.infer<typeof crowdReportCountsDto>;

const cycleContent = {
  title: z.string(),
  summary: z.string(),
  links: z.array(z.object({ url: z.string(), label: z.string() })),
  instructions: z.string(),
  inScope: z.string(),
  outOfScope: z.string(),
  environments: z.array(z.string()),
  appVersion: z.string().nullable(),
  endsAt: z.string().nullable(),
};

export const publicCycleDto = z.object({
  id: z.string(),
  ...cycleContent,
  status: z.enum(CYCLE_STATUSES),
  openedAt: z.string().nullable(),
  // `slug` null untuk project privat: halaman project tidak boleh tertaut (spec §3.3).
  project: z.object({ name: z.string(), slug: z.string().nullable() }),
  stats: z.object({ participants: z.number(), accepted: z.number() }),
  me: z.object({ state: z.enum(ME_STATES) }),
});
export type PublicCycleDto = z.infer<typeof publicCycleDto>;

export const cycleDirectoryItemDto = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  project: z.object({ name: z.string(), slug: z.string().nullable() }),
  status: z.enum(CYCLE_STATUSES),
  endsAt: z.string().nullable(),
  openedAt: z.string().nullable(),
  participants: z.number(),
  accepted: z.number(),
});
export type CycleDirectoryItemDto = z.infer<typeof cycleDirectoryItemDto>;

export const cycleDirectoryPageDto = z.object({ items: z.array(cycleDirectoryItemDto), nextCursor: z.string().nullable() });
export type CycleDirectoryPageDto = z.infer<typeof cycleDirectoryPageDto>;

export const teamCycleDto = z.object({
  id: z.string(),
  number: z.number(),
  ...cycleContent,
  status: z.enum(CYCLE_STATUSES),
  effectiveStatus: z.enum(CYCLE_STATUSES),
  openedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
  participants: z.number(),
  reportCounts: crowdReportCountsDto,
});
export type TeamCycleDto = z.infer<typeof teamCycleDto>;

export const teamCyclesPageDto = z.object({ items: z.array(teamCycleDto), nextCursor: z.string().nullable() });
export type TeamCyclesPageDto = z.infer<typeof teamCyclesPageDto>;

export const participantDto = z.object({
  user: userRefDto,
  status: z.enum(PARTICIPANT_STATUSES),
  joinedAt: z.string(),
  reportCounts: crowdReportCountsDto,
});
export type ParticipantDto = z.infer<typeof participantDto>;

export const participantsPageDto = z.object({ items: z.array(participantDto), nextCursor: z.string().nullable() });
export type ParticipantsPageDto = z.infer<typeof participantsPageDto>;

export const crowdEventDto = z.object({
  id: z.string(),
  actor: userRefDto,
  fromStatus: z.enum(CROWD_REPORT_STATUSES).nullable(),
  toStatus: z.enum(CROWD_REPORT_STATUSES),
  detail: z.string().nullable(),
  createdAt: z.string(),
});
export type CrowdEventDto = z.infer<typeof crowdEventDto>;

const reportContent = {
  id: z.string(),
  number: z.number(),
  title: z.string(),
  steps: z.string(),
  expected: z.string(),
  actual: z.string(),
  environment: z.string(),
  suggestedSeverity: z.enum(CROWD_SEVERITIES),
  links: z.array(z.object({ url: z.string(), title: z.string().nullable() })),
  status: z.enum(CROWD_REPORT_STATUSES),
  finalSeverity: z.enum(CROWD_SEVERITIES).nullable(),
  points: z.number(),
  rejectReason: z.enum(REJECT_REASONS).nullable(),
  triageNote: z.string().nullable(),
  submittedAt: z.string(),
  updatedAt: z.string(),
  triagedAt: z.string().nullable(),
  version: z.number(),
  events: z.array(crowdEventDto),
};

/** Laporan sisi pelapor (API publik). */
export const crowdReportDto = z.object({
  ...reportContent,
  cycle: z.object({ id: z.string(), title: z.string() }),
  duplicateOf: z.object({ number: z.number(), title: z.string() }).nullable(),
});
export type CrowdReportDto = z.infer<typeof crowdReportDto>;

/** Laporan sisi tim (antrian & triase). */
export const teamCrowdReportDto = z.object({
  ...reportContent,
  cycle: z.object({ number: z.number(), title: z.string() }),
  reporter: userRefDto,
  hideFromKnownIssues: z.boolean(),
  triagedBy: userRefDto.nullable(),
  bug: bugRefDto.nullable(),
  duplicateOf: z.object({ number: z.number(), title: z.string() }).nullable(),
  nextSubmittedNumber: z.number().nullable(),
});
export type TeamCrowdReportDto = z.infer<typeof teamCrowdReportDto>;

export const crowdReportListItemDto = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  status: z.enum(CROWD_REPORT_STATUSES),
  suggestedSeverity: z.enum(CROWD_SEVERITIES),
  finalSeverity: z.enum(CROWD_SEVERITIES).nullable(),
  points: z.number(),
  reporter: userRefDto,
  submittedAt: z.string(),
});
export type CrowdReportListItemDto = z.infer<typeof crowdReportListItemDto>;

export const crowdReportsPageDto = z.object({ items: z.array(crowdReportListItemDto), nextCursor: z.string().nullable() });
export type CrowdReportsPageDto = z.infer<typeof crowdReportsPageDto>;

export const myCrowdReportItemDto = crowdReportListItemDto.omit({ reporter: true });
export type MyCrowdReportItemDto = z.infer<typeof myCrowdReportItemDto>;

export const knownIssueDto = z.object({
  title: z.string(),
  severity: z.enum(CROWD_SEVERITIES),
  acceptedAt: z.string(),
});
export type KnownIssueDto = z.infer<typeof knownIssueDto>;

export const knownIssuesPageDto = z.object({ items: z.array(knownIssueDto), nextCursor: z.string().nullable() });
export type KnownIssuesPageDto = z.infer<typeof knownIssuesPageDto>;

// `body` null dan `deletedAt` terisi untuk komentar yang dihapus (soft delete).
export const crowdCommentDto = z.object({
  id: z.string(),
  author: userRefDto,
  body: z.string().nullable(),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type CrowdCommentDto = z.infer<typeof crowdCommentDto>;

export const crowdCommentsPageDto = z.object({ items: z.array(crowdCommentDto), nextCursor: z.string().nullable() });
export type CrowdCommentsPageDto = z.infer<typeof crowdCommentsPageDto>;

export const leaderboardEntryDto = z.object({
  rank: z.number(),
  user: userRefDto,
  points: z.number(),
  accepted: z.number(),
});
export type LeaderboardEntryDto = z.infer<typeof leaderboardEntryDto>;

export const leaderboardDto = z.object({
  entries: z.array(leaderboardEntryDto),
  me: leaderboardEntryDto.nullable(),
});
export type LeaderboardDto = z.infer<typeof leaderboardDto>;

export const testerProfileDto = z.object({
  user: userRefDto,
  points: z.number(),
  acceptanceRate: z.number().nullable(),
  cycles: z.number(),
  recentAccepted: z.array(
    z.object({
      title: z.string(),
      severity: z.enum(CROWD_SEVERITIES),
      cycle: z.object({ id: z.string(), title: z.string() }),
      acceptedAt: z.string(),
    }),
  ),
});
export type TesterProfileDto = z.infer<typeof testerProfileDto>;

export const crowdMeDto = z.object({
  cycles: z.array(
    z.object({
      cycle: z.object({ id: z.string(), title: z.string(), status: z.enum(CYCLE_STATUSES) }),
      status: z.enum(PARTICIPANT_STATUSES),
      reportCounts: crowdReportCountsDto,
      points: z.number(),
    }),
  ),
  points: z.number(),
  acceptanceRate: z.number().nullable(),
});
export type CrowdMeDto = z.infer<typeof crowdMeDto>;

export const crowdSummaryDto = z
  .object({ openCycles: z.number(), awaitingTriage: z.number(), accepted30d: z.number() })
  .nullable();
export type CrowdSummaryDto = z.infer<typeof crowdSummaryDto>;
