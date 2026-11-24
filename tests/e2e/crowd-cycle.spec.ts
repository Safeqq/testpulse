import { LoginPage } from "../pages/LoginPage.js";
import { horizontalOverflow, mobileContextOptions } from "../support/bugs.js";
import { acceptedReport, cycleBody, joinedTester, seedCrowd } from "../support/crowd.js";
import { expect, test } from "../support/fixtures.js";

test.describe("Crowdtesting: halaman cycle publik", () => {
  test("anonim melihat isi cycle; Masuk untuk ikut → login → kembali ke cycle; ikut setelah centang aturan", async ({
    api,
    page,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const seed = await seedCrowd(api, { visibility: "public" });
    const cycle = seed.cycles[0]!;
    const tester = await api.register();

    await page.goto(`/crowd/c/${cycle.id}`);
    await expect(page.getByTestId("cycle-public-header")).toContainText(cycle.title);
    await expect(page.getByTestId("cycle-public-header")).toContainText(seed.project.name);
    await expect(page.getByRole("heading", { name: "Instruksi" })).toBeVisible();
    await expect(page.getByText("Login dan checkout")).toBeVisible();
    await expect(page.getByText("Chrome desktop")).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);

    await page.getByTestId("cycle-login").click();
    await new LoginPage(page).login(tester.user.email, tester.password);
    await expect(page).toHaveURL(new RegExp(`/crowd/c/${cycle.id}$`));

    const join = page.getByTestId("cycle-join");
    await expect(join).toBeDisabled();
    await page.getByTestId("cycle-rules-checkbox").check();
    await join.click();
    await expect(page.getByTestId("cycle-report")).toBeVisible();
    await expect(page.getByTestId("cycle-leave")).toBeVisible();
    await expect(page.getByTestId("cycle-tab-laporan")).toBeVisible();

    await page.getByTestId("cycle-leave").click();
    await expect(page.getByTestId("cycle-join")).toHaveText(/Ikut lagi/);
    await expect(page.getByTestId("cycle-action")).toContainText("sudah keluar");
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("dikeluarkan, anggota project, dan cycle selesai melihat pesan tanpa tombol ikut", async ({ api, signedInPage }) => {
    const seed = await seedCrowd(api);
    const cycle = seed.cycles[0]!;
    const removed = await joinedTester(api, cycle);
    await api.removeParticipant(seed.owner, seed.project.slug, cycle.number, removed.user.id);

    const { page } = await signedInPage(removed);
    await page.goto(`/crowd/c/${cycle.id}`);
    await expect(page.getByTestId("cycle-action")).toContainText("dikeluarkan");
    await expect(page.getByTestId("cycle-join")).toHaveCount(0);

    const { page: owner } = await signedInPage(seed.owner);
    await owner.goto(`/crowd/c/${cycle.id}`);
    await expect(owner.getByTestId("cycle-action")).toContainText("Anggota project");
    await expect(owner.getByTestId("cycle-join")).toHaveCount(0);

    await api.updateCycle(seed.owner, seed.project.slug, cycle.number, { version: cycle.version, status: "closed" });
    const { page: other } = await signedInPage();
    await other.goto(`/crowd/c/${cycle.id}`);
    await expect(other.getByTestId("cycle-action")).toContainText("sudah selesai");
    await expect(other.getByTestId("cycle-join")).toHaveCount(0);
    await expect(other.getByTestId("cycle-public-status")).toContainText("Selesai");
  });

  test("link aplikasi membuka situs luar dengan aman; domain ditampilkan", async ({ api, page }) => {
    const seed = await seedCrowd(api, { cycle: { links: [{ url: "https://staging.example.com/app", label: "Staging" }] } });
    await page.goto(`/crowd/c/${seed.cycles[0]!.id}`);
    const link = page.getByTestId("cycle-app-link-0");
    await expect(link).toHaveAttribute("href", "https://staging.example.com/app");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toContainText("staging.example.com");
  });

  test("tab masalah diketahui, leaderboard, dan laporan saya", async ({ api, signedInPage }) => {
    const seed = await seedCrowd(api);
    const cycle = seed.cycles[0]!;
    const tester = await joinedTester(api, cycle);
    await acceptedReport(api, seed, cycle, tester, "critical", "Checkout gagal di Safari");

    const { page } = await signedInPage(tester);
    await page.goto(`/crowd/c/${cycle.id}`);
    await page.getByTestId("cycle-tab-masalah").click();
    await expect(page.getByTestId("known-issue-0")).toContainText("Checkout gagal di Safari");
    await expect(page.getByTestId("known-issue-0")).toContainText("Critical");

    await page.getByTestId("cycle-tab-leaderboard").click();
    await expect(page.getByTestId("leaderboard-row-1")).toContainText(tester.user.name);
    await expect(page.getByTestId("leaderboard-row-1")).toContainText("5");

    await page.getByTestId("cycle-tab-laporan").click();
    await expect(page.getByTestId("my-reports")).toContainText("Checkout gagal di Safari");
    await expect(page.getByTestId("my-reports")).toContainText("+5 poin");
    await page.reload();
    await expect(page.getByTestId("cycle-tab-laporan")).toHaveAttribute("aria-current", "page");
  });

  // Review Focus 5.
  test("cycle di project privat tampil tanpa tautan project; halaman project tetap 404 bagi anonim", async ({ api, page }) => {
    const seed = await seedCrowd(api);
    await page.goto(`/crowd/c/${seed.cycles[0]!.id}`);
    const header = page.getByTestId("cycle-public-header");
    await expect(header).toContainText(seed.project.name);
    await expect(header.getByRole("link", { name: seed.project.name })).toHaveCount(0);
    expect(await page.content()).not.toContain(seed.project.slug);

    await page.goto(`/p/${seed.project.slug}`);
    await expect(page.getByTestId("project-not-found")).toBeVisible();
  });

  test("Markdown berbahaya di instruksi dan cakupan tampil inert", async ({ api, page }) => {
    let dialog = false;
    page.on("dialog", (d) => {
      dialog = true;
      void d.dismiss();
    });
    const seed = await seedCrowd(api, {
      cycle: cycleBody({
        instructions: "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[klik](javascript:alert(1))\n\n![g](https://example.com/a.png)",
        inScope: "## Status: Diterima",
      }),
    });
    await page.goto(`/crowd/c/${seed.cycles[0]!.id}`);
    await expect(page.getByText("<script>alert(1)</script>")).toBeVisible();
    await expect(page.locator("article img")).toHaveCount(0);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(dialog).toBe(false);
  });

  test("draft atau id acak → Cycle tidak ditemukan", async ({ api, page }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const draft = await api.createCycle(owner, project.slug, cycleBody());
    await page.goto(`/crowd/c/${draft.id}`);
    await expect(page.getByTestId("cycle-not-found")).toBeVisible();
  });

  test("di 375 px halaman cycle dengan instruksi panjang tidak melebar", async ({ api, newContext }) => {
    const seed = await seedCrowd(api, {
      cycle: cycleBody({
        title: "J".repeat(120),
        instructions: `${"tanpa-spasi".repeat(40)}\n\n\`\`\`\n${"x".repeat(400)}\n\`\`\``,
        links: [{ url: `https://${"sub".repeat(20)}.example.com/${"p".repeat(200)}`, label: "L".repeat(60) }],
      }),
    });
    const tester = await api.register();
    const context = await newContext(await mobileContextOptions(tester));
    const page = await context.newPage();
    await page.goto(`/crowd/c/${seed.cycles[0]!.id}`);
    await expect(page.getByTestId("cycle-join")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
