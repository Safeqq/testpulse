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

function pathWithNext(base: "/login" | "/register", target: string): string {
  const next = safeNext(target);
  return next === "/" ? base : `${base}?next=${encodeURIComponent(next)}`;
}

/** Jalur login dengan `next` yang aman; untuk beranda ("/") `next` tidak diperlukan. */
export function loginPathFor(target: string): string {
  return pathWithNext("/login", target);
}

/** Jalur daftar dengan `next` yang aman, agar pengguna baru kembali ke tujuan semula. */
export function registerPathFor(target: string): string {
  return pathWithNext("/register", target);
}

/** Menambahkan `?branch=` (ter-encode) ke jalur internal agar halaman tujuan membuka branch yang sama. */
export function withBranch(path: string, branch: string | null | undefined): string {
  return branch ? `${path}?${new URLSearchParams({ branch }).toString()}` : path;
}

/** Hanya URL http(s) yang dijadikan tautan; nilai dari server tetap diperlakukan sebagai teks tak tepercaya. */
export function safeExternalUrl(url: string | null): string | null {
  return url !== null && /^https?:\/\//i.test(url) ? url : null;
}

/** Jalur halaman perbandingan; id run disematkan agar tautan yang dibagikan selalu membuka pasangan yang sama. */
export function compareHref(slug: string, pair: { base?: string; target?: string; branch?: string | null }): string {
  const params = new URLSearchParams();
  if (pair.base) params.set("base", pair.base);
  if (pair.target) params.set("target", pair.target);
  if (pair.branch) params.set("branch", pair.branch);
  const query = params.toString();
  const path = `/p/${encodeURIComponent(slug)}/compare`;
  return query === "" ? path : `${path}?${query}`;
}
