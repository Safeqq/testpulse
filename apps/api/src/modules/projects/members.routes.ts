import { updateMemberBody, type MemberDto } from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../http/errors.js";
import { isUuid } from "../../http/uuid.js";
import { parseOrThrow } from "../../http/validate.js";
import { loadUser, requireUser } from "../auth/service.js";
import { resolveProject } from "./access.js";
import { changeMemberRole, findMember, listMembers, type MemberRecord } from "./repository.js";

function memberNotFound(): AppError {
  return new AppError(404, "MEMBER_NOT_FOUND", "Anggota tidak ditemukan");
}

function lastAdmin(): AppError {
  return new AppError(409, "LAST_ADMIN", "Project harus memiliki minimal satu admin");
}

function toMemberDto(member: MemberRecord): MemberDto {
  return { ...member, joinedAt: member.joinedAt.toISOString() };
}

export async function memberRoutes(app: FastifyInstance): Promise<void> {
  const loginRequired = { preHandler: [loadUser, requireUser] };

  app.get<{ Params: { slug: string } }>("/projects/:slug/members", loginRequired, async (req) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "members:read");
    const members = await listMembers(app.db, project.id);
    return members.map(toMemberDto);
  });

  app.patch<{ Params: { slug: string; userId: string } }>(
    "/projects/:slug/members/:userId",
    loginRequired,
    async (req) => {
      // Akses diputuskan sebelum body/param divalidasi: bukan anggota tidak boleh tahu apa pun dari respons.
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "members:manage");
      const { role } = parseOrThrow(updateMemberBody, req.body);
      const { userId } = req.params;
      if (!isUuid(userId)) throw memberNotFound();

      const result = await changeMemberRole(app.db, project.id, userId, role);
      if (result === "not_member") throw memberNotFound();
      if (result === "last_admin") throw lastAdmin();

      // Baris sudah berubah; ambil ulang sebagai DTO.
      const member = await findMember(app.db, project.id, userId);
      if (!member) throw memberNotFound();
      return toMemberDto(member);
    },
  );

  app.delete<{ Params: { slug: string; userId: string } }>(
    "/projects/:slug/members/:userId",
    loginRequired,
    async (req, reply) => {
      const { userId } = req.params;
      const isSelf = userId === req.user!.id;

      // Keluar sendiri cukup dengan hak baca; mengeluarkan orang lain butuh admin.
      const { project, role } = await resolveProject(
        app.db,
        req.params.slug,
        req.user,
        isSelf ? "project:read" : "members:manage",
      );
      if (isSelf && role === null) throw memberNotFound();
      if (!isUuid(userId)) throw memberNotFound();

      const result = await changeMemberRole(app.db, project.id, userId, null);
      if (result === "not_member") throw memberNotFound();
      if (result === "last_admin") throw lastAdmin();
      return reply.status(204).send();
    },
  );
}
