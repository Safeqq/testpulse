import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug/manual-runs`: daftar run manual dengan filter status/versi di URL dan "Muat lagi". */
export class ManualRunsPage {
  readonly title: Locator;
  readonly subTabs: Locator;
  readonly list: Locator;
  readonly rows: Locator;
  readonly create: Locator;
  readonly loadMore: Locator;
  readonly empty: Locator;
  readonly status: Locator;
  readonly version: Locator;
  readonly versionSubmit: Locator;
  readonly reset: Locator;
  readonly notFound: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByRole("heading", { level: 1, name: "Run manual" });
    this.subTabs = page.getByTestId("manual-subtabs");
    this.list = page.getByTestId("manual-runs-list");
    this.rows = this.list.locator('[data-testid^="manual-run-row-"]');
    this.create = page.getByTestId("manual-run-create");
    this.loadMore = page.getByTestId("manual-runs-load-more");
    this.empty = page.getByTestId("manual-runs-empty");
    this.status = page.getByTestId("manual-runs-filter-status");
    this.version = page.getByTestId("manual-runs-filter-version");
    this.versionSubmit = page.getByTestId("manual-runs-filter-version-submit");
    this.reset = page.getByTestId("manual-runs-filter-reset");
    this.notFound = page.getByTestId("project-not-found");
  }

  row(number: number): Locator {
    return this.page.getByTestId(`manual-run-row-${number}`);
  }

  async goto(slug: string, query = ""): Promise<void> {
    await this.page.goto(`/p/${slug}/manual-runs${query}`);
    await this.waitForLoaded();
  }

  /** Daftar run (atau keadaan kosongnya) sudah tampil. */
  async waitForLoaded(): Promise<void> {
    await expect(this.list.or(this.empty).or(this.notFound)).toBeVisible();
  }
}
