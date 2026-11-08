import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug/cases/new` dan `/p/:slug/cases/:number/edit`: formulir case dengan editor langkah dan tautan otomasi. */
export class ManualCaseFormPage {
  readonly form: Locator;
  readonly heading: Locator;
  readonly suite: Locator;
  readonly title: Locator;
  readonly titleError: Locator;
  readonly preconditions: Locator;
  readonly preconditionsPreviewTab: Locator;
  readonly preconditionsWriteTab: Locator;
  readonly preconditionsPreview: Locator;
  readonly priority: Locator;
  readonly labelInput: Locator;
  readonly labelAdd: Locator;
  readonly stepsError: Locator;
  readonly addStep: Locator;
  readonly automationSearch: Locator;
  readonly automationStatus: Locator;
  readonly automationSelected: Locator;
  readonly automationUnlink: Locator;
  readonly submit: Locator;
  readonly conflict: Locator;
  readonly conflictReload: Locator;
  readonly formError: Locator;
  readonly forbidden: Locator;
  readonly noSuite: Locator;
  readonly notFound: Locator;
  readonly projectNotFound: Locator;

  constructor(private readonly page: Page) {
    this.form = page.getByTestId("case-form");
    this.heading = page.getByRole("heading", { level: 1 });
    this.suite = page.getByTestId("case-suite");
    this.title = page.getByTestId("case-title");
    this.titleError = page.getByTestId("field-error-title");
    this.preconditions = page.getByTestId("case-preconditions");
    this.preconditionsPreviewTab = page.getByTestId("case-preconditions-tab-preview");
    this.preconditionsWriteTab = page.getByTestId("case-preconditions-tab-write");
    this.preconditionsPreview = page.getByTestId("case-preconditions-preview");
    this.priority = page.getByTestId("case-priority");
    this.labelInput = page.getByTestId("case-labels");
    this.labelAdd = page.getByTestId("case-label-add");
    this.stepsError = page.getByTestId("field-error-steps");
    this.addStep = page.getByTestId("step-add");
    this.automationSearch = page.getByTestId("automation-search");
    this.automationStatus = page.getByTestId("automation-status");
    this.automationSelected = page.getByTestId("automation-selected");
    this.automationUnlink = page.getByTestId("automation-unlink");
    this.submit = page.getByTestId("case-submit");
    this.conflict = page.getByTestId("case-conflict");
    this.conflictReload = page.getByTestId("case-conflict-reload");
    this.formError = page.getByTestId("form-error");
    this.forbidden = page.getByTestId("case-form-forbidden");
    this.noSuite = page.getByTestId("case-form-no-suite");
    this.notFound = page.getByTestId("case-not-found");
    this.projectNotFound = page.getByTestId("project-not-found");
  }

  /** Kolom Aksi langkah ke-`index` (mulai 0). */
  action(index: number): Locator {
    return this.page.getByTestId(`step-${index}-action`);
  }

  expected(index: number): Locator {
    return this.page.getByTestId(`step-${index}-expected`);
  }

  step(index: number): Locator {
    return this.page.getByTestId(`step-${index}`);
  }

  /** Semua langkah di editor. */
  get steps(): Locator {
    return this.page.getByTestId("case-steps").locator('> ol > li[data-testid^="step-"]');
  }

  stepAction(index: number, action: "up" | "down" | "remove"): Locator {
    return this.page.getByTestId(`step-${index}-${action}`);
  }

  previewTab(index: number, field: "action" | "expected"): Locator {
    return this.page.getByTestId(`step-${index}-${field}-tab-preview`);
  }

  writeTab(index: number, field: "action" | "expected"): Locator {
    return this.page.getByTestId(`step-${index}-${field}-tab-write`);
  }

  preview(index: number, field: "action" | "expected"): Locator {
    return this.page.getByTestId(`step-${index}-${field}-preview`);
  }

  actionError(index: number): Locator {
    return this.page.getByTestId(`field-error-steps.${index}.action`);
  }

  automationOption(id: string): Locator {
    return this.page.getByTestId(`automation-option-${id}`);
  }

  async gotoNew(slug: string, query = ""): Promise<void> {
    await this.page.goto(`/p/${slug}/cases/new${query}`);
    await this.waitForLoaded();
  }

  async gotoEdit(slug: string, number: number): Promise<void> {
    await this.page.goto(`/p/${slug}/cases/${number}/edit`);
    await this.waitForLoaded();
  }

  /** Formulir (atau keadaan penggantinya) sudah tampil. */
  async waitForLoaded(): Promise<void> {
    await expect(
      this.form.or(this.forbidden).or(this.noSuite).or(this.notFound).or(this.projectNotFound),
    ).toBeVisible();
  }
}
