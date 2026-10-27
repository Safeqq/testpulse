import { AppShell } from "../pages/AppShell.js";
import { InvitePage } from "../pages/InvitePage.js";
import { LoginPage } from "../pages/LoginPage.js";
import { ProjectPage } from "../pages/ProjectPage.js";
import { ProjectsPage } from "../pages/ProjectsPage.js";
import { SettingsPage } from "../pages/SettingsPage.js";
import { expect, test } from "../support/fixtures.js";

const LAST_ADMIN = "minimal satu admin";

function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

test.describe("Tim, undangan, dan visibilitas", () => {
  test("alur lengkap: undang, terima, hak akses, admin terakhir, visibilitas, cabut undangan, hapus project", async ({
    api,
    signedInPage,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const admin = await api.register();
    const second = await api.register();
    const created = await api.createProject(admin);

    const { page: adminPage } = await signedInPage(admin);
    const adminSettings = new SettingsPage(adminPage);
    const adminProject = new ProjectPage(adminPage);

    // 1. Admin membuat undangan viewer dan membaca URL-nya.
    await adminSettings.goto(created.slug);
    await expect(adminSettings.memberRow(admin.user.id)).toContainText(admin.user.name);
    const inviteUrl = await adminSettings.createInvitation("viewer");
    expect(inviteUrl).toContain("/invite/");
    await expect(adminSettings.toast).toContainText("Undangan Viewer dibuat");
    await expectNoA11yViolationsInBothThemes(adminPage);

    // 2. User kedua membuka URL: pratinjau menampilkan project & role, lalu menerima.
    const { page: secondPage } = await signedInPage(second);
    const invite = new InvitePage(secondPage);
    await invite.goto(inviteUrl);
    await expect(invite.preview).toContainText(created.name);
    await expect(invite.preview).toContainText("Viewer");
    await expectNoA11yViolationsInBothThemes(secondPage);
    await invite.accept.click();
    await expect(secondPage).toHaveURL(new RegExp(`/p/${created.slug}$`));
    await expect(new ProjectPage(secondPage).title).toHaveText(created.name);

    // 3. User kedua (viewer) tidak melihat bagian admin di pengaturan.
    const secondSettings = new SettingsPage(secondPage);
    await new ProjectPage(secondPage).settingsLink.click();
    await expect(secondPage).toHaveURL(new RegExp(`/p/${created.slug}/settings$`));
    await expect(secondSettings.title).toBeVisible();
    await expect(secondSettings.memberRow(second.user.id)).toBeVisible();
    await expect(secondSettings.memberRow(admin.user.id)).toBeVisible();
    await expect(secondSettings.name).toHaveCount(0);
    await expect(secondSettings.visibilityPublic).toHaveCount(0);
    await expect(secondSettings.inviteCreate).toHaveCount(0);
    await expect(secondSettings.deleteProject).toHaveCount(0);
    await expect(secondSettings.memberRole(admin.user.id)).toHaveCount(0);
    await expect(secondSettings.memberRemove(admin.user.id)).toHaveCount(0);
    await expect(secondSettings.leave).toBeVisible();

    // 4. Admin terakhir tidak bisa keluar; tetap anggota.
    await adminSettings.leave.click();
    await expect(adminSettings.toast).toContainText(LAST_ADMIN);
    await expect(adminPage).toHaveURL(new RegExp(`/p/${created.slug}/settings$`));
    await adminPage.reload();
    await expect(adminSettings.memberRow(admin.user.id)).toBeVisible();
    await adminProject.goto(created.slug);
    await expect(adminProject.settingsLink).toBeVisible();

    // 5. Admin menjadikan project publik: anonim melihat lencana, tetapi pengaturan tetap tertutup.
    await adminSettings.goto(created.slug);
    await adminSettings.visibilityPublic.click();
    await expect(adminSettings.visibilityPublic).toBeChecked();
    await expect(adminSettings.toast).toContainText("publik");

    const anonContext = await newContext();
    try {
      const anonPage = await anonContext.newPage();
      const anonProject = new ProjectPage(anonPage);
      await anonProject.goto(created.slug);
      await expect(anonProject.publicBadge).toBeVisible();

      await anonPage.goto(`/p/${created.slug}/settings`);
      await expect(anonPage).toHaveURL(
        new RegExp(`/login\\?next=${encodeURIComponent(`/p/${created.slug}/settings`)}$`),
      );

      // 6. Kembali ke privat: anonim yang memuat ulang melihat "tidak ditemukan".
      await adminSettings.visibilityPrivate.click();
      await expect(adminSettings.visibilityPrivate).toBeChecked();
      await expect(adminSettings.toast).toContainText("privat");
      await anonPage.goto(`/p/${created.slug}`);
      await expect(anonProject.notFound).toBeVisible();
    } finally {
      await anonContext.close();
    }

    // 7. Cabut undangan lain; lalu hapus project dengan konfirmasi slug.
    const other = await api.createInvitation(admin, created.slug, "tester");
    await adminSettings.goto(created.slug);
    await expect(adminSettings.inviteRow(other.id)).toContainText("Tester");
    await adminSettings.inviteRevoke(other.id).click();
    await expect(adminSettings.inviteRow(other.id)).toHaveCount(0);

    await expect(adminSettings.deleteProject).toBeDisabled();
    await adminSettings.deleteConfirm.fill(`${created.slug}-salah`);
    await expect(adminSettings.deleteProject).toBeDisabled();
    await adminSettings.deleteConfirm.fill(created.slug);
    await expect(adminSettings.deleteProject).toBeEnabled();
    await adminSettings.deleteProject.click();

    await expect(adminPage).toHaveURL(/\/$/);
    const projects = new ProjectsPage(adminPage);
    await expect(projects.empty).toBeVisible();
  });

  test("membuat undangan diumumkan lewat toast", async ({ api, signedInPage }) => {
    const admin = await api.register();
    const project = await api.createProject(admin);
    const { page } = await signedInPage(admin);
    const settings = new SettingsPage(page);

    await settings.goto(project.slug);
    await settings.inviteRole.selectOption("tester");
    await settings.inviteCreate.click();

    await expect(settings.toast).toContainText("Undangan Tester dibuat");
    await expect(settings.inviteUrl).toContainText("/invite/");
  });

  test("salin tautan menulis ke clipboard sungguhan dan memberi tahu berhasil (chromium)", async ({
    api,
    newContext,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "izin clipboard-read/clipboard-write hanya dapat diberikan di Chromium");
    const admin = await api.register();
    const project = await api.createProject(admin);
    const context = await newContext({
      storageState: await admin.request.storageState(),
      permissions: ["clipboard-read", "clipboard-write"],
    });
    try {
      const page = await context.newPage();
      const settings = new SettingsPage(page);

      await settings.goto(project.slug);
      const url = await settings.createInvitation("viewer");
      await settings.inviteCopy.click();

      await expect(settings.toast).toContainText("Tautan undangan disalin");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    } finally {
      await context.close();
    }
  });

  for (const outcome of ["berhasil", "ditolak"] as const) {
    test(`salin tautan: toast sesuai hasil penulisan clipboard (${outcome}, semua browser)`, async ({
      api,
      signedInPage,
    }) => {
      const admin = await api.register();
      const project = await api.createProject(admin);
      const { page } = await signedInPage(admin);
      const settings = new SettingsPage(page);
      // Clipboard diganti agar hasilnya deterministik di semua browser (izin clipboard berbeda per browser).
      await page.addInitScript((shouldSucceed) => {
        const win = window as unknown as { __copied?: string };
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: (text: string) => {
              win.__copied = text;
              return shouldSucceed ? Promise.resolve() : Promise.reject(new Error("ditolak"));
            },
          },
        });
      }, outcome === "berhasil");

      await settings.goto(project.slug);
      const url = await settings.createInvitation("viewer");
      await settings.inviteCopy.click();

      if (outcome === "berhasil") await expect(settings.toast).toContainText("Tautan undangan disalin");
      else await expect(settings.toast).toContainText("Salin tautan secara manual");
      expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(url);
    });
  }

  test("anonim melihat pratinjau undangan lalu masuk dan kembali untuk menerima", async ({
    api,
    newContext,
  }) => {
    const admin = await api.register();
    const guest = await api.register();
    const project = await api.createProject(admin);
    const invitation = await api.createInvitation(admin, project.slug, "tester");

    const context = await newContext();
    try {
      const page = await context.newPage();
      const invite = new InvitePage(page);
      const shell = new AppShell(page);

      await invite.goto(invitation.url);
      await expect(invite.preview).toContainText(project.name);
      await expect(invite.preview).toContainText("Tester");
      await shell.expectAnonymous();

      await invite.accept.click();
      const path = `/invite/${tokenOf(invitation.url)}`;
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}$`));

      await new LoginPage(page).login(guest.user.email, guest.password);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(invite.preview).toContainText(project.name);

      await invite.accept.click();
      await expect(page).toHaveURL(new RegExp(`/p/${project.slug}$`));
      await expect(new ProjectPage(page).settingsLink).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("undangan yang tidak berlaku menampilkan pesan dari server", async ({ api, signedInPage }) => {
    const admin = await api.register();
    const project = await api.createProject(admin);
    const used = await api.createInvitation(admin, project.slug, "viewer");
    const { page } = await signedInPage();
    const invite = new InvitePage(page);

    await invite.goto("/invite/token-yang-tidak-ada");
    await expect(invite.error).toContainText("Undangan tidak ditemukan");
    await expect(invite.accept).toHaveCount(0);

    // Undangan yang sudah dipakai orang lain ditolak dengan pesan yang jelas.
    const member = await api.register();
    await api.acceptInvitation(member, tokenOf(used.url));
    await invite.goto(used.url);
    await expect(invite.error).toContainText("Undangan sudah dipakai");
  });

  test("admin mengubah peran dan mengeluarkan anggota; admin terakhir tidak bisa diturunkan", async ({
    api,
    signedInPage,
  }) => {
    const admin = await api.register();
    const project = await api.createProject(admin);
    const tester = await api.addMember(admin, project.slug, "tester");
    const { page } = await signedInPage(admin);
    const settings = new SettingsPage(page);

    await settings.goto(project.slug);
    await expect(settings.memberRole(tester.user.id)).toHaveValue("tester");

    await settings.setMemberRole(tester.user.id, "admin");
    await expect(settings.toast).toContainText("Peran");
    await expect(settings.memberRole(tester.user.id)).toHaveValue("admin");

    await settings.setMemberRole(tester.user.id, "viewer");
    await expect(settings.memberRole(tester.user.id)).toHaveValue("viewer");

    // Admin satu-satunya tidak bisa menurunkan dirinya sendiri; pilihan dikembalikan.
    await settings.setMemberRole(admin.user.id, "viewer");
    await expect(settings.toast).toContainText(LAST_ADMIN);
    await expect(settings.memberRole(admin.user.id)).toHaveValue("admin");

    await settings.memberRemove(tester.user.id).click();
    await expect(settings.memberRow(tester.user.id)).toHaveCount(0);
    await expect(settings.memberRow(admin.user.id)).toBeVisible();
  });

  test("admin mengganti nama project dan non-admin yang keluar kembali ke beranda", async ({ api, signedInPage }) => {
    const admin = await api.register();
    const project = await api.createProject(admin);
    const viewer = await api.addMember(admin, project.slug, "viewer");
    const { page: adminPage } = await signedInPage(admin);
    const settings = new SettingsPage(adminPage);

    await settings.goto(project.slug);
    await settings.name.fill("   ");
    await settings.save.click();
    await expect(adminPage.getByTestId("field-error-name")).toBeVisible();

    await settings.name.fill("Nama Baru E2E");
    await settings.save.click();
    await expect(settings.toast).toContainText("Nama project disimpan");
    await expect(settings.title).toContainText("Nama Baru E2E");
    await adminPage.reload();
    await expect(settings.name).toHaveValue("Nama Baru E2E");

    const { page: viewerPage } = await signedInPage(viewer);
    const viewerSettings = new SettingsPage(viewerPage);
    await viewerSettings.goto(project.slug);
    await viewerSettings.leave.click();
    await expect(viewerPage).toHaveURL(/\/$/);
    await expect(new ProjectsPage(viewerPage).empty).toBeVisible();
  });

  test("pengaturan project bagi yang bukan anggota menampilkan penjelasan, tanpa kontrol", async ({
    api,
    signedInPage,
  }) => {
    const admin = await api.register();
    const project = await api.createProject(admin);
    await api.setVisibility(admin, project.slug, "public");
    const { page } = await signedInPage();
    const settings = new SettingsPage(page);

    await page.goto(`/p/${project.slug}/settings`);
    await expect(settings.notMember).toBeVisible();
    await expect(settings.name).toHaveCount(0);
    await expect(settings.inviteCreate).toHaveCount(0);
  });
});
