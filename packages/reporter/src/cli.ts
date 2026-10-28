#!/usr/bin/env node
import { glob, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, USAGE, UsageError, type ReporterOptions } from "./args.js";
import { MergeError, mergeJUnit } from "./merge.js";
import { UploadError, uploadReport } from "./upload.js";

/** Batas ukuran dokumen hasil gabungan; sama dengan batas body endpoint upload (5 MB). */
export const MAX_REPORT_BYTES = 5 * 1024 * 1024;

export const EXIT_OK = 0;
export const EXIT_UPLOAD_FAILED = 1;
export const EXIT_USAGE = 2;

export interface ReporterIO {
  /** Satu baris keluaran normal (stdout). */
  out: (line: string) => void;
  /** Satu baris galat (stderr). */
  err: (line: string) => void;
  /** Direktori acuan path/glob relatif; default `process.cwd()`. */
  cwd?: string;
  /** Pengganti `fetch` (untuk test). */
  fetch?: typeof fetch;
}

const GLOB_MAGIC = /[*?[\]{}]/;

/** Karakter kontrol (termasuk ESC) dibuang agar teks dari server/berkas tidak dapat memanipulasi terminal. */
const CONTROL_CHARS = /(?![\n\t])\p{Cc}/gu;

class FileError extends Error {}

/** Memperluas argumen berkas (path literal atau glob) menjadi daftar path unik dan terurut. */
async function resolveFiles(patterns: string[], cwd: string): Promise<string[]> {
  const found = new Set<string>();
  for (const pattern of patterns) {
    if (!GLOB_MAGIC.test(pattern)) {
      found.add(path.resolve(cwd, pattern));
      continue;
    }
    let matched = 0;
    for await (const match of glob(pattern, { cwd })) {
      found.add(path.resolve(cwd, match));
      matched++;
    }
    if (matched === 0) throw new FileError(`Tidak ada berkas yang cocok dengan pola: ${pattern}`);
  }
  return [...found].sort();
}

async function readReports(files: string[], cwd: string): Promise<string[]> {
  return Promise.all(
    files.map(async (file) => {
      try {
        return await readFile(file, "utf8");
      } catch (err) {
        const code = (err as { code?: string }).code ?? "tidak diketahui";
        throw new FileError(`Tidak dapat membaca berkas ${path.relative(cwd, file) || file} (${code})`);
      }
    }),
  );
}

/** Penyaring keluaran: membuang karakter kontrol dan menyembunyikan token CI bila tak sengaja terpantul. */
function cleaner(env: NodeJS.ProcessEnv): (text: string) => string {
  const secret = env.TESTPULSE_TOKEN?.trim();
  return (text) => {
    const safe = text.replace(CONTROL_CHARS, " ");
    return secret ? safe.replaceAll(secret, "[token disembunyikan]") : safe;
  };
}

/** Host yang boleh memakai http:// tanpa peringatan (lalu lintas tidak meninggalkan mesin ini). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Titik masuk CLI. Mengembalikan exit code: 0 sukses, 1 upload gagal (HTTP/jaringan) atau galat tak terduga,
 * 2 argumen atau berkas salah. Semua keluaran lewat `io` dan disaring dari token CI serta karakter kontrol;
 * galat tak terduga hanya mencetak pesannya yang sudah disaring, tidak pernah stack trace mentah.
 */
export async function main(argv: string[], env: NodeJS.ProcessEnv, io: ReporterIO): Promise<number> {
  const clean = cleaner(env);
  try {
    return await run(argv, env, io, clean);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    io.err(clean(`Kesalahan tak terduga: ${message.replace(/\s+/g, " ")}`));
    return EXIT_UPLOAD_FAILED;
  }
}

async function run(
  argv: string[],
  env: NodeJS.ProcessEnv,
  io: ReporterIO,
  clean: (text: string) => string,
): Promise<number> {
  const out = (line: string) => io.out(clean(line));
  const err = (line: string) => io.err(clean(line));
  const cwd = io.cwd ?? process.cwd();

  let opts: ReporterOptions;
  try {
    opts = parseArgs(argv, env);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`Kesalahan: ${e.message}`);
    err("");
    err(USAGE);
    return EXIT_USAGE;
  }

  const { protocol, hostname } = new URL(opts.url);
  if (protocol === "http:" && !LOCAL_HOSTS.has(hostname)) {
    err("Peringatan: --url memakai http:// ke host selain localhost; token CI dikirim tanpa enkripsi. Gunakan https://.");
  }

  let files: string[] = [];
  let xml: string;
  try {
    files = await resolveFiles(opts.files, cwd);
    const docs = await readReports(files, cwd);
    xml = mergeJUnit(docs);
  } catch (e) {
    if (e instanceof FileError) {
      err(`Kesalahan: ${e.message}`);
      return EXIT_USAGE;
    }
    if (e instanceof MergeError) {
      const file = files[e.index];
      err(`Kesalahan: ${file ? path.relative(cwd, file) || file : "laporan"}: ${e.message}`);
      return EXIT_USAGE;
    }
    throw e;
  }

  const size = Buffer.byteLength(xml, "utf8");
  if (size > MAX_REPORT_BYTES) {
    err(`Kesalahan: laporan gabungan berukuran ${size} byte, melebihi batas 5 MB`);
    return EXIT_USAGE;
  }

  try {
    const result = await uploadReport(opts, xml, io.fetch);
    const { total, passed, failed, skipped, flaky } = result.totals;
    out(`Laporan terkirim (${files.length} berkas): ${total} test, ${passed} lulus, ${failed} gagal, ${skipped} dilewati, ${flaky} flaky`);
    out(`URL run: ${result.url}`);
    return EXIT_OK;
  } catch (e) {
    if (!(e instanceof UploadError)) throw e;
    const detail = [e.status !== null ? `HTTP ${e.status}` : null, e.code].filter(Boolean).join(" ");
    // Pesan dari server dijadikan satu baris agar tidak dapat menyisipkan baris log palsu.
    err(`Upload gagal${detail ? ` (${detail})` : ""}: ${e.message.replace(/\s+/g, " ")}`);
    return EXIT_UPLOAD_FAILED;
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  // `main` sudah menangkap semua galat; cabang ini hanya untuk kegagalan penulisan keluaran itu sendiri.
  process.exitCode = await main(process.argv.slice(2), process.env, {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  }).catch(() => {
    console.error("Kesalahan tak terduga");
    return EXIT_UPLOAD_FAILED;
  });
}
