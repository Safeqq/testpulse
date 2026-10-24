import { expect, type Locator, type Page } from "@playwright/test";
import type { InvitableRole, Role } from "@testpulse/shared";

/** `/p/:slug/settings`: nama, visibilitas, anggota, undangan, dan zona berbahaya. */
export class SettingsPage {
  readonly title: Locator;
  readonly name: Locator;
  readonly save: Locator;
  readonly visibilityPrivate: Locator;
  readonly visibilityPublic: Locator;
  readonly leave: Locator;
  readonly inviteRole: Locator;
  readonly inviteCreate: Locator;
  readonly inviteUrl: Locator;
  readonly inviteCopy: Locator;
  readonly deleteConfirm: Locator;
  readonly deleteProject: Locator;
  readonly toast: Locator;
  readonly formError: Locator;
  readonly notMember: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByTestId("settings-title");
    this.name = page.getByTestId("settings-name");
    this.save = page.getByTestId("settings-save");
    this.visibilityPrivate = page.getByTestId("visibility-private");
    this.visibilityPublic = page.getByTestId("visibility-public");
    this.leave = page.getByTestId("leave-project");
    this.inviteRole = page.getByTestId("invite-role");
    this.inviteCreate = page.getByTestId("invite-create");
    this.inviteUrl = page.getByTestId("invite-url");
    this.inviteCopy = page.getByTestId("invite-copy");
    this.deleteConfirm = page.getByTestId("delete-confirm");
    this.deleteProject = page.getByTestId("delete-project");
    this.toast = page.getByTestId("toast");
    this.formError = page.getByTestId("form-error");
    this.notMember = page.getByTestId("settings-not-member");
  }

  /** Menunggu judul halaman dan daftar anggota termuat, sehingga pemeriksaan "tidak ada" sesudahnya bermakna. */
  async goto(slug: string): Promise<void> {
    await this.page.goto(`/p/${slug}/settings`);
    await expect(this.title).toBeVisible();
    await expect(this.page.getByTestId("member-list")).toBeVisible();
  }

  memberRow(userId: string): Locator {
    return this.page.getByTestId(`member-row-${userId}`);
  }

  memberRole(userId: string): Locator {
    return this.page.getByTestId(`member-role-${userId}`);
  }

  memberRemove(userId: string): Locator {
    return this.page.getByTestId(`member-remove-${userId}`);
  }

  inviteRow(id: string): Locator {
    return this.page.getByTestId(`invite-row-${id}`);
  }

  inviteRevoke(id: string): Locator {
    return this.page.getByTestId(`invite-revoke-${id}`);
  }

  async setMemberRole(userId: string, role: Role): Promise<void> {
    await this.memberRole(userId).selectOption(role);
  }

  /** Membuat undangan dan mengembalikan URL yang ditampilkan. */
  async createInvitation(role: InvitableRole): Promise<string> {
    await this.inviteRole.selectOption(role);
    await this.inviteCreate.click();
    await expect(this.inviteUrl).toContainText("/invite/");
    return (await this.inviteUrl.textContent()) ?? "";
  }
}
