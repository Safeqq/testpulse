/**
 * Hanya mengizinkan jalur internal: diawali "/" tetapi bukan "//" (protocol-relative),
 * tanpa backslash atau karakter kontrol (browser menganggap "/\host" sama dengan "//host").
 * Nilai lain diganti "/".
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return "/";
  return raw;
}

/** Jalur login dengan `next` yang aman; untuk beranda ("/") `next` tidak diperlukan. */
export function loginPathFor(target: string): string {
  const next = safeNext(target);
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
