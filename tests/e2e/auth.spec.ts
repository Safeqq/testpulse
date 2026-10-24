import { LoginPage } from "../pages/LoginPage.js";
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

  test("/login dan /register lolos pemeriksaan aksesibilitas", async ({ page, expectNoA11yViolations }) => {
    await new LoginPage(page).goto();
    await expectNoA11yViolations(page);

    await new RegisterPage(page).goto();
    await expectNoA11yViolations(page);
  });

  test("user yang sudah masuk (signedInPage) langsung melihat namanya", async ({ signedInPage }) => {
    const { page, user } = await signedInPage();
    await page.goto("/");
    await new AppShell(page).expectSignedInAs(user.user.name);
  });
});
