import type { Page } from "@playwright/test";
import type { ProjectDto } from "@testpulse/shared";
import { VersionsPage } from "../pages/VersionsPage.js";
import type { TestApi, TestUser } from "../support/api-client.js";
import { CI_URL, COMMIT, horizontalOverflow, mobileContextOptions, testCaseIds } from "../support/bugs.js";
import { expect, test } from "../support/fixtures.js";
import { buildJUnit, type JUnitCase } from "../support/junit.js";
import { fetchRunCases } from "../support/manual.js";

const CI_CASES: JUnitCase[] = [{ suite: "checkout", name: "Bayar" }, { suite: "checkout", name: "Keranjang" }];

interface Seed {
  owner: TestUser;
  project: ProjectDto;
  token: string;
  /** Id run CI per versi yang diunggah. */
  runIds: Record<string, string>;
}

async function publish(api: TestApi, token: string, slug: string, version: string): Promise<string> {
  const res = await api.uploadRun(token, slug, buildJUnit(CI_CASES), { branch: "main", commit: COMMIT, ciUrl: CI_URL, version });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { runId: string }).runId;
}

/** Project dengan run CI untuk tiap versi (terlama dulu) dan, bila diminta, satu suite berisi tiga case aktif. */
async function seed(
  api: TestApi,
  versions: string[],
  options: { visibility?: "public"; cases?: boolean } = {},
): Promise<Seed & { suiteId: string | null }> {
  const owner = await api.register();
  const project = await api.createProject(owner);
  if (options.visibility) await api.setVisibility(owner, project.slug, options.visibility);
  const { token } = await api.createToken(owner, project.slug);
  const runIds: Record<string, string> = {};
  for (const version of versions) runIds[version] = await publish(api, token, project.slug, version);
  let suiteId: string | null = null;
  if (options.cases) {
    const suite = await api.createSuite(owner, project.slug, { name: "Login" });
    suiteId = suite.id;
    const ids = await testCaseIds(owner, project.slug, runIds[versions.at(-1)!]!);
    for (const [n, automatedTestId] of [[1, ids["Bayar"]!], [2, undefined], [3, undefined]] as const) {
      await api.createCase(owner, project.slug, {
        suiteId: suite.id,
        title: `Case ${n}`,
        steps: [{ action: "Buka halaman", expected: "Halaman tampil" }],
        ...(automatedTestId ? { automatedTestId } : {}),
      });
    }
  }
  return { owner, project, token, runIds, suiteId };
}

/** Run manual dari suite; `fill` mengisi hasil run case menurut urutan posisinya. */
async function manualRun(
  api: TestApi,
  owner: TestUser,
  slug: string,
  suiteId: string,
  body: { name: string; appVersion: string },
  fill: ("passed" | "failed")[] = [],
): Promise<number> {
  const run = await api.createManualRun(owner, slug, { ...body, suiteIds: [suiteId] });
  const runCases = await fetchRunCases(owner, slug, run.number);
  for (const [index, status] of fill.entries()) {
    await api.updateRunCase(owner, slug, run.number, runCases[index]!.id, { version: 1, status });
  }
  return run.number;
}

async function expectNoOverflow(page: Page): Promise<void> {
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
}

test.describe("Kolom Manual di halaman Versi", () => {
  test("v0.4.0 manual dan 0.4.0 CI jadi satu baris; versi tanpa run manual '–'; manual-saja non-semver di bawah", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, runIds, suiteId } = await seed(api, ["0.3.0", "0.4.0"], { cases: true });
    await manualRun(api, owner, project.slug, suiteId!, { name: "Regresi", appVersion: "v0.4.0" }, ["passed", "passed", "failed"]);
    await manualRun(api, owner, project.slug, suiteId!, { name: "Build 7", appVersion: "build-7" });
    const { page } = await signedInPage(owner);
    const versions = new VersionsPage(page);

    await versions.goto(project.slug);
    const rows = versions.table.locator('[data-testid^="version-row-"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute("data-testid", "version-row-0.4.0");
    await expect(rows.nth(1)).toHaveAttribute("data-testid", "version-row-0.3.0");
    await expect(rows.nth(2)).toHaveAttribute("data-testid", "version-row-build-7");

    const manual = versions.manual("0.4.0");
    await expect(manual).toContainText("TR-1 · 2/3 lulus · 1 gagal");
    await expect(manual.getByRole("link", { name: /TR-1/ })).toHaveAttribute("href", `/p/${project.slug}/manual-runs/1`);
    await expect(versions.manual("0.3.0")).toHaveText("–");

    // Baris manual-saja: kolom automated "–" (run terakhir, pass rate, perbandingan), kolom Manual terisi tanpa gagal.
    const only = versions.row("build-7");
    await expect(versions.manual("build-7")).toContainText("TR-2 · 0/3 lulus");
    await expect(versions.manual("build-7")).not.toContainText("gagal");
    await expect(only).toContainText("build-7");
    await expect(versions.compareLink("build-7")).toHaveCount(0);
    await expect(only.getByRole("cell", { name: "–" }).first()).toBeVisible();

    // Pembanding tetap versi automated sebelumnya.
    expect(new URL((await versions.compareLink("0.4.0").getAttribute("href"))!, "http://x").searchParams.get("base")).toBe(runIds["0.3.0"]);
    await expect(versions.row("0.3.0")).toContainText("Versi pertama");
    await expectNoA11yViolationsInBothThemes(page);

    await manual.getByRole("link", { name: /TR-1/ }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${project.slug}/manual-runs/1$`));
  });

  test("baris manual-saja di antara versi automated dilewati oleh 'Bandingkan dengan versi sebelumnya'", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project, runIds, suiteId } = await seed(api, ["0.3.0", "0.4.0"], { cases: true });
    await manualRun(api, owner, project.slug, suiteId!, { name: "Antara", appVersion: "0.3.5" });
    const { page } = await signedInPage(owner);
    const versions = new VersionsPage(page);

    await versions.goto(project.slug);
    const rows = versions.table.locator('[data-testid^="version-row-"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toHaveAttribute("data-testid", "version-row-0.3.5");
    await expect(versions.manual("0.3.5")).toContainText("TR-1 · 0/3 lulus");
    expect(new URL((await versions.compareLink("0.4.0").getAttribute("href"))!, "http://x").searchParams.get("base")).toBe(runIds["0.3.0"]);
    await versions.compareLink("0.4.0").click();
    await expect(page).toHaveURL(new RegExp(`base=${runIds["0.3.0"]}`));
  });

  test("anonim di project publik melihat kolom Manual; 375 px tanpa scroll mendatar", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, suiteId } = await seed(api, ["0.3.0", "0.4.0"], { cases: true, visibility: "public" });
    await manualRun(api, owner, project.slug, suiteId!, { name: "Regresi", appVersion: "v0.4.0" }, ["passed", "passed", "failed"]);
    await manualRun(api, owner, project.slug, suiteId!, { name: "Build 7", appVersion: "build-7" });

    const anonymous = await (await newContext()).newPage();
    const anonymousVersions = new VersionsPage(anonymous);
    await anonymousVersions.goto(project.slug);
    await expect(anonymousVersions.manual("0.4.0")).toContainText("TR-1 · 2/3 lulus · 1 gagal");

    const phone = await (await newContext({ ...(await mobileContextOptions(owner)) })).newPage();
    const phoneVersions = new VersionsPage(phone);
    await phoneVersions.goto(project.slug);
    // Di layar sempit kolom Manual pindah ke bawah versi (kolomnya disembunyikan).
    await expect(phoneVersions.manualCompact("0.4.0")).toContainText("TR-1 · 2/3 lulus · 1 gagal");
    await expect(phoneVersions.manualCompact("build-7")).toContainText("TR-2 · 0/3 lulus");
    await expect(phoneVersions.manual("0.4.0")).toBeHidden();
    await expectNoOverflow(phone);
    await expectNoA11yViolationsInBothThemes(phone);
  });
});

test.describe("Kartu Test manual di dashboard", () => {
  test("menampilkan run terbaru dengan progres dan cakupan otomasi", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, suiteId } = await seed(api, ["0.4.0"], { cases: true });
    await manualRun(api, owner, project.slug, suiteId!, { name: "Lama", appVersion: "v0.3.0" });
    await manualRun(api, owner, project.slug, suiteId!, { name: "Regresi rilis", appVersion: "v0.4.0" }, ["passed", "passed", "failed"]);
    const { page } = await signedInPage(owner);

    await page.goto(`/p/${project.slug}`);
    const card = page.getByTestId("manual-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("Test manual");
    await expect(card).toContainText("TR-2");
    await expect(card).toContainText("Regresi rilis");
    await expect(card).toContainText("v0.4.0");
    await expect(card).toContainText("Terbuka");
    await expect(card.getByTestId("run-progress-legend")).toHaveText("3/3 dieksekusi · 2 lulus · 1 gagal");
    await expect(card.getByTestId("coverage-meter")).toContainText("1 dari 3 case aktif sudah diotomasi (33%)");
    await expectNoA11yViolationsInBothThemes(page);

    await card.getByRole("link", { name: /TR-2/ }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${project.slug}/manual-runs/2$`));
  });

  test("project dengan case tetapi tanpa run manual: kartu menyebut belum ada run dan tetap menampilkan cakupan", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await seed(api, ["0.4.0"], { cases: true });
    const { page } = await signedInPage(owner);

    await page.goto(`/p/${project.slug}`);
    const card = page.getByTestId("manual-card");
    await expect(card).toContainText("Belum ada run manual");
    await expect(card.getByTestId("coverage-meter")).toContainText("1 dari 3 case aktif sudah diotomasi (33%)");
  });

  test("project tanpa case tidak menampilkan kartu", async ({ api, signedInPage }) => {
    const { owner, project } = await seed(api, ["0.4.0"]);
    const { page } = await signedInPage(owner);

    const summary = page.waitForResponse((res) => res.url().includes("/manual/summary"));
    await page.goto(`/p/${project.slug}`);
    await expect(page.getByTestId("stat-pass-rate")).toBeVisible();
    expect((await summary).status()).toBe(200);
    await expect(page.getByTestId("manual-card")).toHaveCount(0);
  });

  test("anonim di project publik melihat kartu; 375 px tanpa scroll mendatar", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, suiteId } = await seed(api, ["0.4.0"], { cases: true, visibility: "public" });
    await manualRun(api, owner, project.slug, suiteId!, { name: "Regresi rilis ".padEnd(100, "x"), appVersion: "v0.4.0" }, ["passed", "failed"]);

    const anonymous = await (await newContext()).newPage();
    await anonymous.goto(`/p/${project.slug}`);
    await expect(anonymous.getByTestId("manual-card")).toContainText("TR-1");

    const phone = await (await newContext({ ...(await mobileContextOptions(owner)) })).newPage();
    await phone.goto(`/p/${project.slug}`);
    await expect(phone.getByTestId("manual-card")).toBeVisible();
    await expectNoOverflow(phone);
    await expectNoA11yViolationsInBothThemes(phone);
  });
});
