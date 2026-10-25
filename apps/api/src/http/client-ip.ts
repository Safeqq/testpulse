import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";

/** Header yang ditambahkan Pages Function dengan nilai PROXY_SECRET (Ruling R11). */
export const PROXY_SECRET_HEADER = "x-proxy-secret";

/** Header berisi IP klien dari CF-Connecting-IP; dipercaya hanya bersama `x-proxy-secret` yang cocok (Ruling R11). */
export const CLIENT_IP_HEADER = "x-tp-client-ip";

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
 *   `x-tp-client-ip` dari CF-Connecting-IP (dan membuang kiriman klien). Kuncinya nilai header itu, asal tepat satu nilai
 *   tidak kosong. `X-Forwarded-For` tidak pernah dibaca, jadi perantara (Render) yang menambah atau mengubahnya tidak
 *   memengaruhi kunci.
 * - Selain itu (secret tidak diisi, header kosong atau salah, `x-tp-client-ip` kosong/ganda): `req.ip`, yaitu peer
 *   langsung. Fastify berjalan tanpa kepercayaan proxy, jadi header klien dari pemanggil langsung tidak pernah
 *   memengaruhi kunci.
 */
export function rateLimitKey(config: Pick<AppConfig, "proxySecret">): (req: KeyedRequest) => string {
  return (req) => {
    if (config.proxySecret && secretMatches(req.headers[PROXY_SECRET_HEADER], config.proxySecret)) {
      const provided = req.headers[CLIENT_IP_HEADER];
      // Header ganda diterima Node sebagai "a, b" (atau array): ambigu, jadi tidak dipercaya.
      const clientIp = typeof provided === "string" ? provided.trim() : "";
      if (clientIp && !clientIp.includes(",")) return clientIp;
    }
    return req.ip;
  };
}
