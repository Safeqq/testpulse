import type { Page } from "@playwright/test";
import { AppShell } from "../pages/AppShell.js";
import { LoginPage } from "../pages/LoginPage.js";
import { expect, test } from "../support/fixtures.js";

const DARK = /(^|\s)dark(\s|$)/;

function html(page: Page) {
  return page.locator("html");
}

/** Tab sampai elemen dengan testid ini fokus (urutan fokus di atasnya bukan urusan test ini). */
async function tabTo(page: Page, testId: string): Promise<void> {
  const target = page.getByTestId(testId);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Fokus tidak pernah sampai ke ${testId}`);
}

test.describe("Tema", () => {
  test("pilihan sistem mengikuti skema warna yang diemulasikan", async ({ page }) => {
    const login = new LoginPage(page);

    await page.emulateMedia({ colorScheme: "dark" });
    await login.goto();
    await expect(html(page)).toHaveClass(DARK);
    await expect(html(page)).toHaveCSS("color-scheme", "dark");

    await page.emulateMedia({ colorScheme: "light" });
    await login.goto();
    await expect(html(page)).not.toHaveClass(DARK);
    await expect(html(page)).toHaveCSS("color-scheme", "light");
  });

  test("memilih Gelap tersimpan setelah reload; Sistem kembali mengikuti emulasi, termasuk tanpa reload", async ({
    page,
  }) => {
    const login = new LoginPage(page);
    const shell = new AppShell(page);
    await page.emulateMedia({ colorScheme: "light" });
    await login.goto();
    await expect(html(page)).not.toHaveClass(DARK);

    await shell.chooseTheme("dark");
    await expect(html(page)).toHaveClass(DARK);
    expect(await page.evaluate(() => localStorage.getItem("tp-theme"))).toBe("dark");

    await page.reload();
    await expect(login.submit).toBeVisible();
    await expect(html(page)).toHaveClass(DARK);

    await shell.chooseTheme("system");
    await expect(html(page)).not.toHaveClass(DARK);
    expect(await page.evaluate(() => localStorage.getItem("tp-theme"))).toBe("system");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html(page)).toHaveClass(DARK);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html(page)).not.toHaveClass(DARK);
  });

  test("memilih Terang menang atas sistem gelap dan tersimpan setelah reload", async ({ page }) => {
    const login = new LoginPage(page);
    const shell = new AppShell(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await login.goto();

    await shell.chooseTheme("light");
    await expect(html(page)).not.toHaveClass(DARK);

    await page.reload();
    await expect(login.submit).toBeVisible();
    await expect(html(page)).not.toHaveClass(DARK);
  });

  test("tanpa kedip: kelas dark sudah terpasang sebelum bundle aplikasi dimuat", async ({ page }) => {
    // Semua script selain theme-init.js ditahan, sehingga React tidak pernah berjalan.
    await page.route("**/*", (route) => {
      const request = route.request();
      if (request.resourceType() === "script" && new URL(request.url()).pathname !== "/theme-init.js") {
        return route.abort();
      }
      return route.continue();
    });
    await page.emulateMedia({ colorScheme: "dark" });

    await page.goto("/login", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#root")).toBeEmpty();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark");
  });

  test("tanpa kedip: pilihan Terang yang tersimpan menang atas sistem gelap sebelum bundle dimuat", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("tp-theme", "light"));
    await page.route("**/*", (route) => {
      const request = route.request();
      if (request.resourceType() === "script" && new URL(request.url()).pathname !== "/theme-init.js") {
        return route.abort();
      }
      return route.continue();
    });
    await page.emulateMedia({ colorScheme: "dark" });

    await page.goto("/login", { waitUntil: "domcontentloaded" });

    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  });

  // Review Focus 1: localStorage yang melempar tidak boleh merusak halaman.
  test("localStorage yang melempar error: halaman tetap tampil dan toggle tetap berfungsi", async ({ page }) => {
    await page.addInitScript(() => {
      const blocked = () => {
        throw new Error("localStorage diblokir");
      };
      Storage.prototype.getItem = blocked;
      Storage.prototype.setItem = blocked;
    });
    const login = new LoginPage(page);
    const shell = new AppShell(page);
    await page.emulateMedia({ colorScheme: "light" });

    await login.goto();
    await expect(page.getByRole("heading", { name: "Masuk" })).toBeVisible();
    await expect(html(page)).not.toHaveClass(DARK);

    await shell.chooseTheme("dark");
    await expect(html(page)).toHaveClass(DARK);
  });

  // Review Focus 2: nilai tak dikenal diperlakukan sebagai "system".
  test("nilai tp-theme tak dikenal diperlakukan sebagai sistem", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tp-theme", "blue"));
    const login = new LoginPage(page);
    await page.emulateMedia({ colorScheme: "dark" });

    await login.goto();
    await expect(html(page)).toHaveClass(DARK);

    await page.emulateMedia({ colorScheme: "light" });
    await expect(html(page)).not.toHaveClass(DARK);
  });

  test("meta theme-color mengikuti tema aktif", async ({ page }) => {
    const login = new LoginPage(page);
    const shell = new AppShell(page);
    const themeColor = page.locator('meta[name="theme-color"]');
    await page.emulateMedia({ colorScheme: "light" });
    await login.goto();
    await expect(themeColor).toHaveAttribute("content", "#f4f5f7");

    await shell.chooseTheme("dark");
    await expect(themeColor).toHaveAttribute("content", "#0b0d0f");
  });

  // Review Focus 4: keyboard + Escape mengembalikan fokus.
  test("pemilih tema dapat dioperasikan dengan keyboard; Escape menutup dan mengembalikan fokus", async ({ page }) => {
    const login = new LoginPage(page);
    const shell = new AppShell(page);
    await page.emulateMedia({ colorScheme: "light" });
    await login.goto();

    await tabTo(page, "theme-toggle");
    await page.keyboard.press("Enter");
    await expect(shell.themeOption("dark")).toBeVisible();
    await expect(shell.themeToggle).toHaveAttribute("aria-expanded", "true");

    for (let i = 0; i < 4 && !(await shell.themeOption("dark").evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(shell.themeOption("dark")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(html(page)).toHaveClass(DARK);
    await expect(shell.themeOption("dark")).toHaveCount(0);
    await expect(shell.themeToggle).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(shell.themeOption("system")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shell.themeOption("system")).toHaveCount(0);
    await expect(shell.themeToggle).toBeFocused();
    await expect(html(page)).toHaveClass(DARK);
  });

  test.describe("viewport mobile 375x812", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("menu navigasi tersembunyi sampai dibuka; Escape menutup dan mengembalikan fokus ke tombolnya", async ({
      page,
    }) => {
      const login = new LoginPage(page);
      const shell = new AppShell(page);
      await login.goto();

      await expect(shell.mobileMenuToggle).toBeVisible();
      await expect(shell.mobileMenuToggle).toHaveAttribute("aria-expanded", "false");
      await expect(shell.loginLink).toBeHidden();

      await tabTo(page, "mobile-menu-toggle");
      await page.keyboard.press("Enter");
      await expect(shell.mobileMenuToggle).toHaveAttribute("aria-expanded", "true");
      await expect(shell.loginLink).toBeVisible();
      await expect(shell.registerLink).toBeVisible();

      // Fokus pindah ke dalam menu (focus() langsung: WebKit melewati tautan saat Tab), lalu Escape harus
      // kembali ke tombol disclosure.
      await shell.loginLink.focus();
      await expect(shell.loginLink).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(shell.mobileMenuToggle).toHaveAttribute("aria-expanded", "false");
      await expect(shell.mobileMenuToggle).toBeFocused();
      await expect(shell.loginLink).toBeHidden();
    });

    test("menu navigasi tertutup otomatis saat pindah rute (logo, tombol kembali)", async ({ page }) => {
      const login = new LoginPage(page);
      const shell = new AppShell(page);
      await login.goto();

      await shell.mobileMenuToggle.click();
      await expect(shell.mobileMenuToggle).toHaveAttribute("aria-expanded", "true");
      await expect(shell.registerLink).toBeVisible();

      // Logo di luar panel menu: klik padanya pindah rute tanpa melewati handler klik panel.
      await page.getByRole("banner").getByRole("link", { name: "TestPulse" }).click();
      await expect(page).not.toHaveURL(/\/login$/);
      await expect(shell.mobileMenuToggle).toHaveAttribute("aria-expanded", "false");
      await expect(shell.registerLink).toBeHidden();

      await shell.mobileMenuToggle.click();
      await expect(shell.mobileMenuToggle).toHaveAttribute("aria-expanded", "true");
      await page.goBack();
      await expect(page).toHaveURL(/\/login$/);
      await expect(shell.mobileMenuToggle).toHaveAttribute("aria-expanded", "false");
    });

    test("pemilih tema bekerja dengan keyboard di viewport mobile", async ({ page }) => {
      const login = new LoginPage(page);
      const shell = new AppShell(page);
      await page.emulateMedia({ colorScheme: "light" });
      await login.goto();

      await tabTo(page, "theme-toggle");
      await page.keyboard.press("Enter");
      await expect(shell.themeOption("light")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(shell.themeOption("light")).toHaveCount(0);
      await expect(shell.themeToggle).toBeFocused();
    });

    // Review Focus 3: nama terpanjang (80 karakter, tanpa spasi) tidak boleh menimbulkan scroll horizontal.
    test("nama user 80 karakter tidak menimbulkan scroll horizontal; menu berisi navigasi dan logout", async ({
      signedInPage,
      api,
    }) => {
      const user = await api.register({ name: "W".repeat(80) });
      const { page } = await signedInPage(user);
      const shell = new AppShell(page);

      await page.goto("/");
      await expect(shell.mobileMenuToggle).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await shell.mobileMenuToggle.click();
      await expect(page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Project saya" })).toBeVisible();
      await expect(shell.currentUser).toBeVisible();
      await expect(shell.logoutButton).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await shell.logout();
      await expect(page).toHaveURL(/\/login$/);
    });
  });

  test("desktop: tombol menu mobile tersembunyi dan navigasi langsung terlihat", async ({ page }) => {
    const login = new LoginPage(page);
    const shell = new AppShell(page);
    await login.goto();

    await expect(shell.mobileMenuToggle).toBeHidden();
    await shell.expectAnonymous();
    // Landmark navigasi tidak boleh kosong: untuk pengunjung anonim ia berisi tautan Masuk dan Daftar.
    const nav = page.getByRole("banner").getByRole("navigation", { name: "Navigasi utama" });
    await expect(nav.getByRole("link", { name: "Masuk" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Daftar" })).toBeVisible();
  });
});
