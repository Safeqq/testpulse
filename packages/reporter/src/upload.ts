// Hanya tipe: dihapus saat kompilasi, jadi `dist/cli.js` tidak butuh @testpulse/shared (maupun zod) saat dijalankan.
import type { IngestResultDto } from "@testpulse/shared";
import type { ReporterOptions } from "./args.js";

/** Batas waktu satu upload; mencegah langkah CI menggantung bila server tidak merespons. */
export const UPLOAD_TIMEOUT_MS = 60_000;

/** Upload gagal: respons HTTP error (`status` dan `code` API) atau kegagalan jaringan (`status` null). */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

function endpointUrl(opts: ReporterOptions): URL {
  const url = new URL(`${opts.url}/api/v1/projects/${encodeURIComponent(opts.project)}/runs`);
  url.searchParams.set("branch", opts.branch);
  if (opts.commit !== undefined) url.searchParams.set("commit", opts.commit);
  if (opts.ciUrl !== undefined) url.searchParams.set("ciUrl", opts.ciUrl);
  if (opts.name !== undefined) url.searchParams.set("name", opts.name);
  return url;
}

function isIngestResult(value: unknown): value is IngestResultDto {
  if (typeof value !== "object" || value === null) return false;
  const { runId, url, totals } = value as Record<string, unknown>;
  if (typeof runId !== "string" || typeof url !== "string") return false;
  if (typeof totals !== "object" || totals === null) return false;
  return ["total", "passed", "failed", "skipped", "flaky"].every(
    (key) => typeof (totals as Record<string, unknown>)[key] === "number",
  );
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/** `{ error: { code, message } }` dari API, atau null bila bentuknya lain (mis. halaman error gateway). */
function apiError(body: unknown): { code: string; message: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string" ? { code, message } : null;
}

/** Penyebab jaringan yang aman ditampilkan (kode seperti ECONNREFUSED), tanpa pesan mentah yang mungkin memuat header. */
function networkCause(err: unknown): string {
  const cause = err instanceof Error ? err.cause : undefined;
  const code = (cause as { code?: unknown } | undefined)?.code;
  if (typeof code === "string") return code;
  return err instanceof Error && err.name === "TimeoutError" ? "TIMEOUT" : "kesalahan jaringan";
}

/**
 * Mengunggah dokumen JUnit ke `POST {url}/api/v1/projects/{project}/runs` dengan token Bearer. Respons 201
 * dikembalikan sebagai `IngestResultDto`; respons error atau kegagalan jaringan menjadi `UploadError`.
 * Pengalihan tidak diikuti (fetch mengubah POST menjadi GET pada 301/302, sehingga upload tidak pernah terjadi).
 */
export async function uploadReport(
  opts: ReporterOptions,
  xml: string,
  fetchFn: typeof fetch = fetch,
): Promise<IngestResultDto> {
  const url = endpointUrl(opts);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/xml" },
      body: xml,
      redirect: "manual",
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    throw new UploadError(`Tidak dapat terhubung ke ${url.origin} (${networkCause(err)})`, null, null);
  }

  const body = await readJson(res);
  if (res.status === 201) {
    if (!isIngestResult(body)) throw new UploadError("Respons server tidak sesuai format yang diharapkan", res.status, null);
    return body;
  }

  const error = apiError(body);
  if (error) throw new UploadError(error.message, res.status, error.code);
  if (res.status >= 300 && res.status < 400) {
    throw new UploadError(`Server mengalihkan permintaan (HTTP ${res.status}); periksa kembali nilai --url`, res.status, null);
  }
  throw new UploadError(`Server membalas HTTP ${res.status}`, res.status, null);
}
