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
  /**
   * Rahasia bersama dengan API (env PROXY_SECRET di Render). Jika diisi, dikirim sebagai `x-proxy-secret` agar API
   * mempercayai `x-tp-client-ip` dari Function ini untuk rate limit per IP (Ruling R11). Simpan sebagai secret terenkripsi.
   */
  PROXY_SECRET?: string;
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
  // Hanya Function ini yang boleh menetapkan header rahasia; nilai kiriman klien selalu dibuang.
  "x-proxy-secret",
  // Sama: IP klien untuk rate limit hanya boleh berasal dari CF-Connecting-IP (di-set di bawah).
  "x-tp-client-ip",
]);

function errorResponse(message: string): Response {
  return Response.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 502 });
}

function buildUpstreamHeaders(incoming: Headers, proxySecret: string | undefined): Headers {
  const headers = new Headers();
  incoming.forEach((value, name) => {
    if (DROPPED_HEADERS.has(name) || name.startsWith("cf-")) return;
    headers.append(name, value);
  });

  // Ruling R11: IP klien dari Cloudflare dikirim di header khusus `x-tp-client-ip`, yang dipakai API untuk rate limit
  // hanya jika request juga membawa x-proxy-secret yang benar. Header khusus dipilih karena X-Forwarded-For bisa
  // ditambah atau diubah perantara (mis. Render) sebelum sampai ke API. X-Forwarded-For tetap ditimpa dengan tepat
  // satu entri yang sama untuk log dan konsumen lain; API tidak lagi membacanya untuk kunci rate limit.
  const clientIp = incoming.get("cf-connecting-ip");
  if (clientIp) {
    headers.set("x-tp-client-ip", clientIp);
    headers.set("x-forwarded-for", clientIp);
  }
  headers.set("x-forwarded-proto", "https");
  if (proxySecret) headers.set("x-proxy-secret", proxySecret);
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
    headers: buildUpstreamHeaders(request.headers, env.PROXY_SECRET),
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
