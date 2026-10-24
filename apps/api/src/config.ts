export interface AppConfig {
  databaseUrl: string;
  appOrigin: string;
  cookieSecure: boolean;
  port: number;
  rateLimitMax: number;
  /**
   * Jumlah proxy tepercaya di depan API (opsi `trustProxy` Fastify): `false` = jangan percaya
   * X-Forwarded-For; angka N = ambil IP klien dari entri ke-N dari kanan. Lihat docs/deploy.md.
   */
  trustProxy: false | number;
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

function parseTrustProxy(env: NodeJS.ProcessEnv): false | number {
  const raw = env.TRUST_PROXY?.trim();
  if (!raw) return false;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Variabel lingkungan TRUST_PROXY harus berupa bilangan bulat positif (jumlah hop proxy) atau dikosongkan");
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    databaseUrl: requireEnv(env, "DATABASE_URL"),
    appOrigin: requireEnv(env, "APP_ORIGIN"),
    cookieSecure: env.COOKIE_SECURE?.trim() === "true",
    port: parseIntEnv(env, "PORT", 3000),
    rateLimitMax: parseIntEnv(env, "RATE_LIMIT_MAX", 10),
    trustProxy: parseTrustProxy(env),
  };
}
