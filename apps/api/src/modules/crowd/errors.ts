import { AppError } from "../../http/errors.js";

export { fieldError, invalidTransition } from "../bugs/errors.js";

/** Kode error modul crowdtesting dan status HTTP-nya (spec Tahap 5 §8.3). */

export function cycleNotFound(): AppError {
  return new AppError(404, "CYCLE_NOT_FOUND", "Cycle tidak ditemukan");
}

export function cycleNotOpen(): AppError {
  return new AppError(409, "CYCLE_NOT_OPEN", "Cycle sudah ditutup atau belum dibuka");
}

export function cycleHasReports(): AppError {
  return new AppError(409, "CYCLE_HAS_REPORTS", "Cycle yang sudah punya laporan tidak bisa dihapus. Tutup cycle ini saja");
}

export function cycleConflict(): AppError {
  return new AppError(409, "CYCLE_CONFLICT", "Cycle sudah diubah orang lain. Muat ulang untuk melihat versi terbaru");
}

export function memberCannotJoin(): AppError {
  return new AppError(403, "MEMBER_CANNOT_JOIN", "Anggota project tidak bisa ikut sebagai crowd tester di project-nya sendiri");
}

export function notParticipant(): AppError {
  return new AppError(403, "NOT_PARTICIPANT", "Ikut cycle ini terlebih dahulu");
}

export function participantRemoved(): AppError {
  return new AppError(403, "PARTICIPANT_REMOVED", "Anda telah dikeluarkan dari cycle ini");
}

export function participantNotFound(): AppError {
  return new AppError(404, "NOT_FOUND", "Peserta tidak ditemukan");
}

export function reportNotFound(): AppError {
  return new AppError(404, "REPORT_NOT_FOUND", "Laporan tidak ditemukan");
}

export function reportConflict(): AppError {
  return new AppError(409, "REPORT_CONFLICT", "Laporan sudah diubah orang lain. Muat ulang untuk melihat versi terbaru");
}

export function invalidTriage(): AppError {
  return new AppError(409, "INVALID_TRIAGE", "Keputusan ini tidak berlaku untuk status laporan saat ini");
}

export function unauthenticated(): AppError {
  return new AppError(401, "UNAUTHENTICATED", "Anda harus masuk terlebih dahulu");
}
