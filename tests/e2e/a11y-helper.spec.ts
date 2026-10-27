import { expect, test } from "../support/fixtures.js";

test.describe("helper aksesibilitas dua tema", () => {
  test("tidak menggantung bila ada animasi tak berhingga (animate-spin) di halaman", async ({
    page,
    expectNoA11yViolationsInBothThemes,
  }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await page.evaluate(() => {
      // Elemen berkelas animate-spin (CSS nyata aplikasi) ditambah animasi Web Animations tak berhingga.
      const spinner = document.createElement("div");
      spinner.className = "size-4 animate-spin";
      spinner.setAttribute("aria-hidden", "true");
      spinner.setAttribute("data-testid", "injected-spinner");
      document.body.appendChild(spinner);
      spinner.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 400, iterations: Infinity });
    });
    const running = await page.evaluate(() =>
      document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length,
    );
    expect(running).toBeGreaterThan(0);

    const started = Date.now();
    await expectNoA11yViolationsInBothThemes(page);
    expect(Date.now() - started, "helper harus selesai dalam batas waktu, bukan menunggu animasi tak berhingga").toBeLessThan(
      8000,
    );
  });
});
