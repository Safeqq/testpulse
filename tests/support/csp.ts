import type { BrowserContext } from "@playwright/test";

export interface CspViolation {
  /** Direktif yang dilanggar, mis. `style-src-attr`. */
  directive: string;
  blockedURI: string;
  sample: string;
  /** URL dokumen tempat pelanggaran terjadi. */
  url: string;
}

export interface CspGuard {
  violations(): CspViolation[];
}

const BINDING = "__tpReportCsp";

/**
 * Merekam setiap event `securitypolicyviolation` (Chromium, Firefox, WebKit) di semua dokumen dan frame milik
 * context. Harus dipasang sebelum page dibuat. Dipakai fixture `test` agar test gagal bila UI melanggar CSP.
 */
export async function attachCspGuard(context: BrowserContext): Promise<CspGuard> {
  const recorded: CspViolation[] = [];

  await context.exposeBinding(BINDING, (_source, violation: CspViolation) => {
    recorded.push(violation);
  });

  // addInitScript berjalan di setiap dokumen/frame; fungsi ini diserialisasi sehingga tidak boleh memakai variabel luar.
  await context.addInitScript(() => {
    const report = (window as unknown as Record<string, ((v: unknown) => Promise<void>) | undefined>)["__tpReportCsp"];
    if (!report) return;
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
  });

  return { violations: () => [...recorded] };
}

export function describeViolation(v: CspViolation): string {
  const sample = v.sample ? ` (cuplikan: ${v.sample})` : "";
  return `${v.directive} memblokir "${v.blockedURI}" di ${v.url}${sample}`;
}
