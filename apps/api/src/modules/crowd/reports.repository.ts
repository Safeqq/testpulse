import type {
  BugStatus,
  CreateCrowdReportBody,
  CrowdEventDto,
  CrowdReportDto,
  CrowdReportListItemDto,
  CrowdReportStatus,
  CrowdSeverity,
  MyCrowdReportItemDto,
  TeamCrowdReportDto,
  TeamReportsQuery,
  UpdateCrowdReportBody,
} from "@testpulse/shared";
import { and, asc, count, desc, eq, gt, ne, sql, type SQL } from "drizzle-orm";
import { alias, type PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Db, Queryable } from "../../db/client.js";
import {
  bugs,
  crowdCycles,
  crowdParticipants,
  crowdReportEvents,
  crowdReportLinks,
  crowdReports,
  memberships,
  projects,
  users,
} from "../../db/schema.js";
import { escapeLike } from "../bugs/read.repository.js";
import { canSubmit, type SubmitError } from "./domain/access.js";
import { effectiveCycleStatus } from "./domain/cycles.js";
import { submissionLimit, type SubmissionLimit } from "./domain/limits.js";
import { reportTransition } from "./domain/reports.js";

/*
 * Urutan kunci laporan crowd (spec Tahap 5 §7: project → cycle → peserta → laporan):
 * - Kirim laporan: kunci advisory per pengguna (menyerialkan batas harian lintas cycle) → project (`FOR KEY SHARE`,
 *   lalu `UPDATE … cycle_seq` untuk nomor) → cycle (`FOR SHARE`; penutupan cycle menunggu kiriman yang berjalan) →
 *   peserta (`FOR UPDATE`; kiriman paralel tester yang sama dihitung berurutan) → insert laporan.
 * - Ubah / tarik / triase laporan: baris laporan (`FOR UPDATE`) setelah cycle dan peserta bila perlu.
 */

type ReportRow = typeof crowdReports.$inferSelect;
type ReportChanges = PgUpdateSetSource<typeof crowdReports>;

const reporterUser = alias(users, "reporter");
const triagerUser = alias(users, "triager");
const duplicateReport = alias(crowdReports, "duplicate_of");
const actorUser = alias(users, "actor");

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

export async function findReportById(db: Queryable, id: string): Promise<ReportRow | null> {
  const [row] = await db.select().from(crowdReports).where(eq(crowdReports.id, id));
  return row ?? null;
}

export async function findReportByNumber(db: Queryable, projectId: string, number: number): Promise<ReportRow | null> {
  const [row] = await db
    .select()
    .from(crowdReports)
    .where(and(eq(crowdReports.projectId, projectId), eq(crowdReports.number, number)));
  return row ?? null;
}

async function eventsOf(db: Queryable, reportId: string): Promise<CrowdEventDto[]> {
  const rows = await db
    .select({
      id: crowdReportEvents.id,
      actorId: crowdReportEvents.actorId,
      actorName: actorUser.name,
      fromStatus: crowdReportEvents.fromStatus,
      toStatus: crowdReportEvents.toStatus,
      detail: crowdReportEvents.detail,
      createdAt: crowdReportEvents.createdAt,
    })
    .from(crowdReportEvents)
    .innerJoin(actorUser, eq(actorUser.id, crowdReportEvents.actorId))
    .where(eq(crowdReportEvents.reportId, reportId))
    .orderBy(asc(crowdReportEvents.createdAt), asc(crowdReportEvents.id));
  return rows.map((r) => ({
    id: String(r.id),
    actor: { id: r.actorId, name: r.actorName },
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function linksOf(db: Queryable, reportId: string) {
  const rows = await db
    .select({ url: crowdReportLinks.url, title: crowdReportLinks.title })
    .from(crowdReportLinks)
    .where(eq(crowdReportLinks.reportId, reportId))
    .orderBy(asc(crowdReportLinks.position));
  return rows.map((r) => ({ url: r.url, title: r.title }));
}

/** Bagian laporan yang sama untuk sisi pelapor dan sisi tim. */
async function reportCore(db: Queryable, id: string) {
  const [row] = await db
    .select({
      report: crowdReports,
      cycleNumber: crowdCycles.number,
      cycleTitle: crowdCycles.title,
      reporterName: reporterUser.name,
      triagerName: triagerUser.name,
      duplicateNumber: duplicateReport.number,
      duplicateTitle: duplicateReport.title,
      bugNumber: bugs.number,
      bugTitle: bugs.title,
      bugStatus: bugs.status,
    })
    .from(crowdReports)
    .innerJoin(crowdCycles, eq(crowdCycles.id, crowdReports.cycleId))
    .innerJoin(reporterUser, eq(reporterUser.id, crowdReports.reporterId))
    .leftJoin(triagerUser, eq(triagerUser.id, crowdReports.triagedBy))
    .leftJoin(duplicateReport, eq(duplicateReport.id, crowdReports.duplicateOfId))
    .leftJoin(bugs, eq(bugs.id, crowdReports.bugId))
    .where(eq(crowdReports.id, id));
  if (!row) return null;
  const [events, links] = await Promise.all([eventsOf(db, id), linksOf(db, id)]);
  const r = row.report;
  return {
    row,
    base: {
      id: r.id,
      number: r.number,
      title: r.title,
      steps: r.steps,
      expected: r.expected,
      actual: r.actual,
      environment: r.environment,
      suggestedSeverity: r.suggestedSeverity,
      links,
      status: r.status,
      finalSeverity: r.finalSeverity,
      points: r.points,
      rejectReason: r.rejectReason,
      triageNote: r.triageNote,
      submittedAt: r.submittedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      triagedAt: iso(r.triagedAt),
      version: r.version,
      events,
    },
    duplicateOf:
      row.duplicateNumber === null || row.duplicateTitle === null ? null : { number: row.duplicateNumber, title: row.duplicateTitle },
  };
}

/** Laporan sisi pelapor (API publik). */
export async function loadCrowdReportDto(db: Queryable, id: string): Promise<CrowdReportDto> {
  const core = (await reportCore(db, id))!;
  return {
    ...core.base,
    cycle: { id: core.row.report.cycleId, title: core.row.cycleTitle },
    duplicateOf: core.duplicateOf,
  };
}

/**
 * Laporan `submitted` berikutnya di cycle yang sama (urut waktu kirim lalu nomor, terlama dulu), berputar ke awal;
 * laporan ini sendiri tidak dihitung. `null` bila tidak ada lagi.
 */
export async function nextSubmittedNumber(db: Queryable, report: { id: string; cycleId: string; submittedAt: Date; number: number }) {
  const later = sql`(${crowdReports.submittedAt} > ${report.submittedAt} or (${crowdReports.submittedAt} = ${report.submittedAt} and ${crowdReports.number} > ${report.number}))`;
  const [row] = await db
    .select({ number: crowdReports.number })
    .from(crowdReports)
    .where(and(eq(crowdReports.cycleId, report.cycleId), eq(crowdReports.status, "submitted"), ne(crowdReports.id, report.id)))
    .orderBy(sql`case when ${later} then 0 else 1 end`, asc(crowdReports.submittedAt), asc(crowdReports.number))
    .limit(1);
  return row?.number ?? null;
}

/** Laporan sisi tim (antrian & triase); tanpa email. */
export async function loadTeamCrowdReportDto(db: Queryable, id: string): Promise<TeamCrowdReportDto> {
  const core = (await reportCore(db, id))!;
  const { row } = core;
  return {
    ...core.base,
    cycle: { number: row.cycleNumber, title: row.cycleTitle },
    reporter: { id: row.report.reporterId, name: row.reporterName },
    hideFromKnownIssues: row.report.hideFromKnownIssues,
    triagedBy: row.report.triagedBy === null || row.triagerName === null ? null : { id: row.report.triagedBy, name: row.triagerName },
    bug:
      row.bugNumber === null || row.bugTitle === null || row.bugStatus === null
        ? null
        : { number: row.bugNumber, title: row.bugTitle, status: row.bugStatus as BugStatus },
    duplicateOf: core.duplicateOf,
    nextSubmittedNumber: await nextSubmittedNumber(db, row.report),
  };
}

const submittedMicros = sql<number>`(extract(epoch from ${crowdReports.submittedAt}) * 1000000)::bigint`;

export interface ReportCursor {
  at: number;
  number: number;
}

/** Antrian tim: `submitted` terlama dulu (spec §8.1), status lain terbaru dulu. */
export async function listTeamReports(
  db: Queryable,
  opts: { cycleId: string; query: Omit<TeamReportsQuery, "cursor">; after?: ReportCursor; limit: number },
): Promise<(CrowdReportListItemDto & { cursor: ReportCursor })[]> {
  const oldestFirst = opts.query.status === "submitted";
  const conditions: (SQL | undefined)[] = [eq(crowdReports.cycleId, opts.cycleId), eq(crowdReports.status, opts.query.status)];
  if (opts.query.severity !== undefined) conditions.push(eq(crowdReports.suggestedSeverity, opts.query.severity));
  if (opts.query.q !== undefined) conditions.push(sql`${crowdReports.title} ilike ${`%${escapeLike(opts.query.q)}%`} escape '\\'`);
  if (opts.after) {
    const { at, number } = opts.after;
    conditions.push(
      oldestFirst
        ? sql`(${submittedMicros} > ${at} or (${submittedMicros} = ${at} and ${crowdReports.number} > ${number}))`
        : sql`(${submittedMicros} < ${at} or (${submittedMicros} = ${at} and ${crowdReports.number} < ${number}))`,
    );
  }
  const rows = await db
    .select({
      report: crowdReports,
      reporterName: users.name,
      at: submittedMicros.mapWith(Number),
    })
    .from(crowdReports)
    .innerJoin(users, eq(users.id, crowdReports.reporterId))
    .where(and(...conditions))
    .orderBy(
      ...(oldestFirst
        ? [sql`${submittedMicros} asc`, asc(crowdReports.number)]
        : [sql`${submittedMicros} desc`, desc(crowdReports.number)]),
    )
    .limit(opts.limit);
  return rows.map(({ report, reporterName, at }) => ({
    ...listItem(report),
    reporter: { id: report.reporterId, name: reporterName },
    cursor: { at, number: report.number },
  }));
}

function listItem(report: ReportRow): MyCrowdReportItemDto {
  return {
    id: report.id,
    number: report.number,
    title: report.title,
    status: report.status,
    suggestedSeverity: report.suggestedSeverity,
    finalSeverity: report.finalSeverity,
    points: report.points,
    submittedAt: report.submittedAt.toISOString(),
  };
}

export async function listMyReports(db: Queryable, cycleId: string, userId: string): Promise<MyCrowdReportItemDto[]> {
  const rows = await db
    .select()
    .from(crowdReports)
    .where(and(eq(crowdReports.cycleId, cycleId), eq(crowdReports.reporterId, userId)))
    .orderBy(desc(crowdReports.submittedAt), desc(crowdReports.number));
  return rows.map(listItem);
}

export type SubmitFailure = SubmitError | "not_found" | { limit: SubmissionLimit };

/** Kirim laporan (spec §4, §5.5) dalam satu transaksi; lihat urutan kunci di atas. */
export async function submitReport(
  db: Db,
  input: { cycleId: string; userId: string; body: CreateCrowdReportBody; now: Date },
): Promise<CrowdReportDto | SubmitFailure> {
  const { cycleId, userId, body, now } = input;
  return db.transaction(async (tx): Promise<CrowdReportDto | SubmitFailure> => {
    // Batas harian dihitung lintas cycle, jadi kiriman paralel pengguna yang sama diserialkan di sini.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`crowd-submit:${userId}`}, 0))`);

    const [ref] = await tx
      .select({ projectId: crowdCycles.projectId })
      .from(crowdCycles)
      .where(and(eq(crowdCycles.id, cycleId), ne(crowdCycles.status, "draft")));
    if (!ref) return "not_found";
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, ref.projectId)).for("key share");
    const [cycle] = await tx.select().from(crowdCycles).where(eq(crowdCycles.id, cycleId)).for("share");
    if (!cycle || cycle.status === "draft") return "not_found";

    const [member] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.projectId, cycle.projectId), eq(memberships.userId, userId)));
    const [participant] = await tx
      .select({ status: crowdParticipants.status })
      .from(crowdParticipants)
      .where(and(eq(crowdParticipants.cycleId, cycleId), eq(crowdParticipants.userId, userId)))
      .for("update");
    const error = canSubmit({
      authenticated: true,
      isMember: member !== undefined,
      participantStatus: participant?.status ?? null,
      effectiveStatus: effectiveCycleStatus(cycle, now),
    });
    if (error) return error;

    const [inCycle] = await tx
      .select({
        submitted: sql<number>`count(*) filter (where ${crowdReports.status} = 'submitted')`.mapWith(Number),
        total: count(),
      })
      .from(crowdReports)
      .where(and(eq(crowdReports.cycleId, cycleId), eq(crowdReports.reporterId, userId)));
    const [daily] = await tx
      .select({ n: count() })
      .from(crowdReports)
      .where(and(eq(crowdReports.reporterId, userId), gt(crowdReports.submittedAt, sql`now() - interval '24 hours'`)));
    const limit = submissionLimit({
      submittedInCycle: inCycle?.submitted ?? 0,
      totalInCycle: inCycle?.total ?? 0,
      last24h: daily?.n ?? 0,
    });
    if (limit) return { limit };

    const [seq] = await tx
      .update(projects)
      .set({ crowdReportSeq: sql`${projects.crowdReportSeq} + 1` })
      .where(eq(projects.id, cycle.projectId))
      .returning({ n: projects.crowdReportSeq });
    const [report] = await tx
      .insert(crowdReports)
      .values({
        projectId: cycle.projectId,
        cycleId,
        number: seq!.n,
        reporterId: userId,
        title: body.title,
        steps: body.steps,
        expected: body.expected,
        actual: body.actual,
        environment: body.environment,
        suggestedSeverity: body.suggestedSeverity,
        submittedAt: sql`statement_timestamp()`,
      })
      .returning({ id: crowdReports.id });
    await writeLinks(tx, report!.id, body.links ?? []);
    await tx.insert(crowdReportEvents).values({ reportId: report!.id, actorId: userId, fromStatus: null, toStatus: "submitted" });
    return loadCrowdReportDto(tx, report!.id);
  });
}

async function writeLinks(tx: Queryable, reportId: string, links: { url: string; title?: string | undefined }[]) {
  await tx.delete(crowdReportLinks).where(eq(crowdReportLinks.reportId, reportId));
  if (links.length > 0) {
    await tx
      .insert(crowdReportLinks)
      .values(links.map((l, position) => ({ reportId, position, url: l.url, title: l.title ?? null })));
  }
}

export type ReporterWriteFailure = "not_found" | "removed" | "conflict" | "invalid";

/** Laporan milik `userId` yang boleh diubah pelapornya: peserta yang dikeluarkan hanya boleh membaca. */
async function lockOwnReport(tx: Queryable, reportId: string, userId: string): Promise<ReportRow | "not_found" | "removed"> {
  const [report] = await tx.select().from(crowdReports).where(eq(crowdReports.id, reportId));
  if (!report || report.reporterId !== userId) return "not_found";
  const [participant] = await tx
    .select({ status: crowdParticipants.status })
    .from(crowdParticipants)
    .where(and(eq(crowdParticipants.cycleId, report.cycleId), eq(crowdParticipants.userId, userId)))
    .for("share");
  if (participant?.status === "removed") return "removed";
  const [locked] = await tx.select().from(crowdReports).where(eq(crowdReports.id, reportId)).for("update");
  return locked ?? "not_found";
}

export async function updateOwnReport(
  db: Db,
  input: { reportId: string; userId: string; body: UpdateCrowdReportBody },
): Promise<CrowdReportDto | ReporterWriteFailure> {
  const { reportId, userId, body } = input;
  return db.transaction(async (tx): Promise<CrowdReportDto | ReporterWriteFailure> => {
    const report = await lockOwnReport(tx, reportId, userId);
    if (typeof report === "string") return report;
    if (report.status !== "submitted") return "invalid";
    if (report.version !== body.version) return "conflict";
    const changes: ReportChanges = {};
    if (body.title !== undefined) changes.title = body.title;
    if (body.steps !== undefined) changes.steps = body.steps;
    if (body.expected !== undefined) changes.expected = body.expected;
    if (body.actual !== undefined) changes.actual = body.actual;
    if (body.environment !== undefined) changes.environment = body.environment;
    if (body.suggestedSeverity !== undefined) changes.suggestedSeverity = body.suggestedSeverity as CrowdSeverity;
    if (body.links !== undefined) await writeLinks(tx, report.id, body.links);
    await tx
      .update(crowdReports)
      .set({ ...changes, version: sql`${crowdReports.version} + 1`, updatedAt: sql`statement_timestamp()` })
      .where(eq(crowdReports.id, report.id));
    return loadCrowdReportDto(tx, report.id);
  });
}

export async function withdrawOwnReport(
  db: Db,
  input: { reportId: string; userId: string },
): Promise<CrowdReportDto | Exclude<ReporterWriteFailure, "conflict">> {
  return db.transaction(async (tx) => {
    const report = await lockOwnReport(tx, input.reportId, input.userId);
    if (typeof report === "string") return report;
    const next = reportTransition(report.status, "withdraw");
    if (next === null) return "invalid" as const;
    await tx
      .update(crowdReports)
      .set({ status: next as CrowdReportStatus, version: sql`${crowdReports.version} + 1`, updatedAt: sql`statement_timestamp()` })
      .where(eq(crowdReports.id, report.id));
    await tx.insert(crowdReportEvents).values({ reportId: report.id, actorId: input.userId, fromStatus: report.status, toStatus: next });
    return loadCrowdReportDto(tx, report.id);
  });
}
