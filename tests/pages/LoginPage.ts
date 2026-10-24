import { expect, type Locator, type Page } from "@playwright/test";

export class LoginPage {
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly formError: Locator;

  constructor(private readonly page: Page) {
    this.email = page.getByTestId("login-email");
    this.password = page.getByTestId("login-password");
    this.submit = page.getByTestId("login-submit");
    this.formError = page.getByTestId("form-error");
  }

  async goto(next?: string): Promise<void> {
    await this.page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
    await expect(this.submit).toBeVisible();
  }

  fieldError(field: "email" | "password"): Locator {
    return this.page.getByTestId(`field-error-${field}`);
  }

  async fill(email: string, password: string): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
  }

  async login(email: string, password: string): Promise<void> {
    await this.fill(email, password);
    await this.submit.click();
  }
}
