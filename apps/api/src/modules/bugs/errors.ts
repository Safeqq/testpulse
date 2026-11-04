import { AppError } from "../../http/errors.js";

/** Kode error modul bug dan status HTTP-nya (spec Tahap 3 §6; Ruling T1-a). */

export function bugNotFound(): AppError {
  return new AppError(404, "BUG_NOT_FOUND", "Bug tidak ditemukan");
}

export function commentNotFound(): AppError {
  return new AppError(404, "COMMENT_NOT_FOUND", "Komentar tidak ditemukan");
}

export function bugConflict(): AppError {
  return new AppError(409, "BUG_CONFLICT", "Bug sudah diubah orang lain. Muat ulang untuk melihat versi terbaru");
}

export function invalidTransition(): AppError {
  return new AppError(409, "INVALID_TRANSITION", "Perubahan status ini tidak diizinkan");
}

/** 400 VALIDATION_ERROR untuk satu field (pesan tampil di bawah field pada form). */
export function fieldError(field: string, message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", "Data tidak valid", { [field]: message });
}
