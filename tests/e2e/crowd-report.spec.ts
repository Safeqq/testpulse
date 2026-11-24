import type { TeamCycleDto } from "@testpulse/shared";
import { horizontalOverflow, mobileContextOptions } from "../support/bugs.js";
import type { TestApi, TestUser } from "../support/api-client.js";
import { crowdReportBody, joinedTester, seedCrowd, type CrowdSeed } from "../support/crowd.js";
import { expect, test } from "../support/fixtures.js";

async function submitted(api: TestApi, cycle: TeamCycleDto, tester: TestUser, title = "Laporan dari API") {
  return api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title }));
}

async function setup(api: TestApi): Promise<{ seed: CrowdSeed; cycle: TeamCycleDto; tester: TestUser }> {
  const seed = await seedCrowd(api);
  const cycle = seed.cycles[0]!;
  return { seed, cycle, tester: await joinedTester(api, cycle) };
}

test.describe("Crowdtesting: kirim laporan", () => {
  test("validasi per field, chip lingkungan, pratinjau, link bukti → laporan terkirim", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { cycle, tester } = await setup(api);
    const { page } = await signedInPage(tester);
    await page.goto(`/crowd/c/${cycle.id}`);
    await page.getByTestId("cycle-report").click();
    await expect(page.getByTestId("report-form")).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);

    await page.getByTestId("report-submit").click();
    await expect(page.getByTestId("field-error-title")).toBeVisible();
    await expect(page.getByTestId("report-title")).toBeFocused();

    await page.getByTestId("report-title").fill("Checkout gagal di Safari");
    await page.getByTestId("report-steps").fill("1. Buka keranjang\n2. Klik **Bayar**");
    await page.getByTestId("report-steps-tab-preview").click();
    await expect(page.getByTestId("report-steps-preview").locator("strong")).toHaveText("Bayar");
    await page.getByTestId("report-steps-tab-write").click();
    await page.getByTestId("report-expected").fill("Halaman pembayaran terbuka");
    await page.getByTestId("report-actual").fill("Muncul layar putih");
    await page.getByTestId("report-env-chip-1").click();
    await expect(page.getByTestId("report-environment")).toHaveValue("Android");
    await page.getByTestId("report-environment").fill("Android 14 / Chrome 130");
    await page.getByRole("radio", { name: /Critical/ }).check();
    await page.getByTestId("bug-link-add").click();
    await page.getByTestId("bug-link-url-0").fill("https://video.example.com/v/1");
    await page.getByTestId("report-submit").click();

    await expect(page).toHaveURL(/\/crowd\/r\/[0-9a-f-]+$/);
    await expect(page.getByTestId("my-report-status")).toHaveText("Dikirim");
    await expect(page.getByRole("heading", { level: 1, name: "Checkout gagal di Safari" })).toBeVisible();
    await expect(page.getByText("Android 14 / Chrome 130")).toBeVisible();
    await expect(page.getByRole("link", { name: /video\.example\.com/ })).toBeVisible();
    await expect(page.getByTestId("report-timeline")).toContainText("mengirim laporan");
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("panel masalah diketahui bisa dicari", async ({ api, signedInPage }) => {
    const { seed, cycle, tester } = await setup(api);
    for (const title of ["Login lambat sekali", "Tombol bayar hilang"]) {
      const r = await submitted(api, cycle, tester, title);
      await api.triage(seed.owner, seed.project.slug, r.number, { version: r.version, decision: "accept" });
    }
    const { page } = await signedInPage(tester);
    await page.goto(`/crowd/c/${cycle.id}/report`);
    const panel = page.getByTestId("report-known-issues");
    await expect(panel).toContainText("Login lambat sekali");
    await expect(panel).toContainText("Tombol bayar hilang");
    await page.getByTestId("report-known-search").fill("bayar");
    await expect(panel).not.toContainText("Login lambat sekali");
    await expect(panel).toContainText("Tombol bayar hilang");
  });

  test("batas 10 laporan menunggu triase → pesan batas, isian tetap", async ({ api, signedInPage }) => {
    const { cycle, tester } = await setup(api);
    for (let i = 0; i < 10; i++) await submitted(api, cycle, tester, `Laporan ke-${i}`);
    const { page } = await signedInPage(tester);
    await page.goto(`/crowd/c/${cycle.id}/report`);
    await page.getByTestId("report-title").fill("Laporan kesebelas");
    await page.getByTestId("report-steps").fill("Langkah reproduksi yang jelas");
    await page.getByTestId("report-expected").fill("Berhasil");
    await page.getByTestId("report-actual").fill("Gagal");
    await page.getByTestId("report-environment").fill("Firefox 130");
    await page.getByTestId("report-submit").click();
    await expect(page.getByTestId("report-limit")).toContainText("10");
    await expect(page.getByTestId("report-title")).toHaveValue("Laporan kesebelas");
  });

  // Review Focus 3.
  test("cycle ditutup saat form terbuka → pesan cycle ditutup, isian tetap terlihat", async ({ api, signedInPage }) => {
    const { seed, cycle, tester } = await setup(api);
    const { page } = await signedInPage(tester);
    await page.goto(`/crowd/c/${cycle.id}/report`);
    await page.getByTestId("report-title").fill("Laporan yang tertunda");
    await page.getByTestId("report-steps").fill("Langkah reproduksi yang jelas");
    await page.getByTestId("report-expected").fill("Berhasil");
    await page.getByTestId("report-actual").fill("Gagal");
    await page.getByTestId("report-environment").fill("Firefox 130");
    await api.updateCycle(seed.owner, seed.project.slug, cycle.number, { version: cycle.version, status: "closed" });
    await page.getByTestId("report-submit").click();
    await expect(page.getByTestId("report-closed")).toContainText("Cycle sudah ditutup");
    await expect(page.getByTestId("report-title")).toHaveValue("Laporan yang tertunda");
    await expect(page.getByTestId("report-steps")).toHaveValue("Langkah reproduksi yang jelas");
    await expect(page.getByTestId("report-submit")).toBeDisabled();
  });
});

test.describe("Crowdtesting: laporan saya", () => {
  test("ubah laporan; dua tab → banner bentrok tanpa membuang isian", async ({ api, signedInPage }) => {
    const { cycle, tester } = await setup(api);
    const report = await submitted(api, cycle, tester, "Judul pertama");
    const { page } = await signedInPage(tester);
    const { page: other } = await signedInPage(tester);

    await page.goto(`/crowd/r/${report.id}`);
    await page.getByTestId("report-edit").click();
    await other.goto(`/crowd/r/${report.id}/edit`);
    // Tab B harus sudah memuat versi 1 sebelum tab A menyimpan.
    await expect(other.getByTestId("report-title")).toHaveValue("Judul pertama");
    await expect(page.getByTestId("report-title")).toHaveValue("Judul pertama");
    await page.getByTestId("report-title").fill("Judul diubah tab A");
    await page.getByTestId("report-submit").click();
    await expect(page.getByRole("heading", { level: 1, name: "Judul diubah tab A" })).toBeVisible();

    await other.getByTestId("report-title").fill("Judul diubah tab B");
    await other.getByTestId("report-submit").click();
    await expect(other.getByTestId("report-conflict")).toBeVisible();
    await expect(other.getByTestId("report-title")).toHaveValue("Judul diubah tab B");
    await other.getByTestId("report-conflict-reload").click();
    await expect(other.getByTestId("report-title")).toHaveValue("Judul diubah tab A");
  });

  test("tarik laporan dengan konfirmasi inline; tombol ubah/tarik hilang", async ({ api, signedInPage }) => {
    const { cycle, tester } = await setup(api);
    const report = await submitted(api, cycle, tester);
    const { page } = await signedInPage(tester);
    await page.goto(`/crowd/r/${report.id}`);
    await page.getByTestId("report-withdraw").click();
    await page.getByTestId("report-withdraw-confirm").click();
    await expect(page.getByTestId("my-report-status")).toHaveText("Ditarik");
    await expect(page.getByTestId("report-edit")).toHaveCount(0);
    await expect(page.getByTestId("report-withdraw")).toHaveCount(0);
  });

  test("hasil triase terlihat pelapor: diterima, ditolak, duplikat; komentar pelapor", async ({ api, signedInPage }) => {
    const { seed, cycle, tester } = await setup(api);
    const original = await submitted(api, cycle, tester, "Laporan asli");
    const accepted = await api.triage(seed.owner, seed.project.slug, original.number, { version: 1, decision: "accept", severity: "critical" });
    const rejected = await submitted(api, cycle, tester, "Laporan ditolak");
    await api.triage(seed.owner, seed.project.slug, rejected.number, { version: 1, decision: "reject", reason: "out_of_scope", note: "Di luar halaman checkout" });
    const dup = await submitted(api, cycle, tester, "Laporan kembar");
    await api.triage(seed.owner, seed.project.slug, dup.number, { version: 1, decision: "duplicate", duplicateOf: accepted.number });

    const { page } = await signedInPage(tester);
    await page.goto(`/crowd/r/${original.id}`);
    await expect(page.getByTestId("my-report-points")).toHaveText("+5 poin · Critical");
    await page.goto(`/crowd/r/${rejected.id}`);
    await expect(page.getByTestId("my-report-triage")).toContainText("Di luar cakupan");
    await expect(page.getByTestId("my-report-triage")).toContainText("Di luar halaman checkout");
    await page.goto(`/crowd/r/${dup.id}`);
    await expect(page.getByTestId("my-report-triage")).toContainText("Laporan asli");

    await page.getByTestId("crowd-comment-input").fill("Saya bisa kirim video tambahan");
    await page.getByTestId("crowd-comment-submit").click();
    await expect(page.getByTestId("crowd-comments")).toContainText("Saya bisa kirim video tambahan");
  });

  test("laporan orang lain → Laporan tidak ditemukan", async ({ api, signedInPage }) => {
    const { cycle, tester } = await setup(api);
    const report = await submitted(api, cycle, tester);
    const other = await joinedTester(api, cycle);
    const { page } = await signedInPage(other);
    await page.goto(`/crowd/r/${report.id}`);
    await expect(page.getByTestId("report-not-found")).toBeVisible();
  });

  test("di 375 px form dan laporan dengan teks panjang tidak melebar", async ({ api, newContext }) => {
    const { cycle, tester } = await setup(api);
    const report = await api.submitCrowdReport(
      tester,
      cycle.id,
      crowdReportBody({ title: "J".repeat(200), steps: `${"tanpa-spasi".repeat(60)}\n\n\`\`\`\n${"x".repeat(500)}\n\`\`\``, environment: "E".repeat(200) }),
    );
    const context = await newContext(await mobileContextOptions(tester));
    const page = await context.newPage();
    await page.goto(`/crowd/r/${report.id}`);
    await expect(page.getByTestId("my-report-status")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.goto(`/crowd/c/${cycle.id}/report`);
    await expect(page.getByTestId("report-form")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
