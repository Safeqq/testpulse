import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug/manual-runs/:number`: header run, aksi selesaikan/buka ulang/rename/hapus, filter, dan case per suite. */
export class ManualRunPage {
  readonly header: Locator;
  readonly title: Locator;
  readonly code: Locator;
  readonly status: Locator;
  readonly progress: Locator;
  readonly start: Locator;
  readonly complete: Locator;
  readonly completeQuestion: Locator;
  readonly completeConfirm: Locator;
  readonly completeCancel: Locator;
  readonly reopen: Locator;
  readonly completedNote: Locator;
  readonly rename: Locator;
  readonly renameInput: Locator;
  readonly renameSave: Locator;
  readonly renameCancel: Locator;
  readonly del: Locator;
  readonly deleteConfirm: Locator;
  readonly deleteCancel: Locator;
  readonly conflict: Locator;
  readonly conflictReload: Locator;
  readonly actionError: Locator;
  readonly statusFilter: Locator;
  readonly assigneeFilter: Locator;
  readonly suiteFilter: Locator;
  readonly list: Locator;
  readonly rows: Locator;
  readonly groups: Locator;
  readonly empty: Locator;
  readonly reset: Locator;
  readonly loadMore: Locator;
  readonly notFound: Locator;
  readonly projectNotFound: Locator;

  constructor(private readonly page: Page) {
    this.header = page.getByTestId("run-header");
    this.title = page.getByTestId("run-title");
    this.code = page.getByTestId("run-code");
    this.status = page.getByTestId("run-status");
    this.progress = this.header.getByTestId("run-progress");
    this.start = page.getByTestId("run-start");
    this.complete = page.getByTestId("run-complete");
    this.completeQuestion = page.getByTestId("run-complete-question");
    this.completeConfirm = page.getByTestId("run-complete-confirm");
    this.completeCancel = page.getByTestId("run-complete-cancel");
    this.reopen = page.getByTestId("run-reopen");
    this.completedNote = page.getByTestId("run-completed-note");
    this.rename = page.getByTestId("run-rename");
    this.renameInput = page.getByTestId("run-name-input");
    this.renameSave = page.getByTestId("run-name-save");
    this.renameCancel = page.getByTestId("run-name-cancel");
    this.del = page.getByTestId("run-delete");
    this.deleteConfirm = page.getByTestId("run-delete-confirm");
    this.deleteCancel = page.getByTestId("run-delete-cancel");
    this.conflict = page.getByTestId("run-conflict");
    this.conflictReload = page.getByTestId("run-conflict-reload");
    this.actionError = page.getByTestId("run-action-error");
    this.statusFilter = page.getByTestId("run-filter-status");
    this.assigneeFilter = page.getByTestId("run-filter-assignee");
    this.suiteFilter = page.getByTestId("run-filter-suite");
    this.list = page.getByTestId("run-case-list");
    this.rows = this.list.locator('[data-testid^="run-case-row-"]');
    this.groups = this.list.getByRole("group");
    this.empty = page.getByTestId("run-cases-empty");
    this.reset = page.getByTestId("run-cases-filter-reset");
    this.loadMore = page.getByTestId("run-cases-load-more");
    this.notFound = page.getByTestId("manual-run-not-found");
    this.projectNotFound = page.getByTestId("project-not-found");
  }

  row(id: string): Locator {
    return this.page.getByTestId(`run-case-row-${id}`);
  }

  async goto(slug: string, number: number, query = ""): Promise<void> {
    await this.page.goto(`/p/${slug}/manual-runs/${number}${query}`);
    await this.waitForLoaded();
  }

  /** Header run dan daftar case (atau keadaan kosongnya) sudah tampil. */
  async waitForLoaded(): Promise<void> {
    await expect(this.notFound.or(this.projectNotFound).or(this.list).or(this.empty)).toBeVisible();
  }
}
