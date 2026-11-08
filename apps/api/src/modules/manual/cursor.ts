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
