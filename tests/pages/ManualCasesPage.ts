import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug/cases`: sidebar suite (desktop) atau `suite-select` (HP), meter cakupan, filter, dan daftar case. */
export class ManualCasesPage {
  readonly title: Locator;
  readonly subTabs: Locator;
  readonly casesSubTab: Locator;
  readonly runsSubTab: Locator;
  readonly suiteList: Locator;
  readonly suiteSelect: Locator;
  readonly suiteAddInput: Locator;
  readonly suiteAddSubmit: Locator;
  readonly suiteError: Locator;
  readonly coverage: Locator;
  readonly list: Locator;
  readonly rows: Locator;
  readonly create: Locator;
  readonly loadMore: Locator;
  readonly empty: Locator;
  readonly priority: Locator;
  readonly label: Locator;
  readonly automated: Locator;
  readonly archived: Locator;
  readonly search: Locator;
  readonly searchSubmit: Locator;
  readonly reset: Locator;
  readonly notFound: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByRole("heading", { level: 1, name: "Test manual" });
    this.subTabs = page.getByTestId("manual-subtabs");
    this.casesSubTab = page.getByTestId("manual-subtab-cases");
    this.runsSubTab = page.getByTestId("manual-subtab-runs");
    this.suiteList = page.getByTestId("suite-list");
    this.suiteSelect = page.getByTestId("suite-select");
    this.suiteAddInput = page.getByTestId("suite-add");
    this.suiteAddSubmit = page.getByTestId("suite-add-submit");
    this.suiteError = page.getByTestId("suite-error");
    this.coverage = page.getByTestId("coverage-meter");
    this.list = page.getByTestId("cases-list");
    this.rows = this.list.locator('[data-testid^="case-row-"]');
    this.create = page.getByTestId("case-create");
    this.loadMore = page.getByTestId("cases-load-more");
    this.empty = page.getByTestId("cases-empty");
    this.priority = page.getByTestId("cases-filter-priority");
    this.label = page.getByTestId("cases-filter-label");
    this.automated = page.getByTestId("cases-filter-automated");
    this.archived = page.getByTestId("cases-filter-archived");
    this.search = page.getByTestId("cases-search");
    this.searchSubmit = page.getByTestId("cases-search-submit");
    this.reset = page.getByTestId("cases-filter-reset");
    this.notFound = page.getByTestId("project-not-found");
  }

  row(number: number): Locator {
    return this.page.getByTestId(`case-row-${number}`);
  }

  /** Tombol pemilih suite di sidebar ("all" = Semua suite). */
  suite(id: string): Locator {
    return this.page.getByTestId(id === "all" ? "suite-all" : `suite-${id}`);
  }

  /** Satu entri suite di sidebar beserta kontrol kelolanya. */
  suiteItem(id: string): Locator {
    return this.page.getByTestId(`suite-item-${id}`);
  }

  suiteAction(action: "rename" | "up" | "down" | "delete", id: string): Locator {
    return this.page.getByTestId(`suite-${action}-${id}`);
  }

  async goto(slug: string, query = ""): Promise<void> {
    await this.page.goto(`/p/${slug}/cases${query}`);
    await this.waitForLoaded();
  }

  /** Daftar case (atau keadaan kosongnya) dan daftar suite sudah tampil. */
  async waitForLoaded(): Promise<void> {
    await expect(this.list.or(this.empty).or(this.notFound)).toBeVisible();
  }
}
