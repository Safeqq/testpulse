/** Batas deskripsi bug di server (spec Tahap 3 §3.1). */
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

/** Karakter kontrol selain tab/LF/CR ditolak server (sama dengan `hasControlChars` di schema bersama); dibuang di sini. */
function stripControlChars(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    const control = (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || (code >= 0x7f && code <= 0x9f);
    if (!control) out += char;
  }
  return out;
}

/** Pagar blok kode: lebih panjang daripada deretan backtick terpanjang di dalam teks (minimal tiga). */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function assemble(head: string[], message: string | null): string {
  if (message === null) return head.join("\n");
  const fence = fenceFor(message);
  return [...head, "", "**Pesan error:**", "", fence, message, fence].join("\n");
}

/**
 * Deskripsi awal bug dari test gagal (spec Tahap 3 §7.5): suite, branch, commit, link CI, dan pesan error dalam
 * blok kode (Markdown). Pesan yang terlalu panjang dipotong supaya total tetap di bawah batas server.
 */
export function buildBugReportDescription(source: BugReportSource): string {
  const head = [`- **Suite:** ${stripControlChars(source.suite)}`];
  if (source.branch) head.push(`- **Branch:** \`${stripControlChars(source.branch)}\``);
  if (source.commitSha) head.push(`- **Commit:** \`${stripControlChars(source.commitSha)}\``);
  if (source.ciUrl) head.push(`- **Link CI:** ${stripControlChars(source.ciUrl)}`);

  let message = source.message === null ? null : stripControlChars(source.message);
  if (message === null || message.trim() === "") return assemble(head, null);

  const full = assemble(head, message);
  if (full.length > MAX_DESCRIPTION) {
    // Hitung sisa ruang dengan pesan kosong; pagar hanya bisa mengecil setelah pesan dipotong, jadi hasilnya aman.
    const room = MAX_DESCRIPTION - assemble(head, "").length - TRUNCATED.length;
    let cut = message.slice(0, Math.max(0, room));
    // Jangan menyisakan separuh pasangan surrogate.
    if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
    message = cut + TRUNCATED;
  }
  return assemble(head, message);
}
