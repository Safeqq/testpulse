import { expect, type Locator, type Page } from "@playwright/test";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `/p/:slug/bugs/:number`: detail bug dengan transisi, edit inline, panel samping, kartu test asal, dan linimasa. */
export class BugPage {
  readonly title: Locator;
  readonly titleEdit: Locator;
  readonly titleInput: Locator;
  readonly titleSave: Locator;
  readonly titleCancel: Locator;
  readonly titleError: Locator;
  readonly status: Locator;
  readonly resolution: Locator;
  readonly resolutionConfirm: Locator;
  readonly resolutionCancel: Locator;
  readonly resolutionError: Locator;
  readonly description: Locator;
  readonly descriptionEdit: Locator;
  readonly descriptionInput: Locator;
  readonly descriptionSave: Locator;
  readonly descriptionCancel: Locator;
  readonly assignee: Locator;
  readonly priority: Locator;
  readonly severity: Locator;
  readonly labels: Locator;
  readonly labelsEdit: Locator;
  readonly labelsSave: Locator;
  readonly labelsCancel: Locator;
  readonly links: Locator;
  readonly linksEdit: Locator;
  readonly linksSave: Locator;
  readonly linksCancel: Locator;
  readonly testHint: Locator;
  readonly testHistoryLink: Locator;
  readonly testRunLink: Locator;
  readonly activity: Locator;
  readonly activityMore: Locator;
  readonly activityLive: Locator;
  readonly activityRefreshError: Locator;
  readonly activityRefreshRetry: Locator;
  readonly statusLive: Locator;
  readonly comments: Locator;
  readonly events: Locator;
  readonly commentInput: Locator;
  readonly commentSubmit: Locator;
  readonly conflict: Locator;
  readonly conflictReload: Locator;
  readonly deleteButton: Locator;
  readonly deleteConfirm: Locator;
  readonly deleteCancel: Locator;
  readonly actionError: Locator;
  readonly bugNotFound: Locator;
  readonly notFound: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByTestId("bug-title");
    this.titleEdit = page.getByTestId("bug-title-edit");
    this.titleInput = page.getByTestId("bug-title-input");
    this.titleSave = page.getByTestId("bug-title-save");
    this.titleCancel = page.getByTestId("bug-title-cancel");
    this.titleError = page.getByTestId("field-error-title");
    this.status = page.getByTestId("bug-status");
    this.resolution = page.getByTestId("bug-resolution");
    this.resolutionConfirm = page.getByTestId("bug-resolution-confirm");
    this.resolutionCancel = page.getByTestId("bug-resolution-cancel");
    this.resolutionError = page.getByTestId("field-error-resolution");
    this.description = page.getByTestId("bug-description");
    this.descriptionEdit = page.getByTestId("bug-description-edit");
    this.descriptionInput = page.getByTestId("bug-description-input");
    this.descriptionSave = page.getByTestId("bug-description-save");
    this.descriptionCancel = page.getByTestId("bug-description-cancel");
    this.assignee = page.getByTestId("bug-assignee");
    this.priority = page.getByTestId("bug-priority");
    this.severity = page.getByTestId("bug-severity");
    this.labels = page.getByTestId("bug-labels");
    this.labelsEdit = page.getByTestId("bug-labels-edit");
    this.labelsSave = page.getByTestId("bug-labels-save");
    this.labelsCancel = page.getByTestId("bug-labels-cancel");
    this.links = page.getByTestId("bug-links");
    this.linksEdit = page.getByTestId("bug-links-edit");
    this.linksSave = page.getByTestId("bug-links-save");
    this.linksCancel = page.getByTestId("bug-links-cancel");
    this.testHint = page.getByTestId("bug-test-hint");
    this.testHistoryLink = page.getByTestId("bug-test-history-link");
    this.testRunLink = page.getByTestId("bug-test-run-link");
    this.activity = page.getByTestId("bug-activity");
    this.activityLive = page.getByTestId("bug-activity-live");
    this.activityRefreshError = page.getByTestId("bug-activity-refresh-error");
    this.activityRefreshRetry = page.getByTestId("bug-activity-refresh-retry");
    this.statusLive = page.getByTestId("bug-status-live");
    this.actionError = page.getByTestId("form-error");
    this.activityMore = page.getByTestId("bug-activity-more");
    this.comments = this.activity.getByTestId(new RegExp(`^comment-${UUID}$`));
    this.events = this.activity.getByTestId(/^event-\d+$/);
    this.commentInput = page.getByTestId("comment-input");
    this.commentSubmit = page.getByTestId("comment-submit");
    this.conflict = page.getByTestId("bug-conflict");
    this.conflictReload = page.getByTestId("bug-conflict-reload");
    this.deleteButton = page.getByTestId("bug-delete");
    this.deleteConfirm = page.getByTestId("bug-delete-confirm");
    this.deleteCancel = page.getByTestId("bug-delete-cancel");
    this.bugNotFound = page.getByTestId("bug-not-found");
    this.notFound = page.getByTestId("project-not-found");
  }

  /** Pesan galat di bawah pilihan assignee/prioritas/severity di panel samping. */
  fieldError(field: "assignee" | "priority" | "severity"): Locator {
    return this.page.getByTestId(`bug-${field}-error`);
  }

  transition(status: "open" | "in_progress" | "resolved" | "closed"): Locator {
    return this.page.getByTestId(`bug-transition-${status}`);
  }

  /** Komentar pertama (berurutan lama → baru) yang memuat teks itu. */
  comment(text: string): Locator {
    return this.comments.filter({ hasText: text });
  }

  commentAction(action: "edit" | "delete", comment: Locator): Locator {
    return comment.getByTestId(new RegExp(`^comment-${action}-${UUID}$`));
  }

  commentEditInput(comment: Locator): Locator {
    return comment.locator('textarea[data-testid^="comment-edit-input-"]');
  }

  commentEditSave(comment: Locator): Locator {
    return comment.getByTestId(new RegExp(`^comment-edit-save-${UUID}$`));
  }

  commentDeleteConfirm(comment: Locator): Locator {
    return comment.getByTestId(new RegExp(`^comment-delete-confirm-${UUID}$`));
  }

  event(text: string | RegExp): Locator {
    return this.events.filter({ hasText: text });
  }

  async goto(slug: string, number: number | string): Promise<void> {
    await this.page.goto(`/p/${slug}/bugs/${number}`);
    await expect(this.title.or(this.bugNotFound).or(this.notFound)).toBeVisible();
  }
}
