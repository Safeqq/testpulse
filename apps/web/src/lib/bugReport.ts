import { stripControlChars } from "@testpulse/shared";

/** Batas judul dan deskripsi bug di server (spec Tahap 3 §3.1), dalam code unit UTF-16 seperti `.max()` zod. */
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 20_000;
const TRUNCATED = "… (dipotong)";

export interface BugReportSource {
  suite: string;
  /** `null` bila tidak diketahui (mis. run asal sudah dihapus dan test tidak punya hasil lagi). */
  branch: string | null;
  commitSha: string | null;
  ciUrl: string | null;
  /** Pesan error test; `null` bila tidak ada. */
  message: string | null;
}

/** Deretan backtick terpanjang di dalam teks (0 bila tidak ada). */
function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

/**
 * Teks satu baris sebagai code span Markdown yang aman: pembatasnya lebih panjang daripada deretan backtick di dalam
 * teks, baris baru menjadi spasi, dan spasi pengaman ditambahkan bila teks diawali/diakhiri backtick. Isi code span
 * tidak pernah ditafsirkan sebagai Markdown, jadi data dari pihak lain (suite, branch, commit) tidak bisa menyisipkan
 * tautan atau judul.
 */
function codeSpan(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const ticks = "`".repeat(longestBacktickRun(flat) + 1);
  const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
  return `${ticks}${pad}${flat}${pad}${ticks}`;
}

/** Pagar blok kode: lebih panjang daripada deretan backtick terpanjang di dalam teks (minimal tiga). */
function fenceFor(text: string): string {
  return "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
}

/**
 * Link CI sebagai autolink `<url>` hanya bila berupa URL http(s) tanpa spasi, `<`, atau `>`; selain itu tidak ditulis
 * (URL dari run dianggap tak tepercaya, jadi tidak boleh menjadi Markdown bebas).
 */
function ciAutolink(url: string): string | null {
  return /^https?:\/\/[^\s<>]+$/i.test(url) ? `<${url}>` : null;
}

/**
 * Judul awal bug dari nama test (data laporan CI): karakter kontrol dibuang, spasi/baris baru dirapikan menjadi satu
 * spasi (judul satu baris), lalu dipotong ke `MAX_TITLE` di batas code point (tidak pernah menyisakan separuh pasangan
 * surrogate) agar lolos validasi judul server.
 */
export function buildBugReportTitle(testName: string): string {
  const flat = stripControlChars(testName).replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_TITLE) return flat;
  let kept = flat.slice(0, MAX_TITLE);
  if (/[\ud800-\udbff]$/.test(kept)) kept = kept.slice(0, -1);
  return kept.trimEnd();
}

function assemble(head: string[], message: string | null): string {
  if (message === null) return head.join("\n");
  const fence = fenceFor(message);
  return [...head, "", "**Pesan error:**", "", fence, message, fence].join("\n");
}

/**
 * Deskripsi awal bug dari test gagal (spec Tahap 3 §7.5): suite, branch, commit, link CI, dan pesan error dalam
 * blok kode (Markdown). Semua nilai berasal dari laporan CI, jadi dirender sebagai code span/autolink/blok kode.
 * Pesan yang terlalu panjang dipotong sampai total (termasuk pagar yang ikut memanjang) muat dalam batas server.
 */
export function buildBugReportDescription(source: BugReportSource): string {
  const head = [`- **Suite:** ${codeSpan(stripControlChars(source.suite))}`];
  if (source.branch) head.push(`- **Branch:** ${codeSpan(stripControlChars(source.branch))}`);
  if (source.commitSha) head.push(`- **Commit:** ${codeSpan(stripControlChars(source.commitSha))}`);
  const ci = source.ciUrl ? ciAutolink(stripControlChars(source.ciUrl)) : null;
  if (ci) head.push(`- **Link CI:** ${ci}`);

  const message = source.message === null ? null : stripControlChars(source.message);
  if (message === null || message.trim() === "") return assemble(head, null);

  let result = assemble(head, message);
  if (result.length <= MAX_DESCRIPTION) return result;

  // Memotong sebanyak kelebihannya lalu menghitung ulang: pagar hanya bisa menyusut saat pesan memendek, jadi loop ini berakhir.
  let cut = message.length;
  while (result.length > MAX_DESCRIPTION && cut > 0) {
    cut = Math.max(0, cut - Math.max(1, result.length - MAX_DESCRIPTION));
    let kept = message.slice(0, cut);
    // Jangan menyisakan separuh pasangan surrogate.
    if (/[\ud800-\udbff]$/.test(kept)) kept = kept.slice(0, -1);
    result = assemble(head, kept + TRUNCATED);
  }
  return result;
}
