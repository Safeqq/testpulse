import type { Role, Visibility } from "@testpulse/shared";

export type ProjectAction =
  | "project:read"
  | "members:read"
  | "project:manage"
  | "members:manage"
  | "invitations:manage"
  | "runs:delete"
  | "tokens:manage";

export type AccessDecision = "allow" | "unauthenticated" | "not_found" | "forbidden";

type AccessContext = {
  authenticated: boolean;
  visibility: Visibility;
  role: Role | null;
};

// Aksi yang boleh dilakukan viewer ke atas.
const READ_ACTIONS: ReadonlySet<ProjectAction> = new Set(["project:read", "members:read"]);
// Aksi yang boleh dilakukan tester ke atas; sisanya khusus admin.
const TESTER_ACTIONS: ReadonlySet<ProjectAction> = new Set(["runs:delete"]);

export function decideAccess(action: ProjectAction, ctx: AccessContext): AccessDecision {
  const { authenticated, visibility, role } = ctx;

  // Anggota: izin ditentukan role.
  if (role !== null) {
    if (READ_ACTIONS.has(action)) return "allow";
    if (TESTER_ACTIONS.has(action)) return role === "viewer" ? "forbidden" : "allow";
    return role === "admin" ? "allow" : "forbidden";
  }

  // Bukan anggota (anonim atau login) pada project publik: hanya boleh membaca project.
  if (action === "project:read" && visibility === "public") return "allow";

  // Endpoint wajib login mengecek sesi lebih dulu (tidak membocorkan keberadaan project).
  if (!authenticated && action !== "project:read") return "unauthenticated";

  // Project privat (atau tidak ada) disamarkan sebagai tidak ditemukan.
  if (visibility === "private") return "not_found";

  return "forbidden";
}
