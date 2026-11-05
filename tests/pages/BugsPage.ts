import { expect, type Locator, type Page } from "@playwright/test";

export type BugStatusTab = "active" | "done" | "all";

/** `/p/:slug/bugs`: daftar bug dengan tab status, filter di URL, dan "Muat lagi". */
export class BugsPage {
  readonly title: Locator;
  readonly list: Locator;
  readonly rows: Locator;
  readonly create: Locator;
  readonly loadMore: Locator;
  readonly empty: Locator;
  readonly priority: Locator;
  readonly severity: Locator;
  readonly assignee: Locator;
  readonly label: Locator;
  readonly search: Locator;
  readonly searchSubmit: Locator;
  readonly reset: Locator;
  readonly notFound: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByRole("heading", { level: 1, name: "Bug" });
    this.list = page.getByTestId("bugs-list");
    this.rows = this.list.locator('[data-testid^="bug-row-"]');
    this.create = page.getByTestId("bug-create");
    this.loadMore = page.getByTestId("bugs-load-more");
    this.empty = page.getByTestId("bugs-empty");
    this.priority = page.getByTestId("bugs-filter-priority");
    this.severity = page.getByTestId("bugs-filter-severity");
    this.assignee = page.getByTestId("bugs-filter-assignee");
    this.label = page.getByTestId("bugs-filter-label");
    this.search = page.getByTestId("bugs-search");
    this.searchSubmit = page.getByTestId("bugs-search-submit");
    this.reset = page.getByTestId("bugs-filter-reset");
    this.notFound = page.getByTestId("project-not-found");
  }

  row(number: number): Locator {
    return this.page.getByTestId(`bug-row-${number}`);
  }

  statusTab(tab: BugStatusTab): Locator {
    return this.page.getByTestId(`bugs-filter-status-${tab}`);
  }

  async goto(slug: string, query = ""): Promise<void> {
    await this.page.goto(`/p/${slug}/bugs${query}`);
    await expect(this.list.or(this.empty).or(this.notFound)).toBeVisible();
  }
}
