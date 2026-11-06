import type { Page } from "@playwright/test";
import { BugPage } from "../pages/BugPage.js";
import { BugsPage } from "../pages/BugsPage.js";
import { FlakyPage } from "../pages/FlakyPage.js";
import { TestHistoryPage } from "../pages/TestHistoryPage.js";
import {
  createBugs,
  failingRun,
  fetchActivity,
  fetchBug,
  horizontalOverflow,
  mobileContextOptions,
  newProject,
  uploadRun,
} from "../support/bugs.js";
import { expect, test } from "../support/fixtures.js";

test.describe("Detail bug", () => {
  test("assign, mulai kerjakan, komentar, tandai selesai dengan resolusi inline, lalu buka ulang; riwayat memuat semuanya", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const tester = await api.addMember(owner, project.slug, "tester");
    await api.createBug(owner, project.slug, {
      title: "Tombol login macet",
      description: "Klik **tidak** merespons",
      labels: ["ui"],
    });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);

    await bug.goto(project.slug, 1);
    await expect(bug.title).toHaveText("Tombol login macet");
    await expect(bug.status).toContainText("Open");
    await expect(bug.description.locator("strong")).toHaveText("tidak");
    await expect(bug.transition("in_progress")).toHaveText("Mulai kerjakan");
    await expect(bug.transition("resolved")).toHaveText("Tandai selesai");
    await expect(bug.transition("closed")).toHaveText("Tutup");
    await expect(bug.transition("open")).toHaveCount(0);
    await expectNoA11yViolationsInBothThemes(page);

    await bug.assignee.selectOption({ label: tester.user.name });
    await expect(bug.event(`menugaskan bug ini ke ${tester.user.name}`)).toHaveCount(1);
    await expect(bug.assignee).toHaveValue(tester.user.id);

    await bug.transition("in_progress").click();
    await expect(bug.status).toContainText("In progress");
    await expect(bug.event("mengubah status Open → In progress")).toContainText(owner.user.name);
    await expect(bug.event("mengubah status Open → In progress")).toContainText("baru saja");

    await bug.commentInput.fill("Sedang **diperiksa**");
    await bug.commentSubmit.click();
    await expect(bug.comment("Sedang diperiksa")).toBeVisible();
    await expect(bug.comment("Sedang diperiksa").getByTestId("markdown").locator("strong")).toHaveText("diperiksa");
    await expect(bug.commentInput).toHaveValue("");

    // Resolusi wajib dipilih inline sebelum masuk Resolved.
    await bug.transition("resolved").click();
    await expect(bug.resolution).toBeVisible();
    await expect(bug.resolution).toBeFocused();
    await bug.resolutionConfirm.click();
    await expect(bug.resolutionError).toHaveText("Pilih resolusi lebih dulu");
    await expect(bug.status).toContainText("In progress");
    await bug.resolution.selectOption("fixed");
    await bug.resolutionConfirm.click();
    await expect(bug.status).toContainText("Resolved");
    await expect(bug.status).toContainText("Diperbaiki");
    await expect(bug.resolution).toHaveCount(0);
    await expect(bug.event("mengubah status In progress → Resolved")).toHaveCount(1);
    await expect(bug.event("menetapkan resolusi Diperbaiki")).toHaveCount(1);
    await expect(bug.transition("in_progress")).toHaveCount(0);
    await expect(bug.transition("closed")).toBeVisible();
    await expect(bug.transition("open")).toHaveText("Buka ulang");

    await bug.transition("open").click();
    await expect(bug.status).toContainText("Open");
    await expect(bug.status).not.toContainText("Diperbaiki");
    await expect(bug.event("mengubah status Resolved → Open")).toHaveCount(1);
    await expect(bug.event("menghapus resolusi (Diperbaiki)")).toHaveCount(1);

    // Urutan linimasa: lama → baru, komentar di antara event.
    const texts = await bug.activity.locator("ol > li").allTextContents();
    const index = (needle: string) => texts.findIndex((text) => text.includes(needle));
    for (const needle of ["menugaskan bug ini ke", "Open → In progress", "Sedang diperiksa", "In progress → Resolved", "Resolved → Open"]) {
      expect(index(needle), `linimasa memuat "${needle}"`).toBeGreaterThanOrEqual(0);
    }
    expect(index("menugaskan bug ini ke")).toBeLessThan(index("Open → In progress"));
    expect(index("Open → In progress")).toBeLessThan(index("Sedang diperiksa"));
    expect(index("Sedang diperiksa")).toBeLessThan(index("In progress → Resolved"));
    expect(index("In progress → Resolved")).toBeLessThan(index("Resolved → Open"));

    await page.reload();
    await expect(bug.status).toContainText("Open");
    await expect(bug.comments).toHaveCount(1);
    await expect(bug.assignee).toHaveValue(tester.user.id);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("tutup dari Open memilih resolusi inline; Batal membatalkan; dari Resolved menutup tanpa resolusi baru", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, [{ title: "Bug satu" }, { title: "Bug dua" }]);
    await api.updateBug(owner, project.slug, 2, { version: 1, status: "resolved", resolution: "duplicate" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);

    await bug.goto(project.slug, 1);
    await bug.transition("closed").click();
    await expect(bug.resolution).toBeVisible();
    await bug.resolutionCancel.click();
    await expect(bug.resolution).toHaveCount(0);
    await expect(bug.transition("closed")).toBeFocused();
    await expect(bug.status).toContainText("Open");

    await bug.transition("closed").click();
    await bug.resolution.selectOption("wont_fix");
    await bug.resolutionConfirm.click();
    await expect(bug.status).toContainText("Closed");
    await expect(bug.status).toContainText("Tidak akan diperbaiki");
    await expect(bug.transition("open")).toHaveText("Buka ulang");

    await bug.goto(project.slug, 2);
    await bug.transition("closed").click();
    await expect(bug.resolution).toHaveCount(0);
    await expect(bug.status).toContainText("Closed");
    await expect(bug.status).toContainText("Duplikat");
  });

  test("judul dan deskripsi diedit inline; validasi, Batal, dan Escape", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Judul awal", description: "Deskripsi awal" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    await bug.titleEdit.click();
    await expect(bug.titleInput).toBeFocused();
    await expect(bug.titleInput).toHaveValue("Judul awal");
    await bug.titleInput.fill("ab");
    await bug.titleSave.click();
    await expect(bug.titleError).toHaveText("Judul minimal 3 karakter");
    await expect(bug.titleInput).toBeFocused();
    await bug.titleInput.press("Escape");
    await expect(bug.titleInput).toHaveCount(0);
    await expect(bug.title).toHaveText("Judul awal");
    await expect(bug.titleEdit).toBeFocused();

    await bug.titleEdit.click();
    await bug.titleInput.fill("Judul baru yang jelas");
    await bug.titleInput.press("Enter");
    await expect(bug.title).toHaveText("Judul baru yang jelas");
    await expect(bug.event("mengubah judul “Judul awal” → “Judul baru yang jelas”")).toHaveCount(1);

    await bug.descriptionEdit.click();
    await expect(bug.descriptionInput).toHaveValue("Deskripsi awal");
    await bug.descriptionInput.fill("Diubah dan dibatalkan");
    await bug.descriptionCancel.click();
    await expect(bug.description).toContainText("Deskripsi awal");

    await bug.descriptionEdit.click();
    await bug.descriptionInput.fill("## Langkah\n\n- satu\n- dua");
    await bug.descriptionSave.click();
    await expect(bug.description.locator("h2")).toHaveText("Langkah");
    await expect(bug.description.locator("li")).toHaveCount(2);
    await expect(bug.event("mengubah deskripsi")).toHaveCount(1);

    const saved = await fetchBug(owner, project.slug, 1);
    expect(saved).toMatchObject({ title: "Judul baru yang jelas", description: "## Langkah\n\n- satu\n- dua", version: 3 });
  });

  test("prioritas, severity, label, dan link diubah dari panel samping", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug panel", labels: ["lama"] });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    await expect(bug.priority).toHaveValue("medium");
    await expect(bug.severity).toHaveValue("major");
    await bug.priority.selectOption("urgent");
    await expect(bug.event("mengubah prioritas Sedang → Mendesak")).toHaveCount(1);
    await bug.severity.selectOption("blocker");
    await expect(bug.event("mengubah severity Major → Blocker")).toHaveCount(1);
    await expect(bug.priority).toHaveValue("urgent");

    await expect(bug.labels).toContainText("lama");
    await bug.labelsEdit.click();
    await page.getByTestId("bug-labels").fill("Baru!");
    await bug.labelsSave.click();
    await expect(page.getByTestId("field-error-labels")).toContainText("Label hanya boleh berisi");
    await page.getByTestId("bug-labels").fill("Baru");
    await bug.labelsSave.click();
    await expect(bug.labels).toContainText("baru");
    await expect(bug.labels).toContainText("lama");
    await expect(bug.event("mengubah label lama → baru, lama")).toHaveCount(1);

    await bug.linksEdit.click();
    await page.getByTestId("bug-link-add").click();
    await page.getByTestId("bug-link-url-0").fill("bukan url");
    await bug.linksSave.click();
    await expect(page.getByTestId("field-error-links.0.url")).toContainText("URL harus berupa URL http atau https");
    await page.getByTestId("bug-link-url-0").fill("https://tracker.example.com/issue/7");
    await page.getByTestId("bug-link-title-0").fill("Issue 7");
    await bug.linksSave.click();
    const link = bug.links.getByRole("link", { name: "Issue 7" });
    await expect(link).toHaveAttribute("href", "https://tracker.example.com/issue/7");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(bug.event("mengubah link")).toHaveCount(1);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("edit dan hapus komentar sendiri; komentar orang lain: tester tidak bisa, admin hanya menghapus", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const tester = await api.addMember(owner, project.slug, "tester");
    await api.createBug(owner, project.slug, { title: "Bug komentar" });
    await api.addComment(owner, project.slug, 1, { body: "Komentar pemilik" });
    const { page } = await signedInPage(tester);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    const others = bug.comment("Komentar pemilik");
    await expect(others).toBeVisible();
    await expect(bug.commentAction("edit", others)).toHaveCount(0);
    await expect(bug.commentAction("delete", others)).toHaveCount(0);

    await bug.commentInput.fill("Komentar tester");
    await bug.commentSubmit.click();
    const mine = bug.comment("Komentar tester");
    await expect(mine).toBeVisible();
    await expect(mine).not.toContainText("diedit");

    await bug.commentAction("edit", mine).click();
    await expect(bug.commentEditInput(mine)).toBeFocused();
    await bug.commentEditInput(mine).fill("Komentar tester **direvisi**");
    await bug.commentEditSave(mine).click();
    await expect(bug.comment("Komentar tester direvisi")).toContainText("diedit");
    await expect(bug.comment("Komentar tester direvisi").getByTestId("markdown").locator("strong")).toHaveText("direvisi");

    const revised = bug.comment("Komentar tester direvisi");
    await bug.commentAction("delete", revised).click();
    await expect(bug.commentDeleteConfirm(revised)).toBeVisible();
    await expect(revised).toContainText("Komentar tester direvisi");
    await bug.commentDeleteConfirm(revised).click();
    await expect(bug.comments.filter({ hasText: "Komentar dihapus" })).toHaveCount(1);
    await expect(bug.comments.filter({ hasText: "Komentar tester" })).toHaveCount(0);
    await expect(bug.comments).toHaveCount(2);

    // Admin: menghapus komentar tester, tetapi tidak bisa mengubahnya.
    await api.addComment(tester, project.slug, 1, { body: "Komentar kedua tester" });
    const { page: adminPage } = await signedInPage(owner);
    const adminBug = new BugPage(adminPage);
    await adminBug.goto(project.slug, 1);
    const testers = adminBug.comment("Komentar kedua tester");
    await expect(adminBug.commentAction("edit", testers)).toHaveCount(0);
    await adminBug.commentAction("delete", testers).click();
    await adminBug.commentDeleteConfirm(testers).click();
    await expect(adminBug.comments.filter({ hasText: "Komentar dihapus" })).toHaveCount(2);
    await expect(adminBug.commentAction("edit", adminBug.comment("Komentar pemilik"))).toBeVisible();
  });

  test("hapus komentar bisa dibatalkan dan komentar kosong ditolak di tempat", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug komentar" });
    await api.addComment(owner, project.slug, 1, { body: "Tetap ada" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    const comment = bug.comment("Tetap ada");
    await bug.commentAction("delete", comment).click();
    await page.getByTestId(new RegExp(`^comment-delete-cancel-`)).click();
    await expect(bug.commentDeleteConfirm(comment)).toHaveCount(0);
    await expect(bug.commentAction("delete", comment)).toBeFocused();

    await bug.commentInput.fill("   ");
    await bug.commentSubmit.click();
    await expect(page.getByTestId("field-error-comment")).toHaveText("Komentar wajib diisi");
    await expect(bug.commentInput).toBeFocused();
    await expect(bug.comments).toHaveCount(1);
  });

  test("konflik: dua konteks, yang menyimpan belakangan melihat banner dan memuat ulang versi terbaru", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Judul versi satu" });
    const { page: pageA } = await signedInPage(owner);
    const { page: pageB } = await signedInPage(owner);
    const a = new BugPage(pageA);
    const b = new BugPage(pageB);
    await a.goto(project.slug, 1);
    await b.goto(project.slug, 1);

    await a.titleEdit.click();
    await a.titleInput.fill("Judul dari A");
    await a.titleSave.click();
    await expect(a.title).toHaveText("Judul dari A");
    await expect(a.conflict).toHaveCount(0);

    await b.priority.selectOption("urgent");
    await expect(b.conflict).toBeVisible();
    await expect(b.conflict).toContainText("Bug ini baru saja diubah orang lain");
    // Tidak ada perubahan yang tersimpan dari konteks B.
    const current = await fetchBug(owner, project.slug, 1);
    expect(current).toMatchObject({ priority: "medium", title: "Judul dari A", version: 2 });

    await b.conflictReload.click();
    await expect(b.conflict).toHaveCount(0);
    await expect(b.title).toHaveText("Judul dari A");
    await expect(b.priority).toHaveValue("medium");
    await expect(b.event("mengubah judul")).toHaveCount(1);

    await b.priority.selectOption("urgent");
    await expect(b.event("mengubah prioritas Sedang → Mendesak")).toHaveCount(1);
    await expect(b.conflict).toHaveCount(0);
  });

  test("konflik saat transisi: banner, lalu memuat ulang membuang pilihan resolusi yang belum disimpan", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug transisi" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await bug.transition("resolved").click();
    await bug.resolution.selectOption("fixed");
    await api.updateBug(owner, project.slug, 1, { version: 1, status: "in_progress" });

    await bug.resolutionConfirm.click();

    await expect(bug.conflict).toBeVisible();
    await bug.conflictReload.click();
    await expect(bug.conflict).toHaveCount(0);
    await expect(bug.status).toContainText("In progress");
    await expect(bug.resolution).toHaveCount(0);
  });

  test("admin menghapus bug dengan konfirmasi inline lalu kembali ke daftar; tester tidak melihat tombol hapus", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const tester = await api.addMember(owner, project.slug, "tester");
    await createBugs(api, owner, project.slug, [{ title: "Akan dihapus" }, { title: "Tetap ada" }]);

    const { page: testerPage } = await signedInPage(tester);
    const testerBug = new BugPage(testerPage);
    await testerBug.goto(project.slug, 1);
    await expect(testerBug.title).toBeVisible();
    await expect(testerBug.deleteButton).toHaveCount(0);

    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await bug.deleteButton.click();
    await expect(bug.deleteConfirm).toBeVisible();
    await expect(bug.deleteCancel).toBeFocused();
    await bug.deleteCancel.click();
    await expect(bug.deleteConfirm).toHaveCount(0);
    await expect(bug.deleteButton).toBeFocused();
    expect((await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1`)).status()).toBe(200);

    await bug.deleteButton.click();
    await bug.deleteConfirm.click();

    await page.waitForURL(new RegExp(`/p/${project.slug}/bugs$`));
    const list = new BugsPage(page);
    await expect(list.rows).toHaveCount(1);
    await expect(list.row(2)).toContainText("Tetap ada");
    expect((await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1`)).status()).toBe(404);

    await bug.goto(project.slug, 1);
    await expect(bug.bugNotFound).toBeVisible();
  });

  test("viewer dan anonim di project publik hanya membaca; nomor tak dikenal dan project privat", async ({
    api,
    signedInPage,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api, "public");
    const viewer = await api.addMember(owner, project.slug, "viewer");
    await api.createBug(owner, project.slug, {
      title: "Bug publik",
      description: "Isi *deskripsi*",
      labels: ["ui"],
      assigneeId: owner.user.id,
      links: [{ url: "https://tracker.example.com/1", title: "Tracker" }],
    });
    await api.addComment(owner, project.slug, 1, { body: "Komentar publik" });

    const { page: viewerPage } = await signedInPage(viewer);
    const anonymousPage = await (await newContext()).newPage();
    for (const page of [viewerPage, anonymousPage]) {
      const bug = new BugPage(page);
      await bug.goto(project.slug, 1);
      await expect(bug.title).toHaveText("Bug publik");
      await expect(bug.status).toContainText("Open");
      await expect(bug.description.locator("em")).toHaveText("deskripsi");
      await expect(bug.comment("Komentar publik")).toBeVisible();
      await expect(bug.labels).toContainText("ui");
      await expect(bug.assignee).toContainText(owner.user.name);
      await expect(bug.links.getByRole("link", { name: "Tracker" })).toBeVisible();
      for (const control of [
        bug.titleEdit,
        bug.descriptionEdit,
        bug.labelsEdit,
        bug.linksEdit,
        bug.deleteButton,
        bug.commentInput,
        bug.commentSubmit,
        bug.transition("in_progress"),
        bug.transition("resolved"),
        bug.transition("closed"),
        page.locator("select"),
      ]) {
        await expect(control).toHaveCount(0);
      }
      await expect(bug.priority).toContainText("Sedang");
      await expect(bug.severity).toContainText("Major");
      await expectNoA11yViolationsInBothThemes(page);
    }

    const missing = new BugPage(anonymousPage);
    await missing.goto(project.slug, 999);
    await expect(missing.bugNotFound).toBeVisible();
    await missing.goto(project.slug, "abc");
    await expect(missing.bugNotFound).toBeVisible();

    const { owner: privateOwner, project: privateProject } = await newProject(api);
    await api.createBug(privateOwner, privateProject.slug, { title: "Rahasia" });
    await missing.goto(privateProject.slug, 1);
    await expect(missing.notFound).toBeVisible();
    await expect(missing.title).toHaveCount(0);
  });

  test("kartu test asal: petunjuk gagal, lulus berturut-turut, link riwayat dan run, run asal dihapus", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const { runId, ids } = await failingRun(api, owner, project.slug);
    await api.createBug(owner, project.slug, {
      title: "Bug dari test",
      testCaseId: ids["G gagal"]!,
      runId,
    });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);

    await bug.goto(project.slug, 1);
    await expect(bug.testHint).toContainText("G gagal");
    await expect(bug.testHint).toContainText("checkout");
    await expect(bug.testHint).toContainText("Masih gagal di run terakhir di main");
    await expect(bug.testHistoryLink).toHaveAttribute("href", `/p/${project.slug}/tests/${ids["G gagal"]!}?branch=main`);
    await expect(bug.testRunLink).toHaveAttribute("href", `/p/${project.slug}/runs/${runId}`);
    await expectNoA11yViolationsInBothThemes(page);

    // Dua run lulus berikutnya: petunjuk ikut berubah, status bug tidak.
    for (let i = 0; i < 2; i++) await uploadRun(api, owner, project.slug, [{ suite: "checkout", name: "G gagal" }]);
    await page.reload();
    await expect(bug.testHint).toContainText("Lulus 2 run terakhir berturut-turut di main");
    await expect(bug.status).toContainText("Open");

    await bug.testHistoryLink.click();
    await expect(page.getByTestId("test-history")).toBeVisible();
    await expect(page.getByTestId(`bug-badge-1`)).toBeVisible();

    const deleted = await owner.request.delete(`/api/v1/projects/${project.slug}/runs/${runId}`);
    expect(deleted.status()).toBe(204);
    await bug.goto(project.slug, 1);
    await expect(bug.testHint).toContainText("Run asal tidak tersedia");
    await expect(bug.testHint).toContainText("Lulus 2 run terakhir berturut-turut di main");
    await expect(bug.testRunLink).toHaveCount(0);
    await expect(bug.testHistoryLink).toBeVisible();
  });

  test("bug tanpa test asal tidak menampilkan kartu test", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug mandiri" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await expect(bug.title).toBeVisible();
    await expect(bug.testHint).toHaveCount(0);
  });

  test("badge bug muncul di daftar flaky dan riwayat test, menaut ke bug, dan hilang setelah ditutup", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const { runId, ids } = await failingRun(api, owner, project.slug);
    await api.createBug(owner, project.slug, { title: "Bug flaky", testCaseId: ids["F flaky"]!, runId });
    const { page } = await signedInPage(owner);
    const flaky = new FlakyPage(page);
    const history = new TestHistoryPage(page);

    await flaky.goto(project.slug);
    const item = page.getByTestId(`flaky-item-${ids["F flaky"]!}`);
    const badge = item.getByTestId("bug-badge-1");
    await expect(badge).toHaveText("Bug #1 · Open");
    await expect(badge).toHaveAttribute("href", `/p/${project.slug}/bugs/1`);
    await expect(item.getByRole("link")).toHaveCount(2);
    await expectNoA11yViolationsInBothThemes(page);

    await history.goto(project.slug, ids["F flaky"]!);
    await expect(page.getByTestId("bug-badge-1")).toHaveText("Bug #1 · Open");
    await expectNoA11yViolationsInBothThemes(page);

    await page.getByTestId("bug-badge-1").click();
    await expect(new BugPage(page).title).toHaveText("Bug flaky", { timeout: 15_000 });

    await api.updateBug(owner, project.slug, 1, { version: 1, status: "closed", resolution: "fixed" });
    await flaky.goto(project.slug);
    await expect(item).toBeVisible();
    await expect(item.getByTestId("bug-badge-1")).toHaveCount(0);
  });

  test("Review Focus 4: judul, komentar, dan blok kode panjang tersimpan utuh tanpa scroll horizontal di 375 px", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const title = `${"x".repeat(190)}😀😀😀😀😀`;
    const comment = `${"k".repeat(280)}😀😀😀😀😀😀😀😀😀😀`;
    const code = "y".repeat(500);
    await api.createBug(owner, project.slug, { title, description: `Kode:\n\n\`\`\`\n${code}\n\`\`\`` });
    const context = await newContext(await mobileContextOptions(owner));
    const page = await context.newPage();
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    await bug.commentInput.fill(comment);
    await bug.commentSubmit.click();
    await expect(bug.comments).toHaveCount(1);

    await expect(bug.title).toHaveText(title);
    await expect(bug.description.locator("pre")).toHaveText(code);
    await expect(bug.comments.first()).toContainText(comment);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const saved = await fetchBug(owner, project.slug, 1);
    expect(saved.title).toBe(title);
    expect(saved.description).toContain(code);
    const activity = await fetchActivity(owner, project.slug, 1);
    expect(activity.items.find((item) => item.kind === "comment")).toMatchObject({ body: comment });

    // Mode edit dan komentar panjang di dalam daftar tidak melebarkan halaman juga.
    await bug.titleEdit.click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await bug.titleCancel.click();
    await bug.transition("resolved").click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("375 px: panel, linimasa, dan kartu test tanpa scroll horizontal", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const { runId, ids } = await failingRun(api, owner, project.slug);
    await api.createBug(owner, project.slug, {
      title: "Bug 375",
      testCaseId: ids["G gagal"]!,
      runId,
      labels: ["label-yang-cukup-panjang-ya", "a", "b", "c"],
      links: [{ url: `https://example.com/${"p".repeat(150)}`, title: "z".repeat(100) }],
    });
    await api.addComment(owner, project.slug, 1, { body: "komentar" });
    const context = await newContext(await mobileContextOptions(owner));
    const page = await context.newPage();
    const bug = new BugPage(page);

    await bug.goto(project.slug, 1);
    await expect(bug.testHint).toBeVisible();
    await expect(bug.comments).toHaveCount(1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("lebih dari 50 item aktivitas: halaman pertama lalu Muat lagi; komentar baru tetap tampil di akhir", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug ramai" });
    for (let i = 1; i <= 52; i++) await api.addComment(owner, project.slug, 1, { body: `Komentar ke-${i}` });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    await expect(bug.comments).toHaveCount(50);
    // Tunggu semua blok Markdown selesai dirender (chunk lazy) sebelum menekan "Muat lagi", agar tata letak tidak bergeser di bawah klik.
    await expect(page.getByTestId("markdown")).toHaveCount(50);
    await bug.activityMore.click();
    await expect(bug.comments).toHaveCount(52);
    await expect(page.getByTestId("markdown")).toHaveCount(52);
    await expect(bug.activityMore).toHaveCount(0);

    await bug.commentInput.fill("Komentar terakhir");
    await bug.commentSubmit.click();
    await expect(bug.comments).toHaveCount(53);
    await expect(bug.comments.last()).toContainText("Komentar terakhir");
  });
});

/** Membalas setiap PATCH bug dengan galat server tiruan `{ error }`. */
async function failPatch(page: Page, status: number, error: object): Promise<void> {
  await page.route("**/api/v1/projects/*/bugs/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error }) });
  });
}

test.describe("Detail bug: galat per field, fokus, dan pengumuman", () => {
  test("assignee yang dikeluarkan setelah halaman dibuka ditolak server: alasan tampil di bawah pilihan dan nilai kembali", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const tester = await api.addMember(owner, project.slug, "tester");
    await api.createBug(owner, project.slug, { title: "Bug assignee" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await expect(bug.assignee.locator("option")).toHaveCount(3);
    const removed = await owner.request.delete(`/api/v1/projects/${project.slug}/members/${tester.user.id}`);
    expect(removed.status()).toBe(204);

    await bug.assignee.selectOption({ label: tester.user.name });

    await expect(bug.fieldError("assignee")).toBeVisible();
    await expect(bug.fieldError("assignee")).not.toBeEmpty();
    await expect(bug.assignee).toHaveValue("");
    await expect(bug.assignee).toHaveAttribute("aria-invalid", "true");
    await expect(bug.assignee).toHaveAccessibleDescription(/\S/);
    await expect(bug.actionError).toHaveCount(0);
    expect((await fetchBug(owner, project.slug, 1)).assignee).toBeNull();

    // Perubahan berikutnya pada kolom itu membersihkan pesan.
    await bug.assignee.selectOption({ label: owner.user.name });
    await expect(bug.fieldError("assignee")).toHaveCount(0);
    await expect(bug.assignee).toHaveValue(owner.user.id);
  });

  test("galat prioritas dari server tampil di bawah kolomnya; simpan yang tumpang tindih ditolak dengan pesan lalu versi tetap benar", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug prioritas" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    await failPatch(page, 400, {
      code: "VALIDATION_ERROR",
      message: "Data tidak valid",
      fields: { priority: "Prioritas ditolak server" },
    });
    await bug.priority.selectOption("urgent");
    await expect(bug.fieldError("priority")).toHaveText("Prioritas ditolak server");
    await expect(bug.priority).toHaveValue("medium");
    await page.unroute("**/api/v1/projects/*/bugs/*");

    // Dua perubahan beruntun: yang kedua ditolak selama yang pertama belum selesai, dengan pesan di kolomnya.
    await page.route("**/api/v1/projects/*/bugs/*", async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fallback();
    });
    await bug.priority.selectOption("high");
    await bug.severity.selectOption("critical");
    await expect(bug.fieldError("severity")).toContainText("masih disimpan");
    await expect(bug.severity).toHaveValue("major");
    await expect(bug.event("mengubah prioritas Sedang → Tinggi")).toHaveCount(1);
    await page.unroute("**/api/v1/projects/*/bugs/*");

    // Versi dari respons pertama langsung dipakai: simpan berikutnya tidak berbenturan.
    await bug.severity.selectOption("critical");
    await expect(bug.event("mengubah severity Major → Critical")).toHaveCount(1);
    await expect(bug.conflict).toHaveCount(0);
    expect(await fetchBug(owner, project.slug, 1)).toMatchObject({ priority: "high", severity: "critical", version: 3 });
  });

  test("galat resolusi dari server (400) tampil di pilihan resolusi dan fokus ke sana", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug resolusi" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await failPatch(page, 400, {
      code: "VALIDATION_ERROR",
      message: "Data tidak valid",
      fields: { resolution: "Resolusi wajib diisi (server)" },
    });

    await bug.transition("resolved").click();
    await bug.resolution.selectOption("fixed");
    await bug.resolutionConfirm.click();

    await expect(bug.resolutionError).toHaveText("Resolusi wajib diisi (server)");
    await expect(bug.resolution).toBeFocused();
    await expect(bug.resolution).toHaveAttribute("aria-invalid", "true");
    await expect(bug.actionError).toHaveCount(0);
    await expect(bug.status).toContainText("Open");
  });

  test("transisi ditolak (409 INVALID_TRANSITION): pesan di atas halaman, fokus tetap di tombol, status tidak berubah", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug transisi" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await failPatch(page, 409, { code: "INVALID_TRANSITION", message: "Transisi status tidak diizinkan" });

    await bug.transition("in_progress").click();
    await expect(bug.actionError).toHaveText("Transisi status tidak diizinkan");
    await expect(bug.transition("in_progress")).toBeFocused();
    await expect(bug.status).toContainText("Open");
    await expect(bug.conflict).toHaveCount(0);

    // Dengan pilihan resolusi terbuka, fokus tetap di Konfirmasi dan pilihan tidak hilang.
    await bug.transition("resolved").click();
    await bug.resolution.selectOption("fixed");
    await bug.resolutionConfirm.click();
    await expect(bug.actionError).toHaveText("Transisi status tidak diizinkan");
    await expect(bug.resolutionConfirm).toBeFocused();
    await expect(bug.resolution).toHaveValue("fixed");
  });

  test("status diumumkan: label sr-only, fokus ke status, dan daerah live setelah transisi", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug status" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await expect(bug.status).toContainText("Status:");
    await expect(bug.statusLive).toBeEmpty();

    await bug.transition("in_progress").click();

    await expect(bug.status).toContainText("In progress");
    await expect(bug.status).toBeFocused();
    await expect(bug.statusLive).toHaveText("Status diubah menjadi In progress");
  });

  test("Ubah label dan Ubah link memindahkan fokus ke kolomnya; kesalahan link memfokuskan kolom yang salah", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, [
      { title: "Tanpa link" },
      { title: "Dengan link", links: [{ url: "https://tracker.example.com/1" }] },
    ]);
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);

    await bug.goto(project.slug, 1);
    await bug.labelsEdit.click();
    await expect(page.getByTestId("bug-labels")).toBeFocused();
    await bug.labelsCancel.click();
    await expect(bug.labelsEdit).toBeFocused();

    await bug.linksEdit.click();
    await expect(page.getByTestId("bug-link-add")).toBeFocused();
    await page.getByTestId("bug-link-add").click();
    await page.getByTestId("bug-link-url-0").fill("https://ok.example.com");
    await page.getByTestId("bug-link-add").click();
    await page.getByTestId("bug-link-url-1").fill("bukan url");
    await bug.linksSave.click();
    await expect(page.getByTestId("field-error-links.1.url")).toBeVisible();
    await expect(page.getByTestId("bug-link-url-1")).toBeFocused();
    await bug.linksCancel.click();
    await expect(bug.linksEdit).toBeFocused();

    await bug.goto(project.slug, 2);
    await bug.linksEdit.click();
    await expect(page.getByTestId("bug-link-url-0")).toBeFocused();
  });

  test("10 link (Tambah link nonaktif): galat tingkat daftar dari server memfokuskan pesan galat, bukan tombol nonaktif", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const links = Array.from({ length: 10 }, (_, i) => ({ url: `https://tracker.example.com/${i + 1}` }));
    await api.createBug(owner, project.slug, { title: "Sepuluh link", links });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    await bug.linksEdit.click();
    await expect(page.getByTestId("bug-link-add")).toBeDisabled();
    await failPatch(page, 500, { code: "INTERNAL_ERROR", message: "Terjadi kesalahan pada server" });
    await bug.linksSave.click();

    const listError = page.getByTestId("field-error-links");
    await expect(listError).toHaveText("Terjadi kesalahan pada server");
    await expect(listError).toBeFocused();
    await page.unroute("**/api/v1/projects/*/bugs/*");
  });

  test("hapus komentar: fokus ke komentar, pengumuman 'Komentar dihapus'; tombol tiap komentar punya deskripsi unik", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const tester = await api.addMember(owner, project.slug, "tester");
    await api.createBug(owner, project.slug, { title: "Bug komentar" });
    await api.addComment(owner, project.slug, 1, { body: "Komentar pemilik" });
    await api.addComment(tester, project.slug, 1, { body: "Komentar tester" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    const mine = bug.comment("Komentar pemilik");
    const others = bug.comment("Komentar tester");
    await expect(bug.commentAction("delete", mine)).toHaveAccessibleDescription(new RegExp(owner.user.name));
    await expect(bug.commentAction("delete", others)).toHaveAccessibleDescription(new RegExp(tester.user.name));
    await expect(bug.commentAction("edit", mine)).toHaveAccessibleDescription(new RegExp(owner.user.name));

    await bug.commentAction("delete", others).click();
    await bug.commentDeleteConfirm(others).click();

    const deleted = bug.comments.filter({ hasText: "Komentar dihapus" });
    await expect(deleted).toHaveCount(1);
    await expect(deleted).toBeFocused();
    await expect(bug.activityLive).toHaveText("Komentar dihapus");
    await expect(deleted).toHaveAccessibleName(new RegExp(tester.user.name));
  });

  test("komentar terkirim tetap tampil walau memuat ulang aktivitas gagal: galat dengan Coba lagi", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug refresh" });
    await api.addComment(owner, project.slug, 1, { body: "Komentar awal" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await expect(bug.comments).toHaveCount(1);

    await page.route("**/api/v1/projects/*/bugs/1/activity*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Aktivitas tidak tersedia" } }),
      }),
    );
    await bug.commentInput.fill("Komentar baru");
    await bug.commentSubmit.click();

    await expect(bug.activityRefreshError).toContainText("Aktivitas tidak tersedia");
    await expect(bug.comments).toHaveCount(1);
    await page.unroute("**/api/v1/projects/*/bugs/1/activity*");
    await bug.activityRefreshRetry.click();
    await expect(bug.activityRefreshError).toHaveCount(0);
    await expect(bug.comments).toHaveCount(2);
    await expect(bug.comment("Komentar baru")).toBeVisible();
  });

  test("a11y dua tema dengan banner konflik, edit komentar, dan konfirmasi hapus terbuka", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug a11y", description: "isi" });
    await api.addComment(owner, project.slug, 1, { body: "Komentar a11y" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    const comment = bug.comment("Komentar a11y");

    await bug.commentAction("edit", comment).click();
    await expect(bug.commentEditInput(comment)).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);
    await comment.getByTestId(/^comment-edit-cancel-/).click();

    await bug.commentAction("delete", comment).click();
    await expect(bug.commentDeleteConfirm(comment)).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);
    await comment.getByTestId(/^comment-delete-cancel-/).click();

    await bug.deleteButton.click();
    await expect(bug.deleteConfirm).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);
    await bug.deleteCancel.click();

    await api.updateBug(owner, project.slug, 1, { version: 1, priority: "high" });
    await bug.priority.selectOption("low");
    await expect(bug.conflict).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("aktivitas kosong tetap menampilkan wadah bug-activity", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug baru" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await expect(bug.activity).toBeVisible();
    await expect(bug.activity).toContainText("Belum ada aktivitas");
  });
});
