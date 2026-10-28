import type { Db } from "../../db/client.js";
import { hashToken } from "../auth/domain/tokens.js";
import { findActiveTokenByHash, markTokenUsed } from "./repository.js";

export interface IngestAuth {
  tokenId: string;
  projectId: string;
}

/** `tp_` + 32 byte acak base64url (43 karakter). Format yang salah ditolak tanpa menyentuh DB. */
const RAW_TOKEN_PATTERN = /^tp_[A-Za-z0-9_-]{43}$/;

/**
 * Mengautentikasi header `Authorization: Bearer tp_...` untuk endpoint upload.
 * Hanya token aktif (belum dicabut) yang diterima; pencocokan lewat lookup hash SHA-256 pada
 * unique index, bukan membandingkan nilai mentah. Format salah / token tidak dikenal → null.
 */
export async function authenticateIngestToken(db: Db, authorization: string | undefined): Promise<IngestAuth | null> {
  if (!authorization) return null;
  const parts = /^(\S+) (\S+)$/.exec(authorization);
  if (!parts || parts[1]!.toLowerCase() !== "bearer") return null;

  const raw = parts[2]!;
  if (!RAW_TOKEN_PATTERN.test(raw)) return null;
  return findActiveTokenByHash(db, hashToken(raw));
}

/** Mencatat pemakaian token (`last_used_at`); dipanggil setelah upload berhasil. */
export async function touchToken(db: Db, tokenId: string): Promise<void> {
  await markTokenUsed(db, tokenId, new Date());
}
