import {
  createProjectBody,
  deleteProjectBody,
  slugify,
  slugSchema,
  updateProjectBody,
  type CreateProjectBody,
} from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../http/errors.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser, requireUser } from "../auth/service.js";
import { resolveProject, toProjectDto } from "./access.js";
import { insertProjectWithAdmin, listForUser, remove, update } from "./repository.js";

const MANUAL_SLUG_MESSAGE = "Slug tidak dapat dibuat dari nama ini, isi slug secara manual";

/** Slug eksplisit dipakai apa adanya (sudah divalidasi skema); jika kosong dibuat dari nama dan divalidasi ulang. */
function resolveSlug(body: CreateProjectBody): string {
  if (body.slug !== undefined) return body.slug;
  const generated = slugify(body.name);
  if (!slugSchema.safeParse(generated).success) {
    throw new AppError(400, "VALIDATION_ERROR", "Data tidak valid", { slug: MANUAL_SLUG_MESSAGE });
  }
  return generated;
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  const loginRequired = { preHandler: [loadUser, requireUser] };

  app.get("/projects", loginRequired, async (req) => {
    const items = await listForUser(app.db, req.user!.id);
    return items.map(({ project, role }) => toProjectDto(project, role));
  });

  app.post("/projects", loginRequired, async (req, reply) => {
    const body = parseOrThrow(createProjectBody, req.body);
    const slug = resolveSlug(body);
    const project = await insertProjectWithAdmin(app.db, { name: body.name, slug, createdBy: req.user!.id });
    if (!project) {
      throw new AppError(409, "SLUG_TAKEN", "Slug sudah dipakai");
    }
    return reply.status(201).send(toProjectDto(project, "admin"));
  });

  // Satu-satunya endpoint project yang boleh diakses anonim (jika project publik).
  app.get<{ Params: { slug: string } }>("/projects/:slug", { preHandler: [loadUser] }, async (req) => {
    const { project, role } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
    return toProjectDto(project, role);
  });

  app.patch<{ Params: { slug: string } }>("/projects/:slug", loginRequired, async (req) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:manage");
    const changes = parseOrThrow(updateProjectBody, req.body);
    const updated = await update(app.db, project.id, changes);
    if (!updated) throw new AppError(404, "PROJECT_NOT_FOUND", "Project tidak ditemukan");
    return toProjectDto(updated, "admin");
  });

  app.delete<{ Params: { slug: string } }>("/projects/:slug", loginRequired, async (req, reply) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:manage");
    const body = parseOrThrow(deleteProjectBody, req.body);
    if (body.confirmSlug !== project.slug) {
      throw new AppError(400, "CONFIRMATION_MISMATCH", "Slug konfirmasi tidak cocok dengan slug project");
    }
    await remove(app.db, project.id);
    return reply.status(204).send();
  });
}
