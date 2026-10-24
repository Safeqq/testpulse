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
