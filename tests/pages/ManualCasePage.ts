import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug/cases/:number`: detail case (prasyarat, langkah, kartu otomasi, riwayat eksekusi) dengan edit, arsip, dan hapus. */
export class ManualCasePage {
  readonly title: Locator;
  readonly meta: Locator;
  readonly archivedNote: Locator;
  readonly suite: Locator;
  readonly priority: Locator;
  readonly labels: Locator;
  readonly preconditions: Locator;
  readonly steps: Locator;
  readonly automation: Locator;
  readonly automationTest: Locator;
  readonly automationStatus: Locator;
  readonly history: Locator;
  readonly edit: Locator;
  readonly archive: Locator;
  readonly remove: Locator;
  readonly removeConfirm: Locator;
  readonly removeCancel: Locator;
  readonly conflict: Locator;
  readonly conflictReload: Locator;
  readonly notFound: Locator;
  readonly projectNotFound: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByTestId("case-title");
    this.meta = page.getByTestId("case-meta");
    this.archivedNote = page.getByTestId("case-archived");
    this.suite = page.getByTestId("case-suite");
    this.priority = page.getByTestId("case-priority");
    this.labels = page.getByTestId("case-labels");
    this.preconditions = page.getByTestId("case-preconditions");
    this.steps = page.getByTestId("case-steps").locator('> li[data-testid^="case-step-"]');
    this.automation = page.getByTestId("case-automation");
    this.automationTest = page.getByTestId("case-automation-test");
    this.automationStatus = page.getByTestId("case-automation-status");
    this.history = page.getByTestId("case-history");
    this.edit = page.getByTestId("case-edit");
    this.archive = page.getByTestId("case-archive");
    this.remove = page.getByTestId("case-delete");
    this.removeConfirm = page.getByTestId("case-delete-confirm");
    this.removeCancel = page.getByTestId("case-delete-cancel");
    this.conflict = page.getByTestId("case-conflict");
    this.conflictReload = page.getByTestId("case-conflict-reload");
    this.notFound = page.getByTestId("case-not-found");
    this.projectNotFound = page.getByTestId("project-not-found");
  }

  step(index: number): Locator {
    return this.page.getByTestId(`case-step-${index}`);
  }

  historyRow(runNumber: number): Locator {
    return this.page.getByTestId(`case-history-row-${runNumber}`);
  }

  async goto(slug: string, number: number): Promise<void> {
    await this.page.goto(`/p/${slug}/cases/${number}`);
    await this.waitForLoaded();
  }

  /** Judul case (atau keadaan penggantinya) sudah tampil. */
  async waitForLoaded(): Promise<void> {
    await expect(this.title.or(this.notFound).or(this.projectNotFound)).toBeVisible();
  }
}
