import { isUuid } from "../../http/uuid.js";
import { isMicroIso } from "./cursor.js";

/**
 * Cursor buram linimasa aktivitas (spec Tahap 3 §6): posisi keyset item terakhir di halaman. Urutan aktivitas adalah
 * `(created_at, jenis, id)` dengan komentar sebelum event pada waktu yang sama. `at` berpresisi mikrodetik seperti
 * kolom Postgres; `id` komentar berupa uuid, `id` event bilangan bulat bigserial.
 */

export type ActivityKind = "comment" | "event";

export interface ActivityCursor {
  kind: ActivityKind;
  /** Waktu item, ISO UTC kanonis dengan 6 digit pecahan detik. */
  at: string;
  id: string;
}

const TAG: Record<ActivityKind, string> = { comment: "c", event: "e" };
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BIGINT_ID = /^[1-9][0-9]{0,18}$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;

export function encodeActivityCursor(position: ActivityCursor): string {
  return Buffer.from([TAG[position.kind], position.at, position.id].join("|"), "utf8").toString("base64url");
}

/** Posisi dari cursor, atau `null` bila cursor rusak. */
export function decodeActivityCursor(cursor: string): ActivityCursor | null {
  // `Buffer.from(…, "base64url")` mengabaikan karakter asing diam-diam, jadi alfabet dicek lebih dulu.
  if (!BASE64URL.test(cursor)) return null;
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (parts.length !== 3) return null;
  const [tag, at = "", id = ""] = parts;
  if (!isMicroIso(at)) return null;
  if (tag === TAG.comment) return isUuid(id) ? { kind: "comment", at, id } : null;
  if (tag === TAG.event) return BIGINT_ID.test(id) && BigInt(id) <= MAX_BIGINT ? { kind: "event", at, id } : null;
  return null;
}
