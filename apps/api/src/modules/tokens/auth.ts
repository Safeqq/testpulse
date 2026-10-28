import type { Db } from "../../db/client.js";
import { hashToken } from "../auth/domain/tokens.js";
import { findActiveTokenByHash, markTokenUsed } from "./repository.js";

export interface IngestAuth {
  tokenId: string;
  projectId: string;
}

/** `tp_` + 32 byte acak base64url (43 karakter). Format yang salah ditolak tanpa menyentuh DB. */
const RAW_TOKEN_PATTERN = /^tp_[A-Za-z0-9_-]{43}$/;

/** Nilai token dari header `Authorization: Bearer <token>` (skema tanpa peduli huruf besar/kecil); selain itu null. */
export function parseBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const parts = /^(\S+) (\S+)$/.exec(authorization);
  if (!parts || parts[1]!.toLowerCase() !== "bearer") return null;
  return parts[2]!;
}

/**
 * Mengautentikasi header `Authorization: Bearer tp_...` untuk endpoint upload.
 * Hanya token aktif (belum dicabut) yang diterima; pencocokan lewat lookup hash SHA-256 pada
 * unique index, bukan membandingkan nilai mentah. Format salah / token tidak dikenal → null.
 */
export async function authenticateIngestToken(db: Db, authorization: string | undefined): Promise<IngestAuth | null> {
  const raw = parseBearer(authorization);
  if (raw === null || !RAW_TOKEN_PATTERN.test(raw)) return null;
  return findActiveTokenByHash(db, hashToken(raw));
}

/**
 * Mencatat pemakaian token (`last_used_at`). Upload memanggilnya di dalam transaksi `insertRun`, jadi run yang
 * tersimpan dan pencatatan pemakaian selalu commit bersama.
 */
export async function touchToken(db: Pick<Db, "update">, tokenId: string): Promise<void> {
  await markTokenUsed(db, tokenId, new Date());
}
