export interface AppConfig {
  databaseUrl: string;
  appOrigin: string;
  cookieSecure: boolean;
  port: number;
  rateLimitMax: number;
  /** Batas upload JUnit per jam per token CI (env `INGEST_RATE_LIMIT_MAX`, default 60; hanya dilonggarkan di stack test). */
  ingestRateLimitMax: number;
  /**
   * Rahasia bersama dengan Pages Function (header `x-proxy-secret`). Jika diisi dan cocok, rate limit memakai
   * IP klien dari header `x-tp-client-ip` yang di-set Function; jika kosong, fitur mati. Lihat docs/deploy.md.
   */
  proxySecret?: string;
  /**
   * Commit yang sedang berjalan (`RENDER_GIT_COMMIT` di Render). Ditampilkan di `/api/health` agar pipeline deploy
   * bisa memastikan revisi baru benar-benar melayani trafik (Render mempertahankan instance lama sampai yang baru sehat).
   */
  gitCommit?: string;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Variabel lingkungan ${name} wajib diisi`);
  }
  return value;
}

/** Bilangan bulat dari env (`fallback` bila kosong); harus >= `min` (default 0). */
function parseIntEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, { min = 0 }: { min?: number } = {}): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    const rule = min === 0 ? "non-negatif" : `minimal ${min}`;
    throw new Error(`Variabel lingkungan ${name} harus berupa bilangan bulat ${rule}`);
  }
  return value;
}

/**
 * APP_ORIGIN dibandingkan apa adanya dengan header Origin browser dan dipakai membentuk URL undangan, jadi harus
 * origin murni (skema + host + port). Satu garis miring di akhir ditoleransi dan dibuang; path, query, hash,
 * kredensial, atau skema selain http(s) membuat startup gagal dengan pesan yang jelas.
 */
function parseOrigin(raw: string): string {
  const trimmed = raw.replace(/\/$/, "");
  const invalid = () =>
    new Error(`Variabel lingkungan APP_ORIGIN harus berupa origin saja, mis. https://app.example.com (tanpa path, query, atau hash); nilai saat ini: ${raw}`);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw invalid();
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== trimmed) {
    throw invalid();
  }
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const proxySecret = env.PROXY_SECRET?.trim();
  const gitCommit = env.RENDER_GIT_COMMIT?.trim();
  return {
    databaseUrl: requireEnv(env, "DATABASE_URL"),
    appOrigin: parseOrigin(requireEnv(env, "APP_ORIGIN")),
    cookieSecure: env.COOKIE_SECURE?.trim() === "true",
    port: parseIntEnv(env, "PORT", 3000),
    rateLimitMax: parseIntEnv(env, "RATE_LIMIT_MAX", 10),
    ingestRateLimitMax: parseIntEnv(env, "INGEST_RATE_LIMIT_MAX", 60, { min: 1 }),
    ...(proxySecret ? { proxySecret } : {}),
    ...(gitCommit ? { gitCommit } : {}),
  };
}
