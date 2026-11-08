import {
  createManualRunBody,
  manualRunListQuery,
  MAX_RUN_CASES,
  runCaseListQuery,
  updateManualRunBody,
  updateRunCaseBody,
  type ManualRunDto,
  type ManualRunsPageDto,
  type RunCaseDto,
  type RunCasesPageDto,
} from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { withStatementTimeout } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { isUuid } from "../../http/uuid.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser, requireUser } from "../auth/service.js";
import { resolveProject } from "../projects/access.js";
import { READ_STATEMENT_TIMEOUT_MS, type ReadRoutesOptions } from "../results/read.routes.js";
import { parsePathNumber } from "./cases.routes.js";
import { decodeRunCaseCursor, decodeRunCursor, encodeRunCaseCursor, encodeRunCursor } from "./cursor.js";
import { fieldError, manualRunConflict, manualRunNotFound, runCaseNotFound, runCompleted } from "./errors.js";
import { listRunCases, loadRunCaseDto, updateRunCase } from "./run-cases.repository.js";
import {
  createManualRun,
  deleteManualRun,
  findManualRun,
  findRunRef,
  listManualRuns,
  updateManualRun,
} from "./runs.repository.js";

/** Ukuran halaman (spec Tahap 4 §7). */
export const MANUAL_RUNS_PAGE_SIZE = 20;
export const RUN_CASES_PAGE_SIZE = 100;

const SELECTION_MESSAGES = {
  suiteIds: "Suite tidak ditemukan di project ini",
  caseNumbers: "Case tidak ditemukan atau sudah diarsipkan",
  selection: `Pilih 1–${MAX_RUN_CASES} case aktif`,
} as const;
const STEP_RESULTS_MISMATCH = "Hasil langkah harus sebanyak langkah case";
const ASSIGNEE_NOT_MEMBER = "Assignee harus anggota project ini";

/** Nomor run dari path; bentuk tidak sah → 404 MANUAL_RUN_NOT_FOUND. */
const parseRunNumber = (raw: string) => parsePathNumber(raw, manualRunNotFound);

/**
 * Rute run manual dan eksekusi run case (spec Tahap 4 §4, §7). Hanya sesi cookie yang dibaca (token CI diperlakukan
 * anonim); akses project diputuskan sebelum body/query divalidasi. Detail run dan run case berjalan dalam transaksi
 * baca-saja ber-`statement_timeout` (snapshot konsisten untuk ringkasan dan `nextUntestedId`; Task 6 menambah bug).
 */
export async function manualRunRoutes(app: FastifyInstance, opts: ReadRoutesOptions = {}): Promise<void> {
  const readAccess = { preHandler: [loadUser] };
  const loginRequired = { preHandler: [loadUser, requireUser] };
  const statementTimeoutMs = opts.statementTimeoutMs ?? READ_STATEMENT_TIMEOUT_MS;

  app.get<{ Params: { slug: string } }>("/projects/:slug/manual-runs", readAccess, async (req): Promise<ManualRunsPageDto> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    const { cursor, ...query } = parseOrThrow(manualRunListQuery, req.query);
    const after = cursor === undefined ? undefined : decodeRunCursor(cursor);
    if (after === null) throw fieldError("cursor", "Cursor tidak valid");

    const rows = await listManualRuns(app.db, {
      projectId: project.id,
      query,
      ...(after !== undefined ? { after } : {}),
      limit: MANUAL_RUNS_PAGE_SIZE + 1,
    });
    const page = rows.slice(0, MANUAL_RUNS_PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor: rows.length > MANUAL_RUNS_PAGE_SIZE && last ? encodeRunCursor(last.number) : null,
    };
  });

  app.post<{ Params: { slug: string } }>("/projects/:slug/manual-runs", loginRequired, async (req, reply) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "manual:write");
    const body = parseOrThrow(createManualRunBody, req.body);
    const result = await createManualRun(app.db, { projectId: project.id, actorId: req.user!.id, body });
    if (result === "project_not_found") throw new AppError(404, "PROJECT_NOT_FOUND", "Project tidak ditemukan");
    if ("field" in result) throw fieldError(result.field, SELECTION_MESSAGES[result.field]);
    return reply.status(201).send(result);
  });

  app.get<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/manual-runs/:number",
    readAccess,
    async (req): Promise<ManualRunDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      const number = parseRunNumber(req.params.number);
      const run = await withStatementTimeout(app.db, statementTimeoutMs, (db) => findManualRun(db, project.id, number));
      if (!run) throw manualRunNotFound();
      return run;
    },
  );

  app.patch<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/manual-runs/:number",
    loginRequired,
    async (req): Promise<ManualRunDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "manual:write");
      const body = parseOrThrow(updateManualRunBody, req.body);
      const number = parseRunNumber(req.params.number);
      const result = await updateManualRun(app.db, { projectId: project.id, number, actorId: req.user!.id, body });
      switch (result) {
        case "not_found":
          throw manualRunNotFound();
        case "conflict":
          throw manualRunConflict();
        case "completed":
          throw runCompleted();
        default:
          return result;
      }
    },
  );

  app.delete<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/manual-runs/:number",
    loginRequired,
    async (req, reply) => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "manual:delete");
      if (!(await deleteManualRun(app.db, project.id, parseRunNumber(req.params.number)))) throw manualRunNotFound();
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/manual-runs/:number/cases",
    readAccess,
    async (req): Promise<RunCasesPageDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      const number = parseRunNumber(req.params.number);
      const { cursor, ...query } = parseOrThrow(runCaseListQuery, req.query);
      const after = cursor === undefined ? undefined : decodeRunCaseCursor(cursor);
      if (after === null) throw fieldError("cursor", "Cursor tidak valid");

      const run = await findRunRef(app.db, project.id, number);
      if (!run) throw manualRunNotFound();
      const rows = await listRunCases(app.db, {
        runId: run.id,
        userId: req.user?.id ?? null,
        query,
        ...(after !== undefined ? { after } : {}),
        limit: RUN_CASES_PAGE_SIZE + 1,
      });
      const page = rows.slice(0, RUN_CASES_PAGE_SIZE);
      const last = page.at(-1);
      return {
        items: page,
        nextCursor: rows.length > RUN_CASES_PAGE_SIZE && last ? encodeRunCaseCursor(last.position) : null,
      };
    },
  );

  app.get<{ Params: { slug: string; number: string; id: string } }>(
    "/projects/:slug/manual-runs/:number/cases/:id",
    readAccess,
    async (req): Promise<RunCaseDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      const number = parseRunNumber(req.params.number);
      const result = await withStatementTimeout(app.db, statementTimeoutMs, async (db) => {
        const run = await findRunRef(db, project.id, number);
        if (!run) return "run_not_found" as const;
        // Id bukan uuid → 404 RUN_CASE_NOT_FOUND tanpa query (Postgres menolak bind-nya); run tak dikenal didahulukan.
        return isUuid(req.params.id) ? loadRunCaseDto(db, run.id, req.params.id) : null;
      });
      if (result === "run_not_found") throw manualRunNotFound();
      if (!result) throw runCaseNotFound();
      return result;
    },
  );

  app.patch<{ Params: { slug: string; number: string; id: string } }>(
    "/projects/:slug/manual-runs/:number/cases/:id",
    loginRequired,
    async (req): Promise<RunCaseDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "manual:write");
      const body = parseOrThrow(updateRunCaseBody, req.body);
      const runNumber = parseRunNumber(req.params.number);
      const result = await updateRunCase(app.db, {
        projectId: project.id,
        runNumber,
        runCaseId: req.params.id,
        actorId: req.user!.id,
        body,
      });
      if (typeof result === "object" && "field" in result) {
        throw fieldError(result.field, result.field === "stepResults" ? STEP_RESULTS_MISMATCH : ASSIGNEE_NOT_MEMBER);
      }
      switch (result) {
        case "run_not_found":
          throw manualRunNotFound();
        case "not_found":
          throw runCaseNotFound();
        case "conflict":
          throw manualRunConflict();
        case "completed":
          throw runCompleted();
        default:
          return result;
      }
    },
  );
}
