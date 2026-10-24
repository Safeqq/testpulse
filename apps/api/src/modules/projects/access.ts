import type { ProjectDto, Role } from "@testpulse/shared";
import type { Db } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import type { AuthUser } from "../auth/service.js";
import { decideAccess, type ProjectAction } from "./domain/permissions.js";
import { findBySlug, type ProjectRecord } from "./repository.js";

/**
 * Mencari project dan memutuskan akses `user` untuk `action`.
 * Project yang tidak ada diperlakukan persis seperti project privat bagi bukan anggota.
 */
export async function resolveProject(
  db: Db,
  slug: string,
  user: AuthUser | null,
  action: ProjectAction,
): Promise<{ project: ProjectRecord; role: Role | null }> {
  const found = await findBySlug(db, slug, user?.id ?? null);
  const decision = decideAccess(action, {
    authenticated: user !== null,
    visibility: found?.project.visibility ?? "private",
    role: found?.role ?? null,
  });

  switch (decision) {
    case "unauthenticated":
      throw new AppError(401, "UNAUTHENTICATED", "Anda harus masuk terlebih dahulu");
    case "not_found":
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project tidak ditemukan");
    case "forbidden":
      throw new AppError(403, "FORBIDDEN", "Anda tidak punya izin untuk aksi ini");
    case "allow":
      break;
  }
  // `allow` hanya mungkin jika project ada (project tak ada = privat tanpa role = not_found).
  if (!found) throw new AppError(404, "PROJECT_NOT_FOUND", "Project tidak ditemukan");
  return { project: found.project, role: found.role };
}

export function toProjectDto(project: ProjectRecord, role: Role | null): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    visibility: project.visibility,
    createdAt: project.createdAt.toISOString(),
    myRole: role,
  };
}
