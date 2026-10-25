export interface AppConfig {
  databaseUrl: string;
  appOrigin: string;
  cookieSecure: boolean;
  port: number;
  rateLimitMax: number;
  /**
   * Rahasia bersama dengan Pages Function (header `x-proxy-secret`). Jika diisi dan cocok, rate limit memakai
   * IP klien dari `X-Forwarded-For` yang di-set Function; jika kosong, fitur mati. Lihat docs/deploy.md.
   */
  proxySecret?: string;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Variabel lingkungan ${name} wajib diisi`);
  }
  return value;
}

function parseIntEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Variabel lingkungan ${name} harus berupa bilangan bulat non-negatif`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const proxySecret = env.PROXY_SECRET?.trim();
  return {
    databaseUrl: requireEnv(env, "DATABASE_URL"),
    appOrigin: requireEnv(env, "APP_ORIGIN"),
    cookieSecure: env.COOKIE_SECURE?.trim() === "true",
    port: parseIntEnv(env, "PORT", 3000),
    rateLimitMax: parseIntEnv(env, "RATE_LIMIT_MAX", 10),
    ...(proxySecret ? { proxySecret } : {}),
  };
}
