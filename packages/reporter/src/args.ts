import { parseArgs as nodeParseArgs } from "node:util";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface ReporterOptions {
  /** URL dasar TestPulse tanpa garis miring akhir, mis. `https://testpulse.example.com`. */
  url: string;
  project: string;
  branch: string;
  commit?: string;
  ciUrl?: string;
  name?: string;
  /** Path atau pola glob, apa adanya dari argumen. */
  files: string[];
  /** Token CI dari env `TESTPULSE_TOKEN`; tidak pernah dari flag dan tidak pernah dicetak. */
  token: string;
}

export const TOKEN_ENV = "TESTPULSE_TOKEN";

/** Bentuk token CI yang diterbitkan server: `tp_` + 32 byte base64url (43 karakter). */
const TOKEN_SHAPE = /^tp_[A-Za-z0-9_-]{43}$/;

export const USAGE = [
  "Pemakaian: testpulse-report --url <urlDasar> --project <slug> --branch <branch> [opsi] <berkas|glob>...",
  "",
  "Opsi:",
  "  --url <url>       URL dasar TestPulse (wajib)",
  "  --project <slug>  slug project (wajib)",
  "  --branch <nama>   nama branch (wajib)",
  "  --commit <sha>    SHA commit (hex 7-40 karakter)",
  "  --ci-url <url>    URL run di CI",
  "  --name <nama>     nama run",
  "",
  `Token CI dibaca dari environment variable ${TOKEN_ENV} (tidak ada flag token).`,
].join("\n");

const OPTIONS = {
  url: { type: "string" },
  project: { type: "string" },
  branch: { type: "string" },
  commit: { type: "string" },
  "ci-url": { type: "string" },
  name: { type: "string" },
} as const;

/** Nama opsi dari galat `util.parseArgs`; nilai argumen sengaja tidak diulang agar rahasia tidak bocor. */
function optionNameFrom(err: unknown): string | undefined {
  return err instanceof Error ? /'(--?[\w-]+)/.exec(err.message)?.[1] : undefined;
}

function parseBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UsageError("--url bukan URL yang valid (contoh: https://testpulse.example.com)");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UsageError("--url harus berupa URL http atau https");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new UsageError("--url tidak boleh memuat username/password; gunakan TESTPULSE_TOKEN untuk token");
  }
  // Query/fragment tidak bermakna untuk URL dasar; path dasar (mis. di belakang reverse proxy) dipertahankan.
  return trimTrailingSlashes(`${parsed.origin}${parsed.pathname}`);
}

/**
 * Membuang garis miring di akhir. Sengaja tanpa `/\/+$/`: pola itu dicoba ulang dari setiap '/' dan menjadi
 * kuadratik pada path dengan banyak '/' yang tidak berada di akhir.
 */
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

/**
 * Mengurai argumen CLI dan env menjadi `ReporterOptions`. Melempar `UsageError` (pesan Indonesia) untuk
 * argumen yang kurang/salah; token hanya dibaca dari env.
 */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ReporterOptions {
  let parsed;
  try {
    parsed = nodeParseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    const option = optionNameFrom(err);
    const code = (err as { code?: string }).code;
    if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" && option) {
      throw new UsageError(`Opsi ${option} membutuhkan nilai`);
    }
    throw new UsageError(
      option ? `Opsi ${option} tidak dikenal. Token hanya dibaca dari ${TOKEN_ENV}.` : "Argumen tidak valid",
    );
  }

  const { values, positionals } = parsed;
  if (!values.url) throw new UsageError("--url wajib diisi");
  if (!values.project) throw new UsageError("--project wajib diisi");
  if (!values.branch) throw new UsageError("--branch wajib diisi");
  if (positionals.length === 0) throw new UsageError("Minimal satu berkas atau pola glob JUnit wajib diberikan");

  const token = env[TOKEN_ENV]?.trim();
  if (!token) throw new UsageError(`Environment variable ${TOKEN_ENV} wajib diisi dengan token CI project`);

  if (!TOKEN_SHAPE.test(token)) {
    throw new UsageError(`${TOKEN_ENV} bukan token CI yang sah (format: tp_ diikuti 43 karakter base64url)`);
  }

  return {
    url: parseBaseUrl(values.url),
    project: values.project,
    branch: values.branch,
    ...(values.commit ? { commit: values.commit } : {}),
    ...(values["ci-url"] ? { ciUrl: values["ci-url"] } : {}),
    ...(values.name ? { name: values.name } : {}),
    files: positionals,
    token,
  };
}
