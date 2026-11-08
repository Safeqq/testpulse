import {
  caseListQuery,
  createCaseBody,
  testSearchQuery,
  updateCaseBody,
  type CasesPageDto,
  type ManualCaseDto,
  type TestSearchItemDto,
} from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { withStatementTimeout } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser, requireUser } from "../auth/service.js";
import { resolveProject } from "../projects/access.js";
import { READ_STATEMENT_TIMEOUT_MS, type ReadRoutesOptions } from "../results/read.routes.js";
import { caseCoverage, createCase, deleteCase, findCaseByNumber, listCaseLabels, listCases, searchTests, updateCase } from "./cases.repository.js";
import { decodeCaseCursor, encodeCaseCursor } from "./cursor.js";
import { caseConflict, caseNotFound, fieldError } from "./errors.js";

/** Ukuran halaman & batas daftar (spec Tahap 4 §7). */
export const CASES_PAGE_SIZE = 50;
export const MAX_CASE_LABELS = 200;
export const TEST_SEARCH_LIMIT = 20;

const MAX_INT4 = 2_147_483_647;
const NUMBER_PARAM = /^[1-9][0-9]{0,9}$/;

/** Nomor case dari path; bentuk lain (bukan bilangan bulat positif kanonis ≤ int4) → 404 CASE_NOT_FOUND. */
export function parseCaseNumber(raw: string): number {
  const value = NUMBER_PARAM.test(raw) ? Number(raw) : Number.NaN;
  if (!(value <= MAX_INT4)) throw caseNotFound();
  return value;
}

const SUITE_NOT_FOUND = "Suite tidak ditemukan di project ini";
const TEST_NOT_FOUND = "Test otomatis tidak ditemukan di project ini";

/**
 * Rute test case manual, label, dan pencarian automated test (spec Tahap 4 §7). Hanya sesi cookie yang dibaca
 * (token CI diperlakukan anonim); akses project diputuskan sebelum body/query divalidasi. Detail case berjalan dalam
 * transaksi baca-saja ber-`statement_timeout` karena Task 6 menambahkan query riwayat hasil ke dalamnya.
 */
export async function caseRoutes(app: FastifyInstance, opts: ReadRoutesOptions = {}): Promise<void> {
  const readAccess = { preHandler: [loadUser] };
  const loginRequired = { preHandler: [loadUser, requireUser] };
  const statementTimeoutMs = opts.statementTimeoutMs ?? READ_STATEMENT_TIMEOUT_MS;

  app.get<{ Params: { slug: string } }>("/projects/:slug/cases", readAccess, async (req): Promise<CasesPageDto> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    const { cursor, ...query } = parseOrThrow(caseListQuery, req.query);
    const after = cursor === undefined ? undefined : decodeCaseCursor(cursor);
    if (after === null) throw fieldError("cursor", "Cursor tidak valid");

    const rows = await listCases(app.db, {
      projectId: project.id,
      query,
      ...(after ? { after } : {}),
      limit: CASES_PAGE_SIZE + 1,
    });
    const page = rows.slice(0, CASES_PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page.map((row) => row.item),
      nextCursor: rows.length > CASES_PAGE_SIZE && last ? encodeCaseCursor(last.position) : null,
      coverage: await caseCoverage(app.db, project.id),
    };
  });

  app.post<{ Params: { slug: string } }>("/projects/:slug/cases", loginRequired, async (req, reply) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "manual:write");
    const body = parseOrThrow(createCaseBody, req.body);
    const result = await createCase(app.db, { projectId: project.id, actorId: req.user!.id, body });
    if (result === "project_not_found") throw new AppError(404, "PROJECT_NOT_FOUND", "Project tidak ditemukan");
    if (result === "suite_not_found") throw fieldError("suiteId", SUITE_NOT_FOUND);
    if (result === "test_not_found") throw fieldError("automatedTestId", TEST_NOT_FOUND);
    return reply.status(201).send(result);
  });

  app.get<{ Params: { slug: string } }>("/projects/:slug/cases/labels", readAccess, async (req): Promise<string[]> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    return listCaseLabels(app.db, project.id, MAX_CASE_LABELS);
  });

  app.get<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/cases/:number",
    readAccess,
    async (req): Promise<ManualCaseDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      const number = parseCaseNumber(req.params.number);
      const found = await withStatementTimeout(app.db, statementTimeoutMs, (db) => findCaseByNumber(db, project.id, number));
      if (!found) throw caseNotFound();
      return found;
    },
  );

  app.patch<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/cases/:number",
    loginRequired,
    async (req): Promise<ManualCaseDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "manual:write");
      const body = parseOrThrow(updateCaseBody, req.body);
      const number = parseCaseNumber(req.params.number);
      const result = await updateCase(app.db, { projectId: project.id, number, actorId: req.user!.id, body });
      switch (result) {
        case "not_found":
          throw caseNotFound();
        case "conflict":
          throw caseConflict();
        case "suite_not_found":
          throw fieldError("suiteId", SUITE_NOT_FOUND);
        case "test_not_found":
          throw fieldError("automatedTestId", TEST_NOT_FOUND);
        default:
          return result;
      }
    },
  );

  app.delete<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/cases/:number",
    loginRequired,
    async (req, reply) => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "manual:delete");
      if (!(await deleteCase(app.db, project.id, parseCaseNumber(req.params.number)))) throw caseNotFound();
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { slug: string } }>("/projects/:slug/tests", readAccess, async (req): Promise<TestSearchItemDto[]> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    const { q } = parseOrThrow(testSearchQuery, req.query);
    return searchTests(app.db, project.id, q, TEST_SEARCH_LIMIT);
  });
}
