const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

/** Tanggal dan jam dalam format Indonesia; teks aslinya dikembalikan bila bukan tanggal yang valid. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date);
}

const decimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const shortDate = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });

/** Pass rate sebagai persen (mis. "66,7%"); `null` (tidak ada test lulus/gagal) menjadi "–". */
export function formatPassRate(rate: number | null): string {
  return rate === null ? "–" : `${decimal.format(rate)}%`;
}

/** Durasi singkat: "420 md", "1,2 dtk", "2 mnt 5 dtk". */
export function formatDuration(ms: number): string {
  if (Math.round(ms) < 1000) return `${Math.round(ms)} md`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${decimal.format(seconds)} dtk`;
  // Bulatkan total detik lebih dulu, baru pecah, agar tidak pernah muncul "60 dtk".
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} mnt` : `${minutes} mnt ${rest} dtk`;
}

/** Tanggal pendek tanpa jam ("28 Okt"); teks aslinya dikembalikan bila bukan tanggal yang valid. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : shortDate.format(date);
}
