import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";

/** Header yang ditambahkan Pages Function dengan nilai PROXY_SECRET (Ruling R11). */
export const PROXY_SECRET_HEADER = "x-proxy-secret";

type KeyedRequest = Pick<FastifyRequest, "headers" | "ip">;

/** Perbandingan waktu-konstan; di-hash dulu agar panjang berbeda tidak membocorkan apa pun atau melempar error. */
function secretMatches(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== "string" || provided === "") return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Kunci rate limit (register & login).
 * - `PROXY_SECRET` terisi dan header `x-proxy-secret` cocok: request berasal dari Pages Function, yang menetapkan
 *   `X-Forwarded-For` tepat satu entri dari CF-Connecting-IP. Kuncinya entri pertama header itu.
 * - Selain itu (secret tidak diisi, header kosong atau salah): `req.ip`, yaitu peer langsung. Fastify berjalan tanpa
 *   kepercayaan proxy, jadi `X-Forwarded-For` dari pemanggil langsung tidak pernah memengaruhi kunci.
 */
export function rateLimitKey(config: Pick<AppConfig, "proxySecret">): (req: KeyedRequest) => string {
  return (req) => {
    if (config.proxySecret && secretMatches(req.headers[PROXY_SECRET_HEADER], config.proxySecret)) {
      const forwarded = req.headers["x-forwarded-for"];
      const first = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined;
      if (first) return first;
    }
    return req.ip;
  };
}
