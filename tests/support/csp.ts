import type { BrowserContext, ConsoleMessage } from "@playwright/test";

export interface CspViolation {
  /** Direktif yang dilanggar, mis. `style-src-attr`. Dari pesan console: hasil parse terbaik, atau `unknown`. */
  directive: string;
  blockedURI: string;
  /** Dari event: cuplikan sumber. Dari console: teks pesan (dipotong). */
  sample: string;
  /** URL dokumen tempat pelanggaran terjadi. */
  url: string;
}

export interface CspGuard {
  violations(): CspViolation[];
}

const BINDING = "__tpReportCsp";
/** Ditulis init script lewat console.error bila binding tidak ada, supaya guard gagal tertutup (bukan diam-diam mati). */
const MISSING_MARKER = "TP_CSP_GUARD_MISSING";
const GUARD_MISSING_DIRECTIVE = "tp-guard-missing";
const SAMPLE_LIMIT = 200;

const CSP_CONSOLE = /Content[- ]Security[- ]Policy/i;
const DIRECTIVE =
  /\b((?:default|script|style|img|connect|font|object|media|frame|child|worker|manifest|prefetch)-src(?:-elem|-attr)?|form-action|base-uri|frame-ancestors)\b/;

/** `script-src-elem` -> `script-src`, agar pelaporan lewat event dan console untuk satu pelanggaran dapat disamakan. */
function directiveFamily(directive: string): string {
  return directive.replace(/-(elem|attr)$/, "");
}

function fromConsole(message: ConsoleMessage): CspViolation | null {
  const text = message.text();
  // URL halaman pemilik, bukan message.location(): lokasi bisa berupa skrip bundel atau pseudo-URL ("debugger eval code").
  const url = message.page()?.url() ?? message.location().url;
  if (text.includes(MISSING_MARKER)) {
    return {
      directive: GUARD_MISSING_DIRECTIVE,
      blockedURI: "",
      sample: `binding ${BINDING} tidak tersedia; guard CSP tidak dapat mendengarkan event pelanggaran`,
      url,
    };
  }
  if ((message.type() !== "error" && message.type() !== "warning") || !CSP_CONSOLE.test(text)) return null;
  return {
    directive: DIRECTIVE.exec(text)?.[1] ?? "unknown",
    blockedURI: /https?:\/\/[^\s'"“”’)]+/.exec(text)?.[0] ?? "console",
    sample: text.length > SAMPLE_LIMIT ? `${text.slice(0, SAMPLE_LIMIT)}...` : text,
    url,
  };
}

/**
 * Merekam pelanggaran CSP milik semua dokumen, frame, dan worker dari satu context. Harus dipasang sebelum page
 * dibuat. Dua jalur:
 *  1. event `securitypolicyviolation` (Chromium, Firefox, WebKit) lewat `addInitScript` + `exposeBinding` di setiap
 *     dokumen/frame;
 *  2. pesan console error/warning yang menyebut Content Security Policy, untuk yang tidak terlihat event di
 *     `window` (mis. pelanggaran di dalam worker; hanya WebKit yang menampilkannya lewat console Playwright).
 *
 * Satu pelanggaran bisa dilaporkan kedua jalur. Dedupe saat `violations()` dipanggil: entri console dibuang bila ada
 * entri event dengan keluarga direktif yang sama (URL tidak dibandingkan: lokasi pesan console tidak selalu URL
 * dokumen; test sudah pasti gagal lewat entri event itu). Entri console untuk `style-src*` selalu dibuang:
 * halaman sudah terliput oleh event, worker tidak punya style, dan WebKit mencatat pesan yang sama persis untuk
 * artefak `<select>` (lihat di bawah) maupun style inline asli sehingga teksnya tidak bisa dibedakan.
 *
 * Gagal tertutup: bila binding tidak ada di suatu dokumen, init script menulis penanda lewat console.error dan itu
 * menjadi entri pelanggaran `tp-guard-missing`.
 */
export async function attachCspGuard(context: BrowserContext): Promise<CspGuard> {
  const events: CspViolation[] = [];
  const consoleEntries: CspViolation[] = [];

  await context.exposeBinding(BINDING, (_source, violation: CspViolation) => {
    events.push(violation);
  });

  context.on("console", (message) => {
    const entry = fromConsole(message);
    if (entry) consoleEntries.push(entry);
  });

  // addInitScript berjalan di setiap dokumen/frame; fungsi ini diserialisasi sehingga tidak boleh memakai variabel luar.
  await context.addInitScript(
    ([binding, marker]) => {
      const report = (window as unknown as Record<string, ((v: unknown) => Promise<void>) | undefined>)[binding as string];
      if (typeof report !== "function") {
        console.error(marker);
        return;
      }
      window.addEventListener(
        "securitypolicyviolation",
        (event) => {
          // WebKit melaporkan style-src-attr setiap kali <select> dibuat (document.createElement("select")), padahal
          // tidak ada atribut style sama sekali. Itu bug mesin, bukan kode aplikasi; atribut style asli tetap terdeteksi.
          const target = event.target;
          if (
            event.effectiveDirective === "style-src-attr" &&
            target instanceof HTMLSelectElement &&
            !target.hasAttribute("style")
          ) {
            return;
          }
          report({
            directive: event.effectiveDirective || event.violatedDirective,
            blockedURI: event.blockedURI,
            sample: event.sample,
            url: event.documentURI,
          }).catch(() => undefined);
        },
        true,
      );
    },
    [BINDING, MISSING_MARKER],
  );

  return {
    violations: () => {
      const covered = new Set(events.map((e) => directiveFamily(e.directive)));
      const extra = consoleEntries.filter(
        (c) =>
          c.directive === GUARD_MISSING_DIRECTIVE ||
          (!directiveFamily(c.directive).startsWith("style-src") && !covered.has(directiveFamily(c.directive))),
      );
      return [...events, ...extra];
    },
  };
}

export function describeViolation(v: CspViolation): string {
  const sample = v.sample ? ` (cuplikan: ${v.sample})` : "";
  return `${v.directive} memblokir "${v.blockedURI}" di ${v.url}${sample}`;
}
