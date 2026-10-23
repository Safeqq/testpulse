export const INVITATION_TTL_DAYS = 7;

export type InvitationStatus = "active" | "used" | "expired" | "revoked";

/** Prioritas: revoked > used > expired > active. `expiresAt <= now` dianggap expired. */
export function invitationStatus(
  inv: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now: Date,
): InvitationStatus {
  if (inv.revokedAt !== null) return "revoked";
  if (inv.acceptedAt !== null) return "used";
  if (inv.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}
