import { expect, test } from "../support/fixtures.js";

// Font di-host sendiri (@fontsource-variable): file .woff2 disajikan dari origin yang sama,
// sehingga lolos CSP (`default-src 'self'`) tanpa mengubah header. Gate CSP di fixture ikut membuktikannya.
test.describe("Tipografi", () => {
  test("body memakai Geist dan font benar-benar termuat", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-email")).toBeVisible();

    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family).toContain("Geist Variable");

    // Pastikan font (bukan cadangan sistem) memang termuat dari origin sendiri.
    await expect.poll(() => page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('16px "Geist Variable"');
    })).toBe(true);
  });

  test("teks teknis (slug di landing) memakai Geist Mono", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing-hero")).toBeVisible();

    const mono = page.getByTestId("landing-hero").locator(".font-mono").first();
    await expect(mono).toBeVisible();
    const family = await mono.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toContain("Geist Mono Variable");

    await expect.poll(() => page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('12px "Geist Mono Variable"');
    })).toBe(true);
  });
});
