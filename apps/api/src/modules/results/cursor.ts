import { isUuid } from "../../http/uuid.js";

/**
 * Cursor buram untuk paginasi keyset (spec Tahap 2 §7). Isinya base64url tanpa padding; klien tidak boleh
 * menafsirkannya. Dekoder mengembalikan `null` untuk cursor rusak — rute menerjemahkannya menjadi 400.
 */

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const CANONICAL_ISO = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");

/** `Buffer.from(…, "base64url")` mengabaikan karakter asing diam-diam, jadi alfabet dicek lebih dulu. */
function decode(cursor: string): string | null {
  if (!BASE64URL.test(cursor)) return null;
  return Buffer.from(cursor, "base64url").toString("utf8");
}

/** Cursor daftar run: posisi `(created_at, id)` run terakhir di halaman (urutan `created_at desc, id desc`). */
export function encodeCursor(createdAt: Date, id: string): string {
  return encode(`${createdAt.toISOString()}|${id}`);
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const parts = decode(cursor)?.split("|");
  if (parts?.length !== 2) return null;
  const [iso = "", id = ""] = parts;
  // Tahun 4 digit 0001–9999 saja: `toISOString()` juga menghasilkan tahun 0000, ±6 digit, dan negatif, yang
  // ditolak Postgres saat bind (500).
  if (!CANONICAL_ISO.test(iso)) return null;
  const createdAt = new Date(iso);
  // Hanya bentuk kanonis `toISOString()` yang diterima (menolak tanggal tak valid seperti 2026-02-30).
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) return null;
  if (!isUuid(id)) return null;
  return { createdAt, id };
}

/** Cursor hasil test di detail run: `id` (bigserial) hasil terakhir di halaman (urutan `id asc`). */
export function encodeResultCursor(id: number): string {
  return encode(String(id));
}

export function decodeResultCursor(cursor: string): number | null {
  const text = decode(cursor);
  if (text === null || !POSITIVE_INTEGER.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

/** Posisi item dalam kelompok perbandingan; urutan kelompok = `suite`, `name`, `testCaseId` (urutan code unit). */
export interface CompareKey {
  suite: string;
  name: string;
  testCaseId: string;
}

/** Cursor kelompok perbandingan: kunci urut item terakhir di halaman, sebagai array JSON `[suite, name, id]`. */
export function encodeCompareCursor(key: CompareKey): string {
  return encode(JSON.stringify([key.suite, key.name, key.testCaseId]));
}

export function decodeCompareCursor(cursor: string): CompareKey | null {
  const text = decode(cursor);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3 || !parsed.every((part) => typeof part === "string")) return null;
  const [suite, name, testCaseId] = parsed as [string, string, string];
  return isUuid(testCaseId) ? { suite, name, testCaseId } : null;
}
