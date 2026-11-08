import { suiteBody, updateSuiteBody, type SuiteDto } from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../http/errors.js";
import { parseOrThrow } from "../../http/validate.js";
import { isUuid } from "../../http/uuid.js";
import { loadUser, requireUser } from "../auth/service.js";
import { resolveProject } from "../projects/access.js";
import { fieldError, suiteNotEmpty, suiteNotFound } from "./errors.js";
import { createSuite, deleteSuite, listSuites, updateSuite } from "./suites.repository.js";

const NAME_TAKEN = "Nama suite sudah dipakai";
const LIMIT_REACHED = "Jumlah suite sudah mencapai batas maksimal";

/** Id suite dari path; bukan uuid → 404 SUITE_NOT_FOUND (bukan 500 dari bind Postgres). */
function parseSuiteId(raw: string): string {
  if (!isUuid(raw)) throw suiteNotFound();
  return raw;
}

/**
 * Rute suite test case manual (spec Tahap 4 §3.1, §7). Seperti modul bug: hanya sesi cookie yang dibaca (token CI
 * diperlakukan anonim) dan akses project diputuskan sebelum body divalidasi, agar non-anggota project privat selalu 404.
 */
export async function suiteRoutes(app: FastifyInstance): Promise<void> {
  const readAccess = { preHandler: [loadUser] };
  const loginRequired = { preHandler: [loadUser, requireUser] };

  app.get<{ Params: { slug: string } }>("/projects/:slug/suites", readAccess, async (req): Promise<SuiteDto[]> => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    return listSuites(app.db, project.id);
  });

  app.post<{ Params: { slug: string } }>("/projects/:slug/suites", loginRequired, async (req, reply) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "manual:write");
    const body = parseOrThrow(suiteBody, req.body);
    const result = await createSuite(app.db, { projectId: project.id, body });
    if (result === "project_not_found") throw new AppError(404, "PROJECT_NOT_FOUND", "Project tidak ditemukan");
    if (result === "name_taken") throw fieldError("name", NAME_TAKEN);
    if (result === "limit_reached") throw fieldError("name", LIMIT_REACHED);
    return reply.status(201).send(result);
  });

  app.patch<{ Params: { slug: string; id: string } }>(
    "/projects/:slug/suites/:id",
    loginRequired,
    async (req): Promise<SuiteDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "manual:write");
      const body = parseOrThrow(updateSuiteBody, req.body);
      const result = await updateSuite(app.db, { projectId: project.id, id: parseSuiteId(req.params.id), body });
      if (result === "not_found") throw suiteNotFound();
      if (result === "name_taken") throw fieldError("name", NAME_TAKEN);
      return result;
    },
  );

  app.delete<{ Params: { slug: string; id: string } }>("/projects/:slug/suites/:id", loginRequired, async (req, reply) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "manual:delete");
    const result = await deleteSuite(app.db, { projectId: project.id, id: parseSuiteId(req.params.id) });
    if (result === "not_found") throw suiteNotFound();
    if (result === "not_empty") throw suiteNotEmpty();
    return reply.status(204).send();
  });
}
