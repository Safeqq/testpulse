import {
  crowdDirectoryQuery,
  joinBody,
  LEADERBOARD_SIZE,
  type CrowdMeDto,
  type CycleDirectoryPageDto,
  type KnownIssuesPageDto,
  type LeaderboardDto,
  type PublicCycleDto,
  type TesterProfileDto,
} from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { withStatementTimeout } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { isUuid } from "../../http/uuid.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser, requireUser } from "../auth/service.js";
import { READ_STATEMENT_TIMEOUT_MS, type ReadRoutesOptions } from "../results/read.routes.js";
import { decodeCursor, encodeCursor, TIME, UUID } from "./cursor.js";
import { rankLeaderboard, type LeaderboardRow } from "./domain/reputation.js";
import {
  cycleNotFound,
  cycleNotOpen,
  fieldError,
  memberCannotJoin,
  notParticipant,
  participantRemoved,
  unauthenticated,
} from "./errors.js";
import {
  crowdMe,
  findPublicCycleRow,
  globalMeEntry,
  joinCycle,
  leaveCycle,
  listDirectory,
  listKnownIssues,
  loadPublicCycleDto,
  testerProfile,
  type DirectoryCursor,
} from "./public.repository.js";
import { cycleLeaderboard, globalLeaderboardRows } from "./reputation.repository.js";

/** Ukuran halaman (spec Tahap 5 §8.2). */
export const DIRECTORY_PAGE_SIZE = 20;
export const KNOWN_ISSUES_PAGE_SIZE = 100;
/** Umur cache leaderboard global (spec §6). */
export const GLOBAL_LEADERBOARD_TTL_MS = 30_000;

export interface CrowdPublicRoutesOptions extends ReadRoutesOptions {
  /** TTL cache leaderboard global (ms); default 30 detik, test memakai 0. */
  leaderboardTtlMs?: number;
}

const cursorQuery = z.object({ cursor: z.string().optional() });

/** Item halaman tanpa posisi keyset-nya (posisi hanya dipakai untuk `nextCursor`). */
function withoutCursor<T extends { cursor: unknown }>(row: T): Omit<T, "cursor"> {
  const { cursor, ...item } = row;
  void cursor;
  return item;
}

function decodeDirectoryCursor(status: "open" | "closed", raw: string): DirectoryCursor | null {
  if (status === "open") {
    const parts = decodeCursor("do", raw, [TIME, TIME, UUID]);
    return parts && { status: "open", end: parts[0], opened: parts[1], id: parts[2] };
  }
  const parts = decodeCursor("dc", raw, [TIME, UUID]);
  return parts && { status: "closed", ended: parts[0], id: parts[1] };
}

function encodeDirectoryCursor(cursor: DirectoryCursor): string {
  return cursor.status === "open"
    ? encodeCursor("do", [cursor.end, cursor.opened, cursor.id])
    : encodeCursor("dc", [cursor.ended, cursor.id]);
}

/**
 * Rute publik crowdtesting di `/crowd` (spec Tahap 5 §8.2). Hanya sesi cookie yang dibaca (token CI = anonim). Cycle
 * draft tidak pernah terlihat di sini (`404 CYCLE_NOT_FOUND`), dan respons tidak pernah memuat email, slug project
 * privat, atau data project lain selain nama.
 */
export async function crowdPublicRoutes(
  app: FastifyInstance,
  config: AppConfig,
  opts: CrowdPublicRoutesOptions = {},
): Promise<void> {
  const readAccess = { preHandler: [loadUser] };
  const loginRequired = { preHandler: [loadUser, requireUser] };
  const rateLimited = { rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" } };
  const statementTimeoutMs = opts.statementTimeoutMs ?? READ_STATEMENT_TIMEOUT_MS;
  const ttlMs = opts.leaderboardTtlMs ?? GLOBAL_LEADERBOARD_TTL_MS;
  let globalCache: { at: number; rows: LeaderboardRow[] } | null = null;

  async function publicCycle(rawId: string) {
    if (!isUuid(rawId)) throw cycleNotFound();
    const row = await findPublicCycleRow(app.db, rawId);
    if (!row) throw cycleNotFound();
    return row;
  }

  app.get("/crowd/cycles", readAccess, async (req): Promise<CycleDirectoryPageDto> => {
    const { cursor, ...query } = parseOrThrow(crowdDirectoryQuery, req.query);
    const after = cursor === undefined ? undefined : decodeDirectoryCursor(query.status, cursor);
    if (after === null) throw fieldError("cursor", "Cursor tidak valid");
    const rows = await withStatementTimeout(app.db, statementTimeoutMs, (db) =>
      listDirectory(db, {
        status: query.status,
        ...(query.q !== undefined ? { q: query.q } : {}),
        ...(after !== undefined ? { after } : {}),
        limit: DIRECTORY_PAGE_SIZE + 1,
      }),
    );
    const page = rows.slice(0, DIRECTORY_PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page.map(withoutCursor),
      nextCursor: rows.length > DIRECTORY_PAGE_SIZE && last ? encodeDirectoryCursor(last.cursor) : null,
    };
  });

  app.get<{ Params: { id: string } }>("/crowd/cycles/:id", readAccess, async (req): Promise<PublicCycleDto> => {
    const cycle = await publicCycle(req.params.id);
    return withStatementTimeout(app.db, statementTimeoutMs, (db) => loadPublicCycleDto(db, cycle, req.user?.id ?? null, new Date()));
  });

  app.post<{ Params: { id: string } }>(
    "/crowd/cycles/:id/join",
    { ...loginRequired, config: rateLimited },
    async (req) => {
      parseOrThrow(joinBody, req.body);
      if (!isUuid(req.params.id)) throw cycleNotFound();
      const result = await joinCycle(app.db, { cycleId: req.params.id, userId: req.user!.id, now: new Date() });
      switch (result) {
        case "not_found":
          throw cycleNotFound();
        case "UNAUTHENTICATED":
          throw unauthenticated();
        case "MEMBER_CANNOT_JOIN":
          throw memberCannotJoin();
        case "PARTICIPANT_REMOVED":
          throw participantRemoved();
        case "CYCLE_NOT_OPEN":
          throw cycleNotOpen();
        default:
          return result;
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/crowd/cycles/:id/join", loginRequired, async (req, reply) => {
    if (!isUuid(req.params.id)) throw cycleNotFound();
    const result = await leaveCycle(app.db, { cycleId: req.params.id, userId: req.user!.id });
    if (result === "not_found") throw cycleNotFound();
    if (result === "not_participant") throw notParticipant();
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/crowd/cycles/:id/known-issues", readAccess, async (req): Promise<KnownIssuesPageDto> => {
    const { cursor } = parseOrThrow(cursorQuery, req.query);
    const after = cursor === undefined ? undefined : decodeCursor("ki", cursor, [TIME, UUID]);
    if (after === null) throw fieldError("cursor", "Cursor tidak valid");
    const cycle = await publicCycle(req.params.id);
    const rows = await withStatementTimeout(app.db, statementTimeoutMs, (db) =>
      listKnownIssues(db, {
        cycleId: cycle.id,
        ...(after !== undefined ? { after: { at: after[0], id: after[1] } } : {}),
        limit: KNOWN_ISSUES_PAGE_SIZE + 1,
      }),
    );
    const page = rows.slice(0, KNOWN_ISSUES_PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page.map(withoutCursor),
      nextCursor: rows.length > KNOWN_ISSUES_PAGE_SIZE && last ? encodeCursor("ki", [last.cursor.at, last.cursor.id]) : null,
    };
  });

  app.get<{ Params: { id: string } }>("/crowd/cycles/:id/leaderboard", readAccess, async (req): Promise<LeaderboardDto> => {
    const cycle = await publicCycle(req.params.id);
    return withStatementTimeout(app.db, statementTimeoutMs, (db) => cycleLeaderboard(db, cycle.id, req.user?.id ?? null));
  });

  app.get("/crowd/leaderboard", readAccess, async (req): Promise<LeaderboardDto> => {
    // Entri dibagi lewat cache singkat (spec §6); bagian `me` selalu dihitung segar untuk pengguna yang login.
    const now = Date.now();
    if (globalCache === null || now - globalCache.at >= ttlMs) {
      const rows = await withStatementTimeout(app.db, statementTimeoutMs, (db) => globalLeaderboardRows(db));
      globalCache = { at: now, rows };
    }
    const { entries } = rankLeaderboard(globalCache.rows, null, LEADERBOARD_SIZE);
    const userId = req.user?.id ?? null;
    const me = userId === null ? null : await withStatementTimeout(app.db, statementTimeoutMs, (db) => globalMeEntry(db, userId));
    return { entries, me };
  });

  app.get<{ Params: { userId: string } }>("/crowd/testers/:userId", readAccess, async (req): Promise<TesterProfileDto> => {
    const notFound = new AppError(404, "NOT_FOUND", "Tester tidak ditemukan");
    if (!isUuid(req.params.userId)) throw notFound;
    const profile = await withStatementTimeout(app.db, statementTimeoutMs, (db) => testerProfile(db, req.params.userId));
    if (!profile) throw notFound;
    return profile;
  });

  app.get("/crowd/me", loginRequired, async (req): Promise<CrowdMeDto> => {
    return withStatementTimeout(app.db, statementTimeoutMs, (db) => crowdMe(db, req.user!.id, new Date()));
  });
}
