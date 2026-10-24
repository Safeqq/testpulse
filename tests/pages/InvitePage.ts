import { expect, type Locator, type Page } from "@playwright/test";

/** `/invite/:token`: pratinjau undangan (terbuka tanpa login) dan tombol terima. */
export class InvitePage {
  readonly preview: Locator;
  readonly accept: Locator;
  readonly error: Locator;
  readonly formError: Locator;

  constructor(private readonly page: Page) {
    this.preview = page.getByTestId("invite-preview");
    this.accept = page.getByTestId("invite-accept");
    this.error = page.getByTestId("invite-error");
    this.formError = page.getByTestId("form-error");
  }

  /** `urlOrPath` boleh URL penuh dari `invite-url`; yang dipakai hanya path-nya agar tetap di origin test. */
  async goto(urlOrPath: string): Promise<void> {
    const { pathname } = new URL(urlOrPath, "http://placeholder.invalid");
    await this.page.goto(pathname);
    await expect(this.preview.or(this.error)).toBeVisible();
  }
}
