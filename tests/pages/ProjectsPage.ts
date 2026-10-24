import { expect, type Locator, type Page } from "@playwright/test";

/** Beranda `/`: daftar project milik user yang masuk. */
export class ProjectsPage {
  readonly list: Locator;
  readonly empty: Locator;
  readonly newProject: Locator;

  constructor(private readonly page: Page) {
    this.list = page.getByTestId("project-list");
    this.empty = page.getByTestId("empty-projects");
    this.newProject = page.getByTestId("new-project");
  }

  async goto(): Promise<void> {
    await this.page.goto("/");
    await expect(this.newProject).toBeVisible();
  }

  item(slug: string): Locator {
    return this.page.getByTestId(`project-item-${slug}`);
  }
}
