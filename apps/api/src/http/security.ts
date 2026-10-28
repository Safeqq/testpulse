import helmet from "@fastify/helmet";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { AppError } from "./errors.js";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** Satu-satunya path yang boleh menerima body XML: upload JUnit (spec Tahap 2 §4). */
const INGEST_PATH = /^\/api\/v1\/projects\/[^/]+\/runs$/;
const XML_MEDIA_TYPES = new Set(["application/xml", "text/xml"]);

function hasBody(req: FastifyRequest): boolean {
  const length = req.headers["content-length"];
  if (length !== undefined) return length !== "0";
  return req.headers["transfer-encoding"] !== undefined;
}

/** Media type tanpa parameter (mis. `charset`), huruf kecil. */
function mediaTypeOf(contentType: string | undefined): string | undefined {
  return contentType?.split(";")[0]?.trim().toLowerCase();
}

function isJson(contentType: string | undefined): boolean {
  return mediaTypeOf(contentType) === "application/json";
}

/** `application/xml` atau `text/xml`, parameter seperti `charset` boleh ada. */
export function isXml(contentType: string | undefined): boolean {
  const mediaType = mediaTypeOf(contentType);
  return mediaType !== undefined && XML_MEDIA_TYPES.has(mediaType);
}

/** Upload JUnit: POST ke `/api/v1/projects/:slug/runs` (path persis, query boleh) dengan body XML. */
function isIngestUpload(req: FastifyRequest): boolean {
  if (req.method !== "POST") return false;
  const path = req.url.split("?", 1)[0] ?? "";
  return INGEST_PATH.test(path) && isXml(req.headers["content-type"]);
}

/**
 * Header keamanan (helmet) dan penjaga CSRF untuk request pengubah data (§8):
 * - `Origin` yang ada harus sama dengan `APP_ORIGIN` (403 FORBIDDEN); tanpa `Origin` diizinkan. Berlaku untuk semua
 *   request pengubah data, termasuk upload JUnit.
 * - Request yang membawa body wajib `application/json` (400 VALIDATION_ERROR); request tanpa body (mis. logout)
 *   diizinkan. Satu-satunya pengecualian: upload JUnit (`POST /api/v1/projects/:slug/runs` dengan body
 *   `application/xml`/`text/xml`), yang aman dari CSRF karena hanya menerima Bearer token, bukan cookie.
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

  // Body XML diserahkan apa adanya (string) ke rute upload, yang mem-parse-nya sendiri (parseJUnit).
  // Rute lain tidak pernah menerimanya: hook di bawah menolak XML di luar path upload.
  app.addContentTypeParser([...XML_MEDIA_TYPES], { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  app.addHook("onRequest", async (req) => {
    if (!MUTATING_METHODS.has(req.method)) return;

    const origin = req.headers.origin;
    if (origin !== undefined && origin !== config.appOrigin) {
      throw new AppError(403, "FORBIDDEN", "Asal permintaan tidak diizinkan");
    }

    if (hasBody(req) && !isJson(req.headers["content-type"]) && !isIngestUpload(req)) {
      throw new AppError(400, "VALIDATION_ERROR", "Content-Type harus application/json");
    }
  });
}
