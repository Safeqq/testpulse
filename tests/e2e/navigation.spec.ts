import type { Page } from "@playwright/test";
import type { RunDetailDto } from "@testpulse/shared";
import { FlakyPage } from "../pages/FlakyPage.js";
import { ProjectPage } from "../pages/ProjectPage.js";
import { ProjectTabsNav } from "../pages/ProjectTabsNav.js";
import { RunDetailPage } from "../pages/RunDetailPage.js";
import { RunsPage } from "../pages/RunsPage.js";
import { SettingsPage } from "../pages/SettingsPage.js";
import { TestHistoryPage } from "../pages/TestHistoryPage.js";
import type { TestApi } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { buildJUnit } from "../support/junit.js";

/** Batas menunggu halaman lazy setelah navigasi klien (unduh chunk pertama kali). */
const LAZY_NAVIGATION_TIMEOUT = 15_000;
const MOBILE = { width: 375, height: 812 };
const MEMBER_LABELS = ["Ringkasan", "Run", "Versi", "Bug", "Flaky", "Pengaturan"];
const VISITOR_LABELS = ["Ringkasan", "Run", "Versi", "Bug", "Flaky"];

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Project dengan satu run (agar ada halaman detail run dan riwayat test). */
async function seed(api: TestApi, visibility?: "public") {
  const owner = await api.register();
  const project = await api.createProject(owner);
  if (visibility) await api.setVisibility(owner, project.slug, visibility);
  const { token } = await api.createToken(owner, project.slug);
  const res = await api.uploadRun(token, project.slug, buildJUnit([{ name: "A" }, { name: "B", status: "failed" }]), {
    branch: "main",
  });
  expect(res.status(), await res.text()).toBe(201);
  const { runId } = (await res.json()) as { runId: string };
  const detail = await owner.request.get(`/api/v1/projects/${project.slug}/runs/${runId}?status=all`);
  expect(detail.status()).toBe(200);
  const { results } = (await detail.json()) as RunDetailDto;
  return { owner, project, runId, testCaseId: results[0]!.testCaseId };
}

async function expectCurrentTab(tabs: ProjectTabsNav, label: string): Promise<void> {
  await expect(tabs.current).toHaveCount(1);
  await expect(tabs.current).toHaveText(label);
}

test.describe("Tab navigasi project", () => {
  test("anggota melihat enam tab menuju rute masing-masing; tab aktif ditandai aria-current", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await seed(api);
    const { page } = await signedInPage(owner);
    const tabs = new ProjectTabsNav(page);

    await new ProjectPage(page).goto(project.slug);
    await expect(tabs.root).toBeVisible();
    await expect(tabs.tabs).toHaveText(MEMBER_LABELS);
    await expectCurrentTab(tabs, "Ringkasan");
    const base = `/p/${project.slug}`;
    await expect(tabs.tab("ringkasan")).toHaveAttribute("href", base);
    await expect(tabs.tab("run")).toHaveAttribute("href", `${base}/runs`);
    await expect(tabs.tab("versi")).toHaveAttribute("href", `${base}/versions`);
    await expect(tabs.tab("bug")).toHaveAttribute("href", `${base}/bugs`);
    await expect(tabs.tab("flaky")).toHaveAttribute("href", `${base}/flaky`);
    await expect(tabs.tab("pengaturan")).toHaveAttribute("href", `${base}/settings`);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("berpindah antar tab memperbarui halaman dan tab aktif", async ({ api, signedInPage }) => {
    const { owner, project } = await seed(api);
    const { page } = await signedInPage(owner);
    const tabs = new ProjectTabsNav(page);
    await new ProjectPage(page).goto(project.slug);

    await tabs.tab("run").click();
    await expect(page).toHaveURL(`/p/${project.slug}/runs`);
    await expect(new RunsPage(page).list).toBeVisible({ timeout: LAZY_NAVIGATION_TIMEOUT });
    await expectCurrentTab(tabs, "Run");

    const flaky = new FlakyPage(page);
    await tabs.tab("flaky").click();
    await expect(page).toHaveURL(`/p/${project.slug}/flaky`);
    await expect(flaky.list.or(flaky.empty)).toBeVisible({ timeout: LAZY_NAVIGATION_TIMEOUT });
    await expectCurrentTab(tabs, "Flaky");

    await tabs.tab("ringkasan").click();
    await expect(page).toHaveURL(`/p/${project.slug}`);
    await expect(new ProjectPage(page).title).toBeVisible();
    await expectCurrentTab(tabs, "Ringkasan");

    await tabs.tab("pengaturan").click();
    await expect(page).toHaveURL(`/p/${project.slug}/settings`);
    await expect(new SettingsPage(page).name).toBeVisible();
  });

  test("tab ikut tampil di halaman Run, Flaky, dan detail run; riwayat test tanpa tab aktif", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project, runId, testCaseId } = await seed(api);
    const { page } = await signedInPage(owner);
    const tabs = new ProjectTabsNav(page);

    await new RunsPage(page).goto(project.slug);
    await expect(tabs.tabs).toHaveText(MEMBER_LABELS);
    await expectCurrentTab(tabs, "Run");
    await expectNoA11yViolationsInBothThemes(page);

    await new FlakyPage(page).goto(project.slug);
    await expectCurrentTab(tabs, "Flaky");
    await expectNoA11yViolationsInBothThemes(page);

    await new RunDetailPage(page).goto(project.slug, runId);
    await expect(tabs.root).toBeVisible();
    await expectCurrentTab(tabs, "Run");

    // Riwayat test bukan salah satu tab: tab tampil tanpa penanda aktif.
    await new TestHistoryPage(page).goto(project.slug, testCaseId);
    await expect(tabs.tabs).toHaveText(MEMBER_LABELS);
    await expect(tabs.current).toHaveCount(0);
  });

  test("Pengaturan hanya untuk anggota: pengunjung bukan anggota dan anonim tidak melihatnya", async ({
    api,
    signedInPage,
    newContext,
  }) => {
    const { owner, project } = await seed(api, "public");
    const viewer = await api.addMember(owner, project.slug, "viewer");
    const outsider = await api.register();

    const { page: viewerPage } = await signedInPage(viewer);
    const viewerTabs = new ProjectTabsNav(viewerPage);
    await new ProjectPage(viewerPage).goto(project.slug);
    await expect(viewerTabs.tabs).toHaveText(MEMBER_LABELS);
    await new RunsPage(viewerPage).goto(project.slug);
    await expect(viewerTabs.tabs).toHaveText(MEMBER_LABELS);

    const { page: outsiderPage } = await signedInPage(outsider);
    const outsiderTabs = new ProjectTabsNav(outsiderPage);
    await new ProjectPage(outsiderPage).goto(project.slug);
    await expect(outsiderTabs.tabs).toHaveText(VISITOR_LABELS);
    await new RunsPage(outsiderPage).goto(project.slug);
    await expect(outsiderTabs.tabs).toHaveText(VISITOR_LABELS);

    const anonymous = await (await newContext()).newPage();
    const anonymousTabs = new ProjectTabsNav(anonymous);
    await new ProjectPage(anonymous).goto(project.slug);
    await expect(anonymousTabs.tabs).toHaveText(VISITOR_LABELS);
    await expect(anonymousTabs.tab("pengaturan")).toHaveCount(0);
    await new RunsPage(anonymous).goto(project.slug);
    await expect(anonymousTabs.tabs).toHaveText(VISITOR_LABELS);
  });

  test("375 px: halaman tidak bergulir mendatar; tab bergulir di wadahnya dan tab berfokus tergulir ke tampilan", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await seed(api);
    const { page } = await signedInPage(owner);
    await page.setViewportSize(MOBILE);
    const tabs = new ProjectTabsNav(page);

    for (const open of [() => new ProjectPage(page).goto(project.slug), () => new RunsPage(page).goto(project.slug)]) {
      await open();
      await expect(tabs.root).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      // Keenam tab tidak muat di 375 px: wadah tab yang menggulir, bukan halaman.
      expect(await tabs.scrollOverflow()).toBeGreaterThan(0);
    }

    // Fokus pada tab yang sebagian tersembunyi menggulirkannya ke tampilan penuh, tanpa menggeser halaman.
    await new ProjectPage(page).goto(project.slug);
    await tabs.tab("pengaturan").focus();
    await expect(tabs.tab("pengaturan")).toBeInViewport({ ratio: 0.99 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("keyboard: Tab menjangkau semua tab secara berurutan", async ({ api, signedInPage, browserName }) => {
    test.skip(browserName === "webkit", "WebKit Playwright tidak memasukkan tautan ke urutan Tab");
    const { owner, project } = await seed(api);
    const { page } = await signedInPage(owner);
    await page.setViewportSize(MOBILE);
    const tabs = new ProjectTabsNav(page);
    await new ProjectPage(page).goto(project.slug);

    await tabs.tab("ringkasan").focus();
    for (const id of ["run", "versi", "bug", "flaky", "pengaturan"] as const) {
      await page.keyboard.press("Tab");
      await expect(tabs.tab(id)).toBeFocused();
      await expect(tabs.tab(id)).toBeInViewport({ ratio: 0.99 });
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
