import { expect, type Locator, type Page } from "@playwright/test";

export class RegisterPage {
  readonly name: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly formError: Locator;

  constructor(private readonly page: Page) {
    this.name = page.getByTestId("register-name");
    this.email = page.getByTestId("register-email");
    this.password = page.getByTestId("register-password");
    this.submit = page.getByTestId("register-submit");
    this.formError = page.getByTestId("form-error");
  }

  async goto(): Promise<void> {
    await this.page.goto("/register");
    await expect(this.submit).toBeVisible();
  }

  fieldError(field: "name" | "email" | "password"): Locator {
    return this.page.getByTestId(`field-error-${field}`);
  }

  async fill(data: { name: string; email: string; password: string }): Promise<void> {
    await this.name.fill(data.name);
    await this.email.fill(data.email);
    await this.password.fill(data.password);
  }

  async register(data: { name: string; email: string; password: string }): Promise<void> {
    await this.fill(data);
    await this.submit.click();
  }
}
