import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug/manual-runs/new`: nama, versi, pilihan suite, pencarian case satuan, dan ringkasan seleksi. */
export class ManualRunNewPage {
  readonly heading: Locator;
  readonly form: Locator;
  readonly name: Locator;
  readonly nameError: Locator;
  readonly version: Locator;
  readonly versionOptions: Locator;
  readonly search: Locator;
  readonly searchSubmit: Locator;
  readonly searchStatus: Locator;
  readonly summary: Locator;
  readonly submit: Locator;
  readonly formError: Locator;
  readonly selectionError: Locator;
  readonly noSuites: Locator;
  readonly forbidden: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole("heading", { level: 1, name: "Buat run manual" });
    this.form = page.getByTestId("manual-run-form");
    this.name = page.getByTestId("run-name");
    this.nameError = page.getByTestId("field-error-name");
    this.version = page.getByTestId("run-version");
    this.versionOptions = page.locator("datalist#run-version-options option");
    this.search = page.getByTestId("run-case-search");
    this.searchSubmit = page.getByTestId("run-case-search-submit");
    this.searchStatus = page.getByTestId("run-case-search-status");
    this.summary = page.getByTestId("run-selection-summary");
    this.submit = page.getByTestId("run-submit");
    this.formError = page.getByTestId("form-error");
    this.selectionError = page.getByTestId("field-error-selection");
    this.noSuites = page.getByTestId("run-no-suites");
    this.forbidden = page.getByTestId("manual-run-new-forbidden");
  }

  suite(id: string): Locator {
    return this.page.getByTestId(`run-suite-${id}`);
  }

  option(number: number): Locator {
    return this.page.getByTestId(`run-case-option-${number}`);
  }

  picked(number: number): Locator {
    return this.page.getByTestId(`run-picked-${number}`);
  }

  unpick(number: number): Locator {
    return this.page.getByTestId(`run-unpick-${number}`);
  }

  async goto(slug: string): Promise<void> {
    await this.page.goto(`/p/${slug}/manual-runs/new`);
    await this.waitForLoaded();
  }

  async waitForLoaded(): Promise<void> {
    await expect(this.form.or(this.forbidden).or(this.noSuites).or(this.page.getByTestId("project-not-found"))).toBeVisible();
  }

  /** Mencari case lewat kolom cari (hasilnya dimuat tak lama kemudian). */
  async searchCases(query: string): Promise<void> {
    await this.search.fill(query);
    await this.searchSubmit.click();
  }
}
