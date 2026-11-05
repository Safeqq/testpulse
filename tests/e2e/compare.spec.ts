import type { Page } from "@playwright/test";
import { MAX_VERSIONS, type ProjectDto, type VersionDto } from "@testpulse/shared";
import { BugNewPage } from "../pages/BugNewPage.js";
import { ComparePage, type CompareGroupId } from "../pages/ComparePage.js";
import { RunDetailPage } from "../pages/RunDetailPage.js";
import { RunsPage } from "../pages/RunsPage.js";
import { VersionsPage } from "../pages/VersionsPage.js";
import type { TestApi, TestUser } from "../support/api-client.js";
import { CI_URL, COMMIT, horizontalOverflow, mobileContextOptions, testCaseIds } from "../support/bugs.js";
import { expect, test } from "../support/fixtures.js";
import { buildJUnit, type JUnitCase } from "../support/junit.js";

/**
 * v1.0.0 -> v1.0.1 berpola: 2 regresi (A, B), 1 diperbaiki (C), 1 masih gagal (D), 1 lebih lambat (E: 1,2 -> 3,4 dtk),
 * 3 baru (H, I, J), dan 1 hilang (G); F stabil.
 */
const V100: JUnitCase[] = [
  { suite: "checkout", name: "Regresi A" },
  { suite: "checkout", name: "Regresi B" },
  { suite: "auth", name: "Diperbaiki C", status: "failed", message: "Dulu gagal" },
  { suite: "auth", name: "Masih gagal D", status: "failed", message: "Masih rusak" },
  { suite: "report", name: "Melambat E", timeSec: 1.2 },
  { suite: "report", name: "Stabil F" },
  { suite: "report", name: "Hilang G" },
];
const V101: JUnitCase[] = [
  { suite: "checkout", name: "Regresi A", status: "failed", message: "Diharapkan 200 tetapi 500" },
  { suite: "checkout", name: "Regresi B", status: "failed", message: "Timeout setelah 5 dtk" },
  { suite: "auth", name: "Diperbaiki C" },
  { suite: "auth", name: "Masih gagal D", status: "failed", message: "Masih rusak" },
  { suite: "report", name: "Melambat E", timeSec: 3.4 },
  { suite: "report", name: "Stabil F" },
  { suite: "report", name: "Baru H" },
  { suite: "report", name: "Baru I" },
  { suite: "report", name: "Baru J" },
];

interface Seed {
  owner: TestUser;
  project: ProjectDto;
  token: string;
  run100: string;
  run101: string;
  /** Id test per nama (dari run v1.0.1). */
  ids: Record<string, string>;
}

async function publish(
  api: TestApi,
  token: string,
  slug: string,
  cases: JUnitCase[],
  options: { version?: string; branch?: string } = {},
): Promise<string> {
  const res = await api.uploadRun(token, slug, buildJUnit(cases), {
    branch: options.branch ?? "main",
    commit: COMMIT,
    ciUrl: CI_URL,
    ...(options.version !== undefined ? { version: options.version } : {}),
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { runId: string }).runId;
}

async function seedVersions(api: TestApi, visibility?: "public"): Promise<Seed> {
  const owner = await api.register();
  const project = await api.createProject(owner);
  if (visibility) await api.setVisibility(owner, project.slug, visibility);
  const { token } = await api.createToken(owner, project.slug);
  const run100 = await publish(api, token, project.slug, V100, { version: "1.0.0" });
  const run101 = await publish(api, token, project.slug, V101, { version: "1.0.1" });
  return { owner, project, token, run100, run101, ids: await testCaseIds(owner, project.slug, run101) };
}

const SENTENCE =
  "⚠ v1.0.1 punya 2 regresi baru dibanding v1.0.0, sementara 1 test yang dulu gagal kini lulus. Periksa sebelum rilis.";

const SUMMARY_REQUEST = /\/compare\?.*groups=none/;

/** Menunda permintaan ringkasan perbandingan (kartu dashboard/panel run) supaya keadaan memuat dapat diamati. */
async function delaySummary(page: Page, ms = 1500): Promise<void> {
  await page.route(SUMMARY_REQUEST, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

/** Buka semua kelompok yang tertutup (untuk pemindaian aksesibilitas isi lengkap). */
async function openAllGroups(compare: ComparePage): Promise<void> {
  for (const id of ["regressions", "fixed", "stillFailing", "slower", "added", "removed"] as CompareGroupId[]) {
    const group = compare.group(id);
    if (!(await group.evaluate((el) => (el as HTMLDetailsElement).open))) await group.locator("summary").click();
    await expect(group).toHaveJSProperty("open", true);
  }
}

test.describe("Kartu perbandingan di dashboard", () => {
  test("menampilkan kalimat peringatan dan angka, lalu membuka halaman perbandingan", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, run100, run101 } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);

    // Kartu hanya butuh ringkasan angka: permintaannya memakai groups=none (tanpa daftar test).
    const summaryRequest = page.waitForRequest((req) => /\/compare\?.*groups=none/.test(req.url()));
    await page.goto(`/p/${project.slug}`);
    await summaryRequest;
    const card = page.getByTestId("version-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("v1.0.1 vs v1.0.0");
    // Regresi baru yang ada diberi warna peringatan; kelompok lain netral.
    await expect(card.getByTestId("compare-count-regressions")).toHaveClass(/bg-destructive/);
    await expect(card.getByTestId("compare-count-fixed")).not.toHaveClass(/bg-destructive/);
    await expect(card.getByTestId("compare-sentence")).toHaveText(SENTENCE);
    await expect(card.getByTestId("compare-sentence").locator("strong")).toHaveText("2 regresi baru");
    await expect(card.getByTestId("compare-count-regressions")).toHaveText("2 Regresi baru");
    await expect(card.getByTestId("compare-count-fixed")).toHaveText("1 Diperbaiki");
    await expect(card.getByTestId("compare-count-stillFailing")).toHaveText("1 Masih gagal");
    await expect(card.getByTestId("compare-count-slower")).toHaveText("1 Lebih lambat");
    await expect(card.getByTestId("compare-count-added")).toHaveText("3 Test baru");
    await expect(card.getByTestId("compare-count-removed")).toHaveText("1 Test hilang");
    await expectNoA11yViolationsInBothThemes(page);

    await card.getByRole("link", { name: "Lihat perbandingan" }).click();
    await expect(compare.summary).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe(`/p/${project.slug}/compare`);
    expect(url.searchParams.get("base")).toBe(run100);
    expect(url.searchParams.get("target")).toBe(run101);
    await expect(compare.title).toHaveText("v1.0.1 dibanding v1.0.0");
  });

  test("tanpa versi memakai run sebelumnya sebagai pembanding", async ({ api, signedInPage }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const { token } = await api.createToken(owner, project.slug);
    await publish(api, token, project.slug, [{ name: "A" }, { name: "B" }]);
    await publish(api, token, project.slug, [{ name: "A" }, { name: "B", status: "failed" }]);
    const { page } = await signedInPage(owner);

    await page.goto(`/p/${project.slug}`);
    const card = page.getByTestId("version-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2 })).toHaveText(/^run #[0-9a-f]{8} · .+ vs run #[0-9a-f]{8} · .+$/);
    await expect(card.getByTestId("compare-sentence")).toContainText("punya 1 regresi baru dibanding run #");
  });

  test("dua run versi yang sama dibedakan dengan id run di kartu, judul, kalimat, dan baris", async ({
    api,
    signedInPage,
  }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const { token } = await api.createToken(owner, project.slug);
    const first = await publish(api, token, project.slug, [{ name: "A" }, { name: "B" }], { version: "1.0.0" });
    const second = await publish(api, token, project.slug, [{ name: "A" }, { name: "B", status: "failed" }], {
      version: "1.0.0",
    });
    const ids = await testCaseIds(owner, project.slug, second);
    const short = (id: string) => `v1.0.0 · run #${id.slice(0, 8)}`;
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);

    await page.goto(`/p/${project.slug}`);
    const card = page.getByTestId("version-card");
    await expect(card.getByRole("heading", { level: 2 })).toHaveText(`${short(second)} vs ${short(first)}`);
    await expect(card.getByTestId("compare-sentence")).toContainText(
      `${short(second)} punya 1 regresi baru dibanding ${short(first)}`,
    );

    await card.getByRole("link", { name: "Lihat perbandingan" }).click();
    await expect(compare.title).toHaveText(`${short(second)} dibanding ${short(first)}`);
    await expect(compare.row(ids["B"]!).locator("strong")).toHaveText([short(first), short(second)]);
    await expect(compare.row(ids["B"]!).locator("details summary")).toHaveText(`Lihat pesan error ${short(second)}`);
    // Pemilih: dua run dengan versi sama dibedakan dengan id run.
    await expect(compare.target.locator(`option[value="${first}"]`)).toContainText(`run #${first.slice(0, 8)}`);
    await expect(compare.target.locator(`option[value="${second}"]`)).toContainText(`run #${second.slice(0, 8)}`);
  });

  test("dashboard tampil lebih dulu; kartu memesan tempat tanpa menggeser isi saat ringkasan tiba", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    await delaySummary(page);

    await page.goto(`/p/${project.slug}`);
    const card = page.getByTestId("version-card");
    const trend = page.getByRole("heading", { name: "Tren pass rate" });
    // Dashboard sudah utuh sementara ringkasan perbandingan masih dimuat; tempat kartu sudah dipesan.
    await expect(page.getByTestId("stat-last-status")).toBeVisible();
    await expect(trend).toBeVisible();
    await expect(card).toHaveAttribute("aria-busy", "true");
    await expect(card.getByRole("status")).toHaveText("Memuat perbandingan…");
    const before = (await trend.boundingBox())!.y;

    await expect(card).toHaveAttribute("aria-busy", "false");
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("v1.0.1 vs v1.0.0");
    expect((await trend.boundingBox())!.y).toBe(before);
  });

  test("ringkasan gagal dimuat: kesalahan di dalam kartu, Coba lagi menjaga fokus di kartu", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    await page.route(SUMMARY_REQUEST, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );

    await page.goto(`/p/${project.slug}`);
    await expect(page.getByTestId("stat-last-status")).toBeVisible();
    const card = page.getByTestId("version-card");
    await expect(card).toHaveAttribute("data-state", "error");
    await expect(card).toContainText("Gagal memuat perbandingan.");

    await page.unroute(SUMMARY_REQUEST);
    await delaySummary(page);
    await card.getByRole("button", { name: "Coba lagi" }).click();
    // Tombol hilang saat memuat ulang, tetapi fokus tetap di kartu (bukan jatuh ke <body>).
    await expect(card).toHaveAttribute("data-state", "loading");
    await expect(card).toBeFocused();
    await expect(card).toHaveAttribute("data-state", "ready");
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("v1.0.1 vs v1.0.0");
    await expect(card).toBeFocused();
  });

  test("satu run saja: kartu tidak tampil dan halaman perbandingan menyatakan belum ada pembanding", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const { token } = await api.createToken(owner, project.slug);
    await publish(api, token, project.slug, [{ name: "A" }]);
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);

    await page.goto(`/p/${project.slug}`);
    await expect(page.getByTestId("stat-last-status")).toBeVisible();
    await expect(page.getByTestId("version-card")).toHaveCount(0);

    await compare.goto(`/p/${project.slug}/compare`);
    await expect(compare.sentence).toHaveText(/^Belum ada run pembanding untuk run #[0-9a-f]{8} · .+\.$/);
    await expect(compare.group("regressions")).toHaveCount(0);
    await expect(compare.base).toHaveValue("");
    await expect(compare.base.locator("option").first()).toHaveText("Pilih run pembanding");
    await expectNoA11yViolationsInBothThemes(page);
  });
});

test.describe("Halaman perbandingan", () => {
  test("judul, kalimat, ringkasan berurutan, kelompok terbuka/tertutup, dan isi baris", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, run100, run101, ids } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);

    await compare.goto(`/p/${project.slug}/compare`);
    await expect(compare.title).toHaveText("v1.0.1 dibanding v1.0.0");
    await expect(compare.sentence).toHaveText(SENTENCE);
    await expect(compare.sentence).toHaveAttribute("data-tone", "warning");
    await expect(compare.base).toHaveValue(run100);
    await expect(compare.target).toHaveValue(run101);
    await expect(page.getByTestId("compare-target-info")).toContainText(COMMIT.slice(0, 7));
    await expect(page.getByTestId("compare-target-info").getByRole("link", { name: /Buka di CI/ })).toHaveAttribute("href", CI_URL);

    // Urutan ringkasan mengikuti spec: Regresi baru, Diperbaiki, Masih gagal, Lebih lambat, Test baru, Test hilang.
    await expect(compare.summary.getByRole("listitem")).toHaveText([
      "2 Regresi baru",
      "1 Diperbaiki",
      "1 Masih gagal",
      "1 Lebih lambat",
      "3 Test baru",
      "1 Test hilang",
    ]);

    // Regresi & Diperbaiki terbuka, sisanya tertutup.
    await expect(compare.group("regressions")).toHaveJSProperty("open", true);
    await expect(compare.group("fixed")).toHaveJSProperty("open", true);
    for (const id of ["stillFailing", "slower", "added", "removed"] as const) {
      await expect(compare.group(id)).toHaveJSProperty("open", false);
    }
    await expect(compare.rows("regressions")).toHaveCount(2);
    await expect(compare.rows("fixed")).toHaveCount(1);

    // Baris regresi: nama, suite, status sebelum -> sesudah dengan ikon + teks, pesan error dalam <details>.
    const regress = compare.row(ids["Regresi A"]!);
    await expect(regress.getByRole("link", { name: "Regresi A" })).toHaveAttribute(
      "href",
      `/p/${project.slug}/tests/${ids["Regresi A"]!}?branch=main`,
    );
    await expect(regress).toContainText("checkout");
    const sides = regress.locator("strong");
    await expect(sides).toHaveText(["v1.0.0", "v1.0.1"]);
    // Status = ikon + teks (+ warna): "Lulus" hijau, "Gagal" merah, ikon ada di elemen status itu sendiri.
    const passed = regress.getByText("Lulus", { exact: true });
    const failed = regress.getByText("Gagal", { exact: true });
    await expect(passed).toBeVisible();
    await expect(failed).toBeVisible();
    await expect(passed.locator("svg[aria-hidden='true']")).toBeVisible();
    await expect(failed.locator("svg[aria-hidden='true']")).toBeVisible();
    await expect(passed).toHaveClass(/text-success/);
    await expect(failed).toHaveClass(/text-destructive/);
    await expect(compare.count("regressions")).toHaveClass(/bg-destructive/);
    await expect(compare.count("fixed")).not.toHaveClass(/bg-destructive/);
    await expect(regress).toContainText("Durasi:");
    const error = regress.locator("details");
    await expect(error).toHaveCount(1);
    await expect(error.locator("summary")).toHaveText("Lihat pesan error v1.0.1");
    await expect(error.locator("pre")).toBeHidden();
    await error.locator("summary").click();
    await expect(error.locator("pre")).toHaveText("Diharapkan 200 tetapi 500");

    // Sisi sebelum di kiri sesudah di layar lebar.
    const [baseBox, targetBox] = await Promise.all([sides.nth(0).boundingBox(), sides.nth(1).boundingBox()]);
    expect(targetBox!.x).toBeGreaterThan(baseBox!.x);
    expect(Math.abs(targetBox!.y - baseBox!.y)).toBeLessThan(8);

    // Diperbaiki: tanpa tombol laporan karena sudah lulus di target.
    await expect(compare.row(ids["Diperbaiki C"]!)).toContainText("Gagal");
    await expect(compare.row(ids["Diperbaiki C"]!).getByTestId(`report-bug-${ids["Diperbaiki C"]!}`)).toHaveCount(0);
    await expect(compare.row(ids["Diperbaiki C"]!).locator("details summary")).toHaveText("Lihat pesan error v1.0.0");

    // Kelompok tertutup dibuka dengan mengklik judulnya.
    await compare.group("slower").locator("summary").click();
    await expect(compare.row(ids["Melambat E"]!)).toContainText("1,2 dtk → 3,4 dtk (+183%)");
    await compare.group("stillFailing").locator("summary").click();
    await expect(compare.row(ids["Masih gagal D"]!).locator("details")).toHaveCount(2);
    await compare.group("added").locator("summary").click();
    await expect(compare.rows("added")).toHaveCount(3);
    await expect(compare.row(ids["Baru H"]!)).toContainText("Tidak ada");
    await expect(compare.row(ids["Baru H"]!)).toContainText("Lulus");

    // Angka ringkasan adalah tautan yang membuka kelompok tujuannya.
    await compare.count("removed").click();
    await expect(compare.group("removed")).toHaveJSProperty("open", true);
    await expect(page).toHaveURL(/#compare-group-removed$/);
    await expect(compare.rows("removed")).toHaveCount(1);
    await expect(compare.rows("removed").first()).toContainText("Hilang G");
    await expect(compare.rows("removed").first()).toContainText("Tidak ada");

    await openAllGroups(compare);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("kelompok kosong hanya satu baris dan kalimat sukses tanpa regresi", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const { token } = await api.createToken(owner, project.slug);
    await publish(api, token, project.slug, [{ name: "A" }, { name: "B" }], { version: "2.0.0" });
    await publish(api, token, project.slug, [{ name: "A" }, { name: "B" }], { version: "2.0.1" });
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);

    await compare.goto(`/p/${project.slug}/compare`);
    await expect(compare.sentence).toHaveText("✓ Tidak ada regresi dibanding v2.0.0.");
    await expect(compare.sentence).toHaveAttribute("data-tone", "success");
    await expect(compare.group("regressions")).toContainText("Regresi baru (0)");
    await expect(compare.group("regressions")).toContainText("Tidak ada regresi baru ✓");
    // Kelompok kosong bukan <details>: satu baris tanpa isi yang dapat dibuka.
    await expect(compare.group("regressions").locator("summary")).toHaveCount(0);
    await expect(compare.group("fixed")).toContainText("Tidak ada test yang diperbaiki");
    await expect(compare.summary.getByRole("listitem")).toHaveText([
      "0 Regresi baru",
      "0 Diperbaiki",
      "0 Masih gagal",
      "0 Lebih lambat",
      "0 Test baru",
      "0 Test hilang",
    ]);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("tanpa regresi tetapi ada perbaikan menyebut jumlah yang kini lulus", async ({ api, signedInPage }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const { token } = await api.createToken(owner, project.slug);
    await publish(api, token, project.slug, [{ name: "A", status: "failed" }, { name: "B", status: "failed" }], { version: "3.0.0" });
    await publish(api, token, project.slug, [{ name: "A" }, { name: "B" }], { version: "3.0.1" });
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);

    await compare.goto(`/p/${project.slug}/compare`);
    await expect(compare.sentence).toHaveText("✓ Tidak ada regresi. 2 test yang dulu gagal kini lulus.");
    await expect(compare.group("regressions")).toContainText("Tidak ada regresi baru ✓");
    await expect(compare.rows("fixed")).toHaveCount(2);
  });

  test("ganti base dan target lewat <select>, opsi yang sama dinonaktifkan, dan URL dapat dibagikan", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const { token } = await api.createToken(owner, project.slug);
    const run090 = await publish(api, token, project.slug, [{ name: "A" }, { name: "G" }], { version: "0.9.0" });
    const run100 = await publish(api, token, project.slug, V100, { version: "1.0.0" });
    const run101 = await publish(api, token, project.slug, V101, { version: "1.0.1" });
    const runTanpaVersi = await publish(api, token, project.slug, [{ name: "A" }]);
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);

    await compare.goto(`/p/${project.slug}/compare`);
    await expect(compare.title).toHaveText("v1.0.1 dibanding v1.0.0");
    // Pemilih menawarkan run tiap versi dan run terbaru branch yang belum termasuk versi.
    await expect(compare.target.locator("optgroup")).toHaveCount(2);
    await expect(compare.target.locator("optgroup").first()).toHaveAttribute("label", "Versi");
    await expect(compare.target.locator("optgroup").nth(1)).toHaveAttribute("label", "Run terbaru");
    await expect(compare.target.locator(`optgroup[label="Run terbaru"] option[value="${runTanpaVersi}"]`)).toContainText("run #");
    await expect(compare.target.locator(`option[value="${run090}"]`)).toContainText("v0.9.0");

    // Pemilih base selalu menonaktifkan target yang tampil. Pemilih target hanya menonaktifkan base yang disematkan
    // di URL: base default dihitung ulang untuk target baru, jadi memilih run yang kini menjadi base default boleh.
    await expect(compare.base.locator(`option[value="${run101}"]`)).toBeDisabled();
    await expect(compare.base.locator(`option[value="${run100}"]`)).toBeEnabled();
    await expect(compare.target.locator(`option[value="${run100}"]`)).toBeEnabled();
    await compare.target.selectOption(run100);
    await expect(compare.title).toHaveText("v1.0.0 dibanding v0.9.0");
    expect(new URL(page.url()).searchParams.get("base")).toBeNull();
    await compare.goto(`/p/${project.slug}/compare`);
    await expect(compare.title).toHaveText("v1.0.1 dibanding v1.0.0");

    // Mengganti base menyematkan target yang tampil di URL; sejak itu base yang disematkan nonaktif di pemilih target.
    await compare.base.focus();
    await compare.base.selectOption(run090);
    await expect(compare.title).toHaveText("v1.0.1 dibanding v0.9.0");
    await expect(compare.base).toHaveValue(run090);
    // Pemilih tetap terpasang selama perbandingan baru dimuat, jadi fokus keyboard tidak hilang.
    await expect(compare.base).toBeFocused();
    await expect(compare.sentence).toContainText("dibanding v0.9.0");
    const shared = new URL(page.url());
    expect(shared.searchParams.get("base")).toBe(run090);
    expect(shared.searchParams.get("target")).toBe(run101);
    await expect(compare.target.locator(`option[value="${run090}"]`)).toBeDisabled();
    await expect(compare.target.locator(`option[value="${run100}"]`)).toBeEnabled();
    await expect(compare.base.locator(`option[value="${run101}"]`)).toBeDisabled();

    // Memuat ulang URL yang sama menghasilkan perbandingan yang sama.
    await page.reload();
    await expect(compare.summary).toBeVisible();
    await expect(compare.title).toHaveText("v1.0.1 dibanding v0.9.0");
    await expect(compare.base).toHaveValue(run090);

    // Target diganti ke versi terendah: tidak ada versi di bawahnya, tetapi base eksplisit dipertahankan di URL.
    await compare.target.selectOption(run100);
    await expect(compare.title).toHaveText("v1.0.0 dibanding v0.9.0");
    expect(new URL(page.url()).searchParams.get("target")).toBe(run100);
    await expectNoA11yViolationsInBothThemes(page);

    // Tautan langsung dengan base & target lain membuka pasangan itu.
    await compare.goto(`/p/${project.slug}/compare?base=${run101}&target=${run100}`);
    await expect(compare.title).toHaveText("v1.0.0 dibanding v1.0.1");
    // Arah terbalik: regresi menjadi perbaikan.
    await expect(compare.count("regressions")).toHaveText("1 Regresi baru");
  });

  test("target tanpa versi di bawahnya dapat diberi pembanding secara manual", async ({ api, signedInPage }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const { token } = await api.createToken(owner, project.slug);
    const run090 = await publish(api, token, project.slug, [{ name: "A" }], { version: "0.9.0" });
    const run100 = await publish(api, token, project.slug, [{ name: "A" }, { name: "B" }], { version: "1.0.0" });
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);

    // Versi terendah tidak punya pembanding default; pembanding dipilih manual dari <select>.
    await compare.goto(`/p/${project.slug}/compare?target=${run090}`);
    await expect(compare.title).toHaveText("Perbandingan v0.9.0");
    await expect(compare.sentence).toHaveText("Belum ada run pembanding untuk v0.9.0.");
    await expect(compare.sentence).toHaveAttribute("data-tone", "neutral");
    await expect(compare.base).toHaveValue("");
    await compare.base.selectOption(run100);
    await expect(compare.title).toHaveText("v0.9.0 dibanding v1.0.0");
    await expect(compare.count("removed")).toHaveText("1 Test hilang");
  });

  test("base sama dengan target dari URL ditolak dengan pesan, bukan layar kosong", async ({ api, signedInPage }) => {
    const { owner, project, run101 } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);

    await compare.goto(`/p/${project.slug}/compare?base=${run101}&target=${run101}`);
    await expect(compare.sameRun).toContainText("Run pembanding dan target tidak boleh sama");
    await compare.sameRun.getByRole("link", { name: "Buka perbandingan default" }).click();
    await expect(compare.title).toHaveText("v1.0.1 dibanding v1.0.0");
  });

  test("id run yang tidak ada ditampilkan sebagai tidak ditemukan", async ({ api, signedInPage }) => {
    const { owner, project } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);

    await compare.goto(`/p/${project.slug}/compare?target=00000000-0000-4000-8000-000000000000`);
    await expect(compare.notFound).toContainText("Run tidak ditemukan");
  });

  test("kelompok besar: 200 pertama, Muat lagi menambah sisanya, dan cursor usang menawarkan muat ulang", async ({
    api,
    signedInPage,
  }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const { token } = await api.createToken(owner, project.slug);
    await publish(api, token, project.slug, [{ name: "Dasar" }], { version: "1.0.0" });
    const added: JUnitCase[] = Array.from({ length: 205 }, (_, i) => ({ name: `Baru ${String(i).padStart(3, "0")}` }));
    await publish(api, token, project.slug, [{ name: "Dasar" }, ...added], { version: "1.0.1" });
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);

    await compare.goto(`/p/${project.slug}/compare`);
    await expect(compare.count("added")).toHaveText("205 Test baru");
    await compare.group("added").locator("summary").click();
    await expect(compare.rows("added")).toHaveCount(200);
    await expect(compare.more("added")).toBeVisible();

    // Cursor usang (mis. run diganti sementara): 400 fields.cursor -> tawaran muat ulang, bukan kesalahan buntu.
    const staleCursor = /\/compare\?.*group=added/;
    await page.route(staleCursor, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Data tidak valid", fields: { cursor: "Cursor tidak valid" } } }),
      }),
    );
    await compare.more("added").click();
    await expect(page.getByRole("alert").filter({ hasText: "Perbandingan ini sudah berubah" })).toBeVisible();
    await expect(compare.rows("added")).toHaveCount(200);
    await expect(compare.more("added")).toHaveCount(0);
    await page.unroute(staleCursor);

    await page.getByRole("button", { name: "Muat ulang perbandingan" }).click();
    await expect(compare.summary).toBeVisible();
    await compare.group("added").locator("summary").click();
    await expect(compare.rows("added")).toHaveCount(200);
    await compare.more("added").click();
    await expect(compare.rows("added")).toHaveCount(205);
    await expect(compare.more("added")).toHaveCount(0);
  });
});

test.describe("Laporkan bug dari baris perbandingan", () => {
  test("form terisi dengan run target, lalu badge bug menggantikan tombol", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, run101, ids } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    const compare = new ComparePage(page);
    const form = new BugNewPage(page);
    const reportRegression = page.getByTestId(`report-bug-${ids["Regresi A"]!}`);

    await compare.goto(`/p/${project.slug}/compare`);
    await expect(reportRegression).toBeVisible();
    await expect(reportRegression).toHaveAccessibleDescription("Regresi A");
    // Tombol hanya untuk test yang gagal di target (regresi dan masih gagal), bukan yang diperbaiki.
    await expect(page.getByTestId(`report-bug-${ids["Masih gagal D"]!}`)).toHaveCount(0);
    await compare.group("stillFailing").locator("summary").click();
    await expect(page.getByTestId(`report-bug-${ids["Masih gagal D"]!}`)).toBeVisible();
    await expect(page.getByTestId(`report-bug-${ids["Diperbaiki C"]!}`)).toHaveCount(0);

    await reportRegression.click();
    await expect(form.form).toBeVisible();
    expect(page.url()).toContain(`/bugs/new?testCaseId=${ids["Regresi A"]!}&runId=${run101}`);
    await expect(form.title).toHaveValue("Regresi A");
    await expect(form.description).toHaveValue(/Diharapkan 200 tetapi 500/);
    await form.submit.click();
    await page.waitForURL(new RegExp(`/p/${project.slug}/bugs/1$`));

    // Kembali ke perbandingan: badge menggantikan tombol pada baris itu saja.
    await compare.goto(`/p/${project.slug}/compare`);
    const row = compare.row(ids["Regresi A"]!);
    await expect(row.getByTestId("bug-badge-1")).toContainText("Bug #1 · Open");
    await expect(row.getByTestId("bug-badge-1")).toHaveAttribute("href", `/p/${project.slug}/bugs/1`);
    await expect(page.getByTestId(`report-bug-${ids["Regresi A"]!}`)).toHaveCount(0);
    await expect(page.getByTestId(`report-bug-${ids["Regresi B"]!}`)).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);

    // Bug ditutup: tombol kembali.
    await api.updateBug(owner, project.slug, 1, { version: 1, status: "closed", resolution: "wont_fix" });
    await compare.goto(`/p/${project.slug}/compare`);
    await expect(page.getByTestId("bug-badge-1")).toHaveCount(0);
    await expect(page.getByTestId(`report-bug-${ids["Regresi A"]!}`)).toBeVisible();
  });

  test("viewer dan anonim melihat badge tetapi tidak tombol", async ({ api, signedInPage, newContext }) => {
    const { owner, project, run101, ids } = await seedVersions(api, "public");
    const viewer = await api.addMember(owner, project.slug, "viewer");
    await api.createBug(owner, project.slug, { title: "Regresi A", testCaseId: ids["Regresi A"]!, runId: run101 });
    const anonymous = await (await newContext()).newPage();
    const { page: viewerPage } = await signedInPage(viewer);

    for (const page of [viewerPage, anonymous]) {
      const compare = new ComparePage(page);
      await compare.goto(`/p/${project.slug}/compare`);
      await expect(compare.row(ids["Regresi A"]!).getByTestId("bug-badge-1")).toBeVisible();
      await expect(page.getByTestId(`report-bug-${ids["Regresi B"]!}`)).toHaveCount(0);
      await expect(compare.row(ids["Regresi B"]!)).toBeVisible();
    }
  });
});

test.describe("Panel perbandingan di detail run", () => {
  test("run sebagai target menampilkan 'Dibanding {base}' dengan ringkasan yang sama", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, run100, run101 } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);
    const compare = new ComparePage(page);

    await run.goto(project.slug, run101);
    const panel = page.getByTestId("run-compare-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Dibanding v1.0.0");
    await expect(panel.getByTestId("compare-sentence")).toHaveText(SENTENCE);
    await expect(panel.getByTestId("compare-count-regressions")).toHaveText("2 Regresi baru");
    await expect(page.getByTestId("run-version")).toHaveText("v1.0.1");
    await expectNoA11yViolationsInBothThemes(page);

    await panel.getByRole("link", { name: "Lihat perbandingan" }).click();
    await expect(compare.title).toHaveText("v1.0.1 dibanding v1.0.0");
    expect(new URL(page.url()).searchParams.get("base")).toBe(run100);

    // Run pertama tidak punya pembanding: panel tidak tampil.
    const answered = page.waitForResponse((res) => res.url().includes("groups=none") && res.url().includes(`target=${run100}`));
    await run.goto(project.slug, run100);
    await answered;
    await expect(run.header).toBeVisible();
    await expect(page.getByTestId("run-compare-panel")).toHaveCount(0);
  });

  test("halaman tampil lebih dulu; panel memesan tempat tanpa menggeser hasil saat ringkasan tiba", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project, run101 } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);
    await delaySummary(page);

    await run.goto(project.slug, run101);
    const panel = page.getByTestId("run-compare-panel");
    await expect(panel).toHaveAttribute("aria-busy", "true");
    await expect(run.rows.first()).toBeVisible();
    const before = (await run.rows.first().boundingBox())!.y;

    await expect(panel).toHaveAttribute("aria-busy", "false");
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Dibanding v1.0.0");
    expect((await run.rows.first().boundingBox())!.y).toBe(before);
  });

  test("ringkasan gagal dimuat: kesalahan di dalam panel, Coba lagi menjaga fokus di panel", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project, run101 } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);
    await page.route(SUMMARY_REQUEST, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );

    await run.goto(project.slug, run101);
    const panel = page.getByTestId("run-compare-panel");
    await expect(panel).toHaveAttribute("data-state", "error");
    await expect(panel).toContainText("Gagal memuat perbandingan.");
    await expect(run.rows.first()).toBeVisible();

    await page.unroute(SUMMARY_REQUEST);
    await delaySummary(page);
    await panel.getByRole("button", { name: "Coba lagi" }).click();
    await expect(panel).toHaveAttribute("data-state", "loading");
    await expect(panel).toBeFocused();
    await expect(panel).toHaveAttribute("data-state", "ready");
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Dibanding v1.0.0");
    await expect(panel).toBeFocused();
    await expect(run.rows.first()).toBeVisible();
  });
});

test.describe("Halaman versi", () => {
  test("dua baris dengan pass rate, perubahan turun, dan tautan bandingkan", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, run100, run101 } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    const versions = new VersionsPage(page);
    const compare = new ComparePage(page);

    await page.goto(`/p/${project.slug}`);
    await page.getByTestId("tab-versi").click();
    await expect(versions.table).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/p/${project.slug}/versions$`));
    await expect(versions.table.locator('[data-testid^="version-row-"]')).toHaveCount(2);
    // Terbaru di atas.
    await expect(versions.table.locator('[data-testid^="version-row-"]').first()).toHaveAttribute("data-testid", "version-row-1.0.1");
    await expect(versions.row("1.0.1")).toContainText("v1.0.1");
    await expect(versions.row("1.0.1")).toContainText("66,7%");
    await expect(versions.row("1.0.1")).toContainText("▼ turun 4,7 poin");
    await expect(versions.row("1.0.0")).toContainText("71,4%");
    await expect(versions.row("1.0.0")).toContainText("–");
    await expect(versions.compareLink("1.0.0")).toHaveCount(0);
    await expect(versions.row("1.0.0")).toContainText("Versi pertama");
    await expectNoA11yViolationsInBothThemes(page);

    await versions.compareLink("1.0.1").click();
    await expect(compare.title).toHaveText("v1.0.1 dibanding v1.0.0");
    const url = new URL(page.url());
    expect(url.searchParams.get("base")).toBe(run100);
    expect(url.searchParams.get("target")).toBe(run101);
  });

  test("daftar terpotong di batas API: baris terakhir menaut dengan target saja, bukan 'Versi pertama'", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project, run101 } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    const versions = new VersionsPage(page);
    // Semua baris sisipan memakai run terbaru (run101). API memotong daftar di MAX_VERSIONS: sisipkan jawaban seperti project yang punya lebih dari itu.
    await page.route(/\/versions\?branch=/, async (route) => {
      const [first] = (await (await route.fetch()).json()) as VersionDto[];
      const capped = Array.from({ length: MAX_VERSIONS }, (_, i) => ({ ...first!, version: `${MAX_VERSIONS - i}.0.0` }));
      await route.fulfill({ json: capped });
    });

    await versions.goto(project.slug);
    await expect(versions.table.locator('[data-testid^="version-row-"]')).toHaveCount(MAX_VERSIONS);
    const last = versions.compareLink("1.0.0");
    await expect(last).toBeVisible();
    const href = new URL((await last.getAttribute("href"))!, "http://x");
    expect(href.searchParams.get("target")).toBe(run101);
    expect(href.searchParams.has("base")).toBe(false);
    await expect(versions.row("1.0.0")).not.toContainText("Versi pertama");
    // Baris lain tetap memakai versi di bawahnya sebagai base.
    expect(new URL((await versions.compareLink("2.0.0").getAttribute("href"))!, "http://x").searchParams.has("base")).toBe(true);
  });

  test("pemilih branch dan keadaan kosong tanpa versi", async ({ api, signedInPage }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const { token } = await api.createToken(owner, project.slug);
    await publish(api, token, project.slug, [{ name: "A" }]);
    await publish(api, token, project.slug, [{ name: "A" }], { version: "9.9.9", branch: "release" });
    const { page } = await signedInPage(owner);
    const versions = new VersionsPage(page);

    // Default: `main` (tanpa versi) -> keadaan kosong.
    await versions.goto(project.slug);
    await expect(versions.empty).toContainText("Belum ada run dengan versi");
    await versions.branchFilter.selectOption("release");
    await expect(versions.row("9.9.9")).toBeVisible();
    await expect(page).toHaveURL(/versions\?branch=release$/);
    await page.reload();
    await expect(versions.row("9.9.9")).toBeVisible();
  });

  test("anonim membuka halaman versi dan perbandingan project publik", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { project } = await seedVersions(api, "public");
    const page = await (await newContext()).newPage();
    const versions = new VersionsPage(page);
    const compare = new ComparePage(page);

    await page.goto(`/p/${project.slug}`);
    await expect(page.getByTestId("version-card")).toBeVisible();
    await versions.goto(project.slug);
    await expect(versions.row("1.0.1")).toContainText("▼ turun 4,7 poin");
    await compare.goto(`/p/${project.slug}/compare`);
    await expect(compare.sentence).toHaveText(SENTENCE);
    await expect(page.locator('[data-testid^="report-bug-"]')).toHaveCount(0);
    await expectNoA11yViolationsInBothThemes(page);
  });
});

test.describe("Label versi di daftar run", () => {
  test("run yang punya versi menampilkan labelnya", async ({ api, signedInPage }) => {
    const { owner, project, run100, run101 } = await seedVersions(api);
    const { page } = await signedInPage(owner);
    const runs = new RunsPage(page);

    await runs.goto(project.slug);
    await expect(runs.item(run101).getByTestId("run-version")).toHaveText("v1.0.1");
    await expect(runs.item(run100).getByTestId("run-version")).toHaveText("v1.0.0");
  });
});

test.describe("Layar 375 px", () => {
  async function expectNoOverflow(page: Page): Promise<void> {
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  }

  test("dashboard, perbandingan, dan versi tanpa scroll mendatar; kolom sebelum/sesudah bertumpuk", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, run101, ids } = await seedVersions(api);
    const page = await (await newContext(await mobileContextOptions(owner))).newPage();
    const compare = new ComparePage(page);
    const versions = new VersionsPage(page);

    await page.goto(`/p/${project.slug}`);
    await expect(page.getByTestId("version-card")).toBeVisible();
    await expectNoOverflow(page);
    await expectNoA11yViolationsInBothThemes(page);

    await compare.goto(`/p/${project.slug}/compare`);
    await expectNoOverflow(page);
    const sides = compare.row(ids["Regresi A"]!).locator("strong");
    const [baseBox, targetBox] = await Promise.all([sides.nth(0).boundingBox(), sides.nth(1).boundingBox()]);
    // Bertumpuk: sesudah tepat di bawah sebelum, sejajar di kiri.
    expect(targetBox!.y).toBeGreaterThan(baseBox!.y + baseBox!.height - 1);
    expect(Math.abs(targetBox!.x - baseBox!.x)).toBeLessThan(2);
    await openAllGroups(compare);
    await expectNoOverflow(page);
    await expectNoA11yViolationsInBothThemes(page);

    await versions.goto(project.slug);
    await expectNoOverflow(page);
    await expect(versions.row("1.0.1")).toContainText("▼ turun 4,7 poin");
    await expectNoA11yViolationsInBothThemes(page);

    // Detail run dengan panel perbandingan.
    await page.goto(`/p/${project.slug}/runs/${run101}`);
    await expect(page.getByTestId("run-compare-panel")).toBeVisible();
    await expectNoOverflow(page);
    await expectNoA11yViolationsInBothThemes(page);
  });
});
