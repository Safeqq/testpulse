import { createTokenBody, type CreatedTokenDto, type TokenDto } from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../http/errors.js";
import { isUuid } from "../../http/uuid.js";
import { parseOrThrow } from "../../http/validate.js";
import { generateToken, hashToken } from "../auth/domain/tokens.js";
import { loadUser, requireUser } from "../auth/service.js";
import { resolveProject } from "../projects/access.js";
import { insertTokenWithinLimit, listActiveTokens, MAX_ACTIVE_TOKENS, revokeActiveToken } from "./repository.js";

function tokenNotFound(): AppError {
  return new AppError(404, "TOKEN_NOT_FOUND", "Token tidak ditemukan");
}

export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  const loginRequired = { preHandler: [loadUser, requireUser] };

  app.get<{ Params: { slug: string } }>("/projects/:slug/tokens", loginRequired, async (req) => {
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "tokens:manage");
    const active = await listActiveTokens(app.db, project.id);
    return active.map(
      (token): TokenDto => ({
        id: token.id,
        name: token.name,
        createdAt: token.createdAt.toISOString(),
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        createdBy: token.createdBy,
      }),
    );
  });

  app.post<{ Params: { slug: string } }>("/projects/:slug/tokens", loginRequired, async (req, reply) => {
    // Akses diputuskan sebelum body divalidasi: bukan admin tidak boleh tahu apa pun dari respons.
    const { project } = await resolveProject(app.db, req.params.slug, req.user, "tokens:manage");
    const { name } = parseOrThrow(createTokenBody, req.body);

    // Nilai mentah hanya ada di respons ini (tidak dicatat di log); DB menyimpan hash SHA-256-nya.
    const token = `tp_${generateToken()}`;
    const result = await insertTokenWithinLimit(app.db, {
      projectId: project.id,
      name,
      tokenHash: hashToken(token),
      createdBy: req.user!.id,
    });
    if (result.kind === "project_not_found") {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project tidak ditemukan");
    }
    if (result.kind === "limit_reached") {
      throw new AppError(409, "TOKEN_LIMIT", `Maksimal ${MAX_ACTIVE_TOKENS} token aktif per project`);
    }

    const body: CreatedTokenDto = {
      id: result.id,
      name: result.name,
      token,
      createdAt: result.createdAt.toISOString(),
    };
    return reply.status(201).send(body);
  });

  app.delete<{ Params: { slug: string; id: string } }>(
    "/projects/:slug/tokens/:id",
    loginRequired,
    async (req, reply) => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "tokens:manage");
      if (!isUuid(req.params.id)) throw tokenNotFound();

      // Hanya token aktif milik project ini yang bisa dicabut; yang sudah dicabut dianggap tidak ada.
      const revoked = await revokeActiveToken(app.db, project.id, req.params.id, new Date());
      if (!revoked) throw tokenNotFound();
      return reply.status(204).send();
    },
  );
}
