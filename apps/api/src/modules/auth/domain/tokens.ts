import { createHash, randomBytes } from "node:crypto";

export const SESSION_TTL_DAYS = 14;

/** Token acak 32 byte, base64url (43 karakter). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex; hanya hash ini yang disimpan di DB. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
