import { isUuid } from "../../http/uuid.js";

/**
 * Cursor buram daftar crowdtesting: `tag|bagian…` di-encode base64url. Setiap daftar memakai tag sendiri agar cursor
 * satu daftar tidak diterima daftar lain, dan setiap bagian divalidasi ketat (cursor rusak → 400 di rute).
 */

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_INT4 = 2_147_483_647;

export interface CursorPart<T> {
  parse(raw: string): T | null;
}

/** Bilangan bulat kanonis 0…int4. */
export const INT: CursorPart<number> = {
  parse: (raw) => (/^(0|[1-9][0-9]{0,9})$/.test(raw) && Number(raw) <= MAX_INT4 ? Number(raw) : null),
};

/** Waktu epoch sebagai bilangan bulat ≥ 0 (milidetik atau mikrodetik, sesuai daftarnya). */
export const TIME: CursorPart<number> = {
  parse: (raw) => (/^(0|[1-9][0-9]{0,15})$/.test(raw) ? Number(raw) : null),
};

export const UUID: CursorPart<string> = { parse: (raw) => (isUuid(raw) ? raw : null) };

export function encodeCursor(tag: string, parts: ReadonlyArray<string | number>): string {
  return Buffer.from([tag, ...parts].join("|"), "utf8").toString("base64url");
}

type Parsed<P extends readonly CursorPart<unknown>[]> = { [K in keyof P]: P[K] extends CursorPart<infer T> ? T : never };

/** Bagian-bagian cursor, atau `null` bila tag, jumlah bagian, atau salah satu bagian tidak sah. */
export function decodeCursor<const P extends readonly CursorPart<unknown>[]>(
  tag: string,
  cursor: string,
  parts: P,
): Parsed<P> | null {
  // `Buffer.from(…, "base64url")` mengabaikan karakter asing diam-diam, jadi alfabet dicek lebih dulu.
  if (!BASE64URL.test(cursor)) return null;
  const raw = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (raw.length !== parts.length + 1 || raw[0] !== tag) return null;
  const values: unknown[] = [];
  for (let i = 0; i < parts.length; i++) {
    const value = parts[i]!.parse(raw[i + 1]!);
    if (value === null) return null;
    values.push(value);
  }
  return values as Parsed<P>;
}
