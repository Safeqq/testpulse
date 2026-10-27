import { AppShell } from "../pages/AppShell.js";
import { LandingPage, type FeatureSlug, type QualityLink } from "../pages/LandingPage.js";
import { LoginPage } from "../pages/LoginPage.js";
import { ProjectsPage } from "../pages/ProjectsPage.js";
import { expect, test } from "../support/fixtures.js";
import { simulateMeOutage } from "../support/outage.js";

const LANDING_TITLE = "TestPulse — Pantau kesehatan testing tim Anda";

const QUALITY_LINKS: Record<QualityLink, string> = {
  allure: "https://safeqq.github.io/testpulse/",
  ci: "https://github.com/Safeqq/testpulse/actions/workflows/ci.yml",
  source: "https://github.com/Safeqq/testpulse",
  strategy: "https://github.com/Safeqq/testpulse/blob/main/docs/TEST_STRATEGY.md",
};

const AVAILABLE: FeatureSlug[] = ["projects", "team", "invitations"];
const SOON: Array<{ slug: FeatureSlug; stage: string }> = [
  { slug: "dashboard", stage: "Tahap 2" },
  { slug: "bug-tracker", stage: "Tahap 3" },
  { slug: "manual-tests", stage: "Tahap 4" },
  { slug: "crowdtesting", stage: "Tahap 5" },
];

test.describe("Landing page", () => {
  test("pengunjung anonim melihat semua bagian di /, tanpa dialihkan", async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle(LANDING_TITLE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pantau kesehatan testing tim Anda di satu tempat.");
    await expect(landing.hero.getByText("Pratinjau", { exact: true })).toBeVisible();
    for (const section of [landing.features, landing.howItWorks, landing.quality, landing.roadmap, landing.footer]) {
      await expect(section).toBeVisible();
    }
    await expect(new AppShell(page).loginLink).toBeVisible();
    await expect(new AppShell(page).registerLink).toBeVisible();
  });

  test("tombol utama mengarah ke /register dan demo project publik", async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();
    await expect(landing.ctaRegister).toHaveText("Daftar gratis");
    await expect(landing.ctaDemo).toHaveText("Lihat demo project publik");

    await landing.ctaRegister.click();
    await expect(page).toHaveURL(/\/register$/);

    await landing.goto();
    await landing.ctaDemo.click();
    await expect(page).toHaveURL(/\/p\/testpulse$/);
  });

  test("link kualitas punya href persis dan dibuka aman di tab baru", async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    for (const [name, href] of Object.entries(QUALITY_LINKS) as Array<[QualityLink, string]>) {
      const link = landing.qualityLink(name);
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /\bnoopener\b/);
      await expect(link).toHaveAttribute("rel", /\bnoreferrer\b/);
    }
  });

  test("badge Segera hanya pada fitur Tahap 2 sampai 5", async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await expect(landing.soonBadges).toHaveCount(4);
    for (const { slug, stage } of SOON) {
      const card = landing.feature(slug);
      await expect(card.getByTestId("feature-soon-badge")).toHaveText("Segera");
      await expect(card).toContainText(stage);
    }
    for (const slug of AVAILABLE) {
      await expect(landing.feature(slug)).toBeVisible();
      await expect(landing.feature(slug).getByTestId("feature-soon-badge")).toHaveCount(0);
    }
  });

  test("roadmap memuat tahap 1 sampai 6 dan footer tanpa atribusi pembuat", async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    for (const stage of ["Tahap 1", "Tahap 2", "Tahap 3", "Tahap 4", "Tahap 5", "Tahap 6"]) {
      await expect(landing.roadmap).toContainText(stage);
    }
    await expect(landing.footer).toContainText("TestPulse");
    await expect(landing.footer).not.toContainText("Dibuat oleh");
    await expect(landing.footer.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Safeqq/testpulse",
    );
    await expect(landing.footer.getByRole("link", { name: "Dokumentasi" })).toHaveAttribute(
      "href",
      "https://github.com/Safeqq/testpulse#readme",
    );
    await expect(landing.footer.getByRole("link", { name: "Laporan test" })).toHaveAttribute(
      "href",
      QUALITY_LINKS.allure,
    );
  });

  test("user yang masuk membuka / dan melihat daftar project, bukan landing", async ({ signedInPage }) => {
    const { page } = await signedInPage();
    await page.goto("/");

    const projects = new ProjectsPage(page);
    await expect(projects.empty.or(projects.list)).toBeVisible();
    await expect(page.getByTestId("landing-hero")).toHaveCount(0);
  });

  test("login lewat form lalu / menampilkan daftar project", async ({ page, api }) => {
    const { user, password } = await api.register();
    const login = new LoginPage(page);
    await login.goto();
    await login.login(user.email, password);
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/");
    const projects = new ProjectsPage(page);
    await expect(projects.empty.or(projects.list)).toBeVisible();
    await expect(page.getByTestId("landing-hero")).toHaveCount(0);
  });

  test("status memuat menampilkan kerangka netral, tanpa landing dan tanpa pengalihan", async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/auth/me", async (route) => {
      await gate;
      await route.continue();
    });

    await page.goto("/");
    const landing = new LandingPage(page);
    await expect(landing.loading).toBeVisible();
    await expect(landing.hero).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);

    release();
    await expect(landing.hero).toBeVisible();
    await expect(landing.loading).toHaveCount(0);
  });

  test("/auth/me gagal (503): banner galat sesi tampil, landing tidak dirender, tetap di /", async ({
    signedInPage,
  }) => {
    const { page } = await signedInPage();
    const shell = new AppShell(page);
    const landing = new LandingPage(page);
    const outage = await simulateMeOutage(page);

    await page.goto("/");

    await expect(shell.sessionError).toBeVisible();
    await expect(landing.hero).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);

    // Pulih: coba lagi menampilkan beranda user yang masuk, bukan landing.
    outage.active = false;
    await shell.sessionRetry.click();
    await expect(shell.currentUser).toBeVisible();
    const projects = new ProjectsPage(page);
    await expect(projects.empty.or(projects.list)).toBeVisible();
    await expect(landing.hero).toHaveCount(0);
  });

  test("logout dari / berakhir di /login tanpa pengalihan ke tempat lain", async ({ signedInPage }) => {
    const { page } = await signedInPage();
    const shell = new AppShell(page);
    const visited: string[] = [];

    await page.goto("/");
    await expect(shell.currentUser).toBeVisible();
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname + new URL(frame.url()).search);
    });

    await shell.logout();

    await expect(page).toHaveURL(/\/login$/);
    await shell.expectAnonymous();
    // Hanya boleh berpindah ke /login polos; tidak ada /login?next=..., dan tidak berhenti di / sebagai landing.
    expect(visited.filter((url) => url !== "/login")).toEqual([]);
  });

  test("landing lolos pemeriksaan aksesibilitas di kedua tema", async ({ page, expectNoA11yViolationsInBothThemes }) => {
    const landing = new LandingPage(page);
    await landing.goto();
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("di 375 px landing tidak menimbulkan scroll horizontal dan menu mobile bisa dibuka", async ({
    page,
    expectNoA11yViolationsInBothThemes,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const landing = new LandingPage(page);
    await landing.goto();
    await landing.footer.scrollIntoViewIfNeeded();

    const noHorizontalScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await noHorizontalScroll()).toBe(true);
    await expect(landing.ctaRegister).toBeVisible();
    await expect(landing.ctaDemo).toBeVisible();

    const shell = new AppShell(page);
    await shell.mobileMenuToggle.click();
    await expect(shell.loginLink).toBeVisible();
    expect(await noHorizontalScroll()).toBe(true);
    await expectNoA11yViolationsInBothThemes(page);
  });
});
