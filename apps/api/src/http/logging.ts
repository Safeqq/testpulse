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

const MAX_CAUSE_DEPTH = 3;
const PARAMS_MARKER = "params:";

/** Bentuk log `err`; kompatibel dengan tipe serializer pino/Fastify (index signature + type, message, stack). */
export interface SerializedError {
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
  code?: string | number;
  statusCode?: number;
  cause?: SerializedError;
}

/**
 * Query gagal dari drizzle (`DrizzleQueryError`) menaruh nilai parameter di `message` ("Failed query: ... params: ...")
 * dan di `params`/`stack`; untuk register/login itu berarti email, nama, dan hash password. Error seperti itu dicatat
 * tanpa bagian params: nama, teks query (hanya placeholder $1, $2, ...), penyebab (kode dan pesan), dan stack frame.
 */
function carriesParams(err: Error): boolean {
  return Array.isArray((err as { params?: unknown }).params) || err.message.includes(PARAMS_MARKER);
}

function stripParams(message: string): string {
  const at = message.indexOf(PARAMS_MARKER);
  return at === -1 ? message : message.slice(0, at).trimEnd();
}

function serializeErrorAt(err: Error, depth: number): SerializedError {
  const sensitive = carriesParams(err);
  const message = sensitive ? stripParams(err.message) : err.message;
  // Seperti serializer bawaan pino: nama class (DrizzleQueryError memakai name "Error" bawaan).
  const type = typeof err.constructor === "function" && err.constructor.name ? err.constructor.name : err.name;
  const header = `${type}: ${message}`;
  // Header stack berisi message asli; untuk error ber-params diganti yang sudah disensor, hanya frame-nya dipertahankan.
  const frames = err.stack?.indexOf("\n    at ") ?? -1;
  const stack = !err.stack ? header : sensitive ? `${header}${frames === -1 ? "" : err.stack.slice(frames)}` : err.stack;
  const out: SerializedError = { type, message, stack };

  const { code, statusCode, cause } = err as { code?: unknown; statusCode?: unknown; cause?: unknown };
  if (typeof code === "string" || typeof code === "number") out.code = code;
  if (typeof statusCode === "number") out.statusCode = statusCode;
  if (cause instanceof Error && depth < MAX_CAUSE_DEPTH) out.cause = serializeErrorAt(cause, depth + 1);
  return out;
}

/**
 * Serializer pino untuk `err`: bentuk mirip serializer bawaan (`type`, `message`, `stack`), tetapi tidak pernah
 * menuliskan parameter query. Dipakai untuk semua log `{ err }` (error handler, health check, shutdown).
 */
export function serializeError(err: Error): SerializedError {
  // Pemanggil log bisa mengirim nilai apa pun di bawah kunci `err`; yang bukan Error dilewatkan apa adanya.
  return err instanceof Error ? serializeErrorAt(err, 0) : (err as unknown as SerializedError);
}
