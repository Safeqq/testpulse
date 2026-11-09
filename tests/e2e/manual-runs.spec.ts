import type { ManualRunDto, RunCaseListItemDto } from "@testpulse/shared";
import { ManualRunNewPage } from "../pages/ManualRunNewPage.js";
import { ManualRunPage } from "../pages/ManualRunPage.js";
import { ManualRunsPage } from "../pages/ManualRunsPage.js";
import type { TestApi, TestUser } from "../support/api-client.js";
import { buildJUnit } from "../support/junit.js";
import { expect, test } from "../support/fixtures.js";
import { horizontalOverflow, mobileContextOptions, newProject, COMMIT, CI_URL } from "../support/bugs.js";
import { fetchManualRun, fetchRunCases, seedManualProject, type ManualSeed } from "../support/manual.js";

const LONG_NAME = "Regresi".padEnd(110, "x");

/** Run manual dari semua suite seed; `statuses` mengisi hasil run case menurut urutan posisinya (sisanya `untested`). */
async function seedRun(
  api: TestApi,
  seed: ManualSeed,
  body: { name: string; appVersion?: string },
  fill: { status?: "passed" | "failed" | "blocked" | "skipped"; assign?: boolean }[] = [],
): Promise<{ run: ManualRunDto; runCases: RunCaseListItemDto[] }> {
  const run = await api.createManualRun(seed.owner, seed.project.slug, {
    ...body,
    suiteIds: seed.suites.map((suite) => suite.id),
  });
  const runCases = await fetchRunCases(seed.owner, seed.project.slug, run.number);
  for (const [index, entry] of fill.entries()) {
    await api.updateRunCase(seed.owner, seed.project.slug, run.number, runCases[index]!.id, {
      version: 1,
      ...(entry.status ? { status: entry.status } : {}),
      ...(entry.assign ? { assigneeId: seed.owner.user.id } : {}),
    });
  }
  return { run, runCases: await fetchRunCases(seed.owner, seed.project.slug, run.number) };
}

async function completeViaApi(user: TestUser, slug: string, number: number): Promise<void> {
  const run = await fetchManualRun(user, slug, number);
  const res = await user.request.patch(`/api/v1/projects/${slug}/manual-runs/${number}`, {
    data: { version: run.version, status: "completed" },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe("Daftar run manual", () => {
  test("run terbaru dulu dengan progres dan legenda; filter status dan versi tersimpan di URL", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const seed = await seedManualProject(api, { suites: ["Login", "Checkout"], casesPerSuite: 3 });
    const { project, owner } = seed;
    await seedRun(
      api,
      seed,
      { name: "Regresi A", appVersion: "v0.4.0" },
      [{ status: "passed" }, { status: "passed" }, { status: "passed" }, { status: "failed" }, { status: "blocked" }],
    );
    await api.createManualRun(owner, project.slug, { name: "Smoke B", appVersion: "build-7", suiteIds: [seed.suites[0]!.id] });
    await completeViaApi(owner, project.slug, 2);
    await api.createManualRun(owner, project.slug, { name: "Tanpa versi", caseNumbers: [1] });
    const { page } = await signedInPage(owner);
    const runs = new ManualRunsPage(page);

    await runs.goto(project.slug);
    await expect(runs.title).toBeVisible();
    await expect(runs.rows).toHaveCount(3);
    await expect(runs.rows.nth(0)).toContainText("TR-3");
    await expect(runs.rows.nth(1)).toContainText("TR-2");
    await expect(runs.rows.nth(2)).toContainText("TR-1");

    const first = runs.row(1);
    await expect(first).toContainText("Regresi A");
    await expect(first).toContainText("v0.4.0");
    await expect(first).toContainText("Terbuka");
    await expect(first.getByTestId("run-progress")).toContainText("5/6 dieksekusi · 3 lulus · 1 gagal · 1 diblokir");
    await expect(runs.row(2)).toContainText("Selesai");
    await expect(runs.row(2).getByTestId("run-progress")).toContainText("0/3 dieksekusi");
    await expect(runs.row(3)).not.toContainText("v0");
    await expectNoA11yViolationsInBothThemes(page);

    await runs.status.selectOption("completed");
    await expect(page).toHaveURL(/\?status=completed$/);
    await expect(runs.rows).toHaveCount(1);
    await expect(runs.row(2)).toBeVisible();

    await runs.status.selectOption("open");
    await expect(runs.rows).toHaveCount(2);
    await expect(runs.row(2)).toHaveCount(0);

    await page.reload();
    await expect(runs.status).toHaveValue("open");
    await expect(runs.rows).toHaveCount(2);

    await runs.reset.click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(runs.rows).toHaveCount(3);

    await runs.version.fill("v0.4.0");
    await runs.versionSubmit.click();
    await expect(page).toHaveURL(/\?appVersion=v0\.4\.0$/);
    await expect(runs.rows).toHaveCount(1);
    await expect(runs.row(1)).toBeVisible();

    await page.goto(`/p/${project.slug}/manual-runs?appVersion=build-7&status=open`);
    await expect(runs.empty).toBeVisible();
    await expect(runs.empty).toContainText("Tidak ada run yang cocok");
    await runs.reset.click();
    await expect(runs.rows).toHaveCount(3);

    await runs.row(3).getByRole("link").click();
    await expect(page).toHaveURL(`/p/${project.slug}/manual-runs/3`);
  });

  test("project tanpa run menampilkan keadaan kosong; tester melihat Buat run dan sub-tab Run manual aktif", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const runs = new ManualRunsPage(page);

    await runs.goto(project.slug);
    await expect(runs.empty).toBeVisible();
    await expect(runs.empty).toContainText("Belum ada run manual");
    await expect(runs.create).toBeVisible();
    await expect(page.getByTestId("manual-subtab-runs")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("tab-manual")).toHaveAttribute("aria-current", "page");

    await runs.create.click();
    await expect(page).toHaveURL(`/p/${project.slug}/manual-runs/new`);
  });

  test("dimuat 20 per halaman dengan Muat lagi", async ({ api, signedInPage }) => {
    const seed = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 1 });
    for (let n = 1; n <= 21; n += 1) {
      await api.createManualRun(seed.owner, seed.project.slug, { name: `Run nomor ${n}`, caseNumbers: [1] });
    }
    const { page } = await signedInPage(seed.owner);
    const runs = new ManualRunsPage(page);

    await runs.goto(seed.project.slug);
    await expect(runs.rows).toHaveCount(20);
    await runs.loadMore.click();
    await expect(runs.rows).toHaveCount(21);
    await expect(runs.loadMore).toHaveCount(0);
  });

  test("viewer dan pengunjung anonim project publik hanya membaca; project privat tidak terbuka untuk anonim", async ({
    api,
    signedInPage,
    newContext,
  }) => {
    const seed = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 1, visibility: "public" });
    const { project, owner } = seed;
    await api.createManualRun(owner, project.slug, { name: "Regresi publik", caseNumbers: [1] });
    const viewer = await api.addMember(owner, project.slug, "viewer");
    const { page: viewerPage } = await signedInPage(viewer);
    const viewerRuns = new ManualRunsPage(viewerPage);
    await viewerRuns.goto(project.slug);
    await expect(viewerRuns.rows).toHaveCount(1);
    await expect(viewerRuns.create).toHaveCount(0);

    const anonymous = await (await newContext()).newPage();
    const anonymousRuns = new ManualRunsPage(anonymous);
    await anonymousRuns.goto(project.slug);
    await expect(anonymousRuns.rows).toHaveCount(1);
    await expect(anonymousRuns.create).toHaveCount(0);

    const privateSeed = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 1 });
    await api.createManualRun(privateSeed.owner, privateSeed.project.slug, { name: "Rahasia", caseNumbers: [1] });
    const hidden = new ManualRunsPage(anonymous);
    await anonymous.goto(`/p/${privateSeed.project.slug}/manual-runs`);
    await expect(hidden.notFound).toBeVisible();
  });
});

test.describe("Buat run manual", () => {
  test("ringkasan menghitung suite terpilih dan case satuan tanpa dobel; tombol nonaktif bila 0; simpan membuka detail run", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const seed = await seedManualProject(api, { suites: ["Login", "Checkout", "Profil"], casesPerSuite: 2 });
    const { owner, project, suites } = seed;
    await api.updateCase(owner, project.slug, 6, { version: 1, archived: true });
    const { page } = await signedInPage(owner);
    const form = new ManualRunNewPage(page);

    await form.goto(project.slug);
    await expect(form.heading).toBeVisible();
    await expect(form.summary).toContainText("0 case");
    await expect(form.submit).toBeDisabled();
    await expect(form.suite(suites[0]!.id)).not.toBeChecked();
    await expectNoA11yViolationsInBothThemes(page);

    await form.suite(suites[0]!.id).check();
    await form.suite(suites[1]!.id).check();
    await expect(form.summary).toContainText("4 case akan disalin");
    await expect(form.submit).toBeEnabled();

    // Case satuan dari suite yang belum dicentang menambah satu; dari suite yang sudah dicentang tidak dihitung dua kali.
    await form.searchCases("Case 3.1");
    await expect(form.option(5)).toBeVisible();
    await form.option(5).click();
    await expect(form.picked(5)).toBeVisible();
    await expect(form.summary).toContainText("5 case akan disalin");

    await form.searchCases("Case 1.1");
    await form.option(1).click();
    await expect(form.summary).toContainText("5 case akan disalin");

    // Case terarsip tidak ditawarkan.
    await form.searchCases("Case 3.2");
    await expect(form.searchStatus).toContainText("Tidak ada case aktif yang cocok");
    await expect(form.option(6)).toHaveCount(0);

    await form.unpick(5).click();
    await expect(form.summary).toContainText("4 case akan disalin");
    await form.suite(suites[0]!.id).uncheck();
    await form.suite(suites[1]!.id).uncheck();
    await expect(form.summary).toContainText("1 case akan disalin");
    await form.unpick(1).click();
    await expect(form.submit).toBeDisabled();

    await form.suite(suites[0]!.id).check();
    await form.suite(suites[1]!.id).check();
    await form.name.fill("Regresi rilis");
    await form.submit.click();
    await expect(page).toHaveURL(new RegExp(`/p/${project.slug}/manual-runs/1$`));
    const run = new ManualRunPage(page);
    await expect(run.title).toHaveText("Regresi rilis");
    await expect(run.rows).toHaveCount(4);
    const saved = await fetchManualRun(owner, project.slug, 1);
    expect(saved.total).toBe(4);
    expect(saved.appVersion).toBeNull();
  });

  test("saran versi dari GET /versions muncul di datalist dan versi tersimpan di run", async ({ api, signedInPage }) => {
    const seed = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 1 });
    const { owner, project } = seed;
    const { token } = await api.createToken(owner, project.slug);
    const xml = buildJUnit([{ suite: "checkout", name: "Bayar", status: "passed" }]);
    const upload = await api.uploadRun(token, project.slug, xml, { branch: "main", commit: COMMIT, ciUrl: CI_URL, version: "0.4.0" });
    expect(upload.status(), await upload.text()).toBe(201);
    await api.createManualRun(owner, project.slug, { name: "Sudah ada", appVersion: "build-7", caseNumbers: [1] });
    const { page } = await signedInPage(owner);
    const form = new ManualRunNewPage(page);

    await form.goto(project.slug);
    await expect(form.version).toHaveAttribute("list", "run-version-options");
    await expect.poll(() => form.versionOptions.evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))).toEqual(
      expect.arrayContaining(["0.4.0", "build-7"]),
    );

    await form.name.fill("Uji penerimaan");
    await form.version.fill("0.4.0");
    await form.suite(seed.suites[0]!.id).check();
    await form.submit.click();
    await expect(page).toHaveURL(new RegExp(`/manual-runs/2$`));
    expect((await fetchManualRun(owner, project.slug, 2)).appVersion).toBe("0.4.0");
  });

  test("isian tidak valid menampilkan pesan per kolom dan seleksi kosong ditolak", async ({ api, signedInPage }) => {
    const seed = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 1 });
    const { page } = await signedInPage(seed.owner);
    const form = new ManualRunNewPage(page);

    await form.goto(seed.project.slug);
    await form.suite(seed.suites[0]!.id).check();
    await form.name.fill("ab");
    await form.version.fill("versi salah");
    await form.submit.click();
    await expect(form.nameError).toHaveText("Nama minimal 3 karakter");
    await expect(page.getByTestId("field-error-appVersion")).toBeVisible();
    await expect(form.name).toBeFocused();
    await expect(page).toHaveURL(/manual-runs\/new$/);
  });

  test("tanpa suite menampilkan petunjuk; viewer tidak bisa membuat run", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const form = new ManualRunNewPage(page);
    await form.goto(project.slug);
    await expect(form.noSuites).toBeVisible();

    const seed = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 1 });
    const viewer = await api.addMember(seed.owner, seed.project.slug, "viewer");
    const { page: viewerPage } = await signedInPage(viewer);
    const viewerForm = new ManualRunNewPage(viewerPage);
    await viewerForm.goto(seed.project.slug);
    await expect(viewerForm.forbidden).toBeVisible();
    await expect(viewerForm.form).toHaveCount(0);
  });

  test("di 375 px tanpa scroll horizontal", async ({ api, newContext }) => {
    const seed = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 2 });
    const page = await (await newContext(await mobileContextOptions(seed.owner))).newPage();
    const form = new ManualRunNewPage(page);

    await form.goto(seed.project.slug);
    await form.name.fill(LONG_NAME);
    await form.version.fill("v".padEnd(50, "9"));
    await form.suite(seed.suites[0]!.id).check();
    await form.searchCases("Case");
    await expect(form.option(1)).toBeVisible();
    await form.option(1).click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("Detail run manual", () => {
  async function seedDetail(api: TestApi) {
    const seed = await seedManualProject(api, { suites: ["Login", "Checkout"], casesPerSuite: 3 });
    const made = await seedRun(
      api,
      seed,
      { name: "Regresi rilis", appVersion: "v0.4.0" },
      [{ status: "passed", assign: true }, { status: "failed", assign: true }],
    );
    return { ...seed, ...made };
  }

  test("header, progres, dan case dikelompokkan per suite", async ({ api, signedInPage, expectNoA11yViolationsInBothThemes }) => {
    const { owner, project, run, runCases } = await seedDetail(api);
    const failedCase = runCases[1]!;
    const bug = await api.createBug(owner, project.slug, { title: "Login gagal", manualRunCaseId: failedCase.id });
    const { page } = await signedInPage(owner);
    const detail = new ManualRunPage(page);

    await detail.goto(project.slug, run.number);
    await expect(detail.title).toHaveText("Regresi rilis");
    await expect(detail.code).toHaveText("TR-1");
    await expect(detail.header).toContainText("v0.4.0");
    await expect(detail.status).toHaveText("Terbuka");
    await expect(detail.progress).toContainText("2/6 dieksekusi · 1 lulus · 1 gagal");

    await expect(detail.groups).toHaveCount(2);
    await expect(detail.groups.nth(0)).toContainText("Login");
    await expect(detail.groups.nth(0).locator('[data-testid^="run-case-row-"]')).toHaveCount(3);
    await expect(detail.groups.nth(1)).toContainText("Checkout");
    await expect(detail.groups.nth(1).locator('[data-testid^="run-case-row-"]')).toHaveCount(3);

    const passedRow = detail.row(runCases[0]!.id);
    await expect(passedRow).toContainText("TC-1");
    await expect(passedRow).toContainText("Case 1.1");
    await expect(passedRow).toContainText("Lulus");
    await expect(passedRow).toContainText(owner.user.name);
    const failedRow = detail.row(failedCase.id);
    await expect(failedRow).toContainText("Gagal");
    await expect(failedRow.getByTestId(`bug-badge-${bug.number}`)).toContainText(`Bug #${bug.number}`);
    await expect(detail.row(runCases[2]!.id)).toContainText("Belum dites");
    await expect(detail.row(runCases[2]!.id)).toContainText("Belum di-assign");
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("filter status, assignee (Case saya, Belum di-assign), dan suite tersimpan di URL", async ({ api, signedInPage }) => {
    const { owner, project, run, runCases } = await seedDetail(api);
    const { page } = await signedInPage(owner);
    const detail = new ManualRunPage(page);

    await detail.goto(project.slug, run.number);
    await detail.statusFilter.selectOption("failed");
    await expect(page).toHaveURL(/\?status=failed$/);
    await expect(detail.rows).toHaveCount(1);
    await expect(detail.row(runCases[1]!.id)).toBeVisible();
    await expect(detail.groups).toHaveCount(1);

    await detail.statusFilter.selectOption("");
    await detail.assigneeFilter.selectOption({ label: "Case saya" });
    await expect(page).toHaveURL(/\?assignee=me$/);
    await expect(detail.rows).toHaveCount(2);

    await detail.assigneeFilter.selectOption({ label: "Belum di-assign" });
    await expect(page).toHaveURL(/\?assignee=none$/);
    await expect(detail.rows).toHaveCount(4);

    await detail.assigneeFilter.selectOption("");
    await detail.suiteFilter.selectOption("Checkout");
    await expect(page).toHaveURL(/\?suite=Checkout$/);
    await expect(detail.rows).toHaveCount(3);
    await expect(detail.groups).toHaveCount(1);
    await expect(detail.groups.first()).toContainText("Checkout");

    await page.reload();
    await expect(detail.suiteFilter).toHaveValue("Checkout");
    await expect(detail.rows).toHaveCount(3);

    await detail.statusFilter.selectOption("passed");
    await expect(detail.empty).toBeVisible();
    await expect(detail.empty).toContainText("Tidak ada case yang cocok");
    await detail.reset.click();
    await expect(detail.rows).toHaveCount(6);
  });

  test("Mulai eksekusi membuka case belum dites pertama", async ({ api, signedInPage }) => {
    const { owner, project, run, runCases } = await seedDetail(api);
    const { page } = await signedInPage(owner);
    const detail = new ManualRunPage(page);

    await detail.goto(project.slug, run.number);
    await detail.start.click();
    await expect(page).toHaveURL(`/p/${project.slug}/manual-runs/${run.number}/cases/${runCases[2]!.id}`);
  });

  test("Selesaikan run meminta konfirmasi inline dengan jumlah belum dites, lalu hanya-baca sampai Buka ulang", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, run } = await seedDetail(api);
    const { page } = await signedInPage(owner);
    const detail = new ManualRunPage(page);

    await detail.goto(project.slug, run.number);
    await detail.complete.click();
    await expect(detail.completeQuestion).toHaveText("Masih ada 4 case belum dites. Selesaikan tetap?");
    await expect(detail.completeCancel).toBeFocused();
    await expectNoA11yViolationsInBothThemes(page);

    await detail.completeCancel.click();
    await expect(detail.completeQuestion).toHaveCount(0);
    await expect(detail.complete).toBeFocused();
    expect((await fetchManualRun(owner, project.slug, run.number)).status).toBe("open");

    await detail.complete.click();
    await detail.completeConfirm.click();
    await expect(detail.status).toHaveText("Selesai");
    await expect(detail.completedNote).toBeVisible();
    await expect(detail.reopen).toBeVisible();
    await expect(detail.complete).toHaveCount(0);
    await expect(detail.rename).toHaveCount(0);
    await expect(detail.start).toHaveCount(0);
    const completed = await fetchManualRun(owner, project.slug, run.number);
    expect(completed.status).toBe("completed");
    expect(completed.completedBy?.id).toBe(owner.user.id);
    await expectNoA11yViolationsInBothThemes(page);

    await page.reload();
    await expect(detail.status).toHaveText("Selesai");
    await expect(detail.reopen).toBeVisible();

    await detail.reopen.click();
    await expect(detail.status).toHaveText("Terbuka");
    await expect(detail.complete).toBeVisible();
    await expect(detail.completedNote).toHaveCount(0);
    expect((await fetchManualRun(owner, project.slug, run.number)).status).toBe("open");
  });

  test("run tanpa case belum dites langsung selesai tanpa konfirmasi", async ({ api, signedInPage }) => {
    const seed = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 1 });
    const { run } = await seedRun(api, seed, { name: "Satu case" }, [{ status: "passed" }]);
    const { page } = await signedInPage(seed.owner);
    const detail = new ManualRunPage(page);

    await detail.goto(seed.project.slug, run.number);
    await detail.complete.click();
    await expect(detail.status).toHaveText("Selesai");
    await expect(detail.completeQuestion).toHaveCount(0);
  });

  test("ganti nama inline: Simpan, validasi, Escape membatalkan", async ({ api, signedInPage }) => {
    const { owner, project, run } = await seedDetail(api);
    const { page } = await signedInPage(owner);
    const detail = new ManualRunPage(page);

    await detail.goto(project.slug, run.number);
    await detail.rename.click();
    await expect(detail.renameInput).toBeFocused();
    await expect(detail.renameInput).toHaveValue("Regresi rilis");

    await detail.renameInput.fill("ab");
    await detail.renameSave.click();
    await expect(page.getByTestId("field-error-name")).toHaveText("Nama minimal 3 karakter");
    await detail.renameInput.press("Escape");
    await expect(detail.title).toHaveText("Regresi rilis");
    await expect(detail.rename).toBeFocused();

    await detail.rename.click();
    await detail.renameInput.fill("  Regresi rilis 0.4.1  ");
    await detail.renameInput.press("Enter");
    await expect(detail.title).toHaveText("Regresi rilis 0.4.1");
    await expect(detail.rename).toBeFocused();
    expect((await fetchManualRun(owner, project.slug, run.number)).name).toBe("Regresi rilis 0.4.1");
  });

  test("hanya admin melihat Hapus run; konfirmasi inline menghapus lalu kembali ke daftar", async ({ api, signedInPage }) => {
    const { owner, project, run } = await seedDetail(api);
    const tester = await api.addMember(owner, project.slug, "tester");
    const { page: testerPage } = await signedInPage(tester);
    const testerDetail = new ManualRunPage(testerPage);
    await testerDetail.goto(project.slug, run.number);
    await expect(testerDetail.complete).toBeVisible();
    await expect(testerDetail.rename).toBeVisible();
    await expect(testerDetail.del).toHaveCount(0);

    const { page } = await signedInPage(owner);
    const detail = new ManualRunPage(page);
    await detail.goto(project.slug, run.number);
    await detail.del.click();
    await expect(detail.deleteCancel).toBeFocused();
    await detail.deleteCancel.click();
    await expect(detail.deleteConfirm).toHaveCount(0);
    await expect(detail.del).toBeFocused();

    await detail.del.click();
    await detail.deleteConfirm.click();
    await expect(page).toHaveURL(`/p/${project.slug}/manual-runs`);
    await expect(new ManualRunsPage(page).empty).toBeVisible();
    const res = await owner.request.get(`/api/v1/projects/${project.slug}/manual-runs/${run.number}`);
    expect(res.status()).toBe(404);
  });

  test("perubahan lain pada run memunculkan banner bentrok; Muat ulang memakai versi terbaru", async ({ api, signedInPage }) => {
    const { owner, project, run } = await seedDetail(api);
    const { page } = await signedInPage(owner);
    const detail = new ManualRunPage(page);

    await detail.goto(project.slug, run.number);
    // Orang lain mengganti nama run setelah halaman ini dimuat.
    const res = await owner.request.patch(`/api/v1/projects/${project.slug}/manual-runs/${run.number}`, {
      data: { version: run.version, name: "Diganti orang lain" },
    });
    expect(res.status(), await res.text()).toBe(200);

    await detail.complete.click();
    await detail.completeConfirm.click();
    await expect(detail.conflict).toBeVisible();
    await expect(detail.conflict).toContainText("Run ini baru saja diubah orang lain");
    await expect(detail.status).toHaveText("Terbuka");

    await detail.conflictReload.click();
    await expect(detail.conflict).toHaveCount(0);
    await expect(detail.title).toHaveText("Diganti orang lain");
    await detail.complete.click();
    await detail.completeConfirm.click();
    await expect(detail.status).toHaveText("Selesai");
  });

  test("run tidak ada menampilkan keadaan tidak ditemukan", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const detail = new ManualRunPage(page);

    await detail.goto(project.slug, 99);
    await expect(detail.notFound).toBeVisible();
    await page.goto(`/p/${project.slug}/manual-runs/abc`);
    await expect(detail.notFound).toBeVisible();
  });

  test("viewer dan anonim di project publik hanya membaca", async ({ api, signedInPage, newContext }) => {
    const seed = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 2, visibility: "public" });
    const { run } = await seedRun(api, seed, { name: "Regresi publik" }, [{ status: "passed" }]);
    const viewer = await api.addMember(seed.owner, seed.project.slug, "viewer");
    const { page: viewerPage } = await signedInPage(viewer);
    const anonymous = await (await newContext()).newPage();

    for (const page of [viewerPage, anonymous]) {
      const detail = new ManualRunPage(page);
      await detail.goto(seed.project.slug, run.number);
      await expect(detail.title).toHaveText("Regresi publik");
      await expect(detail.rows).toHaveCount(2);
      await expect(detail.progress).toContainText("1/2 dieksekusi · 1 lulus");
      for (const control of [detail.start, detail.complete, detail.reopen, detail.rename, detail.del]) {
        await expect(control).toHaveCount(0);
      }
    }
    // Anonim tidak punya daftar anggota: filter assignee hanya menawarkan "Belum di-assign".
    const anonymousDetail = new ManualRunPage(anonymous);
    await expect(anonymousDetail.assigneeFilter.locator("option")).toHaveText(["Semua assignee", "Belum di-assign"]);
  });

  test("viewer melihat run selesai tanpa tombol Buka ulang", async ({ api, signedInPage }) => {
    const seed = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 1 });
    const { run } = await seedRun(api, seed, { name: "Selesai dulu" }, [{ status: "passed" }]);
    await completeViaApi(seed.owner, seed.project.slug, run.number);
    const viewer = await api.addMember(seed.owner, seed.project.slug, "viewer");
    const { page } = await signedInPage(viewer);
    const detail = new ManualRunPage(page);

    await detail.goto(seed.project.slug, run.number);
    await expect(detail.status).toHaveText("Selesai");
    await expect(detail.completedNote).toBeVisible();
    await expect(detail.reopen).toHaveCount(0);
  });

  test("di 375 px nama panjang, filter, dan daftar tanpa scroll horizontal", async ({ api, newContext }) => {
    const seed = await seedManualProject(api, { suites: ["Login", "Checkout"], casesPerSuite: 2 });
    const { run } = await seedRun(api, seed, { name: LONG_NAME, appVersion: "v".padEnd(50, "9") }, [{ status: "failed", assign: true }]);
    const page = await (await newContext(await mobileContextOptions(seed.owner))).newPage();
    const runs = new ManualRunsPage(page);
    const detail = new ManualRunPage(page);

    await runs.goto(seed.project.slug);
    await expect(runs.rows).toHaveCount(1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await detail.goto(seed.project.slug, run.number);
    await expect(detail.title).toHaveText(LONG_NAME);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await detail.complete.click();
    await expect(detail.completeQuestion).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await detail.completeCancel.click();
    await detail.rename.click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
