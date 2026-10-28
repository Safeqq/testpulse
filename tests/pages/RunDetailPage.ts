import { expect, type Locator, type Page } from "@playwright/test";

export type RunFilter = "failed" | "flaky" | "all";

/** `/p/:slug/runs/:runId`: ringkasan run, filter hasil, daftar hasil test, dan hapus run dengan konfirmasi inline. */
export class RunDetailPage {
  readonly header: Locator;
  readonly ciLink: Locator;
  readonly commit: Locator;
  readonly back: Locator;
  readonly rows: Locator;
  readonly loadMore: Locator;
  readonly emptyResults: Locator;
  readonly runNotFound: Locator;
  readonly notFound: Locator;
  readonly deleteButton: Locator;
  readonly deleteConfirm: Locator;
  readonly deleteCancel: Locator;
  readonly deleteError: Locator;

  constructor(private readonly page: Page) {
    this.header = page.getByTestId("run-header");
    this.ciLink = this.header.getByRole("link", { name: /CI/ });
    this.back = page.getByTestId("run-back");
    this.commit = this.header.getByTestId("run-commit");
    this.rows = page.locator('[data-testid^="result-row-"]');
    this.loadMore = page.getByTestId("results-load-more");
    this.emptyResults = page.getByTestId("results-empty");
    this.runNotFound = page.getByTestId("run-not-found");
    this.notFound = page.getByTestId("project-not-found");
    this.deleteButton = page.getByTestId("run-delete");
    this.deleteConfirm = page.getByTestId("run-delete-confirm");
    this.deleteCancel = page.getByTestId("run-delete-cancel");
    this.deleteError = page.getByTestId("form-error");
  }

  filter(name: RunFilter): Locator {
    return this.page.getByTestId(`run-filter-${name}`);
  }

  row(testCaseId: string): Locator {
    return this.page.getByTestId(`result-row-${testCaseId}`);
  }

  async goto(slug: string, runId: string): Promise<void> {
    await this.page.goto(`/p/${slug}/runs/${runId}`);
    await expect(this.header.or(this.runNotFound).or(this.notFound)).toBeVisible();
  }
}
