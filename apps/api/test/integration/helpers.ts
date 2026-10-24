import type { FastifyInstance } from "fastify";
import { afterAll, inject } from "vitest";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";

const createdApps: FastifyInstance[] = [];

afterAll(async () => {
  await Promise.all(createdApps.splice(0).map((app) => app.close()));
});

/**
 * Membangun app untuk test integrasi terhadap database Testcontainers.
 * App milik helper ini ditutup otomatis pada akhir file test.
 */
export async function createTestApp(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const config: AppConfig = {
    databaseUrl: inject("databaseUrl"),
    appOrigin: "http://localhost:5173",
    cookieSecure: false,
    port: 0,
    rateLimitMax: 1000,
    ...overrides,
  };
  const app = await buildApp(config, { logLevel: "silent" });
  createdApps.push(app);
  return app;
}
