import {
  createCycleBody,
  participantsQuery,
  removeParticipantBody,
  teamCyclesQuery,
  updateCycleBody,
  type CrowdSummaryDto,
  type LeaderboardDto,
  type ParticipantsPageDto,
  type TeamCycleDto,
  type TeamCyclesPageDto,
} from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { withStatementTimeout } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { isUuid } from "../../http/uuid.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser, requireUser } from "../auth/service.js";
import { parsePathNumber } from "../manual/cases.routes.js";
import { resolveProject } from "../projects/access.js";
import { READ_STATEMENT_TIMEOUT_MS, type ReadRoutesOptions } from "../results/read.routes.js";
import { decodeCursor, encodeCursor, INT, TIME, UUID } from "./cursor.js";
import {
  createCycle,
  crowdSummary,
  deleteCycle,
  findCycleRow,
  findTeamCycle,
  listTeamCycles,
  updateCycle,
} from "./cycles.repository.js";
import {
  cycleConflict,
  cycleHasReports,
  cycleNotFound,
  fieldError,
  invalidTransition,
  participantNotFound,
} from "./errors.js";
import { listParticipants, removeParticipant } from "./participants.repository.js";
import { cycleLeaderboard } from "./reputation.repository.js";

/** Ukuran halaman (spec Tahap 5 §8.1). */
export const TEAM_CYCLES_PAGE_SIZE = 20;
export const PARTICIPANTS_PAGE_SIZE = 50;

const ENDS_AT_MESSAGE = "Waktu berakhir harus di masa depan";

/** Nomor cycle dari path; bentuk tidak sah → 404 CYCLE_NOT_FOUND. */
export const parseCycleNumber = (raw: string) => parsePathNumber(raw, cycleNotFound);

/**
 * Rute tim crowdtesting di bawah project (spec Tahap 5 §8.1). Hanya sesi cookie yang dibaca (token CI = anonim);
 * akses project diputuskan sebelum body/query divalidasi. Cycle draft hanya terlihat oleh anggota; bagi selain anggota
 * draft dijawab `404 CYCLE_NOT_FOUND`. Data peserta dan ringkasan hanya untuk anggota (`crowd:read`).
 */
export async function crowdCycleRoutes(app: FastifyInstance, opts: ReadRoutesOptions = {}): Promise<void> {
  const readAccess = { preHandler: [loadUser] };
  const loginRequired = { preHandler: [loadUser, requireUser] };
  const statementTimeoutMs = opts.statementTimeoutMs ?? READ_STATEMENT_TIMEOUT_MS;

  /** Cycle yang terlihat oleh pemanggil (draft hanya untuk anggota), atau 404. */
  async function visibleCycle(projectId: string, rawNumber: string, isMember: boolean) {
    const row = await findCycleRow(app.db, projectId, parseCycleNumber(rawNumber));
    if (!row || (row.status === "draft" && !isMember)) throw cycleNotFound();
    return row;
  }

  app.get<{ Params: { slug: string } }>("/projects/:slug/cycles", readAccess, async (req): Promise<TeamCyclesPageDto> => {
    const { project, role } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    const { cursor, status } = parseOrThrow(teamCyclesQuery, req.query);
    const after = cursor === undefined ? undefined : decodeCursor("cy", cursor, [INT]);
    if (after === null) throw fieldError("cursor", "Cursor tidak valid");
    const now = new Date();
    const rows = await withStatementTimeout(app.db, statementTimeoutMs, (db) =>
      listTeamCycles(db, {
        projectId: project.id,
        includeDrafts: role !== null,
        ...(status !== undefined ? { status } : {}),
        ...(after !== undefined ? { after: after[0] } : {}),
        limit: TEAM_CYCLES_PAGE_SIZE + 1,
        now,
      }),
    );
    const page = rows.slice(0, TEAM_CYCLES_PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor: rows.length > TEAM_CYCLES_PAGE_SIZE && last ? encodeCursor("cy", [last.number]) : null,
    };
  });

  app.post<{ Params: { slug: string } }>("/projects/:slug/cycles", loginRequired, async (req, reply) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "crowd:manage");
    const body = parseOrThrow(createCycleBody, req.body);
    const result = await createCycle(app.db, { projectId: project.id, actorId: req.user!.id, body, now: new Date() });
    if (result === "project_not_found") throw new AppError(404, "PROJECT_NOT_FOUND", "Project tidak ditemukan");
    if ("field" in result) throw fieldError("endsAt", ENDS_AT_MESSAGE);
    return reply.status(201).send(result);
  });

  app.get<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/cycles/:number",
    readAccess,
    async (req): Promise<TeamCycleDto> => {
      const { project, role } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      const number = parseCycleNumber(req.params.number);
      const cycle = await withStatementTimeout(app.db, statementTimeoutMs, (db) =>
        findTeamCycle(db, { projectId: project.id, number, includeDraft: role !== null, now: new Date() }),
      );
      if (!cycle) throw cycleNotFound();
      return cycle;
    },
  );

  app.patch<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/cycles/:number",
    loginRequired,
    async (req): Promise<TeamCycleDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "crowd:manage");
      const body = parseOrThrow(updateCycleBody, req.body);
      const number = parseCycleNumber(req.params.number);
      const result = await updateCycle(app.db, { projectId: project.id, number, body, now: new Date() });
      if (typeof result === "object" && "field" in result) throw fieldError("endsAt", ENDS_AT_MESSAGE);
      switch (result) {
        case "not_found":
          throw cycleNotFound();
        case "conflict":
          throw cycleConflict();
        case "invalid_transition":
          throw invalidTransition();
        default:
          return result;
      }
    },
  );

  app.delete<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/cycles/:number",
    loginRequired,
    async (req, reply) => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "crowd:manage");
      const result = await deleteCycle(app.db, project.id, parseCycleNumber(req.params.number));
      if (result === "not_found") throw cycleNotFound();
      if (result === "has_reports") throw cycleHasReports();
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/cycles/:number/participants",
    readAccess,
    async (req): Promise<ParticipantsPageDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "crowd:read");
      const { cursor, status } = parseOrThrow(participantsQuery, req.query);
      const after = cursor === undefined ? undefined : decodeCursor("pa", cursor, [TIME, UUID]);
      if (after === null) throw fieldError("cursor", "Cursor tidak valid");
      const cycle = await visibleCycle(project.id, req.params.number, true);
      const rows = await withStatementTimeout(app.db, statementTimeoutMs, (db) =>
        listParticipants(db, {
          cycleId: cycle.id,
          ...(status !== undefined ? { status } : {}),
          ...(after !== undefined ? { after: { joinedAt: after[0], userId: after[1] } } : {}),
          limit: PARTICIPANTS_PAGE_SIZE + 1,
        }),
      );
      const page = rows.slice(0, PARTICIPANTS_PAGE_SIZE);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({ user: row.user, status: row.status, joinedAt: row.joinedAt, reportCounts: row.reportCounts })),
        nextCursor:
          rows.length > PARTICIPANTS_PAGE_SIZE && last ? encodeCursor("pa", [last.cursor.joinedAt, last.cursor.userId]) : null,
      };
    },
  );

  app.post<{ Params: { slug: string; number: string; userId: string } }>(
    "/projects/:slug/cycles/:number/participants/:userId/remove",
    loginRequired,
    async (req, reply) => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "crowd:triage");
      const body = parseOrThrow(removeParticipantBody, req.body ?? {});
      const cycle = await visibleCycle(project.id, req.params.number, true);
      if (!isUuid(req.params.userId)) throw participantNotFound();
      const removed = await removeParticipant(app.db, {
        cycleId: cycle.id,
        userId: req.params.userId,
        actorId: req.user!.id,
        reason: body.reason ? body.reason : null,
      });
      if (!removed) throw participantNotFound();
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/cycles/:number/leaderboard",
    readAccess,
    async (req): Promise<LeaderboardDto> => {
      const { project, role } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      const cycle = await visibleCycle(project.id, req.params.number, role !== null);
      return withStatementTimeout(app.db, statementTimeoutMs, (db) => cycleLeaderboard(db, cycle.id, req.user?.id ?? null));
    },
  );

  app.get<{ Params: { slug: string } }>("/projects/:slug/crowd/summary", readAccess, async (req): Promise<CrowdSummaryDto> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "crowd:read");
    return withStatementTimeout(app.db, statementTimeoutMs, (db) => crowdSummary(db, project.id));
  });
}
