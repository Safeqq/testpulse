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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Waktu relatif singkat ("2 jam lalu"); lebih dari 30 hari menjadi tanggal lengkap. `now` bisa diinjeksi untuk test.
 * Selisih negatif kecil (jam klien sedikit tertinggal dari server) dianggap "baru saja".
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  const elapsed = now - time;
  if (elapsed < MINUTE_MS) return "baru saja";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} menit lalu`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} jam lalu`;
  if (elapsed < 30 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)} hari lalu`;
  return formatDateTime(iso);
}
