/**
 * Cloudflare Pages Function: meneruskan semua request `/api/*` ke API di Render sehingga browser hanya
 * melihat satu origin (cookie sesi `SameSite=Lax` tetap first-party). Path tidak di-rewrite karena API
 * sendiri memakai prefix `/api`. Respons (termasuk beberapa `set-cookie`) dikembalikan apa adanya.
 *
 * Ditulis dengan tipe standar Request/Response/fetch agar bisa dites di Node tanpa dependensi wrangler.
 */

interface Env {
  /** Origin API, mis. https://testpulse-api.onrender.com (variabel lingkungan proyek Pages). */
  API_ORIGIN: string;
}

interface Context {
  request: Request;
  env: Env;
}

/** Header yang tidak boleh diteruskan: hop-by-hop, dihitung ulang oleh fetch, atau berasal dari Cloudflare. */
const DROPPED_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "te",
  "upgrade",
  // IP klien hanya boleh datang dari CF-Connecting-IP (di-set di bawah), bukan dari klien.
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
  "true-client-ip",
  "forwarded",
]);

function errorResponse(message: string): Response {
  return Response.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 502 });
}

function buildUpstreamHeaders(incoming: Headers): Headers {
  const headers = new Headers();
  incoming.forEach((value, name) => {
    if (DROPPED_HEADERS.has(name) || name.startsWith("cf-")) return;
    headers.append(name, value);
  });

  // Ruling R6: X-Forwarded-For ditimpa dengan IP klien dari Cloudflare agar rate limit per IP di API tidak bisa dipalsukan.
  const clientIp = incoming.get("cf-connecting-ip");
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  headers.set("x-forwarded-proto", "https");
  return headers;
}

export const onRequest = async ({ request, env }: Context): Promise<Response> => {
  if (!env.API_ORIGIN) {
    return errorResponse("Layanan API belum dikonfigurasi");
  }

  const incoming = new URL(request.url);
  let target: URL;
  try {
    target = new URL(incoming.pathname + incoming.search, env.API_ORIGIN);
  } catch {
    return errorResponse("Layanan API belum dikonfigurasi");
  }

  // Ruling R9: body di-buffer. Request tanpa body (logout, terima undangan) harus null, bukan stream kosong
  // yang dikirim sebagai `transfer-encoding: chunked`.
  let body: ArrayBuffer | null = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const buffered = await request.arrayBuffer();
    if (buffered.byteLength > 0) body = buffered;
  }

  const upstreamRequest = new Request(target, {
    method: request.method,
    headers: buildUpstreamHeaders(request.headers),
    body,
    // Redirect dari API diteruskan ke browser, tidak diikuti oleh proxy.
    redirect: "manual",
  });

  let upstream: Response;
  try {
    upstream = await fetch(upstreamRequest);
  } catch {
    return errorResponse("API tidak dapat dihubungi, coba lagi sebentar lagi");
  }

  // Menyalin status dan header (termasuk beberapa set-cookie) dari respons upstream.
  return new Response(upstream.body, upstream);
};
