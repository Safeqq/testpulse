import { bugListQuery, createBugBody, updateBugBody, type BugDto, type BugsPageDto } from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { withStatementTimeout } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser, requireUser } from "../auth/service.js";
import { resolveProject } from "../projects/access.js";
import { READ_STATEMENT_TIMEOUT_MS, type ReadRoutesOptions } from "../results/read.routes.js";
import { decodeBugCursor, encodeBugCursor } from "./cursor.js";
import { bugConflict, bugNotFound, fieldError, invalidTransition } from "./errors.js";
import { findBugByNumber, listBugs, listLabels } from "./read.repository.js";
import { createBug, deleteBug, updateBug } from "./write.repository.js";

/** Ukuran halaman & batas daftar (spec Tahap 3 §6). */
export const BUGS_PAGE_SIZE = 25;
export const MAX_LABELS = 200;

const MAX_INT4 = 2_147_483_647;
const NUMBER_PARAM = /^[1-9][0-9]{0,9}$/;

/** Nomor bug dari path; bentuk lain (bukan bilangan bulat positif kanonis ≤ int4) → 404 BUG_NOT_FOUND. */
export function parseBugNumber(raw: string): number {
  const value = NUMBER_PARAM.test(raw) ? Number(raw) : Number.NaN;
  if (!(value <= MAX_INT4)) throw bugNotFound();
  return value;
}

const ASSIGNEE_NOT_MEMBER = "Assignee harus anggota project ini";
const RESOLUTION_REQUIRED = "Resolusi wajib diisi untuk status ini";

/**
 * Rute bug tracker (spec Tahap 3 §6). Hanya sesi cookie yang dibaca (`loadUser`): token CI tidak berlaku sehingga
 * pembawa token diperlakukan seperti anonim. Akses project diputuskan sebelum body/query divalidasi, agar non-anggota
 * project privat selalu mendapat 404. Detail bug (dengan `testHint` yang membaca riwayat hasil test) berjalan dalam
 * transaksi baca-saja ber-`statement_timeout` seperti query baca berat lain; terlampaui → 503.
 */
export async function bugRoutes(app: FastifyInstance, opts: ReadRoutesOptions = {}): Promise<void> {
  const readAccess = { preHandler: [loadUser] };
  const loginRequired = { preHandler: [loadUser, requireUser] };
  const statementTimeoutMs = opts.statementTimeoutMs ?? READ_STATEMENT_TIMEOUT_MS;

  app.get<{ Params: { slug: string } }>("/projects/:slug/bugs", readAccess, async (req): Promise<BugsPageDto> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    const { cursor, ...query } = parseOrThrow(bugListQuery, req.query);
    const after = cursor === undefined ? undefined : decodeBugCursor(cursor, query.sort);
    if (after === null) throw fieldError("cursor", "Cursor tidak valid");

    const rows = await listBugs(app.db, {
      projectId: project.id,
      userId: req.user?.id ?? null,
      query,
      ...(after ? { after } : {}),
      limit: BUGS_PAGE_SIZE + 1,
    });
    const page = rows.slice(0, BUGS_PAGE_SIZE);
    const last = page.at(-1);
    return {
      bugs: page.map((row) => row.bug),
      nextCursor: rows.length > BUGS_PAGE_SIZE && last ? encodeBugCursor(query.sort, last.position) : null,
    };
  });

  app.post<{ Params: { slug: string } }>("/projects/:slug/bugs", loginRequired, async (req, reply) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "bugs:write");
    const body = parseOrThrow(createBugBody, req.body);
    const result = await createBug(app.db, { projectId: project.id, reporterId: req.user!.id, body });
    if (result === "project_not_found") throw new AppError(404, "PROJECT_NOT_FOUND", "Project tidak ditemukan");
    if (result === "assignee_not_member") throw fieldError("assigneeId", ASSIGNEE_NOT_MEMBER);
    if (result === "test_case_not_found") throw fieldError("testCaseId", "Test tidak ditemukan di project ini");
    if (result === "run_not_found") throw fieldError("runId", "Run tidak ditemukan atau tidak memuat hasil test ini");
    if (result === "manual_run_case_not_found") throw fieldError("manualRunCaseId", "Run case tidak ditemukan di project ini");
    return reply.status(201).send(result);
  });

  app.get<{ Params: { slug: string } }>("/projects/:slug/bugs/labels", readAccess, async (req): Promise<string[]> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    return listLabels(app.db, project.id, MAX_LABELS);
  });

  app.get<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/bugs/:number",
    readAccess,
    async (req): Promise<BugDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      const number = parseBugNumber(req.params.number);
      const bug = await withStatementTimeout(app.db, statementTimeoutMs, (db) => findBugByNumber(db, project.id, number));
      if (!bug) throw bugNotFound();
      return bug;
    },
  );

  app.patch<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/bugs/:number",
    loginRequired,
    async (req): Promise<BugDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "bugs:write");
      const body = parseOrThrow(updateBugBody, req.body);
      const number = parseBugNumber(req.params.number);
      const result = await updateBug(app.db, { projectId: project.id, number, actorId: req.user!.id, body });
      switch (result) {
        case "not_found":
          throw bugNotFound();
        case "conflict":
          throw bugConflict();
        case "invalid_transition":
          throw invalidTransition();
        case "resolution_required":
          throw fieldError("resolution", RESOLUTION_REQUIRED);
        case "resolution_not_allowed":
          throw fieldError("resolution", "Resolusi hanya untuk bug berstatus resolved atau closed");
        case "assignee_not_member":
          throw fieldError("assigneeId", ASSIGNEE_NOT_MEMBER);
        default:
          return result;
      }
    },
  );

  app.delete<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/bugs/:number",
    loginRequired,
    async (req, reply) => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "bugs:delete");
      if (!(await deleteBug(app.db, project.id, parseBugNumber(req.params.number)))) throw bugNotFound();
      return reply.status(204).send();
    },
  );
}
