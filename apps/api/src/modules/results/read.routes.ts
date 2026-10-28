import {
  ingestQuery,
  type BranchDto,
  type FlakyTestDto,
  type ResultStatus,
  type RunDetailDto,
  type RunsPageDto,
  type RunSummaryDto,
  type StatsDto,
  type TestHistoryDto,
} from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser, requireUser } from "../auth/service.js";
import { resolveProject } from "../projects/access.js";
import { decodeCursor, decodeResultCursor, encodeCursor, encodeResultCursor } from "./cursor.js";
import {
  deleteRun,
  findRun,
  findTestCase,
  latestBranch,
  listBranchHeads,
  listFlakyTests,
  listRecentRuns,
  listRunResults,
  listRuns,
  listTestHistory,
  type RunRecord,
} from "./repository.js";

/** Ukuran halaman & batas daftar (spec Tahap 2 §7). */
export const RUNS_PAGE_SIZE = 20;
export const RESULTS_PAGE_SIZE = 100;
export const TREND_POINTS = 30;
export const MAX_FLAKY_TESTS = 50;
export const HISTORY_LENGTH = 20;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aturan `branch` sama persis dengan query upload (1–200 karakter `[A-Za-z0-9._/-]`). */
const branchParam = ingestQuery.in.shape.branch.optional();
const branchQuery = z.object({ branch: branchParam });
const runsQuery = z.object({ branch: branchParam, cursor: z.string().optional() });
const runDetailQuery = z.object({
  status: z.enum(["failed", "flaky", "all"]).default("failed"),
  cursor: z.string().optional(),
});

function invalidCursor(): AppError {
  return new AppError(400, "VALIDATION_ERROR", "Data tidak valid", { cursor: "Cursor tidak valid" });
}

function runNotFound(): AppError {
  return new AppError(404, "RUN_NOT_FOUND", "Run tidak ditemukan");
}

function testNotFound(): AppError {
  return new AppError(404, "TEST_NOT_FOUND", "Test tidak ditemukan");
}

function toRunSummary(run: RunRecord): RunSummaryDto {
  return {
    id: run.id,
    branch: run.branch,
    commitSha: run.commitSha,
    ciUrl: run.ciUrl,
    name: run.name,
    createdAt: run.createdAt.toISOString(),
    durationMs: run.durationMs,
    total: run.total,
    passed: run.passed,
    failed: run.failed,
    skipped: run.skipped,
    flaky: run.flaky,
  };
}

/** passed / (passed + failed) × 100, dibulatkan 1 desimal (setengah ke atas); `null` bila penyebutnya 0. */
function passRate(run: RunRecord): number | null {
  const executed = run.passed + run.failed;
  return executed === 0 ? null : Math.round((run.passed * 1000) / executed) / 10;
}

/**
 * Rute baca hasil test (spec Tahap 2 §7) dan hapus run. Hanya sesi cookie yang dibaca (`loadUser`); token CI tidak
 * berlaku di sini sehingga pembawa token diperlakukan seperti anonim. Akses project diputuskan sebelum query
 * divalidasi agar non-anggota project privat selalu mendapat 404.
 */
export async function readRoutes(app: FastifyInstance): Promise<void> {
  const readAccess = { preHandler: [loadUser] };
  const loginRequired = { preHandler: [loadUser, requireUser] };

  /** Branch dari query, atau branch run terbaru project bila tidak diisi. */
  const branchOrLatest = async (projectId: string, query: unknown) =>
    parseOrThrow(branchQuery, query).branch ?? (await latestBranch(app.db, projectId));

  app.get<{ Params: { slug: string } }>("/projects/:slug/branches", readAccess, async (req) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    const heads = await listBranchHeads(app.db, project.id);
    return heads.map((run): BranchDto => ({ branch: run.branch, lastRun: toRunSummary(run) }));
  });

  app.get<{ Params: { slug: string } }>("/projects/:slug/runs", readAccess, async (req): Promise<RunsPageDto> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    const query = parseOrThrow(runsQuery, req.query);
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (after === null) throw invalidCursor();

    const rows = await listRuns(app.db, project.id, {
      ...(query.branch !== undefined ? { branch: query.branch } : {}),
      ...(after ? { after } : {}),
      limit: RUNS_PAGE_SIZE + 1,
    });
    const page = rows.slice(0, RUNS_PAGE_SIZE);
    const last = page.at(-1);
    return {
      runs: page.map(toRunSummary),
      nextCursor: rows.length > RUNS_PAGE_SIZE && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  });

  app.get<{ Params: { slug: string; runId: string } }>(
    "/projects/:slug/runs/:runId",
    readAccess,
    async (req): Promise<RunDetailDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      const query = parseOrThrow(runDetailQuery, req.query);
      const afterId = query.cursor === undefined ? undefined : decodeResultCursor(query.cursor);
      if (afterId === null) throw invalidCursor();

      if (!UUID_PATTERN.test(req.params.runId)) throw runNotFound();
      const run = await findRun(app.db, project.id, req.params.runId);
      if (!run) throw runNotFound();

      const rows = await listRunResults(app.db, run.id, {
        filter: query.status,
        ...(afterId !== undefined ? { afterId } : {}),
        limit: RESULTS_PAGE_SIZE + 1,
      });
      const page = rows.slice(0, RESULTS_PAGE_SIZE);
      const last = page.at(-1);
      return {
        run: toRunSummary(run),
        results: page.map((row) => ({
          testCaseId: row.testCaseId,
          suite: row.suite,
          name: row.name,
          status: row.status as ResultStatus,
          flakyInRun: row.flakyInRun,
          retries: row.retries,
          durationMs: row.durationMs,
          message: row.message,
        })),
        nextCursor: rows.length > RESULTS_PAGE_SIZE && last ? encodeResultCursor(last.id) : null,
      };
    },
  );

  app.delete<{ Params: { slug: string; runId: string } }>(
    "/projects/:slug/runs/:runId",
    loginRequired,
    async (req, reply) => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "runs:delete");
      if (!UUID_PATTERN.test(req.params.runId)) throw runNotFound();
      if (!(await deleteRun(app.db, project.id, req.params.runId))) throw runNotFound();
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { slug: string } }>("/projects/:slug/stats", readAccess, async (req): Promise<StatsDto> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    const branch = await branchOrLatest(project.id, req.query);
    if (branch === null) return { branch: null, points: [], latest: null };

    const recent = await listRecentRuns(app.db, project.id, branch, TREND_POINTS);
    const latest = recent[0];
    return {
      branch,
      points: recent.toReversed().map((run) => ({
        runId: run.id,
        createdAt: run.createdAt.toISOString(),
        passRate: passRate(run),
        durationMs: run.durationMs,
      })),
      latest: latest ? toRunSummary(latest) : null,
    };
  });

  app.get<{ Params: { slug: string } }>("/projects/:slug/flaky", readAccess, async (req): Promise<FlakyTestDto[]> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    const branch = await branchOrLatest(project.id, req.query);
    if (branch === null) return [];
    return listFlakyTests(app.db, project.id, branch, MAX_FLAKY_TESTS);
  });

  app.get<{ Params: { slug: string; testCaseId: string } }>(
    "/projects/:slug/tests/:testCaseId/history",
    readAccess,
    async (req): Promise<TestHistoryDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      const query = parseOrThrow(branchQuery, req.query);
      if (!UUID_PATTERN.test(req.params.testCaseId)) throw testNotFound();
      const testCase = await findTestCase(app.db, project.id, req.params.testCaseId);
      if (!testCase) throw testNotFound();

      const branch = query.branch ?? (await latestBranch(app.db, project.id));
      if (branch === null) return { testCase, branch: null, results: [] };

      const history = await listTestHistory(app.db, project.id, testCase.id, branch, HISTORY_LENGTH);
      return {
        testCase,
        branch,
        // Urut waktu (lama → baru), sama seperti titik tren dan masukan `flakyScore`.
        results: history.toReversed().map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          status: row.status as ResultStatus,
        })),
      };
    },
  );
}
