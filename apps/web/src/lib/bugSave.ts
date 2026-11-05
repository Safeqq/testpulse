import { ApiError } from "./api";

/** Hasil menyimpan satu perubahan bug; editor menampilkan `fields` di bawah kolomnya dan `message` sebagai pesan umum. */
export type SaveResult =
  | { ok: true }
  | { ok: false; conflict?: true; fields?: Record<string, string>; message?: string };

/** Memetakan galat PATCH bug: 409 BUG_CONFLICT menjadi `conflict` (banner), selebihnya pesan server dan galat per field. */
export function toSaveFailure(error: unknown): Extract<SaveResult, { ok: false }> {
  if (!(error instanceof ApiError)) return { ok: false, message: "Terjadi kesalahan. Coba lagi." };
  if (error.code === "BUG_CONFLICT") return { ok: false, conflict: true };
  return { ok: false, message: error.message, ...(error.fields ? { fields: error.fields } : {}) };
}
