import {
  createInvitationBody,
  type AcceptInvitationDto,
  type CreatedInvitationDto,
  type InvitationDto,
  type InvitationPreviewDto,
} from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../http/errors.js";
import { isUuid } from "../../http/uuid.js";
import { parseOrThrow } from "../../http/validate.js";
import { generateToken, hashToken } from "../auth/domain/tokens.js";
import { loadUser, requireUser } from "../auth/service.js";
import { resolveProject } from "../projects/access.js";
import { INVITATION_TTL_DAYS, invitationStatus } from "./domain/invitations.js";
import {
  acceptInvitation,
  findByTokenHash,
  insertInvitation,
  listActiveInvitations,
  revokeActiveInvitation,
} from "./repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function invitationNotFound(): AppError {
  return new AppError(404, "INVITATION_NOT_FOUND", "Undangan tidak ditemukan");
}

function invitationUsed(): AppError {
  return new AppError(410, "INVITATION_USED", "Undangan sudah dipakai");
}

function invitationExpired(): AppError {
  return new AppError(410, "INVITATION_EXPIRED", "Undangan sudah kedaluwarsa");
}

export async function invitationRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const loginRequired = { preHandler: [loadUser, requireUser] };

  app.get<{ Params: { slug: string } }>("/projects/:slug/invitations", loginRequired, async (req) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "invitations:manage");
    const active = await listActiveInvitations(app.db, project.id, new Date());
    return active.map(
      (inv): InvitationDto => ({
        id: inv.id,
        role: inv.role,
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: inv.createdAt.toISOString(),
        createdBy: inv.createdBy,
      }),
    );
  });

  app.post<{ Params: { slug: string } }>("/projects/:slug/invitations", loginRequired, async (req, reply) => {
    // Akses diputuskan sebelum body divalidasi: bukan admin tidak boleh tahu apa pun dari respons.
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "invitations:manage");
    const { role } = parseOrThrow(createInvitationBody, req.body);

    // Token mentah hanya ada di respons ini; DB menyimpan hash SHA-256-nya.
    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * DAY_MS);
    const created = await insertInvitation(app.db, {
      projectId: project.id,
      tokenHash: hashToken(token),
      role,
      createdBy: req.user!.id,
      expiresAt,
    });

    const body: CreatedInvitationDto = {
      id: created.id,
      url: `${config.appOrigin}/invite/${token}`,
      role: created.role,
      expiresAt: created.expiresAt.toISOString(),
    };
    return reply.status(201).send(body);
  });

  app.delete<{ Params: { slug: string; id: string } }>(
    "/projects/:slug/invitations/:id",
    loginRequired,
    async (req, reply) => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "invitations:manage");
      if (!isUuid(req.params.id)) throw invitationNotFound();

      // Hanya undangan aktif yang bisa dicabut; yang sudah dicabut/terpakai/kedaluwarsa dianggap tidak ada.
      const revoked = await revokeActiveInvitation(app.db, project.id, req.params.id, new Date());
      if (!revoked) throw invitationNotFound();
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { token: string } }>("/invitations/:token", async (req) => {
    const found = await findByTokenHash(app.db, hashToken(req.params.token));
    if (!found) throw invitationNotFound();

    const status = invitationStatus(found, new Date());
    if (status === "revoked") throw invitationNotFound();
    if (status === "used") throw invitationUsed();
    if (status === "expired") throw invitationExpired();

    const body: InvitationPreviewDto = {
      projectName: found.projectName,
      projectSlug: found.projectSlug,
      role: found.role,
      expiresAt: found.expiresAt.toISOString(),
    };
    return body;
  });

  app.post<{ Params: { token: string } }>("/invitations/:token/accept", loginRequired, async (req) => {
    const result = await acceptInvitation(app.db, hashToken(req.params.token), req.user!.id, new Date());
    switch (result.kind) {
      case "not_found":
        throw invitationNotFound();
      case "rejected":
        throw result.status === "used" ? invitationUsed() : invitationExpired();
      case "already_member":
        throw new AppError(409, "ALREADY_MEMBER", "Anda sudah menjadi anggota project ini");
      case "accepted": {
        const body: AcceptInvitationDto = { projectSlug: result.projectSlug, role: result.role };
        return body;
      }
    }
  });
}
