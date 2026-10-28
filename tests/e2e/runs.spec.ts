import type { Page } from "@playwright/test";
import type { ProjectDto, RunDetailDto } from "@testpulse/shared";
import { FlakyPage } from "../pages/FlakyPage.js";
import { RunDetailPage } from "../pages/RunDetailPage.js";
import { RunsPage } from "../pages/RunsPage.js";
import { TestHistoryPage } from "../pages/TestHistoryPage.js";
import type { TestApi, TestUser } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { buildJUnit, type JUnitCase } from "../support/junit.js";

const COMMIT = "abcdef1234567890abcdef1234567890abcdef12";
const CI_URL = "https://ci.example.com/builds/42";
/** Batas menunggu halaman lazy setelah navigasi klien (unduh chunk pertama kali). */
const LAZY_NAVIGATION_TIMEOUT = 15_000;
const MULTILINE_MESSAGE = "Diharapkan 3 tetapi 4\n    di baris berindentasi\nbaris terakhir";

interface Upload {
  branch?: string;
  commit?: string;
  ciUrl?: string;
  name?: string;
}

async function upload(api: TestApi, token: string, slug: string, cases: JUnitCase[], extra: Upload = {}): Promise<string> {
  const res = await api.uploadRun(token, slug, buildJUnit(cases), { branch: extra.branch ?? "main", ...extra });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { runId: string }).runId;
}

async function newProject(api: TestApi, visibility?: "public"): Promise<{ owner: TestUser; project: ProjectDto; token: string }> {
  const owner = await api.register();
  const project = await api.createProject(owner);
  if (visibility) await api.setVisibility(owner, project.slug, visibility);
  const { token } = await api.createToken(owner, project.slug);
  return { owner, project, token };
}

/** Peta nama test -> testCaseId untuk satu run (lewat API, bukan UI). */
async function testCaseIds(owner: TestUser, slug: string, runId: string): Promise<Record<string, string>> {
  const res = await owner.request.get(`/api/v1/projects/${slug}/runs/${runId}?status=all`);
  expect(res.status()).toBe(200);
  const detail = (await res.json()) as RunDetailDto;
  return Object.fromEntries(detail.results.map((r) => [r.name, r.testCaseId]));
}

/** Satu run dengan empat jenis hasil: A lulus, B gagal (pesan multi-baris), C flaky, D dilewati. */
const DETAIL_CASES: JUnitCase[] = [
  { name: "A lulus" },
  { name: "B gagal", status: "failed", message: MULTILINE_MESSAGE },
  { name: "C flaky", retries: 1, message: "Percobaan pertama gagal" },
  { name: "D dilewati", status: "skipped" },
];

async function seedDetailRun(api: TestApi, visibility?: "public") {
  const { owner, project, token } = await newProject(api, visibility);
  const runId = await upload(api, token, project.slug, DETAIL_CASES, {
    branch: "main",
    commit: COMMIT,
    ciUrl: CI_URL,
    name: "Build #42",
  });
  return { owner, project, runId, ids: await testCaseIds(owner, project.slug, runId) };
}

/**
 * 22 run di `main`: F gagal di run ganjil (bolak-balik -> skor 95 di jendela 20), B gagal hanya di run terakhir (skor 5).
 * Mengembalikan id run terlama ke terbaru.
 */
async function seedFlakyHistory(api: TestApi, visibility?: "public") {
  const { owner, project, token } = await newProject(api, visibility);
  const runIds: string[] = [];
  for (let i = 0; i < 22; i += 1) {
    runIds.push(
      await upload(api, token, project.slug, [
        { name: "A" },
        { name: "F", status: i % 2 === 1 ? "failed" : "passed" },
        { name: "B", status: i === 21 ? "failed" : "passed" },
      ]),
    );
  }
  return { owner, project, runIds, ids: await testCaseIds(owner, project.slug, runIds[21]!) };
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("Daftar run", () => {
  test("memuat 20 run dulu, 'Muat lebih banyak' menambah sisanya lalu hilang", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, token } = await newProject(api);
    for (let i = 0; i < 25; i += 1) await upload(api, token, project.slug, [{ name: "A" }], { name: `Run ${i}` });
    const { page } = await signedInPage(owner);
    const runs = new RunsPage(page);

    await runs.goto(project.slug);
    await expect(runs.items).toHaveCount(20);
    await expect(runs.loadMore).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);

    await runs.loadMore.click();
    await expect(runs.items).toHaveCount(25);
    await expect(runs.loadMore).toHaveCount(0);

    // Run terbaru di atas; tautan menuju detail run.
    await expect(runs.items.first()).toContainText("Run 24");
    await expect(runs.items.last()).toContainText("Run 0");
    await expect(runs.items.first().getByRole("link")).toHaveAttribute("href", /^\/p\/[^/]+\/runs\/[0-9a-f-]{36}$/);
  });

  test("filter branch mengubah daftar dan tersimpan di URL", async ({ api, signedInPage }) => {
    const { owner, project, token } = await newProject(api);
    await upload(api, token, project.slug, [{ name: "A" }], { branch: "main", name: "Di main" });
    await upload(api, token, project.slug, [{ name: "A" }], { branch: "feature/x", name: "Di fitur" });
    await upload(api, token, project.slug, [{ name: "A" }], { branch: "main", name: "Di main lagi" });
    const { page } = await signedInPage(owner);
    const runs = new RunsPage(page);

    await runs.goto(project.slug);
    await expect(runs.items).toHaveCount(3);
    await expect(runs.branchFilter).toHaveValue("");
    await expect(runs.branchFilter.locator("option")).toHaveText(["Semua branch", "main", "feature/x"]);

    await runs.branchFilter.selectOption("feature/x");
    await expect(runs.items).toHaveCount(1);
    await expect(runs.items.first()).toContainText("Di fitur");
    await expect(page).toHaveURL(/\?branch=feature%2Fx$/);

    await runs.branchFilter.selectOption("");
    await expect(runs.items).toHaveCount(3);

    // Tautan langsung dengan ?branch= langsung terfilter.
    await runs.goto(project.slug, "main");
    await expect(runs.items).toHaveCount(2);
    await expect(runs.branchFilter).toHaveValue("main");
  });

  test("project tanpa run menampilkan keadaan kosong", async ({ api, signedInPage }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const { page } = await signedInPage(owner);
    const runs = new RunsPage(page);

    await runs.goto(project.slug);

    await expect(runs.empty).toContainText("Belum ada run");
    await expect(runs.items).toHaveCount(0);
  });
});

test.describe("Detail run", () => {
  test("header menampilkan branch, commit mono, link CI aman, durasi, dan total; filter bawaan Gagal", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, runId, ids } = await seedDetailRun(api);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);

    await run.goto(project.slug, runId);

    await expect(run.header).toContainText("main");
    await expect(run.header).toContainText("Build #42");
    await expect(run.commit).toHaveText(COMMIT);
    await expect(run.commit).toHaveCSS("font-family", /mono|Consolas|Menlo/i);
    await expect(run.ciLink).toHaveAttribute("href", CI_URL);
    await expect(run.ciLink).toHaveAttribute("target", "_blank");
    await expect(run.ciLink).toHaveAttribute("rel", /noopener/);
    await expect(run.ciLink).toHaveAttribute("rel", /noreferrer/);
    await expect(run.header).toContainText("4 (2 lulus, 1 gagal, 1 dilewati, 1 flaky)");
    // Durasi = jumlah durasi test setelah penggabungan: 0,1 + 0,1 + (0,1 + 0,1) + 0,1 dtk.
    await expect(run.header).toContainText("500 md");
    await expect(run.back).toHaveAttribute("href", `/p/${project.slug}/runs?branch=main`);

    // Filter bawaan: Gagal -> hanya B.
    await expect(run.filter("failed")).toHaveAttribute("aria-pressed", "true");
    await expect(run.rows).toHaveCount(1);
    await expect(run.row(ids["B gagal"]!)).toContainText("B gagal");
    await expect(run.row(ids["B gagal"]!)).toContainText("Gagal");
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("pesan error ada di <details> dengan spasi putih terjaga", async ({ api, signedInPage, expectNoA11yViolationsInBothThemes }) => {
    const { owner, project, runId, ids } = await seedDetailRun(api);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);
    await run.goto(project.slug, runId);

    const row = run.row(ids["B gagal"]!);
    const details = row.locator("details");
    await expect(details).toHaveCount(1);
    await expect(details).not.toHaveJSProperty("open", true);
    await details.locator("summary").click();
    await expect(details).toHaveJSProperty("open", true);

    const pre = details.locator("pre");
    await expect(pre).toBeVisible();
    await expect(pre).toHaveCSS("white-space", /pre-wrap/);
    // innerText mempertahankan baris baru dan indentasi (toHaveText menormalkan spasi, jadi tidak dipakai).
    expect(await pre.evaluate((el) => (el as HTMLElement).innerText)).toBe(MULTILINE_MESSAGE);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("filter Flaky dan Semua mengubah daftar hasil", async ({ api, signedInPage }) => {
    const { owner, project, runId, ids } = await seedDetailRun(api);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);
    await run.goto(project.slug, runId);
    await expect(run.rows).toHaveCount(1);

    await run.filter("flaky").click();
    await expect(run.filter("flaky")).toHaveAttribute("aria-pressed", "true");
    await expect(run.filter("failed")).toHaveAttribute("aria-pressed", "false");
    await expect(run.rows).toHaveCount(1);
    await expect(run.row(ids["C flaky"]!)).toContainText("Flaky");
    await expect(run.row(ids["C flaky"]!)).toContainText("1 percobaan ulang");
    // Header tidak ikut hilang saat daftar dimuat ulang.
    await expect(run.header).toBeVisible();

    await run.filter("all").click();
    await expect(run.rows).toHaveCount(4);
    await expect(run.row(ids["A lulus"]!)).toContainText("Lulus");
    await expect(run.row(ids["D dilewati"]!)).toContainText("Dilewati");

    await run.filter("failed").click();
    await expect(run.rows).toHaveCount(1);
  });

  test("run tanpa test gagal menampilkan pesan kosong pada filter Gagal", async ({ api, signedInPage }) => {
    const { owner, project, token } = await newProject(api);
    const runId = await upload(api, token, project.slug, [{ name: "A" }, { name: "B" }]);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);

    await run.goto(project.slug, runId);

    await expect(run.emptyResults).toContainText("Tidak ada test yang gagal");
    await expect(run.rows).toHaveCount(0);
  });

  test("hasil lebih dari 100 dimuat bertahap lewat 'Muat lebih banyak'", async ({ api, signedInPage }) => {
    const { owner, project, token } = await newProject(api);
    const cases = Array.from({ length: 110 }, (_, i) => ({ name: `Test ${String(i).padStart(3, "0")}` }));
    const runId = await upload(api, token, project.slug, cases);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);
    await run.goto(project.slug, runId);

    await run.filter("all").click();
    await expect(run.rows).toHaveCount(100);
    await run.loadMore.click();
    await expect(run.rows).toHaveCount(110);
    await expect(run.loadMore).toHaveCount(0);
  });

  test("nama test pada hasil menaut ke riwayat test", async ({ api, signedInPage }) => {
    const { owner, project, runId, ids } = await seedDetailRun(api);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);
    await run.goto(project.slug, runId);

    await run.row(ids["B gagal"]!).getByRole("link", { name: "B gagal" }).click();

    await expect(page).toHaveURL(new RegExp(`/p/${project.slug}/tests/${ids["B gagal"]}`));
    await expect(new TestHistoryPage(page).history).toBeVisible({ timeout: LAZY_NAVIGATION_TIMEOUT });
  });

  test("nama test pada run di branch non-bawaan membuka riwayat untuk branch itu", async ({ api, signedInPage }) => {
    const { owner, project, token } = await newProject(api);
    // Run fitur diunggah lebih dulu: branch run terbaru (bawaan API untuk riwayat) adalah main, bukan feature/x.
    const featureRunId = await upload(api, token, project.slug, [{ name: "F", status: "failed" }], { branch: "feature/x" });
    await upload(api, token, project.slug, [{ name: "F" }], { branch: "main" });
    await upload(api, token, project.slug, [{ name: "F" }], { branch: "main" });
    const ids = await testCaseIds(owner, project.slug, featureRunId);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);
    const history = new TestHistoryPage(page);
    await run.goto(project.slug, featureRunId);

    await run.row(ids.F!).getByRole("link", { name: "F" }).click();

    await expect(page).toHaveURL(`/p/${project.slug}/tests/${ids.F}?branch=feature%2Fx`);
    await expect(history.history).toBeVisible({ timeout: LAZY_NAVIGATION_TIMEOUT });
    await expect(history.branch).toHaveText("feature/x");
    await expect(history.cells).toHaveCount(1);
    await expect(history.cell(featureRunId)).toContainText("Gagal");
  });

  test("gagal mengunduh chunk halaman menampilkan pesan dengan tombol muat ulang, bukan layar kosong", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seedDetailRun(api);
    const { page } = await signedInPage(owner);
    // Dev server melayani src/pages/project/RunsPage.tsx; build produksi melayani assets/RunsPage-<hash>.js.
    await page.route(/\/RunsPage[.-]/, (route) => route.abort());

    await page.goto(`/p/${project.slug}/runs`);

    const error = page.getByTestId("chunk-error");
    await expect(error).toContainText("Halaman gagal dimuat");
    await expect(error.getByRole("button", { name: "Muat ulang halaman" })).toBeVisible();
    // Kerangka aplikasi (header) tetap ada.
    await expect(page.getByRole("banner")).toBeVisible();
  });

  test("run yang tidak ada menampilkan 'Run tidak ditemukan'", async ({ api, signedInPage, expectNoA11yViolationsInBothThemes }) => {
    const { owner, project } = await seedDetailRun(api);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);

    await run.goto(project.slug, "00000000-0000-4000-8000-000000000000");

    await expect(run.runNotFound).toContainText("Run tidak ditemukan");
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("tester menghapus run lewat konfirmasi inline lalu kembali ke daftar run", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, token } = await newProject(api);
    const keepId = await upload(api, token, project.slug, [{ name: "A" }], { name: "Dipertahankan" });
    const deleteId = await upload(api, token, project.slug, [{ name: "A" }], { name: "Dihapus" });
    const tester = await api.addMember(owner, project.slug, "tester");
    const { page } = await signedInPage(tester);
    const run = new RunDetailPage(page);
    const runs = new RunsPage(page);

    await run.goto(project.slug, deleteId);
    await expect(run.deleteConfirm).toHaveCount(0);
    await run.deleteButton.click();

    // Konfirmasi inline, bukan dialog.
    await expect(run.deleteConfirm).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expectNoA11yViolationsInBothThemes(page);

    // Batal mengembalikan keadaan semula tanpa menghapus.
    await run.deleteCancel.click();
    await expect(run.deleteConfirm).toHaveCount(0);
    await expect(run.deleteButton).toBeFocused();
    await run.deleteButton.click();

    await run.deleteConfirm.click();
    await expect(page).toHaveURL(`/p/${project.slug}/runs`);
    await expect(runs.list).toBeVisible({ timeout: LAZY_NAVIGATION_TIMEOUT });
    await expect(runs.item(keepId)).toBeVisible();
    await expect(runs.item(deleteId)).toHaveCount(0);

    // Halaman detail run yang sudah dihapus: tidak ditemukan.
    await run.goto(project.slug, deleteId);
    await expect(run.runNotFound).toBeVisible();
  });

  test("viewer tidak melihat tombol hapus run", async ({ api, signedInPage }) => {
    const { owner, project, runId } = await seedDetailRun(api);
    const viewer = await api.addMember(owner, project.slug, "viewer");
    const { page } = await signedInPage(viewer);
    const run = new RunDetailPage(page);

    await run.goto(project.slug, runId);

    await expect(run.header).toBeVisible();
    await expect(run.rows.first()).toBeVisible();
    await expect(run.deleteButton).toHaveCount(0);
  });

  test("pengunjung anonim project publik tidak melihat tombol hapus run", async ({ api, newContext }) => {
    const { project, runId } = await seedDetailRun(api, "public");
    const page = await (await newContext()).newPage();
    const run = new RunDetailPage(page);

    await run.goto(project.slug, runId);

    await expect(run.header).toBeVisible();
    await expect(run.deleteButton).toHaveCount(0);
  });
});

test.describe("Test flaky dan riwayat test", () => {
  test("daftar flaky terurut menurut skor, dengan bar skor dan tautan ke riwayat", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, ids } = await seedFlakyHistory(api);
    const { page } = await signedInPage(owner);
    const flaky = new FlakyPage(page);

    await flaky.goto(project.slug);

    await expect(flaky.branchFilter).toHaveValue("main");
    await expect(flaky.items).toHaveCount(2);
    await expect(flaky.items.nth(0).getByText("F", { exact: true })).toBeVisible();
    await expect(flaky.items.nth(0).getByText("Skor 95", { exact: true })).toBeVisible();
    await expect(flaky.items.nth(1).getByText("B", { exact: true })).toBeVisible();
    await expect(flaky.items.nth(1).getByText("Skor 5", { exact: true })).toBeVisible();
    // Bar skor dekoratif: angka sudah berupa teks.
    await expect(flaky.items.nth(0).getByRole("img")).toHaveCount(0);
    await expect(flaky.items.nth(0).getByRole("link")).toHaveAttribute(
      "href",
      `/p/${project.slug}/tests/${ids.F}?branch=main`,
    );
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("klik test flaky membuka riwayat dengan 20 hasil terbaru berlabel teks status", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, runIds, ids } = await seedFlakyHistory(api);
    const { page } = await signedInPage(owner);
    const flaky = new FlakyPage(page);
    const history = new TestHistoryPage(page);

    await flaky.goto(project.slug);
    await flaky.items.nth(0).getByRole("link").click();

    await expect(page).toHaveURL(new RegExp(`/p/${project.slug}/tests/${ids.F}`));
    // Navigasi klien ke halaman lazy: React menahan tampilan lama sampai chunk-nya terunduh, yang bisa lambat saat
    // tiga browser berjalan paralel melawan stack Docker (pernah terlihat >5 dtk di Firefox).
    await expect(history.title).toHaveText("F", { timeout: LAZY_NAVIGATION_TIMEOUT });
    await expect(history.cells).toHaveCount(20);

    // 22 run, hanya 20 terbaru (run ke-3 sampai ke-22), terlama di kiri; F gagal di run ganjil (indeks 1, 3, ...).
    await expect(history.cell(runIds[0]!)).toHaveCount(0);
    await expect(history.cell(runIds[1]!)).toHaveCount(0);
    await expect(history.cells.first()).toHaveAttribute("data-testid", `history-cell-${runIds[2]}`);
    await expect(history.cells.last()).toHaveAttribute("data-testid", `history-cell-${runIds[21]}`);
    await expect(history.cell(runIds[2]!)).toContainText("Lulus");
    await expect(history.cell(runIds[3]!)).toContainText("Gagal");
    await expect(history.cell(runIds[21]!)).toContainText("Gagal");

    // Status selalu berupa teks, bukan hanya warna.
    for (const cell of await history.cells.all()) await expect(cell).toHaveText(/Lulus|Gagal|Dilewati/);

    // Sel menaut ke detail run-nya.
    await expect(history.cell(runIds[21]!).getByRole("link")).toHaveAttribute(
      "href",
      `/p/${project.slug}/runs/${runIds[21]}`,
    );
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("riwayat menandai hasil flaky dalam run dan test yang tidak ada tidak ditemukan", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project, token } = await newProject(api);
    const runId = await upload(api, token, project.slug, [{ name: "F", retries: 1 }]);
    const ids = await testCaseIds(owner, project.slug, runId);
    const { page } = await signedInPage(owner);
    const history = new TestHistoryPage(page);

    await history.goto(project.slug, ids.F!);
    await expect(history.cell(runId)).toContainText("Lulus");
    await expect(history.cell(runId)).toContainText("Flaky");

    await history.goto(project.slug, "00000000-0000-4000-8000-000000000000");
    await expect(history.testNotFound).toContainText("Test tidak ditemukan");
  });

  test("project tanpa test flaky menampilkan keadaan kosong", async ({ api, signedInPage }) => {
    const { owner, project, token } = await newProject(api);
    await upload(api, token, project.slug, [{ name: "A" }]);
    const { page } = await signedInPage(owner);
    const flaky = new FlakyPage(page);

    await flaky.goto(project.slug);

    await expect(flaky.empty).toContainText("Tidak ada test flaky");
  });
});

test.describe("Akses publik dan privat", () => {
  test("anonim bisa membuka keempat halaman project publik (hanya-baca)", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { project, runIds, ids } = await seedFlakyHistory(api, "public");
    const page = await (await newContext()).newPage();
    const runs = new RunsPage(page);
    const run = new RunDetailPage(page);
    const flaky = new FlakyPage(page);
    const history = new TestHistoryPage(page);

    await runs.goto(project.slug);
    await expect(runs.items).toHaveCount(20);
    await expectNoA11yViolationsInBothThemes(page);

    await run.goto(project.slug, runIds[21]!);
    await expect(run.header).toBeVisible();
    await expect(run.rows).toHaveCount(2);
    await expectNoA11yViolationsInBothThemes(page);

    await flaky.goto(project.slug);
    await expect(flaky.items).toHaveCount(2);
    await expectNoA11yViolationsInBothThemes(page);

    await history.goto(project.slug, ids.F!);
    await expect(history.cells).toHaveCount(20);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("project privat menampilkan 'Project tidak ditemukan' di keempat halaman bagi non-anggota dan anonim", async ({
    api,
    signedInPage,
    newContext,
  }) => {
    const { project, runIds, ids } = await seedFlakyHistory(api);
    const outsider = await signedInPage();
    const anonymous = await (await newContext()).newPage();

    for (const page of [outsider.page, anonymous]) {
      const runs = new RunsPage(page);
      const run = new RunDetailPage(page);
      const flaky = new FlakyPage(page);
      const history = new TestHistoryPage(page);

      await runs.goto(project.slug);
      await expect(runs.notFound).toContainText("Project tidak ditemukan");
      await run.goto(project.slug, runIds[0]!);
      await expect(run.notFound).toContainText("Project tidak ditemukan");
      await flaky.goto(project.slug);
      await expect(flaky.notFound).toContainText("Project tidak ditemukan");
      await history.goto(project.slug, ids.F!);
      await expect(history.notFound).toContainText("Project tidak ditemukan");
    }
  });
});

test.describe("Masuk dari halaman privat", () => {
  test("tautan Masuk mempertahankan query halaman tujuan", async ({ api, newContext }) => {
    const { project } = await newProject(api);
    const page = await (await newContext()).newPage();
    const runs = new RunsPage(page);

    await runs.goto(project.slug, "feature/x");

    const next = encodeURIComponent(`/p/${project.slug}/runs?branch=feature%2Fx`);
    await expect(runs.notFound.getByRole("link", { name: "Masuk" })).toHaveAttribute("href", `/login?next=${next}`);
  });
});

test.describe("Tampilan 375 px", () => {
  test("keempat halaman tanpa gulir horizontal, termasuk branch, pesan, dan nama test yang sangat panjang", async ({
    api,
    newContext,
  }) => {
    const { owner, project, token } = await newProject(api);
    const longBranch = `feature/${"nama-branch-yang-sangat-panjang-".repeat(5)}x`;
    const longName = `test_${"nama_test_yang_sangat_panjang_".repeat(6)}`;
    const longMessage = `Gagal: ${"x".repeat(400)}\n${"    indentasi ".repeat(30)}`;
    const cases: JUnitCase[] = [
      { suite: `com.example.${"paket.".repeat(20)}Suite`, name: longName, status: "failed", message: longMessage },
      { name: "Test flaky", retries: 1 },
    ];
    await upload(api, token, project.slug, cases, { branch: "main" });
    const runId = await upload(api, token, project.slug, cases, {
      branch: longBranch,
      commit: COMMIT,
      ciUrl: `https://ci.example.com/${"jalur/".repeat(60)}`,
      name: "N".repeat(120),
    });
    const ids = await testCaseIds(owner, project.slug, runId);

    const context = await newContext({
      storageState: await owner.request.storageState(),
      viewport: { width: 375, height: 800 },
    });
    const page = await context.newPage();
    const runs = new RunsPage(page);
    const run = new RunDetailPage(page);
    const flaky = new FlakyPage(page);
    const history = new TestHistoryPage(page);

    await runs.goto(project.slug);
    await expect(runs.items.first()).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await run.goto(project.slug, runId);
    await run.rows.first().locator("summary").click();
    await expect(run.rows.first().locator("pre")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await run.filter("all").click();
    await expect(run.rows).toHaveCount(2);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await flaky.goto(project.slug, longBranch);
    await expect(flaky.items.first()).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await history.goto(project.slug, ids[longName]!, longBranch);
    await expect(history.cells).toHaveCount(1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
