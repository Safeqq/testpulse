// Penyusun Markdown aman untuk teks dari pihak yang tidak tepercaya (laporan CI, case manual, laporan crowd).
// Dipakai web (isian awal bug) dan server (deskripsi bug dari laporan crowd, spec Tahap 5 §5.4).

/** Deretan backtick terpanjang di dalam teks (0 bila tidak ada). */
function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

/**
 * Teks satu baris sebagai code span Markdown yang aman: pembatasnya lebih panjang daripada deretan backtick di dalam
 * teks, baris baru menjadi spasi, dan spasi pengaman ditambahkan bila teks diawali/diakhiri backtick. Isi code span
 * tidak pernah ditafsirkan sebagai Markdown, jadi data dari pihak lain tidak bisa menyisipkan tautan atau judul.
 */
export function codeSpan(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const ticks = "`".repeat(longestBacktickRun(flat) + 1);
  const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
  return `${ticks}${pad}${flat}${pad}${ticks}`;
}

/** Pagar blok kode: lebih panjang daripada deretan backtick terpanjang di dalam teks (minimal tiga). */
export function fenceFor(text: string): string {
  return "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
}

/**
 * URL sebagai autolink `<url>` hanya bila berupa URL http(s) tanpa spasi, `<`, atau `>`; selain itu `null` (URL dari
 * pihak lain dianggap tak tepercaya, jadi tidak boleh menjadi Markdown bebas).
 */
export function safeAutolink(url: string): string | null {
  return /^https?:\/\/[^\s<>]+$/i.test(url) ? `<${url}>` : null;
}

/**
 * `text` dipotong ke paling banyak `max` code unit UTF-16 (satuan `.max()` zod) tanpa pernah menyisakan separuh
 * pasangan surrogate; teks yang muat dikembalikan apa adanya.
 */
export function clipCodePoints(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = text.slice(0, max);
  if (/[\ud800-\udbff]$/.test(kept)) kept = kept.slice(0, -1);
  return kept;
}
