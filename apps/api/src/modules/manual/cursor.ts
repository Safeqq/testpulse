/**
 * Cursor buram daftar case (spec Tahap 4 §7): posisi keyset case terakhir di halaman, sesuai urutan
 * "posisi suite, lalu nomor case". Nomor unik per project, jadi pasangan ini mengurutkan semua case tanpa seri.
 */

export interface CaseCursor {
  suitePosition: number;
  number: number;
}

const TAG = "c";
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_INT4 = 2_147_483_647;
// Bilangan bulat kanonis (tanpa nol di depan); nomor case mulai 1, posisi suite mulai 0.
const POSITION = /^(0|[1-9][0-9]{0,9})$/;
const NUMBER = /^[1-9][0-9]{0,9}$/;

export function encodeCaseCursor(position: CaseCursor): string {
  return Buffer.from([TAG, position.suitePosition, position.number].join("|"), "utf8").toString("base64url");
}

/** Posisi dari cursor, atau `null` bila cursor rusak. */
export function decodeCaseCursor(cursor: string): CaseCursor | null {
  // `Buffer.from(…, "base64url")` mengabaikan karakter asing diam-diam, jadi alfabet dicek lebih dulu.
  if (!BASE64URL.test(cursor)) return null;
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (parts.length !== 3 || parts[0] !== TAG) return null;
  const [, position = "", number = ""] = parts;
  if (!POSITION.test(position) || !NUMBER.test(number)) return null;
  const suitePosition = Number(position);
  const caseNumber = Number(number);
  if (suitePosition > MAX_INT4 || caseNumber > MAX_INT4) return null;
  return { suitePosition, number: caseNumber };
}

/**
 * Cursor buram daftar run manual: nomor TR run terakhir di halaman (urutan "nomor terbesar dulu").
 * Cursor daftar run case: `position` run case terakhir (posisi unik per run). Tag berbeda agar cursor satu daftar
 * tidak diterima daftar lain.
 */

const RUN_TAG = "r";
const RUN_CASE_TAG = "rc";

function encodeTagged(tag: string, value: number): string {
  return Buffer.from(`${tag}|${value}`, "utf8").toString("base64url");
}

function decodeTagged(cursor: string, tag: string, pattern: RegExp): number | null {
  if (!BASE64URL.test(cursor)) return null;
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (parts.length !== 2 || parts[0] !== tag) return null;
  const raw = parts[1] ?? "";
  if (!pattern.test(raw)) return null;
  const value = Number(raw);
  return value > MAX_INT4 ? null : value;
}

export function encodeRunCursor(number: number): string {
  return encodeTagged(RUN_TAG, number);
}

/** Nomor run dari cursor, atau `null` bila cursor rusak. */
export function decodeRunCursor(cursor: string): number | null {
  return decodeTagged(cursor, RUN_TAG, NUMBER);
}

export function encodeRunCaseCursor(position: number): string {
  return encodeTagged(RUN_CASE_TAG, position);
}

/** Posisi run case dari cursor, atau `null` bila cursor rusak. */
export function decodeRunCaseCursor(cursor: string): number | null {
  return decodeTagged(cursor, RUN_CASE_TAG, POSITION);
}
