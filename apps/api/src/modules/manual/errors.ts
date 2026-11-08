import { AppError } from "../../http/errors.js";

export { fieldError } from "../bugs/errors.js";

/** Kode error modul test manual dan status HTTP-nya (spec Tahap 4 §7). */

export function suiteNotFound(): AppError {
  return new AppError(404, "SUITE_NOT_FOUND", "Suite tidak ditemukan");
}

export function suiteNotEmpty(): AppError {
  return new AppError(409, "SUITE_NOT_EMPTY", "Pindahkan atau hapus case di suite ini terlebih dahulu.");
}

export function caseNotFound(): AppError {
  return new AppError(404, "CASE_NOT_FOUND", "Case tidak ditemukan");
}

export function caseConflict(): AppError {
  return new AppError(409, "CASE_CONFLICT", "Case sudah diubah orang lain. Muat ulang untuk melihat versi terbaru");
}

export function manualRunNotFound(): AppError {
  return new AppError(404, "MANUAL_RUN_NOT_FOUND", "Run manual tidak ditemukan");
}

export function runCaseNotFound(): AppError {
  return new AppError(404, "RUN_CASE_NOT_FOUND", "Case di run ini tidak ditemukan");
}

export function manualRunConflict(): AppError {
  return new AppError(409, "MANUAL_RUN_CONFLICT", "Data sudah diubah orang lain. Muat ulang untuk melihat versi terbaru");
}

export function runCompleted(): AppError {
  return new AppError(409, "RUN_COMPLETED", "Run sudah selesai. Buka ulang run untuk mengubah hasil");
}
