export interface AppConfig {
  databaseUrl: string;
  appOrigin: string;
  cookieSecure: boolean;
  port: number;
  rateLimitMax: number;
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
  return {
    databaseUrl: requireEnv(env, "DATABASE_URL"),
    appOrigin: requireEnv(env, "APP_ORIGIN"),
    cookieSecure: env.COOKIE_SECURE?.trim() === "true",
    port: parseIntEnv(env, "PORT", 3000),
    rateLimitMax: parseIntEnv(env, "RATE_LIMIT_MAX", 10),
  };
}
