import type { CrowdReportStatus, CycleStatus, MeState, ParticipantStatus, RejectReason } from "@testpulse/shared";

// Teks dan format crowdtesting (spec Tahap 5 §9).

export const cycleCode = (number: number) => `CY-${number}`;
export const reportCode = (number: number) => `CR-${number}`;

export const cyclePublicPath = (id: string) => `/crowd/c/${encodeURIComponent(id)}`;
export const reportPublicPath = (id: string) => `/crowd/r/${encodeURIComponent(id)}`;
export const testerPath = (userId: string) => `/crowd/testers/${encodeURIComponent(userId)}`;

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  draft: "Draf",
  open: "Berlangsung",
  closed: "Selesai",
};

export const REPORT_STATUS_LABEL: Record<CrowdReportStatus, string> = {
  submitted: "Dikirim",
  accepted: "Diterima",
  rejected: "Ditolak",
  duplicate: "Duplikat",
  withdrawn: "Ditarik",
};

export const REJECT_REASON_LABEL: Record<RejectReason, string> = {
  not_reproducible: "Tidak bisa direproduksi",
  out_of_scope: "Di luar cakupan",
  not_a_bug: "Bukan bug",
  insufficient_info: "Informasi kurang",
  other: "Lainnya",
};

export const PARTICIPANT_STATUS_LABEL: Record<ParticipantStatus, string> = {
  active: "Aktif",
  left: "Keluar",
  removed: "Dikeluarkan",
};

/** Pesan di blok aksi halaman cycle publik untuk setiap keadaan pengunjung (spec §9.2). */
export const ME_STATE_COPY: Record<MeState, string> = {
  anonymous: "Masuk atau daftar untuk ikut menguji aplikasi ini dan mengirim laporan bug.",
  can_join: "Siapa pun yang punya akun boleh ikut. Baca instruksi dan cakupan sebelum mulai.",
  joined: "Anda peserta cycle ini. Temukan bug, lalu kirim laporan yang jelas.",
  left: "Anda sudah keluar dari cycle ini. Laporan Anda tetap tersimpan, dan Anda bisa ikut lagi.",
  removed: "Anda telah dikeluarkan dari cycle ini oleh tim, jadi tidak bisa ikut atau mengirim laporan lagi.",
  member: "Anggota project tidak bisa ikut sebagai crowd tester di project-nya sendiri.",
  closed: "Cycle ini sudah selesai. Laporan baru tidak diterima lagi.",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Sisa waktu cycle untuk kartu dan header ("Berakhir 3 hari lagi"); dibulatkan ke atas agar tidak terlihat lebih pendek. */
export function endsLabel(endsAt: string | null, now: number = Date.now()): string {
  if (endsAt === null) return "Tanpa batas akhir";
  const left = new Date(endsAt).getTime() - now;
  if (Number.isNaN(left)) return "Tanpa batas akhir";
  if (left <= 0) return "Sudah berakhir";
  if (left >= DAY) return `Berakhir ${Math.ceil(left / DAY)} hari lagi`;
  if (left >= HOUR) return `Berakhir ${Math.ceil(left / HOUR)} jam lagi`;
  return `Berakhir ${Math.max(1, Math.ceil(left / MINUTE))} menit lagi`;
}

/** Tingkat penerimaan sebagai persen bulat, atau keterangan bila belum ada keputusan triase. */
export function formatAcceptance(rate: number | null): string {
  return rate === null ? "Belum ada keputusan" : `${Math.round(rate * 100)}%`;
}
