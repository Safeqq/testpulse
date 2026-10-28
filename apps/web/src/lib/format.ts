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

/** passed/(passed+failed)×100 dibulatkan 1 desimal, selaras dengan API; `null` bila keduanya 0. */
export function passRateOf(passed: number, failed: number): number | null {
  const decided = passed + failed;
  return decided === 0 ? null : Math.round((passed / decided) * 1000) / 10;
}

/** Durasi singkat: "420 md", "1,2 dtk", "2 mnt 5 dtk". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} md`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${decimal.format(seconds)} dtk`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest === 0 ? `${minutes} mnt` : `${minutes} mnt ${rest} dtk`;
}

/** Tanggal pendek tanpa jam ("28 Okt"); teks aslinya dikembalikan bila bukan tanggal yang valid. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : shortDate.format(date);
}
