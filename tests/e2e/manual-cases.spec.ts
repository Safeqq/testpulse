import type { CreateCaseBody } from "@testpulse/shared";
import { BugsPage } from "../pages/BugsPage.js";
import { FlakyPage } from "../pages/FlakyPage.js";
import { ManualCasesPage } from "../pages/ManualCasesPage.js";
import { ProjectPage } from "../pages/ProjectPage.js";
import { ProjectTabsNav } from "../pages/ProjectTabsNav.js";
import { RunsPage } from "../pages/RunsPage.js";
import { VersionsPage } from "../pages/VersionsPage.js";
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
