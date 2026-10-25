import { expect, type Locator, type Page } from "@playwright/test";

/** Kerangka halaman: header dengan merek, navigasi, dan user saat ini. */
export class AppShell {
  readonly currentUser: Locator;
  readonly logoutButton: Locator;
  readonly loginLink: Locator;
  readonly registerLink: Locator;
  /** Banner "sesi belum dapat diperiksa" (status auth `error`) beserta tombol coba lagi. */
  readonly sessionError: Locator;
  readonly sessionRetry: Locator;

  constructor(private readonly page: Page) {
    this.currentUser = page.getByTestId("current-user");
    this.logoutButton = page.getByTestId("logout");
    this.loginLink = page.getByRole("banner").getByRole("link", { name: "Masuk" });
    this.registerLink = page.getByRole("banner").getByRole("link", { name: "Daftar" });
    this.sessionError = page.getByTestId("auth-error");
    this.sessionRetry = page.getByTestId("auth-retry");
  }

  async logout(): Promise<void> {
    await this.logoutButton.click();
  }

  async expectSignedInAs(name: string): Promise<void> {
    await expect(this.currentUser).toHaveText(name);
  }

  async expectAnonymous(): Promise<void> {
    await expect(this.loginLink).toBeVisible();
    await expect(this.registerLink).toBeVisible();
    await expect(this.currentUser).toHaveCount(0);
  }
}
