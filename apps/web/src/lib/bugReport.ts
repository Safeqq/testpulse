import { clipCodePoints, codeSpan, fenceFor, safeAutolink, stripControlChars } from "@testpulse/shared";

// Helper Markdown aman kini di @testpulse/shared (spec Tahap 5 §5.4); diekspor ulang untuk pemakai lama di web.
export { codeSpan, fenceFor };

/** Batas judul dan deskripsi bug di server (spec Tahap 3 §3.1), dalam code unit UTF-16 seperti `.max()` zod. */
const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 20_000;
/** Penanda teks yang dipotong agar deskripsi muat dalam batas server. */
export const TRUNCATED = "… (dipotong)";

export interface BugReportSource {
  suite: string;
  /** `null` bila tidak diketahui (mis. run asal sudah dihapus dan test tidak punya hasil lagi). */
  branch: string | null;
  commitSha: string | null;
  ciUrl: string | null;
  /** Pesan error test; `null` bila tidak ada. */
  message: string | null;
}

/**
 * Judul awal bug dari nama test (data laporan CI): karakter kontrol dibuang, spasi/baris baru dirapikan menjadi satu
 * spasi (judul satu baris), lalu dipotong ke `MAX_TITLE` di batas code point (tidak pernah menyisakan separuh pasangan
 * surrogate) agar lolos validasi judul server.
 */
export function buildBugReportTitle(testName: string): string {
  const flat = stripControlChars(testName).replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_TITLE) return flat;
  return clipCodePoints(flat, MAX_TITLE).trimEnd();
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
  const ci = source.ciUrl ? safeAutolink(stripControlChars(source.ciUrl)) : null;
  if (ci) head.push(`- **Link CI:** ${ci}`);

  const message = source.message === null ? null : stripControlChars(source.message);
  if (message === null || message.trim() === "") return assemble(head, null);

  let result = assemble(head, message);
  if (result.length <= MAX_DESCRIPTION) return result;

  // Memotong sebanyak kelebihannya lalu menghitung ulang: pagar hanya bisa menyusut saat pesan memendek, jadi loop ini berakhir.
  let cut = message.length;
  while (result.length > MAX_DESCRIPTION && cut > 0) {
    cut = Math.max(0, cut - Math.max(1, result.length - MAX_DESCRIPTION));
    result = assemble(head, clipCodePoints(message, cut) + TRUNCATED);
  }
  return result;
}
