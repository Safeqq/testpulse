import type { Page } from "@playwright/test";
import { SettingsPage } from "../pages/SettingsPage.js";
import { expect, test } from "../support/fixtures.js";
import { buildJUnit } from "../support/junit.js";

const XML = buildJUnit([{ name: "lulus" }]);

function tokenHeading(page: Page) {
  return page.getByRole("heading", { name: "Token CI" });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("Token CI di pengaturan project", () => {
  test("admin membuat token, memakainya untuk unggah, lalu mencabutnya", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const admin = await api.register();
    const project = await api.createProject(admin);
    const { page } = await signedInPage(admin);
    const settings = new SettingsPage(page);

    await settings.goto(project.slug);
    await expect(tokenHeading(page)).toBeVisible();
    await expect(page.getByTestId("token-empty")).toBeVisible();

    const token = await settings.createToken("GitHub Actions");
    expect(token).toMatch(/^tp_[A-Za-z0-9_-]{20,}$/);
    await expect(settings.toast).toContainText("Token dibuat");

    // Contoh curl: URL production-agnostic (origin halaman) dan slug project.
    const origin = new URL(page.url()).origin;
    await expect(settings.tokenCurl).toContainText(`${origin}/api/v1/projects/${project.slug}/runs`);
    await expect(settings.tokenCurl).toContainText("Authorization: Bearer");
    await expect(settings.tokenName).toHaveValue("");

    // Token muncul di daftar tanpa nilainya.
    const row = page.locator('[data-testid^="token-row-"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("GitHub Actions");
    await expect(row).toContainText(admin.user.name);
    await expect(row).not.toContainText(token);
    await expectNoA11yViolationsInBothThemes(page);

    // Token benar-benar berfungsi untuk unggah (membuktikan nilai yang ditampilkan utuh).
    const upload = await api.uploadRun(token, project.slug, XML, { branch: "main" });
    expect(upload.status(), await upload.text()).toBe(201);

    // Setelah dimuat ulang, nilai token tidak lagi tersedia; baris tetap ada dan sekarang punya waktu pemakaian.
    await page.reload();
    await expect(settings.title).toBeVisible();
    await expect(row).toHaveCount(1);
    await expect(settings.tokenValue).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(token);
    await expectNoA11yViolationsInBothThemes(page);

    // Cabut: baris hilang, daftar kosong, dan token ditolak.
    await row.getByRole("button", { name: /Cabut/ }).click();
    await expect(row).toHaveCount(0);
    await expect(settings.toast).toContainText("Token dicabut");
    await expect(page.getByTestId("token-empty")).toBeVisible();
    const rejected = await api.uploadRun(token, project.slug, XML, { branch: "main" });
    expect(rejected.status()).toBe(401);
  });

  test("nama kosong ditolak dengan pesan di bawah kolom", async ({ api, signedInPage }) => {
    const admin = await api.register();
    const project = await api.createProject(admin);
    const { page } = await signedInPage(admin);
    const settings = new SettingsPage(page);

    await settings.goto(project.slug);
    await settings.tokenName.fill("   ");
    await settings.tokenCreate.click();

    await expect(page.getByTestId("field-error-name").filter({ hasText: "Nama token wajib diisi" })).toBeVisible();
    await expect(settings.tokenValue).toHaveCount(0);
  });

  test("token ke-11 ditolak dengan pesan dari server", async ({ api, signedInPage }) => {
    const admin = await api.register();
    const project = await api.createProject(admin);
    for (let i = 1; i <= 10; i += 1) await api.createToken(admin, project.slug, `token ${i}`);
    const { page } = await signedInPage(admin);
    const settings = new SettingsPage(page);

    await settings.goto(project.slug);
    await expect(page.locator('[data-testid^="token-row-"]')).toHaveCount(10);
    await settings.tokenName.fill("token 11");
    await settings.tokenCreate.click();

    await expect(settings.toast).toContainText("Maksimal 10 token aktif");
    await expect(page.locator('[data-testid^="token-row-"]')).toHaveCount(10);
    await expect(settings.tokenValue).toHaveCount(0);
  });

  test("tester dan viewer tidak melihat bagian Token CI", async ({ api, signedInPage }) => {
    const admin = await api.register();
    const project = await api.createProject(admin);
    const existing = await api.createToken(admin, project.slug);

    for (const role of ["tester", "viewer"] as const) {
      const member = await api.addMember(admin, project.slug, role);
      const { page } = await signedInPage(member);
      const settings = new SettingsPage(page);

      await settings.goto(project.slug);
      await expect(tokenHeading(page)).toHaveCount(0);
      await expect(settings.tokenName).toHaveCount(0);
      await expect(settings.tokenCreate).toHaveCount(0);
      await expect(page.getByTestId(`token-row-${existing.id}`)).toHaveCount(0);
    }
  });

  test("tombol salin memberi tahu hasil penulisan clipboard (berhasil dan ditolak)", async ({ api, signedInPage }) => {
    const admin = await api.register();
    const project = await api.createProject(admin);

    for (const outcome of ["berhasil", "ditolak"] as const) {
      const { page } = await signedInPage(admin);
      const settings = new SettingsPage(page);
      // Clipboard diganti agar hasilnya deterministik di semua browser.
      await page.addInitScript((shouldSucceed) => {
        const win = window as unknown as { __copied?: string };
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: (text: string) => {
              win.__copied = text;
              return shouldSucceed ? Promise.resolve() : Promise.reject(new Error("ditolak"));
            },
          },
        });
      }, outcome === "berhasil");

      await settings.goto(project.slug);
      const token = await settings.createToken(`salin ${outcome}`);
      await settings.tokenCopy.click();

      if (outcome === "berhasil") await expect(settings.toast).toContainText("Token disalin");
      else await expect(settings.toast).toContainText("Salin token secara manual");
      expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(token);
    }
  });

  test("tampil rapi di 375 px tanpa gulir horizontal", async ({ api, newContext }) => {
    const admin = await api.register();
    const project = await api.createProject(admin);
    const context = await newContext({
      storageState: await admin.request.storageState(),
      viewport: { width: 375, height: 800 },
    });
    try {
      const page = await context.newPage();
      const settings = new SettingsPage(page);

      await settings.goto(project.slug);
      await settings.createToken("nama token yang cukup panjang untuk layar sempit");
      await expect(settings.tokenCurl).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });
});
