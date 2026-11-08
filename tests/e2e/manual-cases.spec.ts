import type { CreateCaseBody, ManualCaseDto } from "@testpulse/shared";
import { BugsPage } from "../pages/BugsPage.js";
import { FlakyPage } from "../pages/FlakyPage.js";
import { ManualCaseFormPage } from "../pages/ManualCaseFormPage.js";
import { ManualCasePage } from "../pages/ManualCasePage.js";
import { ManualCasesPage } from "../pages/ManualCasesPage.js";
import { ProjectPage } from "../pages/ProjectPage.js";
import { ProjectTabsNav } from "../pages/ProjectTabsNav.js";
import { RunsPage } from "../pages/RunsPage.js";
import { VersionsPage } from "../pages/VersionsPage.js";
import type { TestUser } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { horizontalOverflow, mobileContextOptions, newProject, testCaseIds, uploadRun } from "../support/bugs.js";
import { seedManualProject } from "../support/manual.js";

const STEPS: CreateCaseBody["steps"] = [{ action: "Buka halaman", expected: "Halaman tampil" }];
const SUITE_FULL_MESSAGE = "Jumlah suite sudah mencapai batas maksimal";

test.describe("Navigasi Test manual", () => {
  test("tab Test manual tampil di semua halaman project, tanpa ?branch=, dan aktif di /cases", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const tabs = new ProjectTabsNav(page);
    const cases = new ManualCasesPage(page);
    const base = `/p/${project.slug}`;

    await new ProjectPage(page).goto(project.slug);
    await expect(tabs.tab("manual")).toHaveText("Test manual");
    await expect(tabs.tab("manual")).toHaveAttribute("href", `${base}/cases`);
    await expect(tabs.tab("manual")).not.toHaveAttribute("aria-current", "page");

    // Halaman per branch membawa ?branch= ke tabnya sendiri, tetapi tidak ke Test manual.
    await new RunsPage(page).goto(project.slug, "main");
    await expect(tabs.tab("run")).toHaveAttribute("href", `${base}/runs?branch=main`);
    await expect(tabs.tab("manual")).toHaveAttribute("href", `${base}/cases`);

    await new FlakyPage(page).goto(project.slug);
    await expect(tabs.tab("manual")).toBeVisible();
    await new VersionsPage(page).goto(project.slug);
    await expect(tabs.tab("manual")).toBeVisible();
    await new BugsPage(page).goto(project.slug);
    await expect(tabs.tab("manual")).toBeVisible();

    await tabs.tab("manual").click();
    await expect(page).toHaveURL(`${base}/cases`);
    await cases.waitForLoaded();
    await expect(tabs.current).toHaveCount(1);
    await expect(tabs.current).toHaveText("Test manual");
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("sub-tab berpindah antara Test case dan Run manual (URL saja; halaman run manual dibuat Task 9)", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);
    const base = `/p/${project.slug}`;

    await cases.goto(project.slug);
    await expect(cases.subTabs).toBeVisible();
    await expect(cases.subTabs.getByRole("link")).toHaveText(["Test case", "Run manual"]);
    await expect(cases.casesSubTab).toHaveAttribute("aria-current", "page");
    await expect(cases.runsSubTab).not.toHaveAttribute("aria-current", "page");
    await expect(cases.casesSubTab).toHaveAttribute("href", `${base}/cases`);
    await expect(cases.runsSubTab).toHaveAttribute("href", `${base}/manual-runs`);

    await cases.runsSubTab.click();
    await expect(page).toHaveURL(`${base}/manual-runs`);
  });
});

test.describe("Suite test manual (desktop)", () => {
  test("sidebar menampilkan Semua suite dan tiap suite dengan jumlah case aktif; memilih suite menyaring daftar", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login", "Checkout"], casesPerSuite: 2 });
    await api.createSuite(owner, project.slug, { name: "Kosong" });
    // Case terarsip tidak dihitung pada jumlah suite aktif.
    await api.updateCase(owner, project.slug, 1, { version: 1, archived: true });
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);
    const [login, checkout] = suites;

    await cases.goto(project.slug);
    await expect(cases.suiteList).toBeVisible();
    await expect(cases.suiteSelect).toBeHidden();
    await expect(cases.suite("all")).toContainText("Semua suite");
    await expect(cases.suite("all")).toContainText("3");
    await expect(cases.suite(login!.id)).toContainText("Login");
    await expect(cases.suite(login!.id)).toContainText("1");
    await expect(cases.suite(checkout!.id)).toContainText("2");
    await expect(cases.suite("all")).toHaveAttribute("aria-pressed", "true");
    await expect(cases.rows).toHaveCount(3);
    await expectNoA11yViolationsInBothThemes(page);

    await cases.suite(checkout!.id).click();
    await expect(page).toHaveURL(new RegExp(`\\?suite=${checkout!.id}$`));
    await expect(cases.suite(checkout!.id)).toHaveAttribute("aria-pressed", "true");
    await expect(cases.rows).toHaveCount(2);
    await expect(cases.row(3)).toContainText("Case 2.1");

    await page.reload();
    await expect(cases.suite(checkout!.id)).toHaveAttribute("aria-pressed", "true");
    await expect(cases.rows).toHaveCount(2);

    await cases.suite("all").click();
    await expect(page).not.toHaveURL(/suite=/);
    await expect(cases.rows).toHaveCount(3);
  });

  test("tester menambah suite inline; nama kembar ditolak di bawah kolom", async ({ api, signedInPage }) => {
    const { owner, project } = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 1 });
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);
    await cases.goto(project.slug);

    await cases.suiteAddInput.fill("Regresi");
    await cases.suiteAddSubmit.click();
    await expect(cases.suiteList.getByTestId(/^suite-item-/)).toHaveCount(2);
    await expect(cases.suiteList.getByTestId(/^suite-item-/).last()).toContainText("Regresi");
    await expect(cases.suiteAddInput).toHaveValue("");

    await cases.suiteAddInput.fill("  regresi ");
    await cases.suiteAddInput.press("Enter");
    await expect(cases.suiteError).toHaveText("Nama suite sudah dipakai");
    await expect(cases.suiteList.getByTestId(/^suite-item-/)).toHaveCount(2);
    await expect(cases.suiteAddInput).toHaveAttribute("aria-invalid", "true");

    await cases.suiteAddInput.fill("");
    await cases.suiteAddInput.press("Enter");
    await expect(cases.suiteError).toHaveText("Nama suite wajib diisi");
  });

  test("batas 200 suite: pesan server tampil di kolom tambah suite", async ({ api, signedInPage }) => {
    test.setTimeout(120_000);
    const owner = await api.register();
    const project = await api.createProject(owner);
    for (let start = 0; start < 200; start += 20) {
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => api.createSuite(owner, project.slug, { name: `Suite ${start + i}` })),
      );
    }
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);
    await cases.goto(project.slug);

    await cases.suiteAddInput.fill("Suite ke-201");
    await cases.suiteAddSubmit.click();
    await expect(cases.suiteError).toHaveText(SUITE_FULL_MESSAGE);
  });

  test("ganti nama suite inline; Escape membatalkan; nama kembar ditolak", async ({ api, signedInPage }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login", "Checkout"], casesPerSuite: 1 });
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);
    const [login, checkout] = suites;
    await cases.goto(project.slug);

    await cases.suiteAction("rename", login!.id).click();
    const input = page.getByTestId(`suite-rename-input-${login!.id}`);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Login");
    await input.fill("Masuk");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(cases.suite(login!.id)).toContainText("Login");

    // Mengganti huruf besar/kecil nama sendiri diterima.
    await cases.suiteAction("rename", login!.id).click();
    await input.fill("LOGIN");
    await input.press("Enter");
    await expect(input).toHaveCount(0);
    await expect(cases.suite(login!.id)).toContainText("LOGIN");

    // Nama suite lain (tanpa membedakan huruf besar/kecil) ditolak, dan kolom tetap terbuka.
    await cases.suiteAction("rename", login!.id).click();
    await input.fill("checkout");
    await page.getByTestId(`suite-rename-save-${login!.id}`).click();
    await expect(cases.suiteItem(login!.id).getByRole("alert")).toHaveText("Nama suite sudah dipakai");
    await expect(input).toHaveValue("checkout");

    await input.fill("Masuk");
    await input.press("Enter");
    await expect(cases.suite(login!.id)).toContainText("Masuk");
    await page.reload();
    await expect(cases.suite(login!.id)).toContainText("Masuk");
    await expect(cases.suite(checkout!.id)).toContainText("Checkout");
  });

  test("tombol ▲/▼ mengubah urutan suite dan bertahan setelah reload", async ({ api, signedInPage }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["A", "B", "C"], casesPerSuite: 0 });
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);
    const [a, b, c] = suites;
    const items = cases.suiteList.getByTestId(/^suite-item-/);
    await cases.goto(project.slug);

    await expect(items).toContainText(["A", "B", "C"]);
    await expect(cases.suiteAction("up", a!.id)).toBeDisabled();
    await expect(cases.suiteAction("down", c!.id)).toBeDisabled();
    await expect(cases.suiteAction("up", b!.id)).toHaveAccessibleName("Pindah ke atas: B");
    await expect(cases.suiteAction("down", b!.id)).toHaveAccessibleName("Pindah ke bawah: B");

    await cases.suiteAction("down", a!.id).click();
    await expect(items).toContainText(["B", "A", "C"]);
    await cases.suiteAction("up", c!.id).click();
    await expect(items).toContainText(["B", "C", "A"]);

    await page.reload();
    await expect(items).toContainText(["B", "C", "A"]);
    await expect(cases.suiteAction("up", b!.id)).toBeDisabled();
    await expect(cases.suiteAction("down", a!.id)).toBeDisabled();
  });

  test("hapus suite kosong dengan konfirmasi inline; suite berisi case menampilkan pesan SUITE_NOT_EMPTY", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Berisi"], casesPerSuite: 1 });
    const empty = await api.createSuite(owner, project.slug, { name: "Kosong" });
    const [filled] = suites;
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);
    await cases.goto(project.slug);

    // Batal tidak menghapus apa pun.
    await cases.suiteAction("delete", empty.id).click();
    const confirm = page.getByTestId(`suite-delete-confirm-${empty.id}`);
    await expect(cases.suiteItem(empty.id)).toContainText("Hapus suite “Kosong”?");
    await page.getByTestId(`suite-delete-cancel-${empty.id}`).click();
    await expect(confirm).toHaveCount(0);
    await expect(cases.suiteItem(empty.id)).toBeVisible();

    await cases.suiteAction("delete", empty.id).click();
    await confirm.click();
    await expect(cases.suiteItem(empty.id)).toHaveCount(0);
    await page.reload();
    await expect(cases.suiteItem(empty.id)).toHaveCount(0);
    await expect(cases.suiteItem(filled!.id)).toBeVisible();

    await cases.suiteAction("delete", filled!.id).click();
    await page.getByTestId(`suite-delete-confirm-${filled!.id}`).click();
    await expect(cases.suiteItem(filled!.id).getByRole("alert")).toHaveText(
      "Pindahkan atau hapus case di suite ini terlebih dahulu.",
    );
    await expect(cases.suiteItem(filled!.id)).toBeVisible();
    await expect(cases.rows).toHaveCount(1);
  });
});

test.describe("Suite test manual (HP)", () => {
  test("di 375 px sidebar diganti suite-select; memilih suite menyaring daftar tanpa scroll horizontal", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login", "Checkout"], casesPerSuite: 2 });
    // Judul dan nama suite panjang tanpa spasi tidak boleh melebarkan halaman.
    const longTitle = "x".repeat(190);
    await api.createCase(owner, project.slug, { suiteId: suites[0]!.id, title: longTitle, steps: STEPS });
    const page = await (await newContext(await mobileContextOptions(owner))).newPage();
    const cases = new ManualCasesPage(page);
    const checkout = suites[1]!;

    await cases.goto(project.slug);
    await expect(cases.suiteSelect).toBeVisible();
    await expect(cases.suiteList).toBeHidden();
    await expect(cases.suiteSelect.locator("option")).toHaveText(["Semua suite", "Login (3)", "Checkout (2)"]);
    await expect(cases.suiteSelect).toHaveValue("");
    await expect(cases.coverage).toBeVisible();
    await expect(cases.rows).toHaveCount(5);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolationsInBothThemes(page);

    await cases.suiteSelect.selectOption(checkout.id);
    await expect(page).toHaveURL(new RegExp(`\\?suite=${checkout.id}$`));
    await expect(cases.rows).toHaveCount(2);

    await page.reload();
    await expect(cases.suiteSelect).toHaveValue(checkout.id);
    await expect(cases.rows).toHaveCount(2);

    await cases.suiteSelect.selectOption("");
    await expect(page).not.toHaveURL(/suite=/);
    await expect(cases.rows).toHaveCount(5);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("di 375 px admin menambah, mengganti nama, memindah, dan menghapus suite lewat kontrol suite terpilih", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login", "Checkout"], casesPerSuite: 1 });
    const page = await (await newContext(await mobileContextOptions(owner))).newPage();
    const cases = new ManualCasesPage(page);
    const manage = page.getByTestId("suite-manage-panel");
    const options = cases.suiteSelect.locator("option");
    await cases.goto(project.slug);

    // Sidebar tidak dirender di HP (id uji unik); kontrol ada di panel lipat.
    await expect(cases.suiteList).toHaveCount(0);
    await expect(cases.suiteAddInput).toBeHidden();
    await page.getByTestId("suite-manage-toggle").click();
    await expect(manage).toContainText("Pilih satu suite di atas");

    // Tambah suite.
    await cases.suiteAddInput.fill("Regresi");
    await cases.suiteAddSubmit.click();
    await expect(options).toHaveText(["Semua suite", "Login (1)", "Checkout (1)", "Regresi (0)"]);
    await expect(cases.suiteAddInput).toHaveValue("");
    await cases.suiteAddInput.fill("regresi");
    await cases.suiteAddInput.press("Enter");
    await expect(cases.suiteError).toHaveText("Nama suite sudah dipakai");

    // Pilih suite baru: kontrolnya muncul untuk suite itu saja.
    await cases.suiteSelect.selectOption({ label: "Regresi (0)" });
    // Select terkendali URL: nilainya baru terpasang setelah navigasi router selesai.
    await expect(cases.suiteSelect).not.toHaveValue("");
    const id = await cases.suiteSelect.inputValue();
    await expect(page).toHaveURL(new RegExp(`\\?suite=${id}$`));
    await expect(manage).toContainText("Suite terpilih: Regresi");
    await expect(cases.suiteAction("up", id)).toHaveAccessibleName("Pindah ke atas: Regresi");
    await expect(cases.suiteAction("down", id)).toHaveAccessibleName("Pindah ke bawah: Regresi");
    await expect(cases.suiteAction("down", id)).toBeDisabled();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolationsInBothThemes(page);

    // Ganti nama.
    await cases.suiteAction("rename", id).click();
    const input = page.getByTestId(`suite-rename-input-${id}`);
    await expect(input).toBeFocused();
    await input.fill("Regresi v2");
    await input.press("Enter");
    await expect(options).toHaveText(["Semua suite", "Login (1)", "Checkout (1)", "Regresi v2 (0)"]);
    await expect(manage).toContainText("Suite terpilih: Regresi v2");

    // Pindah ke atas dua kali; urutan bertahan setelah reload.
    await cases.suiteAction("up", id).click();
    await expect(options).toHaveText(["Semua suite", "Login (1)", "Regresi v2 (0)", "Checkout (1)"]);
    await cases.suiteAction("up", id).click();
    await expect(options).toHaveText(["Semua suite", "Regresi v2 (0)", "Login (1)", "Checkout (1)"]);
    await expect(cases.suiteAction("up", id)).toBeDisabled();
    await page.reload();
    await expect(options).toHaveText(["Semua suite", "Regresi v2 (0)", "Login (1)", "Checkout (1)"]);
    await expect(cases.suiteSelect).toHaveValue(id);

    // Hapus suite kosong dengan konfirmasi inline; pilihan dilepas dan kembali ke Semua suite.
    await page.getByTestId("suite-manage-toggle").click();
    await cases.suiteAction("delete", id).click();
    await expect(manage).toContainText("Hapus suite “Regresi v2”?");
    await page.getByTestId(`suite-delete-confirm-${id}`).click();
    await expect(options).toHaveText(["Semua suite", "Login (1)", "Checkout (1)"]);
    await expect(cases.suiteSelect).toHaveValue("");
    await expect(page).not.toHaveURL(/suite=/);
    await expect(manage).toContainText("Pilih satu suite di atas");

    // Suite berisi case: pesan SUITE_NOT_EMPTY di panel, suite tetap ada dan terpilih.
    const login = suites[0]!;
    await cases.suiteSelect.selectOption(login.id);
    await cases.suiteAction("delete", login.id).click();
    await page.getByTestId(`suite-delete-confirm-${login.id}`).click();
    await expect(manage.getByRole("alert")).toHaveText("Pindahkan atau hapus case di suite ini terlebih dahulu.");
    await expect(options).toHaveText(["Semua suite", "Login (1)", "Checkout (1)"]);
    await expect(cases.suiteSelect).toHaveValue(login.id);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("di 375 px berpindah suite di suite-select membuang kolom ganti nama, konfirmasi hapus, dan error suite sebelumnya", async ({
    api,
    newContext,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login", "Checkout"], casesPerSuite: 1 });
    const [login, checkout] = suites;
    const page = await (await newContext(await mobileContextOptions(owner))).newPage();
    const cases = new ManualCasesPage(page);
    const manage = page.getByTestId("suite-manage-panel");
    await cases.goto(project.slug, `?suite=${login!.id}`);
    await page.getByTestId("suite-manage-toggle").click();

    // Kolom ganti nama yang terbuka (dengan draf) tidak ikut ke suite lain.
    await cases.suiteAction("rename", login!.id).click();
    const loginInput = page.getByTestId(`suite-rename-input-${login!.id}`);
    await loginInput.fill("Draf untuk Login");
    await cases.suiteSelect.selectOption(checkout!.id);
    await expect(manage).toContainText("Suite terpilih: Checkout");
    await expect(page.locator('[data-testid^="suite-rename-input-"]')).toHaveCount(0);
    await expect(cases.suiteAction("rename", checkout!.id)).toBeVisible();
    // Membukanya lagi untuk suite baru menampilkan nama suite itu, bukan draf lama.
    await cases.suiteAction("rename", checkout!.id).click();
    await expect(page.getByTestId(`suite-rename-input-${checkout!.id}`)).toHaveValue("Checkout");
    await page.getByTestId(`suite-rename-cancel-${checkout!.id}`).click();

    // Konfirmasi hapus yang terbuka tidak ikut ke suite lain.
    await cases.suiteAction("delete", checkout!.id).click();
    await expect(manage).toContainText("Hapus suite “Checkout”?");
    await cases.suiteSelect.selectOption(login!.id);
    await expect(manage).toContainText("Suite terpilih: Login");
    await expect(manage).not.toContainText("Hapus suite");
    await expect(page.locator('[data-testid^="suite-delete-confirm-"]')).toHaveCount(0);

    // Error aksi sebelumnya (SUITE_NOT_EMPTY) tidak ikut ke suite lain.
    await cases.suiteAction("delete", login!.id).click();
    await page.getByTestId(`suite-delete-confirm-${login!.id}`).click();
    await expect(manage.getByRole("alert")).toHaveText("Pindahkan atau hapus case di suite ini terlebih dahulu.");
    await cases.suiteSelect.selectOption(checkout!.id);
    await expect(manage).toContainText("Suite terpilih: Checkout");
    await expect(manage.getByRole("alert")).toHaveCount(0);
  });

  test("di 375 px tester tidak melihat hapus suite, dan viewer tidak melihat kontrol kelola sama sekali", async ({
    api,
    newContext,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 0 });
    const tester = await api.addMember(owner, project.slug, "tester");
    const viewer = await api.addMember(owner, project.slug, "viewer");
    const suiteId = suites[0]!.id;

    const testerPage = await (await newContext(await mobileContextOptions(tester))).newPage();
    const testerCases = new ManualCasesPage(testerPage);
    await testerCases.goto(project.slug, `?suite=${suiteId}`);
    await testerPage.getByTestId("suite-manage-toggle").click();
    await expect(testerCases.suiteAction("rename", suiteId)).toBeVisible();
    await expect(testerCases.suiteAction("up", suiteId)).toBeVisible();
    await expect(testerCases.suiteAction("down", suiteId)).toBeVisible();
    await expect(testerCases.suiteAction("delete", suiteId)).toHaveCount(0);

    const viewerPage = await (await newContext(await mobileContextOptions(viewer))).newPage();
    const viewerCases = new ManualCasesPage(viewerPage);
    await viewerCases.goto(project.slug, `?suite=${suiteId}`);
    await expect(viewerCases.suiteSelect).toBeVisible();
    await expect(viewerPage.getByTestId("suite-manage-panel")).toHaveCount(0);
    await expect(viewerCases.suiteAddInput).toHaveCount(0);
  });
});

test.describe("Suite test manual (ganti ukuran)", () => {
  test("melebar dari HP ke desktop menukar suite-select dengan sidebar tanpa kehilangan pilihan", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login", "Checkout"], casesPerSuite: 1 });
    const page = await (await newContext(await mobileContextOptions(owner))).newPage();
    const cases = new ManualCasesPage(page);
    await cases.goto(project.slug, `?suite=${suites[1]!.id}`);
    await expect(cases.suiteSelect).toHaveValue(suites[1]!.id);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(cases.suiteSelect).toHaveCount(0);
    await expect(cases.suite(suites[1]!.id)).toHaveAttribute("aria-pressed", "true");
    await expect(cases.rows).toHaveCount(1);
    await expectNoA11yViolationsInBothThemes(page);
  });
});

test.describe("Daftar test case", () => {
  test("meter cakupan menampilkan 'X dari Y case aktif sudah diotomasi (Z%)'; case terarsip tidak dihitung", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 3 });
    const runId = await uploadRun(api, owner, project.slug, [{ suite: "login", name: "masuk berhasil" }]);
    const ids = await testCaseIds(owner, project.slug, runId);
    await api.updateCase(owner, project.slug, 1, { version: 1, automatedTestId: ids["masuk berhasil"]! });
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);

    await cases.goto(project.slug);
    await expect(cases.coverage).toContainText("1 dari 3 case aktif sudah diotomasi (33%)");
    await expect(cases.row(1)).toContainText("Otomatis");
    await expect(cases.row(2)).not.toContainText("Otomatis");
    await expectNoA11yViolationsInBothThemes(page);

    // Meter menghitung seluruh project, bukan hasil filter.
    await cases.suite(suites[0]!.id).click();
    await cases.priority.selectOption("urgent");
    await expect(cases.empty).toBeVisible();
    await expect(cases.coverage).toContainText("1 dari 3 case aktif sudah diotomasi (33%)");

    await api.updateCase(owner, project.slug, 3, { version: 1, archived: true });
    await page.goto(`/p/${project.slug}/cases`);
    await expect(cases.coverage).toContainText("1 dari 2 case aktif sudah diotomasi (50%)");
  });

  test("tanpa case aktif: meter tidak menampilkan persen dan daftar kosong mengajak membuat case", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);

    await cases.goto(project.slug);
    await expect(cases.coverage).toContainText("Belum ada case aktif");
    await expect(cases.coverage).not.toContainText("%");
    await expect(cases.empty).toContainText("Belum ada test case");
    await expect(cases.create).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("baris case menampilkan kode, judul, suite, prioritas, label, jumlah langkah, dan tautan ke detail", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 0 });
    await api.createCase(owner, project.slug, {
      suiteId: suites[0]!.id,
      title: "Login berhasil",
      priority: "high",
      labels: ["smoke", "ui"],
      steps: [...STEPS, { action: "Klik masuk", expected: "" }],
    });
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);

    await cases.goto(project.slug);
    const row = cases.row(1);
    await expect(row).toContainText("TC-1");
    await expect(row).toContainText("Login berhasil");
    await expect(row).toContainText("Login");
    await expect(row).toContainText("Prioritas Tinggi");
    await expect(row).toContainText("2 langkah");
    await expect(row).toContainText("smoke");
    await expect(row).toContainText("ui");
    await expect(row).toContainText("diubah");
    await expect(row.getByRole("link")).toHaveAttribute("href", `/p/${project.slug}/cases/1`);
    await expect(cases.create).toHaveAttribute("href", `/p/${project.slug}/cases/new`);

    // Membuat case dari suite terpilih membawa suite itu.
    await cases.suite(suites[0]!.id).click();
    await expect(cases.create).toHaveAttribute("href", `/p/${project.slug}/cases/new?suite=${suites[0]!.id}`);
  });

  test("filter cari, prioritas, label, otomasi, dan arsip tersimpan di URL dan bertahan setelah reload", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 0 });
    const suiteId = suites[0]!.id;
    await api.createCase(owner, project.slug, { suiteId, title: "Login berhasil", priority: "high", labels: ["smoke"], steps: STEPS });
    await api.createCase(owner, project.slug, { suiteId, title: "Login gagal", priority: "low", labels: ["regresi"], steps: STEPS });
    await api.createCase(owner, project.slug, { suiteId, title: "Bayar kartu", labels: ["smoke", "regresi"], steps: STEPS });
    await api.createCase(owner, project.slug, { suiteId, title: "Arsip lama", steps: STEPS });
    await api.updateCase(owner, project.slug, 4, { version: 1, archived: true });
    const runId = await uploadRun(api, owner, project.slug, [{ suite: "bayar", name: "kartu" }]);
    const ids = await testCaseIds(owner, project.slug, runId);
    await api.updateCase(owner, project.slug, 3, { version: 1, automatedTestId: ids["kartu"]! });
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);

    await cases.goto(project.slug);
    await expect(cases.rows).toHaveCount(3);
    await expect(cases.row(4)).toHaveCount(0);

    await cases.priority.selectOption("high");
    await expect(page).toHaveURL(/priority=high/);
    await expect(cases.rows).toHaveCount(1);
    await expect(cases.row(1)).toBeVisible();

    await cases.priority.selectOption("");
    await expect(page).not.toHaveURL(/priority=/);
    await expect(cases.label.locator("option")).toHaveText(["Semua label", "regresi", "smoke"]);
    await cases.label.selectOption("regresi");
    await expect(page).toHaveURL(/label=regresi/);
    await expect(cases.rows).toHaveCount(2);

    await cases.label.selectOption("");
    await cases.automated.selectOption("yes");
    await expect(page).toHaveURL(/automated=yes/);
    await expect(cases.rows).toHaveCount(1);
    await expect(cases.row(3)).toBeVisible();
    await cases.automated.selectOption("no");
    await expect(page).toHaveURL(/automated=no/);
    await expect(cases.rows).toHaveCount(2);
    await cases.automated.selectOption("");

    await cases.search.fill("LOGIN");
    await cases.searchSubmit.click();
    await expect(page).toHaveURL(/q=LOGIN/);
    await expect(cases.rows).toHaveCount(2);

    await cases.archived.check();
    await expect(page).toHaveURL(/archived=true/);
    await expect(cases.empty).toBeVisible();
    await cases.search.fill("");
    await cases.searchSubmit.click();
    await expect(cases.rows).toHaveCount(1);
    await expect(cases.row(4)).toContainText("Arsip lama");
    await expect(cases.row(4)).toContainText("Diarsipkan");

    await page.reload();
    await expect(cases.archived).toBeChecked();
    await expect(cases.search).toHaveValue("");
    await expect(cases.rows).toHaveCount(1);
    await cases.archived.uncheck();
    await cases.search.fill("login");
    await cases.search.press("Enter");
    await cases.priority.selectOption("low");

    await page.reload();
    await expect(cases.search).toHaveValue("login");
    await expect(cases.priority).toHaveValue("low");
    await expect(cases.rows).toHaveCount(1);
    await expect(cases.row(2)).toBeVisible();

    await cases.reset.click();
    await expect(page).toHaveURL(new RegExp(`/p/${project.slug}/cases$`));
    await expect(cases.rows).toHaveCount(3);
    await expect(cases.search).toHaveValue("");
  });

  test("parameter URL yang tidak valid hanya menggugurkan dirinya; Atur ulang filter membersihkannya", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 2 });
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);

    await cases.goto(project.slug, "?priority=bogus&suite=bukan-uuid&automated=no&archived=ya");
    await expect(cases.rows).toHaveCount(2);
    await expect(cases.automated).toHaveValue("no");
    await expect(cases.priority).toHaveValue("");
    await expect(cases.archived).not.toBeChecked();

    await cases.reset.click();
    await expect(page).toHaveURL(new RegExp(`/p/${project.slug}/cases$`));
    await expect(cases.reset).toHaveCount(0);
  });

  test("60 case: 50 pertama lalu 'Muat lagi' menambah sisanya", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    test.setTimeout(120_000);
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 60 });
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);

    await cases.goto(project.slug);
    await expect(cases.rows).toHaveCount(50);
    await expect(cases.loadMore).toHaveText("Muat lagi");
    await expect(cases.row(50)).toBeVisible();
    await expect(cases.row(51)).toHaveCount(0);
    await expectNoA11yViolationsInBothThemes(page);

    await cases.loadMore.click();
    await expect(cases.rows).toHaveCount(60);
    await expect(cases.row(60)).toBeVisible();
    await expect(cases.loadMore).toHaveCount(0);
  });
});

test.describe("Hak akses daftar test case", () => {
  test("tester melihat kontrol tulis tetapi bukan hapus suite; admin melihat hapus suite", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 1 });
    const tester = await api.addMember(owner, project.slug, "tester");
    const suiteId = suites[0]!.id;

    const { page: testerPage } = await signedInPage(tester);
    const testerCases = new ManualCasesPage(testerPage);
    await testerCases.goto(project.slug);
    await expect(testerCases.create).toBeVisible();
    await expect(testerCases.suiteAddInput).toBeVisible();
    await expect(testerCases.suiteAction("rename", suiteId)).toBeVisible();
    await expect(testerCases.suiteAction("up", suiteId)).toBeVisible();
    await expect(testerCases.suiteAction("down", suiteId)).toBeVisible();
    await expect(testerCases.suiteAction("delete", suiteId)).toHaveCount(0);

    const { page: ownerPage } = await signedInPage(owner);
    const ownerCases = new ManualCasesPage(ownerPage);
    await ownerCases.goto(project.slug);
    await expect(ownerCases.create).toBeVisible();
    await expect(ownerCases.suiteAction("delete", suiteId)).toBeVisible();
  });

  test("viewer dan anonim di project publik tidak melihat kontrol tulis, tetapi tetap melihat suite dan case", async ({
    api,
    signedInPage,
    newContext,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 1, visibility: "public" });
    const viewer = await api.addMember(owner, project.slug, "viewer");
    const outsider = await api.register();
    const suiteId = suites[0]!.id;
    const anonymous = await (await newContext()).newPage();

    const pages = [
      (await signedInPage(viewer)).page,
      (await signedInPage(outsider)).page,
      anonymous,
    ];
    for (const page of pages) {
      const cases = new ManualCasesPage(page);
      await cases.goto(project.slug);
      await expect(cases.suite(suiteId)).toContainText("Login");
      await expect(cases.rows).toHaveCount(1);
      await expect(cases.coverage).toBeVisible();
      await expect(cases.create).toHaveCount(0);
      await expect(cases.suiteAddInput).toHaveCount(0);
      await expect(cases.suiteAction("rename", suiteId)).toHaveCount(0);
      await expect(cases.suiteAction("up", suiteId)).toHaveCount(0);
      await expect(cases.suiteAction("down", suiteId)).toHaveCount(0);
      await expect(cases.suiteAction("delete", suiteId)).toHaveCount(0);
    }
  });

  test("project privat: non-anggota melihat 'tidak ditemukan'", async ({ api, signedInPage }) => {
    const { project } = await seedManualProject(api, { suites: 1, casesPerSuite: 1 });
    const outsider = await api.register();
    const { page } = await signedInPage(outsider);
    const cases = new ManualCasesPage(page);

    await cases.goto(project.slug);
    await expect(cases.notFound).toBeVisible();
    await expect(cases.list).toHaveCount(0);
  });
});

/** Case menurut server (bukan menurut UI). */
async function fetchCase(user: TestUser, slug: string, number: number): Promise<ManualCaseDto> {
  const res = await user.request.get(`/api/v1/projects/${slug}/cases/${number}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as ManualCaseDto;
}

test.describe("Form case: editor langkah", () => {
  test("tester membuat case 3 langkah, memindah langkah 3 ke posisi 1; detail menampilkan urutan baru", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login", "Checkout"], casesPerSuite: 0 });
    const { page } = await signedInPage(owner);
    const form = new ManualCaseFormPage(page);
    const detail = new ManualCasePage(page);

    // ?suite= memilih suite awal; tanpa itu suite pertama.
    await form.gotoNew(project.slug, `?suite=${suites[1]!.id}`);
    await expect(form.heading).toHaveText("Buat test case");
    await expect(form.suite).toHaveValue(suites[1]!.id);
    await expect(form.steps).toHaveCount(1);
    await expectNoA11yViolationsInBothThemes(page);

    await form.title.fill("Bayar dengan kartu");
    await form.action(0).fill("Buka keranjang");
    await form.expected(0).fill("Keranjang tampil");
    await form.addStep.click();
    await expect(form.action(1)).toBeFocused();
    await form.action(1).fill("Pilih kartu");
    await form.addStep.click();
    await form.action(2).fill("Konfirmasi bayar");
    await expect(form.steps).toHaveCount(3);
    await expect(form.stepAction(0, "up")).toBeDisabled();
    await expect(form.stepAction(2, "down")).toBeDisabled();

    // Langkah 3 → 2 → 1; isian "Hasil yang diharapkan" ikut berpindah bersama langkahnya, dan fokus tetap di tombolnya.
    await form.stepAction(2, "up").click();
    await expect(form.action(1)).toHaveValue("Konfirmasi bayar");
    await expect(form.action(2)).toHaveValue("Pilih kartu");
    await expect(form.stepAction(1, "up")).toBeFocused();
    await form.stepAction(1, "up").click();
    await expect(form.action(0)).toHaveValue("Konfirmasi bayar");
    await expect(form.action(1)).toHaveValue("Buka keranjang");
    await expect(form.expected(1)).toHaveValue("Keranjang tampil");
    await expect(form.stepAction(0, "up")).toBeDisabled();
    // Di posisi pertama ▲ nonaktif: fokus pindah ke ▼ langkah yang sama, tidak lepas ke awal halaman.
    await expect(form.stepAction(0, "down")).toBeFocused();

    await form.submit.click();
    await expect(page).toHaveURL(`/p/${project.slug}/cases/1`);
    await expect(detail.title).toHaveText("Bayar dengan kartu");
    await expect(detail.steps).toHaveCount(3);
    await expect(detail.step(0)).toContainText("Konfirmasi bayar");
    await expect(detail.step(1)).toContainText("Buka keranjang");
    await expect(detail.step(1)).toContainText("Keranjang tampil");
    await expect(detail.step(2)).toContainText("Pilih kartu");
    await expect(detail.suite).toHaveText("Checkout");
    const stored = await fetchCase(owner, project.slug, 1);
    expect(stored.steps.map((step) => step.action)).toEqual(["Konfirmasi bayar", "Buka keranjang", "Pilih kartu"]);
    expect(stored.suite.id).toBe(suites[1]!.id);

    await expectNoA11yViolationsInBothThemes(page);
  });

  test("menghapus langkah memindahkan fokus ke tetangganya; langkah terakhir yang tersisa menjadi satu langkah kosong; tombol tambah berhenti di 50", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 0 });
    const { page } = await signedInPage(owner);
    const form = new ManualCaseFormPage(page);

    await form.gotoNew(project.slug);
    await form.action(0).fill("Satu");
    await form.addStep.click();
    await form.action(1).fill("Dua");
    await form.addStep.click();
    await form.action(2).fill("Tiga");

    await form.stepAction(1, "remove").click();
    await expect(form.steps).toHaveCount(2);
    await expect(form.action(1)).toHaveValue("Tiga");
    await expect(form.stepAction(1, "remove")).toBeFocused();

    await form.stepAction(0, "remove").click();
    await form.stepAction(0, "remove").click();
    await expect(form.steps).toHaveCount(1);
    await expect(form.action(0)).toHaveValue("");
    await expect(form.expected(0)).toHaveValue("");

    for (let i = 1; i < 50; i += 1) await form.addStep.click();
    await expect(form.steps).toHaveCount(50);
    await expect(form.addStep).toBeDisabled();
    await expect(page.getByTestId("case-steps")).toContainText("(50 dari 50)");
    await expect(page.getByTestId("case-steps")).toContainText("Maksimal 50 langkah");
  });

  test("pratinjau Markdown berfungsi untuk prasyarat serta Aksi dan Hasil yang diharapkan tiap langkah", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 0 });
    const { page } = await signedInPage(owner);
    const form = new ManualCaseFormPage(page);

    await form.gotoNew(project.slug);
    await form.preconditions.fill("Akun **aktif** dan `saldo` cukup");
    await form.preconditionsPreviewTab.click();
    await expect(form.preconditionsPreview.locator("strong")).toHaveText("aktif");
    await expect(form.preconditionsPreview.locator("code")).toHaveText("saldo");
    await expect(form.preconditions).toBeHidden();
    await form.preconditionsWriteTab.click();
    await expect(form.preconditions).toBeVisible();

    await form.action(0).fill("Klik **Bayar**");
    await form.expected(0).fill("- Muncul struk\n- Saldo berkurang");
    await form.previewTab(0, "action").click();
    await expect(form.preview(0, "action").locator("strong")).toHaveText("Bayar");
    await form.previewTab(0, "expected").click();
    await expect(form.preview(0, "expected").locator("li")).toHaveCount(2);
    // Pratinjau satu kolom tidak menyentuh kolom lain; isian di Tulis tidak hilang.
    await expect(form.action(0)).toBeHidden();
    await form.writeTab(0, "action").click();
    await expect(form.action(0)).toHaveValue("Klik **Bayar**");
    await expect(form.expected(0)).toBeHidden();
  });

  test("pratinjau suatu langkah tetap pada langkahnya setelah dipindah", async ({ api, signedInPage }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 0 });
    const { page } = await signedInPage(owner);
    const form = new ManualCaseFormPage(page);

    await form.gotoNew(project.slug);
    await form.action(0).fill("Pertama **tebal**");
    await form.addStep.click();
    await form.action(1).fill("Kedua");
    await form.previewTab(0, "action").click();
    await expect(form.preview(0, "action")).toBeVisible();

    await form.stepAction(0, "down").click();
    await expect(form.preview(1, "action").locator("strong")).toHaveText("tebal");
    await expect(form.preview(0, "action")).toHaveCount(0);
    await expect(form.action(0)).toHaveValue("Kedua");
  });

  test("judul dan langkah kosong ditolak dengan pesan di bawah field-nya", async ({ api, signedInPage, expectNoA11yViolationsInBothThemes }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 0 });
    const { page } = await signedInPage(owner);
    const form = new ManualCaseFormPage(page);

    await form.gotoNew(project.slug);
    await form.title.fill("ab");
    await form.addStep.click();
    await form.action(1).fill("   ");
    await form.submit.click();

    await expect(form.titleError).toHaveText("Judul minimal 3 karakter");
    await expect(form.title.locator("xpath=..").getByTestId("field-error-title")).toBeVisible();
    await expect(form.title).toBeFocused();
    await expect(form.actionError(0)).toHaveText("Langkah wajib diisi");
    await expect(form.step(0).getByTestId("field-error-steps.0.action")).toBeVisible();
    await expect(form.actionError(1)).toHaveText("Langkah wajib diisi");
    await expect(form.step(1).getByTestId("field-error-steps.1.action")).toBeVisible();
    await expect(page).toHaveURL(/\/cases\/new$/);
    await expectNoA11yViolationsInBothThemes(page);

    // Setelah diperbaiki, simpan berhasil dan case benar-benar terbuat.
    await form.title.fill("Judul valid");
    await form.action(0).fill("Langkah satu");
    await form.stepAction(1, "remove").click();
    await form.submit.click();
    await expect(page).toHaveURL(`/p/${project.slug}/cases/1`);
  });

  test("error langkah mengikuti langkahnya saat dipindah atau saat langkah lain dihapus, dan hilang bersama langkah yang dihapus", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 0 });
    const { page } = await signedInPage(owner);
    const form = new ManualCaseFormPage(page);
    const invalid = (index: number) => form.action(index).and(page.locator('[aria-invalid="true"]'));

    // Langkah 3 kosong → error di langkah 3; dipindah ke atas, error ikut ke posisi barunya.
    await form.gotoNew(project.slug);
    await form.title.fill("Judul valid");
    await form.action(0).fill("Satu");
    await form.addStep.click();
    await form.action(1).fill("Dua");
    await form.addStep.click();
    await form.submit.click();
    await expect(form.actionError(2)).toHaveText("Langkah wajib diisi");
    await expect(invalid(2)).toHaveCount(1);
    await form.stepAction(2, "up").click();
    await expect(form.actionError(1)).toHaveText("Langkah wajib diisi");
    await expect(invalid(1)).toHaveCount(1);
    await expect(form.actionError(2)).toHaveCount(0);
    await expect(form.action(2)).not.toHaveAttribute("aria-invalid", "true");
    await expect(form.action(1)).toHaveValue("");

    // Langkah 2 (kosong) bermasalah; menghapus langkah 1 yang valid memindahkan error bersama langkahnya ke posisi 1.
    await form.submit.click();
    await expect(form.actionError(1)).toBeVisible();
    await form.stepAction(0, "remove").click();
    await expect(form.steps).toHaveCount(2);
    await expect(form.actionError(0)).toHaveText("Langkah wajib diisi");
    await expect(invalid(0)).toHaveCount(1);
    await expect(form.actionError(1)).toHaveCount(0);
    await expect(form.action(1)).not.toHaveAttribute("aria-invalid", "true");

    // Menghapus langkah yang bermasalah menghilangkan pesannya; langkah lain tidak ketularan.
    await form.stepAction(0, "remove").click();
    await expect(form.steps).toHaveCount(1);
    await expect(page.locator('[data-testid^="field-error-steps."]')).toHaveCount(0);
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  });

  test("kesalahan langkah dari server dipetakan ke langkahnya; pratinjau yang menyembunyikan kolom kembali ke Tulis", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 0 });
    const { page } = await signedInPage(owner);
    const form = new ManualCaseFormPage(page);
    await page.route(`**/api/v1/projects/${project.slug}/cases`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Data tidak valid",
            fields: { "steps.1.action": "Langkah maksimal 2000 karakter", "steps.0.expected": "Hasil yang diharapkan maksimal 2000 karakter" },
          },
        }),
      });
    });

    await form.gotoNew(project.slug);
    await form.title.fill("Judul valid");
    await form.action(0).fill("Satu");
    await form.addStep.click();
    await form.action(1).fill("Dua");
    await form.previewTab(1, "action").click();
    await form.submit.click();

    await expect(form.step(1).getByTestId("field-error-steps.1.action")).toHaveText("Langkah maksimal 2000 karakter");
    await expect(form.step(0).getByTestId("field-error-steps.0.expected")).toHaveText("Hasil yang diharapkan maksimal 2000 karakter");
    // Kolom bermasalah tampil kembali sebagai textarea dan menerima fokus.
    await expect(form.action(1)).toBeVisible();
    await expect(form.expected(0)).toBeFocused();
    await expect(page).toHaveURL(/\/cases\/new$/);
  });
});

test.describe("Form case: edit", () => {
  test("isian terisi dari case; suite dipindah, prioritas diubah, label ditambah dan dihapus", async ({ api, signedInPage }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login", "Checkout"], casesPerSuite: 0 });
    await api.createCase(owner, project.slug, {
      suiteId: suites[0]!.id,
      title: "Login berhasil",
      preconditions: "Akun **aktif**",
      priority: "urgent",
      labels: ["smoke", "ui"],
      steps: [
        { action: "Buka halaman", expected: "Halaman tampil" },
        { action: "Klik masuk", expected: "" },
      ],
    });
    const { page } = await signedInPage(owner);
    const form = new ManualCaseFormPage(page);
    const detail = new ManualCasePage(page);

    await form.gotoEdit(project.slug, 1);
    await expect(form.heading).toHaveText("Edit TC-1");
    await expect(form.suite).toHaveValue(suites[0]!.id);
    await expect(form.title).toHaveValue("Login berhasil");
    await expect(form.preconditions).toHaveValue("Akun **aktif**");
    await expect(form.priority).toHaveValue("urgent");
    await expect(form.steps).toHaveCount(2);
    await expect(form.expected(0)).toHaveValue("Halaman tampil");
    await expect(page.getByTestId("case-label-smoke")).toBeVisible();

    await form.suite.selectOption(suites[1]!.id);
    await form.priority.selectOption("low");
    await page.getByTestId("case-label-remove-smoke").click();
    await form.labelInput.fill("Regresi");
    await form.labelInput.press("Enter");
    await form.title.fill("Login berhasil (diubah)");
    await form.submit.click();

    await expect(page).toHaveURL(`/p/${project.slug}/cases/1`);
    await expect(detail.title).toHaveText("Login berhasil (diubah)");
    await expect(detail.suite).toHaveText("Checkout");
    await expect(detail.priority).toHaveText("Rendah");
    await expect(detail.labels).toContainText("ui");
    await expect(detail.labels).toContainText("regresi");
    await expect(detail.labels).not.toContainText("smoke");
    await expect(detail.preconditions.locator("strong")).toHaveText("aktif");
    const stored = await fetchCase(owner, project.slug, 1);
    expect(stored.version).toBe(2);
    expect(stored.labels).toEqual(["regresi", "ui"]);
  });

  test("kesalahan label yang belum jadi chip menahan penyimpanan", async ({ api, signedInPage }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 1 });
    const { page } = await signedInPage(owner);
    const form = new ManualCaseFormPage(page);

    await form.gotoEdit(project.slug, 1);
    await form.labelInput.fill("label salah!");
    await form.submit.click();
    await expect(page.getByTestId("field-error-labels")).toBeVisible();
    await expect(page).toHaveURL(/\/edit$/);
  });

  test("konflik dua tab: banner case-conflict, isian tidak dibuang, muat ulang menampilkan versi terbaru", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 1 });
    const { page: tabA } = await signedInPage(owner);
    const { page: tabB } = await signedInPage(owner);
    const formA = new ManualCaseFormPage(tabA);
    const formB = new ManualCaseFormPage(tabB);
    const detailB = new ManualCasePage(tabB);

    await formA.gotoEdit(project.slug, 1);
    await formB.gotoEdit(project.slug, 1);
    await formB.title.fill("Judul dari tab B");
    await formB.submit.click();
    await expect(detailB.title).toHaveText("Judul dari tab B");

    await formA.title.fill("Judul dari tab A");
    await formA.action(0).fill("Langkah dari tab A");
    await formA.submit.click();
    await expect(formA.conflict).toBeVisible();
    await expect(formA.conflict).toContainText("Case ini baru saja diubah orang lain");
    await expect(tabA).toHaveURL(/\/cases\/1\/edit$/);
    await expect(formA.title).toHaveValue("Judul dari tab A");
    await expect(formA.action(0)).toHaveValue("Langkah dari tab A");
    expect((await fetchCase(owner, project.slug, 1)).title).toBe("Judul dari tab B");
    await expectNoA11yViolationsInBothThemes(tabA);

    await formA.conflictReload.click();
    await expect(formA.conflict).toHaveCount(0);
    await expect(formA.title).toHaveValue("Judul dari tab B");
    await expect(formA.title).toBeFocused();
    await formA.title.fill("Judul akhir dari tab A");
    await formA.submit.click();
    await expect(tabA).toHaveURL(`/p/${project.slug}/cases/1`);
    expect((await fetchCase(owner, project.slug, 1)).title).toBe("Judul akhir dari tab A");
  });
});

test.describe("Tautan otomasi", () => {
  test("cari 'lo', pilih test: kartu menampilkan status terakhir dan meter cakupan naik; lepas tautan → Belum diotomasi", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 2 });
    const runId = await uploadRun(api, owner, project.slug, [
      { suite: "auth", name: "login works" },
      { suite: "auth", name: "signup works" },
    ]);
    const ids = await testCaseIds(owner, project.slug, runId);
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);
    const form = new ManualCaseFormPage(page);
    const detail = new ManualCasePage(page);

    await cases.goto(project.slug);
    await expect(cases.coverage).toContainText("0 dari 2 case aktif sudah diotomasi (0%)");

    await form.gotoEdit(project.slug, 1);
    await form.automationSearch.fill("l");
    await expect(form.automationOption(ids["login works"]!)).toHaveCount(0);
    await form.automationSearch.fill("lo");
    await expect(form.automationOption(ids["login works"]!)).toHaveText("auth › login works");
    await expect(form.automationOption(ids["signup works"]!)).toHaveCount(0);
    await expect(form.automationStatus).toHaveText("1 test ditemukan.");
    await expectNoA11yViolationsInBothThemes(page);

    // Enter di kolom cari tidak mengirim formulir.
    await form.automationSearch.press("Enter");
    await expect(page).toHaveURL(/\/cases\/1\/edit$/);

    await form.automationOption(ids["login works"]!).click();
    await expect(form.automationSelected).toContainText("auth › login works");
    await expect(form.automationSearch).toHaveCount(0);
    await expect(form.automationUnlink).toBeFocused();
    await form.submit.click();

    await expect(page).toHaveURL(`/p/${project.slug}/cases/1`);
    await expect(detail.automation).toContainText("auth › login works");
    await expect(detail.automationStatus).toContainText("Lulus");
    await expect(detail.automationStatus).toContainText("di main");
    await expect(detail.automationTest).toHaveAttribute("href", `/p/${project.slug}/tests/${ids["login works"]}`);
    await expect(detail.automationStatus.getByRole("link")).toHaveAttribute("href", `/p/${project.slug}/runs/${runId}`);
    await expectNoA11yViolationsInBothThemes(page);

    await cases.goto(project.slug);
    await expect(cases.coverage).toContainText("1 dari 2 case aktif sudah diotomasi (50%)");
    await expect(cases.row(1)).toContainText("Otomatis");

    await form.gotoEdit(project.slug, 1);
    await expect(form.automationSelected).toContainText("auth › login works");
    await form.automationUnlink.click();
    await expect(form.automationSearch).toBeFocused();
    await form.submit.click();
    await expect(page).toHaveURL(`/p/${project.slug}/cases/1`);
    await expect(detail.automation).toContainText("Belum diotomasi");
    await expect(detail.automationTest).toHaveCount(0);

    await cases.goto(project.slug);
    await expect(cases.coverage).toContainText("0 dari 2 case aktif sudah diotomasi (0%)");
    expect((await fetchCase(owner, project.slug, 1)).automatedTest).toBeNull();
  });

  test("kata cari tanpa hasil menampilkan pesan 'Tidak ada test yang cocok'", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 1 });
    const { page } = await signedInPage(owner);
    const form = new ManualCaseFormPage(page);

    await form.gotoEdit(project.slug, 1);
    await form.automationSearch.fill("tidak-ada-test-ini");
    await expect(form.automationStatus).toHaveText("Tidak ada test yang cocok.");
  });
});

test.describe("Detail case", () => {
  test("menampilkan judul, kode, suite, prioritas, label, prasyarat, dan langkah; riwayat eksekusi menaut ke halaman eksekusi", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Login"], casesPerSuite: 0 });
    await api.createCase(owner, project.slug, {
      suiteId: suites[0]!.id,
      title: "Login berhasil",
      preconditions: "Akun **aktif**",
      priority: "high",
      labels: ["smoke"],
      steps: [
        { action: "Buka *halaman* login", expected: "Form tampil" },
        { action: "Klik masuk", expected: "" },
      ],
    });
    const run = await api.createManualRun(owner, project.slug, { name: "Regresi", appVersion: "0.4.0", caseNumbers: [1] });
    const runCases = await owner.request.get(`/api/v1/projects/${project.slug}/manual-runs/${run.number}/cases`);
    const [runCase] = ((await runCases.json()) as { items: { id: string }[] }).items;
    await api.updateRunCase(owner, project.slug, run.number, runCase!.id, { version: 1, status: "failed" });
    const { page } = await signedInPage(owner);
    const detail = new ManualCasePage(page);

    await detail.goto(project.slug, 1);
    await expect(detail.title).toHaveText("Login berhasil");
    await expect(detail.meta).toContainText("TC-1");
    await expect(detail.suite).toHaveText("Login");
    await expect(detail.priority).toHaveText("Tinggi");
    await expect(detail.labels).toContainText("smoke");
    await expect(detail.preconditions.locator("strong")).toHaveText("aktif");
    await expect(detail.steps).toHaveCount(2);
    await expect(detail.step(0).locator("em")).toHaveText("halaman");
    await expect(detail.step(0)).toContainText("Form tampil");
    await expect(detail.automation).toContainText("Belum diotomasi");

    const row = detail.historyRow(run.number);
    await expect(row).toContainText("TR-1");
    await expect(row).toContainText("Regresi 0.4.0");
    await expect(row).toContainText("Gagal");
    await expect(row.getByRole("link")).toHaveAttribute("href", `/p/${project.slug}/manual-runs/${run.number}/cases/${runCase!.id}`);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("case yang belum pernah masuk run manual menampilkan keadaan kosong riwayat", async ({ api, signedInPage }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 1 });
    const { page } = await signedInPage(owner);
    const detail = new ManualCasePage(page);

    await detail.goto(project.slug, 1);
    await expect(detail.history).toContainText("Case ini belum pernah masuk run manual");
    await expect(detail.preconditions).toContainText("Tidak ada prasyarat");
  });

  test("case tidak ada atau nomor tidak valid: 'Case tidak ditemukan'", async ({ api, signedInPage }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 1 });
    const { page } = await signedInPage(owner);
    const detail = new ManualCasePage(page);
    const form = new ManualCaseFormPage(page);

    await page.goto(`/p/${project.slug}/cases/999`);
    await detail.waitForLoaded();
    await expect(detail.notFound).toBeVisible();
    await page.goto(`/p/${project.slug}/cases/abc`);
    await detail.waitForLoaded();
    await expect(detail.notFound).toBeVisible();
    await form.gotoEdit(project.slug, 999);
    await expect(form.notFound).toBeVisible();
  });

  test("konflik saat mengarsipkan: banner case-conflict; setelah muat ulang pengarsipan berhasil", async ({ api, signedInPage }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 1 });
    const { page } = await signedInPage(owner);
    const detail = new ManualCasePage(page);

    await detail.goto(project.slug, 1);
    // Orang lain mengubah case lebih dulu, jadi `version` yang dilihat halaman ini sudah usang.
    await api.updateCase(owner, project.slug, 1, { version: 1, title: "Judul dari orang lain" });
    await detail.archive.click();
    await expect(detail.conflict).toBeVisible();
    await expect(detail.archivedNote).toHaveCount(0);

    await detail.conflictReload.click();
    await expect(detail.conflict).toHaveCount(0);
    await expect(detail.title).toHaveText("Judul dari orang lain");
    await detail.archive.click();
    await expect(detail.archivedNote).toBeVisible();
    expect((await fetchCase(owner, project.slug, 1)).archivedAt).not.toBeNull();
  });
});

test.describe("Arsip dan hapus case", () => {
  test("arsipkan: case hilang dari daftar bawaan dan tampil dengan filter arsip; pulihkan mengembalikannya", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 2 });
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);
    const detail = new ManualCasePage(page);

    await detail.goto(project.slug, 1);
    await expect(detail.archive).toHaveText("Arsipkan");
    await detail.archive.click();
    await expect(detail.archive).toHaveText("Pulihkan");
    await expect(detail.archivedNote).toContainText("Diarsipkan");

    await cases.goto(project.slug);
    await expect(cases.rows).toHaveCount(1);
    await expect(cases.row(1)).toHaveCount(0);
    await expect(cases.coverage).toContainText("0 dari 1 case aktif");
    await cases.goto(project.slug, "?archived=true");
    await expect(cases.rows).toHaveCount(1);
    await expect(cases.row(1)).toContainText("Diarsipkan");

    await detail.goto(project.slug, 1);
    await detail.archive.click();
    await expect(detail.archive).toHaveText("Arsipkan");
    await expect(detail.archivedNote).toHaveCount(0);
    await cases.goto(project.slug);
    await expect(cases.rows).toHaveCount(2);
  });

  test("admin menghapus case lewat konfirmasi inline; Batal menutup konfirmasi tanpa menghapus", async ({ api, signedInPage }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 2 });
    const { page } = await signedInPage(owner);
    const cases = new ManualCasesPage(page);
    const detail = new ManualCasePage(page);

    await detail.goto(project.slug, 2);
    await detail.remove.click();
    await expect(detail.removeConfirm).toBeVisible();
    await expect(page.getByRole("group")).toContainText("Run manual lama tetap tersimpan");
    await expect(detail.removeCancel).toBeFocused();
    await detail.removeCancel.click();
    await expect(detail.removeConfirm).toHaveCount(0);
    await expect(detail.remove).toBeFocused();

    await detail.remove.click();
    await detail.removeConfirm.click();
    await expect(page).toHaveURL(`/p/${project.slug}/cases`);
    await cases.waitForLoaded();
    await expect(cases.rows).toHaveCount(1);
    await expect(cases.row(2)).toHaveCount(0);
    expect((await owner.request.get(`/api/v1/projects/${project.slug}/cases/2`)).status()).toBe(404);
  });

  test("tester melihat Edit dan Arsipkan tetapi bukan hapus permanen; viewer tidak melihat kontrol tulis", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 1, visibility: "public" });
    const tester = await api.addMember(owner, project.slug, "tester");
    const viewer = await api.addMember(owner, project.slug, "viewer");

    const testerPage = new ManualCasePage((await signedInPage(tester)).page);
    await testerPage.goto(project.slug, 1);
    await expect(testerPage.edit).toBeVisible();
    await expect(testerPage.archive).toBeVisible();
    await expect(testerPage.remove).toHaveCount(0);

    const viewerPage = new ManualCasePage((await signedInPage(viewer)).page);
    await viewerPage.goto(project.slug, 1);
    await expect(viewerPage.title).toBeVisible();
    await expect(viewerPage.edit).toHaveCount(0);
    await expect(viewerPage.archive).toHaveCount(0);
    await expect(viewerPage.remove).toHaveCount(0);
  });
});

test.describe("Hak akses form case", () => {
  test("viewer dan anonim tidak bisa membuka form; anonim diajak masuk", async ({ api, signedInPage, newContext }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 1, visibility: "public" });
    const viewer = await api.addMember(owner, project.slug, "viewer");
    const anonymous = await (await newContext()).newPage();

    const viewerForm = new ManualCaseFormPage((await signedInPage(viewer)).page);
    await viewerForm.gotoNew(project.slug);
    await expect(viewerForm.forbidden).toContainText("Peran viewer");
    await expect(viewerForm.form).toHaveCount(0);

    const anonymousForm = new ManualCaseFormPage(anonymous);
    await anonymousForm.gotoEdit(project.slug, 1);
    await expect(anonymousForm.forbidden).toBeVisible();
    await expect(anonymous.getByRole("link", { name: "Masuk" }).last()).toHaveAttribute("href", /\/login/);
  });

  test("project tanpa suite: form mengajak membuat suite lebih dulu", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const form = new ManualCaseFormPage(page);

    await form.gotoNew(project.slug);
    await expect(form.noSuite).toBeVisible();
    await expect(form.form).toHaveCount(0);
  });
});

test.describe("Teks panjang di form dan detail case", () => {
  // 300 karakter tanpa spasi + emoji, dan blok kode 500 karakter (Review Focus 5).
  const LONG = `${"A".repeat(300)}😀🎉`;
  const CODE = `\`\`\`\n${"x".repeat(500)}\n\`\`\``;

  test("langkah dan prasyarat panjang tersimpan utuh; tanpa scroll horizontal di 375 px, baik di form maupun di detail", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await seedManualProject(api, { suites: 1, casesPerSuite: 0 });
    const page = await (await newContext(await mobileContextOptions(owner))).newPage();
    const form = new ManualCaseFormPage(page);
    const detail = new ManualCasePage(page);

    await form.gotoNew(project.slug);
    await form.title.fill(`Judul ${"B".repeat(150)}`);
    await form.preconditions.fill(`${LONG}\n\n${CODE}`);
    await form.action(0).fill(LONG);
    await form.expected(0).fill(CODE);
    await form.addStep.click();
    await form.action(1).fill(CODE);
    await form.expected(1).fill(`${LONG}\n\n${CODE}`);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Mode pratinjau merender blok kode panjang di dalam wadah yang bisa digulir, bukan melebarkan halaman.
    await form.preconditionsPreviewTab.click();
    await form.previewTab(0, "action").click();
    await form.previewTab(1, "action").click();
    await form.previewTab(1, "expected").click();
    await expect(form.preview(1, "action").getByRole("region", { name: "Blok kode" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolationsInBothThemes(page);

    await form.submit.click();
    await expect(page).toHaveURL(`/p/${project.slug}/cases/1`);
    await expect(detail.title).toBeVisible();
    await expect(detail.step(1).getByRole("region", { name: "Blok kode" }).first()).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolationsInBothThemes(page);

    const stored = await fetchCase(owner, project.slug, 1);
    expect(stored.preconditions).toBe(`${LONG}\n\n${CODE}`);
    expect(stored.steps).toEqual([
      { action: LONG, expected: CODE },
      { action: CODE, expected: `${LONG}\n\n${CODE}` },
    ]);

    // Form edit dengan isi yang sama juga tidak melebar.
    await form.gotoEdit(project.slug, 1);
    await expect(form.action(0)).toHaveValue(LONG);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("di 375 px detail dengan label, riwayat, dan kartu otomasi tidak melebar", async ({ api, newContext }) => {
    const { owner, project, suites } = await seedManualProject(api, { suites: ["Suite dengan nama yang sangat panjang sekali ".repeat(2).trim()], casesPerSuite: 0 });
    const runId = await uploadRun(api, owner, project.slug, [{ suite: "s".repeat(80), name: "n".repeat(120) }]);
    const ids = await testCaseIds(owner, project.slug, runId);
    await api.createCase(owner, project.slug, {
      suiteId: suites[0]!.id,
      title: "J".repeat(190),
      labels: ["l".repeat(30), "m".repeat(30), "n".repeat(30)],
      steps: [{ action: "a", expected: "" }],
      automatedTestId: Object.values(ids)[0]!,
    });
    const run = await api.createManualRun(owner, project.slug, { name: "R".repeat(100), appVersion: "v".repeat(40), caseNumbers: [1] });
    expect(run.number).toBe(1);
    const page = await (await newContext(await mobileContextOptions(owner))).newPage();
    const detail = new ManualCasePage(page);

    await detail.goto(project.slug, 1);
    await expect(detail.automationStatus).toContainText("Lulus");
    await expect(detail.historyRow(1)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
