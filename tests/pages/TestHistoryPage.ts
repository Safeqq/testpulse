import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug/tests/:testCaseId`: riwayat hasil satu test (kotak status per run, terlama ke terbaru). */
export class TestHistoryPage {
  readonly title: Locator;
  readonly history: Locator;
  readonly branch: Locator;
  readonly cells: Locator;
  readonly testNotFound: Locator;
  readonly notFound: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByTestId("test-title");
    this.history = page.getByTestId("test-history");
    this.branch = page.getByTestId("test-branch");
    this.cells = this.history.locator('[data-testid^="history-cell-"]');
    this.testNotFound = page.getByTestId("test-not-found");
    this.notFound = page.getByTestId("project-not-found");
  }

  cell(runId: string): Locator {
    return this.history.getByTestId(`history-cell-${runId}`);
  }

  async goto(slug: string, testCaseId: string, branch?: string): Promise<void> {
    await this.page.goto(
      branch ? `/p/${slug}/tests/${testCaseId}?branch=${encodeURIComponent(branch)}` : `/p/${slug}/tests/${testCaseId}`,
    );
    await expect(this.history.or(this.testNotFound).or(this.notFound)).toBeVisible();
  }
}
