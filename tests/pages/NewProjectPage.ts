import { expect, type Locator, type Page } from "@playwright/test";

/** `/projects/new`: form nama + slug dengan pratinjau slug otomatis. */
export class NewProjectPage {
  readonly name: Locator;
  readonly slug: Locator;
  readonly slugPreview: Locator;
  readonly submit: Locator;
  readonly formError: Locator;

  constructor(private readonly page: Page) {
    this.name = page.getByTestId("project-name");
    this.slug = page.getByTestId("project-slug");
    this.slugPreview = page.getByTestId("slug-preview");
    this.submit = page.getByTestId("create-project-submit");
    this.formError = page.getByTestId("form-error");
  }

  async goto(): Promise<void> {
    await this.page.goto("/projects/new");
    await expect(this.submit).toBeVisible();
  }

  fieldError(field: "name" | "slug"): Locator {
    return this.page.getByTestId(`field-error-${field}`);
  }

  /** Mengetik per karakter (menambah ke isi yang ada) agar pratinjau slug diuji saat pengguna mengetik. */
  async typeName(name: string): Promise<void> {
    await this.name.click();
    await this.name.pressSequentially(name);
  }

  async create(data: { name: string; slug?: string }): Promise<void> {
    await this.name.fill(data.name);
    if (data.slug !== undefined) await this.slug.fill(data.slug);
    await this.submit.click();
  }
}
