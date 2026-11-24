import { randomUUID } from "node:crypto";
import { LoginPage } from "../pages/LoginPage.js";
import { horizontalOverflow, mobileContextOptions } from "../support/bugs.js";
import { acceptedReport, joinedTester, seedCrowd } from "../support/crowd.js";
import { expect, test } from "../support/fixtures.js";

/** Tag unik untuk judul cycle, agar pencarian direktori hanya menemukan data test ini. */
const tag = () => `e2e${randomUUID().slice(0, 8)}`;

test.describe("Crowdtesting: navigasi dan direktori", () => {
  test("menu Crowdtesting tampil untuk anonim dan pengguna yang masuk", async ({ page, signedInPage }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-crowd")).toBeVisible();
    await page.getByTestId("nav-crowd").click();
    await expect(page).toHaveURL(/\/crowd$/);
    await expect(page.getByRole("heading", { level: 1, name: "Crowdtesting" })).toBeVisible();

    const { page: signed } = await signedInPage();
    await signed.goto("/");
    await expect(signed.getByTestId("nav-crowd")).toBeVisible();
  });

  test("tab dan pencarian tersimpan di URL; 25 cycle → 20 + Muat lagi", async ({ api, page, expectNoA11yViolationsInBothThemes }) => {
    const t = tag();
    const seed = await seedCrowd(api, { titles: Array.from({ length: 25 }, (_, i) => `${t} cycle ${i}`) });
    const closed = seed.cycles[0]!;
    await api.updateCycle(seed.owner, seed.project.slug, closed.number, { version: closed.version, status: "closed" });

    await page.goto(`/crowd?q=${t}`);
    const cards = page.locator('[data-testid^="crowd-cycle-card-"]');
    await expect(cards).toHaveCount(20);
    await expect(page.getByTestId("crowd-search")).toHaveValue(t);
    await expect(page.getByTestId("crowd-tab-open")).toHaveAttribute("aria-current", "page");
    await page.getByTestId("crowd-load-more").click();
    await expect(cards).toHaveCount(24);
    await expect(page.getByTestId("crowd-load-more")).toHaveCount(0);

    await page.getByTestId("crowd-tab-closed").click();
    await expect(page).toHaveURL(new RegExp(`status=closed.*q=${t}`));
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(`${t} cycle 0`);
    await expect(cards.first()).toContainText("Selesai");

    await page.reload();
    await expect(cards).toHaveCount(1);
    await expect(page.getByTestId("crowd-tab-closed")).toHaveAttribute("aria-current", "page");
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("kartu cycle menampilkan project, periode, peserta, dan laporan diterima", async ({ api, page }) => {
    const t = tag();
    const seed = await seedCrowd(api, { titles: [`${t} kartu`], cycle: { endsAt: new Date(Date.now() + 3 * 86_400_000 - 60_000).toISOString() } });
    const cycle = seed.cycles[0]!;
    const tester = await joinedTester(api, cycle);
    await acceptedReport(api, seed, cycle, tester);

    await page.goto(`/crowd?q=${t}`);
    const card = page.getByTestId(`crowd-cycle-card-${cycle.id}`);
    await expect(card).toContainText(seed.project.name);
    await expect(card).toContainText("Berakhir 3 hari lagi");
    await expect(card).toContainText("1 peserta");
    await expect(card).toContainText("1 laporan diterima");
  });

  test("di 375 px direktori tidak melebar", async ({ api, newContext }) => {
    const t = tag();
    await seedCrowd(api, { titles: [`${t} ${"judul-panjang-tanpa-spasi".repeat(4)}`] });
    const context = await newContext({ viewport: { width: 375, height: 800 } });
    const page = await context.newPage();
    await page.goto(`/crowd?q=${t}`);
    await expect(page.locator('[data-testid^="crowd-cycle-card-"]')).toHaveCount(1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("Crowdtesting: leaderboard, profil, dan ringkasan saya", () => {
  test("leaderboard global menandai posisi saya; profil tester tanpa email", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const seed = await seedCrowd(api);
    const cycle = seed.cycles[0]!;
    const tester = await joinedTester(api, cycle);
    await acceptedReport(api, seed, cycle, tester, "minor", "Laporan kecil");

    const { page } = await signedInPage(tester);
    await page.goto("/crowd/leaderboard");
    await expect(page.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeVisible();
    const mine = page.getByRole("row", { name: new RegExp(tester.user.name) });
    await expect(mine.first()).toContainText("(Anda)");
    await expectNoA11yViolationsInBothThemes(page);

    await mine.first().getByRole("link", { name: tester.user.name }).click();
    await expect(page.getByTestId("tester-profile")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: tester.user.name })).toBeVisible();
    await expect(page.getByTestId("tester-points")).toHaveText("1");
    await expect(page.getByTestId("tester-acceptance")).toHaveText("100%");
    await expect(page.getByTestId("tester-recent")).toContainText("Laporan kecil");
    expect(await page.locator("main").innerText()).not.toContain("@");
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("/crowd/me untuk anonim → login → kembali ke /crowd/me", async ({ api, page }) => {
    const seed = await seedCrowd(api);
    const tester = await joinedTester(api, seed.cycles[0]!);
    await page.goto("/crowd/me");
    await expect(page).toHaveURL(/\/login\?next=%2Fcrowd%2Fme/);
    await new LoginPage(page).login(tester.user.email, tester.password);
    await expect(page).toHaveURL(/\/crowd\/me$/);
    await expect(page.getByTestId("crowd-me")).toBeVisible();
    await expect(page.getByTestId("crowd-me-cycles")).toContainText(seed.cycles[0]!.title);
  });

  // Review Focus 1.
  test("login dengan next=//evil.com berakhir di beranda situs ini", async ({ api, page }) => {
    const user = await api.register();
    await page.goto(`/login?next=${encodeURIComponent("//evil.com/x")}`);
    await new LoginPage(page).login(user.user.email, user.password);
    await expect(page).toHaveURL((url) => url.pathname === "/" && url.host !== "evil.com");
  });

  test("di 375 px leaderboard dan profil tidak melebar", async ({ api, newContext }) => {
    const seed = await seedCrowd(api);
    const tester = await api.register({ name: "Nama-tester-yang-sangat-panjang-tanpa-spasi-sama-sekali" });
    await api.joinCycle(tester, seed.cycles[0]!.id);
    await acceptedReport(api, seed, seed.cycles[0]!, tester, "blocker", "J".repeat(190));
    const context = await newContext(await mobileContextOptions(tester));
    const page = await context.newPage();
    await page.goto("/crowd/leaderboard");
    await expect(page.getByTestId("leaderboard")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.goto(`/crowd/testers/${tester.user.id}`);
    await expect(page.getByTestId("tester-recent")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
