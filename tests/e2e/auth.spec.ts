import type { Page } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage.js";
import { NewProjectPage } from "../pages/NewProjectPage.js";
import { RegisterPage } from "../pages/RegisterPage.js";
import { AppShell } from "../pages/AppShell.js";
import { newUserData } from "../support/data.js";
import { expect, test } from "../support/fixtures.js";

test.describe("Autentikasi", () => {
  test("daftar akun baru mengarahkan ke beranda dan menampilkan nama user", async ({ page }) => {
    const data = newUserData();
    const register = new RegisterPage(page);
    const shell = new AppShell(page);

    await register.goto();
    await register.register(data);

    await expect(page).toHaveURL(/\/$/);
    await shell.expectSignedInAs(data.name);
  });

  test("logout menampilkan tombol masuk; login kembali dengan email huruf besar berhasil", async ({ page, api }) => {
    const { user, password } = await api.register();
    const login = new LoginPage(page);
    const shell = new AppShell(page);

    await login.goto();
    await login.login(user.email, password);
    await shell.expectSignedInAs(user.name);

    await shell.logout();
    await shell.expectAnonymous();

    await login.goto();
    await login.login(user.email.toUpperCase(), password);
    await expect(page).toHaveURL(/\/$/);
    await shell.expectSignedInAs(user.name);
  });

  test("password salah menampilkan error umum", async ({ page, api }) => {
    const { user } = await api.register();
    const login = new LoginPage(page);

    await login.goto();
    await login.login(user.email, "password-yang-salah");

    await expect(login.formError).toHaveText("Email atau password salah");
    await expect(login.formError).toHaveAttribute("role", "alert");
    await expect(page).toHaveURL(/\/login/);
  });

  test("password 7 karakter ditolak di sisi klien tanpa request ke server", async ({ page }) => {
    const register = new RegisterPage(page);
    const registerRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/auth/register")) registerRequests.push(req.url());
    });

    await register.goto();
    await register.register({ ...newUserData(), password: "1234567" });

    await expect(register.fieldError("password")).toHaveText("Password minimal 8 karakter");
    expect(registerRequests).toEqual([]);
  });

  test("email yang sudah terdaftar dipetakan ke error umum", async ({ page, api }) => {
    const { user } = await api.register();
    const register = new RegisterPage(page);

    await register.goto();
    await register.register({ ...newUserData(), email: user.email });

    await expect(register.formError).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });

  test("next yang valid diikuti setelah masuk", async ({ page, api }) => {
    const { user, password } = await api.register();
    const login = new LoginPage(page);

    await login.goto("/projects/new");
    await login.login(user.email, password);

    await expect(page).toHaveURL(/\/projects\/new$/);
  });

  test("next yang mengarah ke luar situs diabaikan", async ({ page, api, baseURL }) => {
    const { user, password } = await api.register();
    const login = new LoginPage(page);

    await login.goto("//evil.example/phish");
    await login.login(user.email, password);

    await expect(page).toHaveURL(`${baseURL}/`);
  });

  test("/login dan /register lolos pemeriksaan aksesibilitas", async ({ page, expectNoA11yViolationsInBothThemes }) => {
    await new LoginPage(page).goto();
    await expectNoA11yViolationsInBothThemes(page);

    await new RegisterPage(page).goto();
    await expectNoA11yViolationsInBothThemes(page);
  });

  test.describe("/auth/me gagal sementara (bukan 401)", () => {
    const unavailable = { error: { code: "INTERNAL_ERROR", message: "Layanan sedang tidak tersedia" } };

    /**
     * Menjawab 503 untuk /auth/me selama `outage.active`, lalu meneruskan ke API sungguhan. Berbasis keadaan, bukan
     * hitungan panggilan: dev server (React StrictMode) memanggil /auth/me dua kali saat halaman dibuka.
     */
    async function simulateMeOutage(page: Page): Promise<{ active: boolean; calls: number }> {
      const outage = { active: true, calls: 0 };
      await page.route("**/api/v1/auth/me", async (route) => {
        outage.calls += 1;
        if (outage.active) {
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify(unavailable) });
        } else {
          await route.continue();
        }
      });
      return outage;
    }

    test("halaman terlindungi: tidak diarahkan ke /login, ada coba lagi, lalu pulih", async ({ signedInPage }) => {
      const { page, user } = await signedInPage();
      const shell = new AppShell(page);
      const outage = await simulateMeOutage(page);

      await page.goto("/projects/new");

      await expect(shell.sessionError).toBeVisible();
      await expect(shell.sessionRetry).toBeVisible();
      await expect(page.getByTestId("auth-pending")).toBeVisible();
      await expect(page).toHaveURL(/\/projects\/new$/);
      await expect(shell.loginLink).toHaveCount(0);

      outage.active = false;
      await shell.sessionRetry.click();

      await shell.expectSignedInAs(user.user.name);
      await expect(shell.sessionError).toHaveCount(0);
      await expect(new NewProjectPage(page).submit).toBeVisible();
      await expect(page).toHaveURL(/\/projects\/new$/);
    });

    test("gagal lagi saat dicoba ulang: banner tetap, tetap tidak ke /login", async ({ signedInPage }) => {
      const { page, user } = await signedInPage();
      const shell = new AppShell(page);
      const outage = await simulateMeOutage(page);

      await page.goto("/");
      await expect(shell.sessionError).toBeVisible();

      const callsBeforeRetry = outage.calls;
      await shell.sessionRetry.click();
      await expect.poll(() => outage.calls).toBeGreaterThan(callsBeforeRetry);
      await expect(shell.sessionError).toBeVisible();
      await expect(page).toHaveURL(/\/$/);

      outage.active = false;
      await shell.sessionRetry.click();
      await shell.expectSignedInAs(user.user.name);
    });

    test("user yang benar-benar anonim (401) tetap diarahkan ke /login tanpa banner", async ({ page }) => {
      await page.goto("/projects/new");
      await expect(page).toHaveURL(/\/login\?next=%2Fprojects%2Fnew$/);
      await expect(new AppShell(page).sessionError).toHaveCount(0);
    });
  });

  test("user yang sudah masuk (signedInPage) langsung melihat namanya", async ({ signedInPage }) => {
    const { page, user } = await signedInPage();
    await page.goto("/");
    await new AppShell(page).expectSignedInAs(user.user.name);
  });
});
