import type { ProjectDto } from "@testpulse/shared";
import { ProjectPage } from "../pages/ProjectPage.js";
import type { TestApi, TestUser } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { buildJUnit, type JUnitCase } from "../support/junit.js";

const FEATURE_BRANCH = "feature/login-v2";

/**
 * Enam run di `main` (terlama ke terbaru) lalu satu run di `feature/login-v2`, diunggah terakhir sehingga branch
 * run terbaru BUKAN `main` (default pemilih harus tetap `main`).
 *
 * `main`: B gagal di r2 -> skor 33; F gagal di r2 dan lulus-dengan-retry di r3 -> skor 50; G dilewati di r6 diabaikan;
 * H hanya gagal sekali (n = 1, bukan flaky). Run terakhir: 3 lulus, 1 gagal, 1 dilewati -> pass rate 75%.
 * `feature/login-v2`: 1 lulus, 2 gagal (33,3%), tanpa test flaky.
 */
const MAIN_RUNS: JUnitCase[][] = [
  [{ name: "A" }, { name: "B" }, { name: "F" }, { name: "G" }],
  [{ name: "A" }, { name: "B", status: "failed" }, { name: "F", status: "failed" }, { name: "G" }],
  [{ name: "A" }, { name: "B" }, { name: "F", retries: 1 }, { name: "G" }],
  [{ name: "A" }, { name: "B" }, { name: "F" }, { name: "G" }],
  [{ name: "A" }, { name: "B" }, { name: "F" }, { name: "G" }],
  [{ name: "A" }, { name: "B" }, { name: "F" }, { name: "G", status: "skipped" }, { name: "H", status: "failed" }],
];
const FEATURE_RUN: JUnitCase[] = [{ name: "A" }, { name: "X", status: "failed" }, { name: "Y", status: "failed" }];

interface Seeded {
  owner: TestUser;
  project: ProjectDto;
  /** Id run `main`, terlama ke terbaru. */
  mainRunIds: string[];
}

async function upload(api: TestApi, token: string, slug: string, cases: JUnitCase[], branch: string): Promise<string> {
  const res = await api.uploadRun(token, slug, buildJUnit(cases), { branch });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { runId: string }).runId;
}

async function seed(api: TestApi, options: { visibility?: "public" } = {}): Promise<Seeded> {
  const owner = await api.register();
  const project = await api.createProject(owner);
  if (options.visibility) await api.setVisibility(owner, project.slug, options.visibility);
  const { token } = await api.createToken(owner, project.slug);
  const mainRunIds: string[] = [];
  for (const cases of MAIN_RUNS) mainRunIds.push(await upload(api, token, project.slug, cases, "main"));
  await upload(api, token, project.slug, FEATURE_RUN, FEATURE_BRANCH);
  return { owner, project, mainRunIds };
}

async function horizontalOverflow(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("Dashboard project", () => {
  test("menampilkan angka, tren, run terbaru, dan test paling flaky untuk branch main (default)", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, mainRunIds } = await seed(api);
    const { page } = await signedInPage(owner);
    const dashboard = new ProjectPage(page);

    await dashboard.goto(project.slug);
    await dashboard.expectDashboard();

    // Default `main` walau run terbaru ada di branch lain.
    await expect(dashboard.dashboardBranch).toHaveValue("main");
    await expect(dashboard.dashboardBranch.locator("option")).toHaveText([FEATURE_BRANCH, "main"]);

    await expect(dashboard.statLastStatus).toContainText("Gagal");
    await expect(dashboard.statPassRate).toContainText("75%");
    await expect(dashboard.statTotal).toContainText("5");
    await expect(dashboard.statFlaky).toHaveText(/^Test flaky2Test dengan/);

    // Satu titik per run (enam run), dengan alternatif teks untuk pembaca layar.
    await expect(dashboard.trendPoints).toHaveCount(6);
    await expect(dashboard.trendChart.getByRole("img")).toHaveAttribute("aria-label", /6 run terakhir/);
    await expect(dashboard.trendChart.locator("tbody tr")).toHaveCount(6);

    // Hanya 5 run terbaru: run pertama tidak ikut.
    await expect(dashboard.runItems).toHaveCount(5);
    await expect(dashboard.recentRuns.getByTestId(`run-item-${mainRunIds[5]}`)).toBeVisible();
    await expect(dashboard.recentRuns.getByTestId(`run-item-${mainRunIds[0]}`)).toHaveCount(0);
    await expect(dashboard.recentRuns.getByRole("link", { name: /Lihat semua/ })).toHaveAttribute(
      "href",
      `/p/${project.slug}/runs`,
    );

    // Test flaky terurut menurut skor: F (50) lalu B (33).
    await expect(dashboard.flakyItems).toHaveCount(2);
    await expect(dashboard.flakyItems.nth(0)).toContainText("F");
    await expect(dashboard.flakyItems.nth(0)).toContainText("50");
    await expect(dashboard.flakyItems.nth(1)).toContainText("B");
    await expect(dashboard.flakyItems.nth(1)).toContainText("33");
    await expect(dashboard.topFlaky.getByRole("link", { name: /Lihat semua/ })).toHaveAttribute(
      "href",
      `/p/${project.slug}/flaky`,
    );

    await expectNoA11yViolationsInBothThemes(page);
  });

  test("mengganti branch mengganti semua angka ke data branch itu", async ({ api, signedInPage }) => {
    const { owner, project } = await seed(api);
    const { page } = await signedInPage(owner);
    const dashboard = new ProjectPage(page);

    await dashboard.goto(project.slug);
    await dashboard.expectDashboard();
    await expect(dashboard.statPassRate).toContainText("75%");

    await dashboard.dashboardBranch.selectOption(FEATURE_BRANCH);

    await expect(dashboard.statPassRate).toContainText("33,3%");
    await expect(dashboard.statLastStatus).toContainText("Gagal");
    await expect(dashboard.statTotal).toContainText("3");
    await expect(dashboard.statFlaky).toHaveText(/^Test flaky0Test dengan/);
    await expect(dashboard.trendPoints).toHaveCount(1);
    await expect(dashboard.runItems).toHaveCount(1);
    await expect(dashboard.flakyItems).toHaveCount(0);
    await expect(dashboard.topFlaky).toContainText("Tidak ada test flaky");

    await dashboard.dashboardBranch.selectOption("main");
    await expect(dashboard.statPassRate).toContainText("75%");
    await expect(dashboard.runItems).toHaveCount(5);
  });

  test("anggota tanpa run melihat panduan setup berisi slug dan endpoint unggah", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const { page } = await signedInPage(owner);
    const dashboard = new ProjectPage(page);

    await dashboard.goto(project.slug);

    await expect(dashboard.setupInstructions).toBeVisible();
    await expect(dashboard.setupInstructions).toContainText(project.slug);
    await expect(dashboard.setupInstructions).toContainText(`/api/v1/projects/${project.slug}/runs`);
    await expect(dashboard.setupInstructions.getByRole("link", { name: /Token CI/ })).toHaveAttribute(
      "href",
      `/p/${project.slug}/settings#tokens`,
    );
    await expect(dashboard.dashboardBranch).toHaveCount(0);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("tester tanpa run melihat panduan tanpa tautan Token CI (hanya admin yang membuat token)", async ({
    api,
    signedInPage,
  }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const tester = await api.addMember(owner, project.slug, "tester");
    const { page } = await signedInPage(tester);
    const dashboard = new ProjectPage(page);

    await dashboard.goto(project.slug);

    await expect(dashboard.setupInstructions).toContainText(`/api/v1/projects/${project.slug}/runs`);
    await expect(dashboard.setupInstructions.getByRole("link")).toHaveCount(0);
    await expect(dashboard.setupInstructions).toContainText("admin");
  });

  test("pengunjung anonim project publik tanpa run melihat 'Belum ada hasil test' tanpa panduan setup", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    await api.setVisibility(owner, project.slug, "public");
    const context = await newContext();
    const page = await context.newPage();
    const dashboard = new ProjectPage(page);

    await dashboard.goto(project.slug);

    await expect(dashboard.emptyResults).toContainText("Belum ada hasil test");
    await expect(dashboard.setupInstructions).toHaveCount(0);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("pengunjung anonim project publik dengan run melihat dashboard hanya-baca", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { project } = await seed(api, { visibility: "public" });
    const context = await newContext();
    const page = await context.newPage();
    const dashboard = new ProjectPage(page);

    await dashboard.goto(project.slug);
    await dashboard.expectDashboard();

    await expect(dashboard.statPassRate).toContainText("75%");
    await expect(dashboard.trendPoints).toHaveCount(6);
    await expect(dashboard.runItems).toHaveCount(5);
    await expect(dashboard.flakyItems).toHaveCount(2);
    await expect(dashboard.emptyResults).toHaveCount(0);
    await expect(dashboard.setupInstructions).toHaveCount(0);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("project privat tidak terlihat oleh non-anggota (404 tetap sama)", async ({ api, signedInPage }) => {
    const { project } = await seed(api);
    const { page } = await signedInPage();
    const dashboard = new ProjectPage(page);

    await dashboard.goto(project.slug);

    await expect(dashboard.notFound).toBeVisible();
    await expect(dashboard.dashboardBranch).toHaveCount(0);
  });

  test("tampil rapi di 375 px tanpa gulir horizontal, termasuk nama branch yang sangat panjang", async ({
    api,
    newContext,
  }) => {
    const { owner, project } = await seed(api);
    const { token } = await api.createToken(owner, project.slug, "panjang");
    const longBranch = `feature/${"nama-branch-yang-sangat-panjang-".repeat(5)}x`;
    await upload(api, token, project.slug, FEATURE_RUN, longBranch);

    const context = await newContext({
      storageState: await owner.request.storageState(),
      viewport: { width: 375, height: 800 },
    });
    const page = await context.newPage();
    const dashboard = new ProjectPage(page);

    await dashboard.goto(project.slug);
    await dashboard.expectDashboard();
    await expect(dashboard.trendPoints).toHaveCount(6);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await dashboard.dashboardBranch.selectOption(longBranch);
    await expect(dashboard.trendPoints).toHaveCount(1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
