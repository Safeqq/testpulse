import helmet from "@fastify/helmet";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { AppError } from "./errors.js";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function hasBody(req: FastifyRequest): boolean {
  const length = req.headers["content-length"];
  if (length !== undefined) return length !== "0";
  return req.headers["transfer-encoding"] !== undefined;
}

function isJson(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Header keamanan (helmet) dan penjaga CSRF untuk request pengubah data (§8):
 * - `Origin` yang ada harus sama dengan `APP_ORIGIN` (403 FORBIDDEN); tanpa `Origin` diizinkan.
 * - Request yang membawa body wajib `application/json` (400 VALIDATION_ERROR);
 *   request tanpa body (mis. logout) diizinkan.
 */
export async function registerSecurity(app: FastifyInstance, config: AppConfig): Promise<void> {
  await app.register(helmet);

  // Body JSON kosong (mis. `Content-Type: application/json` tanpa body pada logout) dianggap tidak ada body.
  const parseJson = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    if (body === "") return done(null, undefined);
    parseJson(req, body as string, done);
  });

  app.addHook("onRequest", async (req) => {
    if (!MUTATING_METHODS.has(req.method)) return;

    const origin = req.headers.origin;
    if (origin !== undefined && origin !== config.appOrigin) {
      throw new AppError(403, "FORBIDDEN", "Asal permintaan tidak diizinkan");
    }

    if (hasBody(req) && !isJson(req.headers["content-type"])) {
      throw new AppError(400, "VALIDATION_ERROR", "Content-Type harus application/json");
    }
  });
}
