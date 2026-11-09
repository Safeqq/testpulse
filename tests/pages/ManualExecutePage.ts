import { expect, type Locator, type Page } from "@playwright/test";

type StepStatusLabel = "Lulus" | "Gagal" | "Diblokir" | "Dilewati";
type CaseStatusLabel = StepStatusLabel | "Belum dites";

/** `/p/:slug/manual-runs/:number/cases/:id`: eksekusi satu case (hasil per langkah, saran, catatan, simpan & lanjut). */
export class ManualExecutePage {
  readonly title: Locator;
  readonly runLink: Locator;
  readonly caseLink: Locator;
  readonly suite: Locator;
  readonly preconditions: Locator;
  readonly caseDeleted: Locator;
  readonly status: Locator;
  readonly suggestion: Locator;
  readonly useSuggestion: Locator;
  readonly note: Locator;
  readonly assignee: Locator;
  readonly assigneeText: Locator;
  readonly save: Locator;
  readonly saveNext: Locator;
  readonly saved: Locator;
  readonly reportBug: Locator;
  readonly bugs: Locator;
  readonly conflict: Locator;
  readonly conflictReload: Locator;
  readonly completed: Locator;
  readonly formError: Locator;
  readonly notFound: Locator;
  readonly projectNotFound: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByTestId("exec-title");
    this.runLink = page.getByTestId("exec-run-link");
    this.caseLink = page.getByTestId("exec-case-link");
    this.suite = page.getByTestId("exec-suite");
    this.preconditions = page.getByTestId("exec-preconditions");
    this.caseDeleted = page.getByTestId("exec-case-deleted");
    this.status = page.getByTestId("exec-status");
    this.suggestion = page.getByTestId("exec-suggestion");
    this.useSuggestion = page.getByTestId("exec-use-suggestion");
    this.note = page.getByTestId("exec-note");
    this.assignee = page.getByTestId("exec-assignee");
    this.assigneeText = page.getByTestId("exec-assignee-text");
    this.save = page.getByTestId("exec-save");
    this.saveNext = page.getByTestId("exec-save-next");
    this.saved = page.getByTestId("exec-saved");
    this.reportBug = page.getByTestId("exec-report-bug");
    this.bugs = page.getByTestId("exec-bugs");
    this.conflict = page.getByTestId("exec-conflict");
    this.conflictReload = page.getByTestId("exec-conflict-reload");
    this.completed = page.getByTestId("exec-completed");
    this.formError = page.getByTestId("form-error");
    this.notFound = page.getByTestId("exec-not-found");
    this.projectNotFound = page.getByTestId("project-not-found");
  }

  /** Kartu langkah ke-`index` (mulai 0). */
  step(index: number): Locator {
    return this.page.getByTestId(`exec-step-${index}`);
  }

  /** Radio hasil langkah ke-`index` (dalam fieldset "Langkah n"). */
  stepResult(index: number, label: StepStatusLabel): Locator {
    return this.step(index).getByRole("group", { name: `Langkah ${index + 1}` }).getByRole("radio", { name: label, exact: true });
  }

  stepNote(index: number): Locator {
    return this.page.getByTestId(`exec-step-${index}-note`);
  }

  /** Radio status case (dalam fieldset "Status case"). */
  caseStatus(label: CaseStatusLabel): Locator {
    return this.status.getByRole("radio", { name: label, exact: true });
  }

  async goto(slug: string, runNumber: number, id: string): Promise<void> {
    await this.page.goto(`/p/${slug}/manual-runs/${runNumber}/cases/${id}`);
    await this.waitForLoaded();
  }

  async waitForLoaded(): Promise<void> {
    await expect(this.title.or(this.notFound).or(this.projectNotFound)).toBeVisible();
  }
}
