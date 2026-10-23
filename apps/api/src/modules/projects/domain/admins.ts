import type { Role } from "@testpulse/shared";

/**
 * True jika perubahan akan menyisakan project tanpa admin.
 * `targetNewRole: null` berarti anggota dikeluarkan / keluar.
 */
export function wouldLeaveNoAdmin(input: {
  adminCount: number;
  targetCurrentRole: Role;
  targetNewRole: Role | null;
}): boolean {
  const { adminCount, targetCurrentRole, targetNewRole } = input;
  if (targetCurrentRole !== "admin") return false;
  if (targetNewRole === "admin") return false;
  return adminCount <= 1;
}
