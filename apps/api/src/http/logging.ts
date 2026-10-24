import type { FastifyRequest } from "fastify";

// Token undangan adalah rahasia sekali pakai yang ikut di path; segmennya disensor sebelum masuk log.
// Hanya /api/v1/invitations/:token yang disensor; id undangan di /projects/:slug/invitations/:id bukan rahasia.
const INVITATION_TOKEN_PATH = /^(\/api\/v1\/invitations\/)[^/?#]+/i;

export function redactUrl(url: string): string {
  return url.replace(INVITATION_TOKEN_PATH, "$1[REDACTED]");
}

type LoggedRequest = Pick<FastifyRequest, "method" | "url" | "headers" | "host" | "ip" | "socket">;

/** Sama dengan serializer `req` bawaan Fastify, tetapi dengan URL yang sudah disensor. */
export function serializeRequest(req: Partial<LoggedRequest>) {
  const version = req.headers?.["accept-version"];
  return {
    method: req.method,
    url: req.url === undefined ? undefined : redactUrl(req.url),
    version: typeof version === "string" ? version : undefined,
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
