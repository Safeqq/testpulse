/** Protokol yang boleh menjadi tautan di Markdown (spec Tahap 3 §3.5). */
const SAFE_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);

/**
 * URL Markdown aman: dikembalikan apa adanya bila protokolnya `http:`, `https:`, atau `mailto:`, selain itu `null`
 * (URL relatif, `javascript:`, `data:`, `vbscript:`, dll.). Protokol dibaca dengan parser URL standar yang sama dengan
 * browser, sehingga trik seperti huruf besar, spasi/kontrol di depan, atau tab/baris baru di tengah skema tidak lolos.
 */
export function safeMarkdownUrl(url: string): string | null {
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}
