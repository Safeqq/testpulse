import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

/** Gagal jika ada pelanggaran aksesibilitas berdampak `serious` atau `critical` pada halaman saat ini. */
export async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")) }));
  expect(blocking, "pelanggaran aksesibilitas serious/critical").toEqual([]);
}

/**
 * Menunggu transisi CSS (mis. `transition-colors` saat tema berganti) selesai. Tanpa ini axe bisa membaca warna di
 * tengah transisi dan melaporkan kontras palsu.
 */
async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Dua frame agar gaya baru dihitung dan transisi sudah terdaftar di getAnimations().
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
  });
}

/**
 * Menjalankan `expectNoA11yViolations` pada halaman saat ini di tema terang, lalu gelap. Tema diganti lewat emulasi
 * `prefers-color-scheme` (preferensi pengguna tetap "system"); axe baru dijalankan setelah kelas `dark` di `<html>`
 * sesuai. Emulasi diakhiri pada `light`, jadi test yang memanggilnya melanjutkan dengan tema terang.
 */
export async function expectNoA11yViolationsInBothThemes(page: Page): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const html = page.locator("html");
    if (scheme === "dark") await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    await settleTransitions(page);
    await expectNoA11yViolations(page);
  }
}
