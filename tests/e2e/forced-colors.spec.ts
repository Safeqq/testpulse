import type { Page } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage.js";
import { expect, test } from "../support/fixtures.js";

// Mode kontras tinggi Windows (forced-colors) menghapus box-shadow dan warna latar, sehingga fokus yang hanya
// ditandai ring/latar menjadi tak terlihat. Pastikan elemen yang fokus lewat keyboard tetap punya outline nyata.
test.describe("fokus keyboard terlihat di mode forced-colors", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "Emulasi forced-colors hanya diandalkan di Chromium");
  });

  async function focusRing(page: Page): Promise<{ style: string; width: number }> {
    return page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return { style: "none", width: 0 };
      const computed = getComputedStyle(active);
      return { style: computed.outlineStyle, width: Number.parseFloat(computed.outlineWidth) };
    });
  }

  async function tabTo(page: Page, testId: string): Promise<void> {
    const target = page.getByTestId(testId);
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      if (await target.evaluate((el) => el === document.activeElement)) return;
    }
    throw new Error(`Fokus tidak pernah sampai ke ${testId}`);
  }

  for (const [label, testId] of [
    ["tombol pemilih tema", "theme-toggle"],
    ["kolom input", "login-email"],
    ["tombol kirim", "login-submit"],
  ] as const) {
    test(`${label} punya outline saat fokus keyboard`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: "active" });
      expect(await page.evaluate(() => window.matchMedia("(forced-colors: active)").matches)).toBe(true);
      await new LoginPage(page).goto();

      await tabTo(page, testId);

      const ring = await focusRing(page);
      expect(ring.style, `outline-style ${testId}`).not.toBe("none");
      expect(ring.width, `outline-width ${testId}`).toBeGreaterThan(0);
    });
  }
});
