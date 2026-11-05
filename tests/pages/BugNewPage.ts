import { expect, type Locator, type Page } from "@playwright/test";

/** `/p/:slug/bugs/new`: formulir bug baru (juga terisi otomatis dari test gagal lewat `?testCaseId=&runId=`). */
export class BugNewPage {
  readonly form: Locator;
  readonly title: Locator;
  readonly titleError: Locator;
  readonly description: Locator;
  readonly descriptionWrite: Locator;
  readonly descriptionPreviewTab: Locator;
  readonly descriptionPreview: Locator;
  readonly priority: Locator;
  readonly severity: Locator;
  readonly assignee: Locator;
  readonly labelInput: Locator;
  readonly labelAdd: Locator;
  readonly labelChips: Locator;
  readonly labelsError: Locator;
  readonly linkAdd: Locator;
  readonly submit: Locator;
  readonly origin: Locator;
  readonly forbidden: Locator;
  readonly notFound: Locator;

  constructor(private readonly page: Page) {
    this.form = page.getByTestId("bug-form");
    this.title = page.getByTestId("bug-title");
    this.titleError = page.getByTestId("field-error-title");
    this.description = page.getByTestId("bug-description");
    this.descriptionWrite = page.getByTestId("bug-description-tab-write");
    this.descriptionPreviewTab = page.getByTestId("bug-description-tab-preview");
    this.descriptionPreview = page.getByTestId("bug-description-preview");
    this.priority = page.getByTestId("bug-priority");
    this.severity = page.getByTestId("bug-severity");
    this.assignee = page.getByTestId("bug-assignee");
    this.labelInput = page.getByTestId("bug-labels");
    this.labelAdd = page.getByTestId("bug-label-add");
    this.labelChips = page.getByTestId("bug-label-list").locator("li");
    this.labelsError = page.getByTestId("field-error-labels");
    this.linkAdd = page.getByTestId("bug-link-add");
    this.submit = page.getByTestId("bug-submit");
    this.origin = page.getByTestId("bug-new-origin");
    this.forbidden = page.getByTestId("bug-new-forbidden");
    this.notFound = page.getByTestId("project-not-found");
  }

  label(name: string): Locator {
    return this.page.getByTestId(`bug-label-${name}`);
  }

  removeLabel(name: string): Locator {
    return this.page.getByTestId(`bug-label-remove-${name}`);
  }

  linkUrl(index: number): Locator {
    return this.page.getByTestId(`bug-link-url-${index}`);
  }

  linkTitle(index: number): Locator {
    return this.page.getByTestId(`bug-link-title-${index}`);
  }

  linkError(index: number): Locator {
    return this.page.getByTestId(`field-error-links.${index}.url`);
  }

  async goto(slug: string, query = ""): Promise<void> {
    await this.page.goto(`/p/${slug}/bugs/new${query}`);
    await expect(this.form.or(this.forbidden).or(this.notFound)).toBeVisible();
  }
}
