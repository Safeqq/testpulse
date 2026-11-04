import { commentBody, type ActivityPageDto, type CommentDto } from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../http/errors.js";
import { isUuid } from "../../http/uuid.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser, requireUser } from "../auth/service.js";
import { resolveProject } from "../projects/access.js";
import { decodeActivityCursor, encodeActivityCursor } from "./activity-cursor.js";
import { createComment, deleteComment, editComment, findBugId, listActivity } from "./comments.repository.js";
import { bugNotFound, commentNotFound, fieldError } from "./errors.js";
import { parseBugNumber } from "./routes.js";

/** Ukuran halaman linimasa aktivitas (spec Tahap 3 §6). */
export const ACTIVITY_PAGE_SIZE = 50;

const forbidden = () => new AppError(403, "FORBIDDEN", "Anda tidak punya izin untuk aksi ini");

type CommentParams = { slug: string; number: string; id: string };

/** Komentar tidak ketemu: 404 BUG_NOT_FOUND bila bug-nya yang tidak ada, selain itu 404 COMMENT_NOT_FOUND. */
async function missingComment(app: FastifyInstance, projectId: string, number: number): Promise<AppError> {
  return (await findBugId(app.db, projectId, number)) ? commentNotFound() : bugNotFound();
}

/**
 * Rute komentar & aktivitas bug (spec Tahap 3 §3.4, §6). Seperti rute bug, hanya sesi cookie yang dibaca. Menulis
 * komentar butuh `bugs:write` (tester/admin) sehingga penulis yang sudah turun menjadi viewer ditolak (403); akses
 * project diputuskan sebelum body divalidasi. Mengubah komentar hanya untuk penulis, menghapus untuk penulis atau admin.
 */
export async function commentRoutes(app: FastifyInstance): Promise<void> {
  const readAccess = { preHandler: [loadUser] };
  const loginRequired = { preHandler: [loadUser, requireUser] };

  app.get<{ Params: { slug: string; number: string }; Querystring: { cursor?: string } }>(
    "/projects/:slug/bugs/:number/activity",
    readAccess,
    async (req): Promise<ActivityPageDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      const number = parseBugNumber(req.params.number);
      const { cursor } = req.query;
      const after = cursor === undefined ? undefined : decodeActivityCursor(cursor);
      if (after === null) throw fieldError("cursor", "Cursor tidak valid");

      const bugId = await findBugId(app.db, project.id, number);
      if (!bugId) throw bugNotFound();

      const rows = await listActivity(app.db, {
        bugId,
        ...(after ? { after } : {}),
        limit: ACTIVITY_PAGE_SIZE + 1,
      });
      const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
      const last = page.at(-1);
      return {
        items: page.map((row) => row.item),
        nextCursor: rows.length > ACTIVITY_PAGE_SIZE && last ? encodeActivityCursor(last.position) : null,
      };
    },
  );

  app.post<{ Params: { slug: string; number: string } }>(
    "/projects/:slug/bugs/:number/comments",
    loginRequired,
    async (req, reply): Promise<CommentDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "bugs:write");
      const { body } = parseOrThrow(commentBody, req.body);
      const number = parseBugNumber(req.params.number);
      const comment = await createComment(app.db, { projectId: project.id, number, authorId: req.user!.id, body });
      if (!comment) throw bugNotFound();
      return reply.status(201).send(comment);
    },
  );

  app.patch<{ Params: CommentParams }>(
    "/projects/:slug/bugs/:number/comments/:id",
    loginRequired,
    async (req): Promise<CommentDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "bugs:write");
      const { body } = parseOrThrow(commentBody, req.body);
      const number = parseBugNumber(req.params.number);
      if (!isUuid(req.params.id)) throw commentNotFound();
      const result = await editComment(app.db, {
        projectId: project.id,
        number,
        commentId: req.params.id,
        actorId: req.user!.id,
        body,
      });
      if (result === "not_found") throw await missingComment(app, project.id, number);
      if (result === "forbidden") throw forbidden();
      return result;
    },
  );

  app.delete<{ Params: CommentParams }>(
    "/projects/:slug/bugs/:number/comments/:id",
    loginRequired,
    async (req, reply) => {
      const { project, role } = await resolveProject(app.db, req.params.slug, req.user, "bugs:write");
      const number = parseBugNumber(req.params.number);
      if (!isUuid(req.params.id)) throw commentNotFound();
      const result = await deleteComment(app.db, {
        projectId: project.id,
        number,
        commentId: req.params.id,
        actorId: req.user!.id,
        isAdmin: role === "admin",
      });
      if (result === "not_found") throw await missingComment(app, project.id, number);
      if (result === "forbidden") throw forbidden();
      return reply.status(204).send();
    },
  );
}
