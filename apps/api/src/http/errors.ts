import type { ApiErrorBody, ErrorCode } from "@testpulse/shared";
import type { FastifyError, FastifyInstance } from "fastify";
import { isStatementTimeout } from "../db/client.js";

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

function body(code: ErrorCode, message: string, fields?: Record<string, string>): ApiErrorBody {
  return { error: fields ? { code, message, fields } : { code, message } };
}

function isClientStatus(error: unknown): error is FastifyError & { statusCode: number } {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return false;
  const { statusCode } = error;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500;
}

/** Memasang error handler dan not-found handler dengan bentuk error standar (§7). */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(body(error.code, error.message, error.code === "VALIDATION_ERROR" ? error.fields : undefined));
    }
    if (isClientStatus(error)) {
      if (error.statusCode === 429) {
        return reply.status(429).send(body("RATE_LIMITED", "Terlalu banyak permintaan, coba lagi nanti"));
      }
      // Body melebihi `bodyLimit` rute (mis. upload JUnit > 5 MB), ditolak Fastify sebelum parsing.
      if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        return reply.status(413).send(body("PAYLOAD_TOO_LARGE", "Ukuran body melebihi batas yang diizinkan"));
      }
      return reply.status(400).send(body("VALIDATION_ERROR", "Permintaan tidak valid"));
    }
    // Query baca dibatalkan `statement_timeout` (withStatementTimeout): beban sementara, bukan bug → 503, boleh dicoba lagi.
    if (isStatementTimeout(error)) {
      request.log.warn({ err: error }, "query dibatalkan statement_timeout");
      return reply
        .status(503)
        .send(body("INTERNAL_ERROR", "Server sedang sibuk memproses data ini, coba lagi sebentar lagi"));
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send(body("INTERNAL_ERROR", "Terjadi kesalahan pada server"));
  });

  app.setNotFoundHandler(() => {
    throw new AppError(404, "NOT_FOUND", "Halaman tidak ditemukan");
  });
}
