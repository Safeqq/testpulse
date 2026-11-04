import type { BugListQuery } from "@testpulse/shared";
import { isUuid } from "../../http/uuid.js";

/**
 * Cursor buram daftar bug (spec Tahap 3 §6): posisi keyset bug terakhir di halaman, sesuai urutan aktif.
 * - `updated`: `(updated_at, id)`; `created`: `(created_at, id)`; `priority`: `(peringkat, updated_at, id)`.
 * Waktu disimpan berpresisi mikrodetik (seperti kolom Postgres), bukan milidetik `Date`, agar bug dengan milidetik
 * sama tidak terlewat atau terulang. Jenis urutan ikut dikodekan: cursor dari urutan lain ditolak (400).
 */

export type BugSort = BugListQuery["sort"];

export interface BugCursor {
  /** Waktu kunci urutan, ISO UTC kanonis dengan 6 digit pecahan detik. */
  at: string;
  id: string;
  /** Peringkat prioritas (low 1 … urgent 4); hanya untuk `sort=priority`. */
  rank?: number;
}

const TAG: Record<BugSort, string> = { updated: "u", created: "c", priority: "p" };
const BASE64URL = /^[A-Za-z0-9_-]+$/;
// Tahun 4 digit 0001–9999 saja (tahun lain ditolak Postgres saat bind).
const MICRO_ISO = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(\d{3})Z$/;
const RANK = /^[1-4]$/;

function isMicroIso(value: string): boolean {
  if (!MICRO_ISO.test(value)) return false;
  // Bagian sampai milidetik harus kanonis menurut `Date` (menolak 2026-02-30, jam 25, dst.).
  const millis = `${value.slice(0, 23)}Z`;
  const date = new Date(millis);
  return !Number.isNaN(date.getTime()) && date.toISOString() === millis;
}

export function encodeBugCursor(sort: BugSort, position: BugCursor): string {
  const parts = sort === "priority" ? [TAG[sort], String(position.rank), position.at, position.id] : [TAG[sort], position.at, position.id];
  return Buffer.from(parts.join("|"), "utf8").toString("base64url");
}

/** Posisi dari cursor untuk urutan `sort`, atau `null` bila cursor rusak / milik urutan lain. */
export function decodeBugCursor(cursor: string, sort: BugSort): BugCursor | null {
  // `Buffer.from(…, "base64url")` mengabaikan karakter asing diam-diam, jadi alfabet dicek lebih dulu.
  if (!BASE64URL.test(cursor)) return null;
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (parts[0] !== TAG[sort]) return null;

  if (sort === "priority") {
    if (parts.length !== 4) return null;
    const [, rank = "", at = "", id = ""] = parts;
    if (!RANK.test(rank) || !isMicroIso(at) || !isUuid(id)) return null;
    return { at, id, rank: Number(rank) };
  }

  if (parts.length !== 3) return null;
  const [, at = "", id = ""] = parts;
  if (!isMicroIso(at) || !isUuid(id)) return null;
  return { at, id };
}
