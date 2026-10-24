import type { ApiErrorBody, ErrorCode } from "@testpulse/shared";
import type { FastifyError, FastifyInstance } from "fastify";

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
      return reply.status(400).send(body("VALIDATION_ERROR", "Permintaan tidak valid"));
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send(body("INTERNAL_ERROR", "Terjadi kesalahan pada server"));
  });

  app.setNotFoundHandler(() => {
    throw new AppError(404, "NOT_FOUND", "Halaman tidak ditemukan");
  });
}
