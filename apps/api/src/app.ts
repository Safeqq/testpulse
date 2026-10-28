import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { createDb, type Db } from "./db/client.js";
import { PROXY_SECRET_HEADER, rateLimitKey } from "./http/client-ip.js";
import { registerErrorHandlers } from "./http/errors.js";
import { serializeError, serializeRequest } from "./http/logging.js";
import { registerSecurity } from "./http/security.js";
import { authRoutes } from "./modules/auth/routes.js";
import { invitationRoutes } from "./modules/invitations/routes.js";
import { memberRoutes } from "./modules/projects/members.routes.js";
import { projectRoutes } from "./modules/projects/routes.js";
import { ingestRoutes } from "./modules/results/ingest.routes.js";
import { tokenRoutes } from "./modules/tokens/routes.js";

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
  /** Tujuan log pino (untuk test yang menangkap log); default stdout. */
  logStream?: { write(msg: string): void };
}

export async function buildApp(config: AppConfig, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? "info",
      redact: ["req.headers.cookie", "req.headers.authorization", `req.headers["${PROXY_SECRET_HEADER}"]`, "*.password", "*.token"],
      // req: menyensor token undangan yang ada di URL (redact pino tidak menjangkau isi string).
      // err: membuang params query dari error database (berisi email, nama, hash password).
      serializers: { req: serializeRequest, err: serializeError },
      ...(opts.logStream ? { stream: opts.logStream } : {}),
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
  // Batas laju dipasang per rute lewat `config.rateLimit`; kunci: IP klien, lihat http/client-ip.ts (Ruling R11).
  await app.register(rateLimit, { global: false, keyGenerator: rateLimitKey(config) });
  app.decorateRequest("user", null);

  app.get("/api/health", async (_request, reply) => {
    try {
      await app.db.execute(sql`select 1`);
      return { status: "ok", commit: config.gitCommit ?? null };
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
      await invitationRoutes(api, config);
      await tokenRoutes(api);
      await ingestRoutes(api, config);
    },
    { prefix: "/api/v1" },
  );

  return app;
}
