import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug`: ringkasan project (publik hanya-baca atau anggota). */
export class ProjectPage {
  readonly title: Locator;
  readonly publicBadge: Locator;
  readonly notFound: Locator;
  readonly emptyResults: Locator;
  readonly settingsLink: Locator;
  readonly loginButton: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByTestId("project-title");
    this.publicBadge = page.getByTestId("public-badge");
    this.notFound = page.getByTestId("project-not-found");
    this.emptyResults = page.getByTestId("empty-results");
    this.settingsLink = page.getByTestId("settings-link");
    this.loginButton = page.getByTestId("project-login");
  }

  async goto(slug: string): Promise<void> {
    await this.page.goto(`/p/${slug}`);
    await expect(this.title.or(this.notFound)).toBeVisible();
  }
}
