import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug/flaky`: test flaky terurut menurut skor, dengan bar skor dan tautan ke riwayat. */
export class FlakyPage {
  readonly branchFilter: Locator;
  readonly list: Locator;
  readonly items: Locator;
  readonly empty: Locator;
  readonly notFound: Locator;

  constructor(private readonly page: Page) {
    this.branchFilter = page.getByTestId("flaky-branch");
    this.list = page.getByTestId("flaky-list");
    this.items = this.list.locator('[data-testid^="flaky-item-"]');
    this.empty = page.getByTestId("flaky-empty");
    this.notFound = page.getByTestId("project-not-found");
  }

  async goto(slug: string, branch?: string): Promise<void> {
    await this.page.goto(branch ? `/p/${slug}/flaky?branch=${encodeURIComponent(branch)}` : `/p/${slug}/flaky`);
    await expect(this.list.or(this.empty).or(this.notFound)).toBeVisible();
  }
}
