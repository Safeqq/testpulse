import { ingestQuery, type IngestQuery, type IngestResultDto } from "@testpulse/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../../config.js";
import { rateLimitKey } from "../../http/client-ip.js";
import { AppError } from "../../http/errors.js";
import { hasUtf8Charset, isXml } from "../../http/security.js";
import { parseOrThrow } from "../../http/validate.js";
import { hashToken } from "../auth/domain/tokens.js";
import { findBySlug } from "../projects/repository.js";
import { authenticateIngestToken, parseBearer, type IngestAuth } from "../tokens/auth.js";
import { InvalidReportError, parseJUnit } from "./domain/junit.js";
import { insertRun } from "./repository.js";

/** Batas body upload JUnit (spec Tahap 2 §4): 5 MB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface IngestContext {
  auth: IngestAuth;
  slug: string;
  query: IngestQuery;
}

type IngestRequest = FastifyRequest<{ Params: { slug: string }; Body: unknown }>;

/** Hasil pemeriksaan hook `onRequest`, dibaca handler setelah body di-parse. */
const contexts = new WeakMap<FastifyRequest, IngestContext>();

/**
 * Kunci rate limit upload (Ruling P2): `ingest:` + SHA-256 token Bearer, jadi batasnya per token dan nilai mentah
 * token tidak pernah disimpan. Tanpa Bearer: kunci IP yang sama dengan rute lain (Ruling R11).
 */
function ingestRateLimitKey(config: AppConfig): (req: FastifyRequest) => string {
  const ipKey = rateLimitKey(config);
  return (req) => {
    const token = parseBearer(req.headers.authorization);
    // Jaring pengaman: hook rate-limit berjalan setelah `checkUpload`, yang sudah mewajibkan Bearer token sah, jadi
    // cabang IP ini hanya terpakai jika urutan hook berubah (mis. upgrade plugin).
    return token === null ? ipKey(req) : `ingest:${hashToken(token)}`;
  };
}

/**
 * `POST /projects/:slug/runs` — upload laporan JUnit XML dari CI (spec Tahap 2 §4). Hanya Bearer token CI yang
 * diterima; cookie sesi tidak pernah dibaca di sini.
 *
 * Urutan cek (Ruling P1): Content-Type + charset utf-8 (hook global + hook rute) → token 401 → project 404 →
 * query 400, semuanya di `onRequest` sebelum body dibaca; lalu batas laju 429 (hook rate-limit dipasang setelah hook
 * rute); lalu `bodyLimit` 5 MB saat parsing (413); lalu parse JUnit (422) dan simpan (run + `last_used_at` token dalam satu transaksi).
 */
export async function ingestRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const checkUpload = async (req: IngestRequest) => {
    if (!isXml(req.headers["content-type"])) {
      throw new AppError(400, "VALIDATION_ERROR", "Content-Type harus application/xml atau text/xml");
    }
    if (!hasUtf8Charset(req.headers["content-type"])) {
      throw new AppError(400, "VALIDATION_ERROR", "Charset laporan harus utf-8");
    }

    // Satu pesan untuk semua kegagalan token (tidak ada, format salah, tidak dikenal, dicabut).
    const auth = await authenticateIngestToken(app.db, req.headers.authorization);
    if (!auth) throw new AppError(401, "UNAUTHENTICATED", "Token CI tidak valid");

    // Token project lain diperlakukan sama dengan slug yang tidak ada: tidak membocorkan keberadaan project.
    const found = await findBySlug(app.db, req.params.slug, null);
    if (!found || found.project.id !== auth.projectId) {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project tidak ditemukan");
    }

    const query = parseOrThrow(ingestQuery, req.query);
    contexts.set(req, { auth, slug: found.project.slug, query });
  };

  app.post<{ Params: { slug: string }; Body: unknown }>(
    "/projects/:slug/runs",
    {
      bodyLimit: MAX_UPLOAD_BYTES,
      onRequest: checkUpload,
      config: {
        rateLimit: {
          max: config.ingestRateLimitMax,
          timeWindow: "1 hour",
          keyGenerator: ingestRateLimitKey(config),
        },
      },
    },
    async (req, reply) => {
      const ctx = contexts.get(req);
      if (!ctx) throw new Error("konteks upload tidak ada");

      let report;
      try {
        report = parseJUnit(typeof req.body === "string" ? req.body : "");
      } catch (err) {
        if (err instanceof InvalidReportError) throw new AppError(422, "INVALID_REPORT", err.message);
        throw err;
      }

      const { runId, totals } = await insertRun(app.db, {
        projectId: ctx.auth.projectId,
        tokenId: ctx.auth.tokenId,
        query: ctx.query,
        report,
      });

      const body: IngestResultDto = { runId, url: `${config.appOrigin}/p/${ctx.slug}/runs/${runId}`, totals };
      return reply.status(201).send(body);
    },
  );
}
