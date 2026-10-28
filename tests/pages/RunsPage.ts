import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug/runs`: daftar run dengan filter branch dan tombol "Muat lebih banyak". */
export class RunsPage {
  readonly title: Locator;
  readonly branchFilter: Locator;
  readonly list: Locator;
  readonly items: Locator;
  readonly loadMore: Locator;
  readonly empty: Locator;
  readonly notFound: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByRole("heading", { level: 1, name: "Daftar run" });
    this.branchFilter = page.getByTestId("runs-branch");
    this.list = page.getByTestId("runs-list");
    this.items = this.list.locator('[data-testid^="run-item-"]');
    this.loadMore = page.getByTestId("runs-load-more");
    this.empty = page.getByTestId("runs-empty");
    this.notFound = page.getByTestId("project-not-found");
  }

  item(runId: string): Locator {
    return this.list.getByTestId(`run-item-${runId}`);
  }

  async goto(slug: string, branch?: string): Promise<void> {
    await this.page.goto(branch ? `/p/${slug}/runs?branch=${encodeURIComponent(branch)}` : `/p/${slug}/runs`);
    await expect(this.list.or(this.empty).or(this.notFound)).toBeVisible();
  }
}
