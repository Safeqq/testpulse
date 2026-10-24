import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { createDb, type Db } from "./db/client.js";
import { registerErrorHandlers } from "./http/errors.js";
import { registerSecurity } from "./http/security.js";
import { authRoutes } from "./modules/auth/routes.js";
import { memberRoutes } from "./modules/projects/members.routes.js";
import { projectRoutes } from "./modules/projects/routes.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}

export interface BuildAppOptions {
  /** Db milik pemanggil (tidak ditutup oleh app). Jika kosong, app membuat dan menutup pool sendiri. */
  db?: Db;
  /** Level log pino; default "info". */
  logLevel?: string;
}

export async function buildApp(config: AppConfig, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? "info",
      redact: ["req.headers.cookie", "req.headers.authorization", "*.password", "*.token"],
    },
  });

  if (opts.db) {
    app.decorate("db", opts.db);
  } else {
    const { db, pool } = createDb(config.databaseUrl);
    app.decorate("db", db);
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  registerErrorHandlers(app);
  await registerSecurity(app, config);
  await app.register(cookie);
  // Batas laju dipasang per rute lewat `config.rateLimit` (kunci: req.ip, lihat Ruling R6).
  await app.register(rateLimit, { global: false });
  app.decorateRequest("user", null);

  app.get("/api/health", async (_request, reply) => {
    try {
      await app.db.execute(sql`select 1`);
      return { status: "ok" };
    } catch (err) {
      app.log.error({ err }, "health check: database tidak terjangkau");
      return reply.status(503).send({ status: "error" });
    }
  });

  // Rute modul (auth, projects, invitations) didaftarkan di sini di bawah prefix /api/v1.
  await app.register(
    async (api) => {
      await authRoutes(api, config);
      await projectRoutes(api);
      await memberRoutes(api);
    },
    { prefix: "/api/v1" },
  );

  return app;
}
