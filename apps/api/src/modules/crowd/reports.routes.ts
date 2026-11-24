import {
  createCrowdReportBody,
  crowdCommentBody,
  MAX_REPORTS_PER_CYCLE,
  MAX_REPORTS_PER_DAY,
  MAX_SUBMITTED_PER_CYCLE,
  teamReportsQuery,
  updateCrowdReportBody,
  type CrowdCommentDto,
  type CrowdCommentsPageDto,
  type CrowdReportDto,
  type CrowdReportsPageDto,
  type MyCrowdReportsDto,
  type TeamCrowdReportDto,
} from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { withStatementTimeout } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { isUuid } from "../../http/uuid.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser, requireUser } from "../auth/service.js";
import { parsePathNumber } from "../manual/cases.routes.js";
import { resolveProject } from "../projects/access.js";
import { READ_STATEMENT_TIMEOUT_MS, type ReadRoutesOptions } from "../results/read.routes.js";
import { addComment, deleteComment, listComments, type CommentCursor } from "./comments.repository.js";
import { decodeCursor, encodeCursor, INT, TIME, UUID } from "./cursor.js";
import { findCycleRow } from "./cycles.repository.js";
import { parseCycleNumber } from "./cycles.routes.js";
import type { SubmissionLimit } from "./domain/limits.js";
import {
  cycleNotFound,
  cycleNotOpen,
  fieldError,
  invalidTriage,
  memberCannotJoin,
  notParticipant,
  participantRemoved,
  reportConflict,
  reportNotFound,
  unauthenticated,
} from "./errors.js";
import { findPublicCycleRow, visitorOf } from "./public.repository.js";
import {
  findReportById,
  findReportByNumber,
  listMyReports,
  listTeamReports,
  loadCrowdReportDto,
  loadTeamCrowdReportDto,
  submitReport,
  updateOwnReport,
  withdrawOwnReport,
} from "./reports.repository.js";

/** Ukuran halaman (spec Tahap 5 §8.1). */
export const TEAM_REPORTS_PAGE_SIZE = 50;
export const COMMENTS_PAGE_SIZE = 50;

const LIMIT_MESSAGES: Record<SubmissionLimit, string> = {
  submitted: `Anda sudah punya ${MAX_SUBMITTED_PER_CYCLE} laporan yang menunggu triase di cycle ini. Tunggu sebagian ditriase dulu.`,
  total: `Batas ${MAX_REPORTS_PER_CYCLE} laporan per tester untuk cycle ini sudah tercapai.`,
  daily: `Batas ${MAX_REPORTS_PER_DAY} laporan per 24 jam sudah tercapai. Coba lagi nanti.`,
};

const cursorQuery = z.object({ cursor: z.string().optional() });

/** Nomor laporan dari path; bentuk tidak sah → 404 REPORT_NOT_FOUND. */
const parseReportNumber = (raw: string) => parsePathNumber(raw, reportNotFound);

function withoutCursor<T extends { cursor: unknown }>(row: T): Omit<T, "cursor"> {
  const { cursor, ...item } = row;
  void cursor;
  return item;
}

function decodeCommentCursor(cursor: string | undefined): CommentCursor | undefined {
  if (cursor === undefined) return undefined;
  const parts = decodeCursor("cm", cursor, [TIME, UUID]);
  if (!parts) throw fieldError("cursor", "Cursor tidak valid");
  return { at: parts[0], id: parts[1] };
}

function commentsPage(rows: (CrowdCommentDto & { cursor: CommentCursor })[]): CrowdCommentsPageDto {
  const page = rows.slice(0, COMMENTS_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map(withoutCursor),
    nextCursor: rows.length > COMMENTS_PAGE_SIZE && last ? encodeCursor("cm", [last.cursor.at, last.cursor.id]) : null,
  };
}

/**
 * Rute laporan crowd (spec Tahap 5 §8.1–§8.2): kirim & kelola laporan sendiri di `/crowd`, antrian & detail tim di
 * bawah project, dan satu thread komentar untuk keduanya. Laporan orang lain di API publik selalu
 * `404 REPORT_NOT_FOUND` (bukan 403) agar keberadaannya tidak bocor.
 */
export async function crowdReportRoutes(app: FastifyInstance, config: AppConfig, opts: ReadRoutesOptions = {}): Promise<void> {
  const readAccess = { preHandler: [loadUser] };
  const loginRequired = { preHandler: [loadUser, requireUser] };
  const rateLimited = { rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" } };
  const statementTimeoutMs = opts.statementTimeoutMs ?? READ_STATEMENT_TIMEOUT_MS;

  /** Laporan milik pengguna yang login, atau 404 untuk siapa pun selain pelapornya. */
  async function ownReport(rawId: string, userId: string) {
    if (!isUuid(rawId)) throw reportNotFound();
    const report = await findReportById(app.db, rawId);
    if (!report || report.reporterId !== userId) throw reportNotFound();
    return report;
  }

  // --- Publik: pelapor -------------------------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>("/crowd/cycles/:id/reports", loginRequired, async (req): Promise<MyCrowdReportsDto> => {
    if (!isUuid(req.params.id)) throw cycleNotFound();
    const cycle = await findPublicCycleRow(app.db, req.params.id);
    if (!cycle) throw cycleNotFound();
    const visitor = await visitorOf(app.db, cycle, req.user!.id);
    if (visitor.participantStatus === null) throw notParticipant();
    return { items: await listMyReports(app.db, cycle.id, req.user!.id) };
  });

  app.post<{ Params: { id: string } }>(
    "/crowd/cycles/:id/reports",
    { ...loginRequired, config: rateLimited },
    async (req, reply) => {
      const body = parseOrThrow(createCrowdReportBody, req.body);
      if (!isUuid(req.params.id)) throw cycleNotFound();
      const result = await submitReport(app.db, { cycleId: req.params.id, userId: req.user!.id, body, now: new Date() });
      if (typeof result === "object" && "limit" in result) throw new AppError(429, "RATE_LIMITED", LIMIT_MESSAGES[result.limit]);
      switch (result) {
        case "not_found":
          throw cycleNotFound();
        case "UNAUTHENTICATED":
          throw unauthenticated();
        case "MEMBER_CANNOT_JOIN":
          throw memberCannotJoin();
        case "PARTICIPANT_REMOVED":
          throw participantRemoved();
        case "NOT_PARTICIPANT":
          throw notParticipant();
        case "CYCLE_NOT_OPEN":
          throw cycleNotOpen();
        default:
          return reply.status(201).send(result);
      }
    },
  );

  app.get<{ Params: { id: string } }>("/crowd/reports/:id", loginRequired, async (req): Promise<CrowdReportDto> => {
    const report = await ownReport(req.params.id, req.user!.id);
    return withStatementTimeout(app.db, statementTimeoutMs, (db) => loadCrowdReportDto(db, report.id));
  });

  const reporterFailure = (result: "not_found" | "removed" | "conflict" | "invalid") => {
    switch (result) {
      case "not_found":
        return reportNotFound();
      case "removed":
        return participantRemoved();
      case "conflict":
        return reportConflict();
      case "invalid":
        return invalidTriage();
    }
  };

  app.patch<{ Params: { id: string } }>("/crowd/reports/:id", loginRequired, async (req): Promise<CrowdReportDto> => {
    const body = parseOrThrow(updateCrowdReportBody, req.body);
    if (!isUuid(req.params.id)) throw reportNotFound();
    const result = await updateOwnReport(app.db, { reportId: req.params.id, userId: req.user!.id, body });
    if (typeof result === "string") throw reporterFailure(result);
    return result;
  });

  app.delete<{ Params: { id: string } }>("/crowd/reports/:id", loginRequired, async (req): Promise<CrowdReportDto> => {
    if (!isUuid(req.params.id)) throw reportNotFound();
    const result = await withdrawOwnReport(app.db, { reportId: req.params.id, userId: req.user!.id });
    if (typeof result === "string") throw reporterFailure(result);
    return result;
  });

  app.get<{ Params: { id: string } }>("/crowd/reports/:id/comments", loginRequired, async (req): Promise<CrowdCommentsPageDto> => {
    const { cursor } = parseOrThrow(cursorQuery, req.query);
    const after = decodeCommentCursor(cursor);
    const report = await ownReport(req.params.id, req.user!.id);
    const rows = await withStatementTimeout(app.db, statementTimeoutMs, (db) =>
      listComments(db, { reportId: report.id, ...(after ? { after } : {}), limit: COMMENTS_PAGE_SIZE + 1 }),
    );
    return commentsPage(rows);
  });

  app.post<{ Params: { id: string } }>(
    "/crowd/reports/:id/comments",
    { ...loginRequired, config: rateLimited },
    async (req, reply) => {
      const body = parseOrThrow(crowdCommentBody, req.body);
      const report = await ownReport(req.params.id, req.user!.id);
      const cycle = await findPublicCycleRow(app.db, report.cycleId);
      if (cycle && (await visitorOf(app.db, cycle, req.user!.id)).participantStatus === "removed") throw participantRemoved();
      return reply.status(201).send(await addComment(app.db, { reportId: report.id, authorId: req.user!.id, body: body.body }));
    },
  );

  app.delete<{ Params: { id: string; commentId: string } }>(
    "/crowd/reports/:id/comments/:commentId",
    loginRequired,
    async (req, reply) => {
      const report = await ownReport(req.params.id, req.user!.id);
      if (!isUuid(req.params.commentId)) throw new AppError(404, "COMMENT_NOT_FOUND", "Komentar tidak ditemukan");
      const result = await deleteComment(app.db, { reportId: report.id, commentId: req.params.commentId, authorId: req.user!.id });
      if (result === "not_found") throw new AppError(404, "COMMENT_NOT_FOUND", "Komentar tidak ditemukan");
      if (result === "forbidden") throw new AppError(403, "FORBIDDEN", "Hanya penulis yang bisa menghapus komentar ini");
      return reply.status(204).send();
    },
  );

  // --- Tim -------------------------------------------------------------------------------------------------------

  app.get<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/cycles/:number/reports",
    readAccess,
    async (req): Promise<CrowdReportsPageDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "crowd:read");
      const { cursor, ...query } = parseOrThrow(teamReportsQuery, req.query);
      const after = cursor === undefined ? undefined : decodeCursor("tr", cursor, [TIME, INT]);
      if (after === null) throw fieldError("cursor", "Cursor tidak valid");
      const cycle = await findCycleRow(app.db, project.id, parseCycleNumber(req.params.number));
      if (!cycle) throw cycleNotFound();
      const rows = await withStatementTimeout(app.db, statementTimeoutMs, (db) =>
        listTeamReports(db, {
          cycleId: cycle.id,
          query,
          ...(after !== undefined ? { after: { at: after[0], number: after[1] } } : {}),
          limit: TEAM_REPORTS_PAGE_SIZE + 1,
        }),
      );
      const page = rows.slice(0, TEAM_REPORTS_PAGE_SIZE);
      const last = page.at(-1);
      return {
        items: page.map(withoutCursor),
        nextCursor: rows.length > TEAM_REPORTS_PAGE_SIZE && last ? encodeCursor("tr", [last.cursor.at, last.cursor.number]) : null,
      };
    },
  );

  /** Laporan project ini berdasarkan nomor, untuk anggota dengan `action`. */
  async function teamReport(slug: string, rawNumber: string, user: Parameters<typeof resolveProject>[2], action: "crowd:read" | "crowd:triage") {
    const { project } = await resolveProject(app.db, slug, user, action);
    const report = await findReportByNumber(app.db, project.id, parseReportNumber(rawNumber));
    if (!report) throw reportNotFound();
    return report;
  }

  app.get<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/crowd-reports/:number",
    readAccess,
    async (req): Promise<TeamCrowdReportDto> => {
      const report = await teamReport(req.params.slug, req.params.number, req.user, "crowd:read");
      return withStatementTimeout(app.db, statementTimeoutMs, (db) => loadTeamCrowdReportDto(db, report.id));
    },
  );

  app.get<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/crowd-reports/:number/comments",
    readAccess,
    async (req): Promise<CrowdCommentsPageDto> => {
      const report = await teamReport(req.params.slug, req.params.number, req.user, "crowd:read");
      const { cursor } = parseOrThrow(cursorQuery, req.query);
      const after = decodeCommentCursor(cursor);
      const rows = await withStatementTimeout(app.db, statementTimeoutMs, (db) =>
        listComments(db, { reportId: report.id, ...(after ? { after } : {}), limit: COMMENTS_PAGE_SIZE + 1 }),
      );
      return commentsPage(rows);
    },
  );

  app.post<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/crowd-reports/:number/comments",
    { ...loginRequired, config: rateLimited },
    async (req, reply) => {
      const report = await teamReport(req.params.slug, req.params.number, req.user, "crowd:triage");
      const body = parseOrThrow(crowdCommentBody, req.body);
      return reply.status(201).send(await addComment(app.db, { reportId: report.id, authorId: req.user!.id, body: body.body }));
    },
  );

  app.delete<{ Params: { slug: string; number: string; id: string } }>(
    "/projects/:slug/crowd-reports/:number/comments/:id",
    loginRequired,
    async (req, reply) => {
      const report = await teamReport(req.params.slug, req.params.number, req.user, "crowd:read");
      if (!isUuid(req.params.id)) throw new AppError(404, "COMMENT_NOT_FOUND", "Komentar tidak ditemukan");
      const result = await deleteComment(app.db, { reportId: report.id, commentId: req.params.id, authorId: req.user!.id });
      if (result === "not_found") throw new AppError(404, "COMMENT_NOT_FOUND", "Komentar tidak ditemukan");
      if (result === "forbidden") throw new AppError(403, "FORBIDDEN", "Hanya penulis yang bisa menghapus komentar ini");
      return reply.status(204).send();
    },
  );
}
