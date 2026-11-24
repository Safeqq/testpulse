import { horizontalOverflow, mobileContextOptions } from "../support/bugs.js";
import { crowdReportBody, joinedTester, seedCrowd } from "../support/crowd.js";
import { expect, test } from "../support/fixtures.js";

const triagePath = (slug: string, number: number) => `/p/${slug}/crowd-reports/${number}`;

test.describe("Crowdtesting: alur lengkap", () => {
  test("terima: cycle dibuat dan dibuka → tester ikut dan melapor → bug dibuat, poin, leaderboard, masalah diketahui", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const title = `Uji alur ${Date.now().toString(36)}`;

    // Admin membuat dan membuka cycle lewat UI.
    const { page: admin } = await signedInPage(owner);
    await admin.goto(`/p/${project.slug}/cycles/new`);
    await admin.getByTestId("cycle-title").fill(title);
    await admin.getByTestId("cycle-link-0-url").fill("https://staging.example.com");
    await admin.getByTestId("cycle-link-0-label").fill("Web staging");
    await admin.getByTestId("cycle-instructions").fill("Coba alur **checkout**");
    await admin.getByTestId("cycle-save").click();
    await admin.getByTestId("cycle-open").click();
    await admin.getByTestId("cycle-status-confirm").click();
    await expect(admin.getByTestId("cycle-status")).toContainText("Berlangsung");

    // Tester luar menemukan cycle di direktori, ikut, membaca masalah diketahui, lalu melapor.
    const { page: tester, user: testerUser } = await signedInPage();
    await tester.goto("/crowd");
    await tester.getByTestId("crowd-search").fill(title);
    await tester.getByTestId("crowd-search").press("Enter");
    await tester.getByRole("link", { name: title }).click();
    await expect(tester).toHaveURL(/\/crowd\/c\/[0-9a-f-]+$/);
    const cycleUrl = tester.url();
    await tester.getByTestId("cycle-rules-checkbox").check();
    await tester.getByTestId("cycle-join").click();
    await tester.getByTestId("cycle-tab-masalah").click();
    await expect(tester.getByTestId("known-issues")).toBeVisible();
    await tester.goto(`${cycleUrl}/report`);
    await tester.getByTestId("report-title").fill("Tombol bayar tidak merespons");
    await tester.getByTestId("report-steps").fill("1. Buka keranjang\n2. Klik Bayar");
    await tester.getByTestId("report-expected").fill("Halaman pembayaran terbuka");
    await tester.getByTestId("report-actual").fill("Tidak terjadi apa-apa");
    await tester.getByTestId("report-environment").fill("Chrome 130");
    await tester.getByTestId("report-submit").click();
    await expect(tester.getByTestId("my-report-status")).toHaveText("Dikirim");
    const myReportUrl = tester.url();

    // Admin menerima dengan severity critical.
    await admin.reload();
    await admin.getByTestId("triage-row-1").getByRole("link").click();
    await expect(admin).toHaveURL(new RegExp(`${triagePath(project.slug, 1)}$`));
    await expect(admin.getByTestId("triage-panel")).toBeVisible();
    await expect(admin.getByTestId("triage-reporter")).toContainText(testerUser.user.name);
    await expectNoA11yViolationsInBothThemes(admin);
    await admin.getByTestId("triage-accept").click();
    await expect(admin.getByTestId("triage-severity")).toHaveValue("major");
    await expect(admin.getByTestId("triage-priority")).toHaveValue("medium");
    await admin.getByTestId("triage-severity").selectOption("critical");
    await admin.getByTestId("triage-save").click();
    await expect(admin.getByTestId("triage-status")).toHaveText("Diterima");
    await expect(admin.getByTestId("triage-bug-link")).toHaveText("Bug #1 dibuat");
    await expectNoA11yViolationsInBothThemes(admin);

    await admin.getByTestId("triage-bug-link").click();
    await expect(admin).toHaveURL(new RegExp(`/p/${project.slug}/bugs/1$`));
    await expect(admin.getByTestId("bug-labels")).toContainText("crowd");
    await expect(admin.getByTestId("bug-crowd-origin")).toContainText("CY-1 · CR-1");
    await expect(admin.getByTestId("bug-crowd-origin")).toContainText(testerUser.user.name);
    await admin.getByTestId("bug-crowd-origin").getByRole("link").click();
    await expect(admin).toHaveURL(new RegExp(`${triagePath(project.slug, 1)}$`));

    // Tester melihat poin dan tampil di leaderboard cycle dan global.
    await tester.goto(myReportUrl);
    await expect(tester.getByTestId("my-report-points")).toHaveText("+5 poin · Critical");
    await tester.goto(`${cycleUrl}?tab=leaderboard`);
    await expect(tester.getByTestId("leaderboard")).toContainText(testerUser.user.name);
    await tester.goto("/crowd/leaderboard");
    await expect(tester.getByTestId("leaderboard")).toContainText(testerUser.user.name);

    // Laporan masuk daftar masalah diketahui; disembunyikan → hilang.
    await tester.goto(`${cycleUrl}?tab=masalah`);
    await expect(tester.getByTestId("known-issue-0")).toContainText("Tombol bayar tidak merespons");
    await admin.getByTestId("triage-hide").check();
    await expect(admin.getByTestId("triage-hide-message")).toContainText("disembunyikan");
    await tester.reload();
    await expect(tester.getByTestId("known-issues")).toBeVisible();
    await expect(tester.getByTestId("known-issue-0")).toHaveCount(0);
  });

  test("tolak dengan alasan, kembalikan, dan duplikat hanya ke kandidat sah", async ({ api, signedInPage }) => {
    const seed = await seedCrowd(api);
    const cycle = seed.cycles[0]!;
    const tester = await joinedTester(api, cycle);
    const first = await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: "Login gagal" }));
    await api.triage(seed.owner, seed.project.slug, first.number, { version: first.version, decision: "accept" });
    const second = await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: "Login gagal lagi" }));
    await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: "Login gagal ketiga" }));
    await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: "Login gagal keempat" }));

    const { page } = await signedInPage(seed.owner);
    await page.goto(triagePath(seed.project.slug, 2));
    await page.getByTestId("triage-reject").click();
    await page.getByTestId("triage-reason").getByRole("radio", { name: "Lainnya" }).check();
    await page.getByTestId("triage-save").click();
    await expect(page.getByTestId("field-error-note")).toBeVisible();
    await page.getByTestId("triage-reason").getByRole("radio", { name: "Di luar cakupan" }).check();
    await page.getByTestId("triage-note").fill("Halaman admin tidak diuji");
    await page.getByTestId("triage-save").click();
    await expect(page.getByTestId("triage-status")).toHaveText("Ditolak");

    const { page: testerPage } = await signedInPage(tester);
    await testerPage.goto(`/crowd/r/${second.id}`);
    await expect(testerPage.getByTestId("my-report-triage")).toContainText("Di luar cakupan");
    await expect(testerPage.getByTestId("my-report-triage")).toContainText("Halaman admin tidak diuji");

    await page.getByTestId("triage-reopen").click();
    await expect(page.getByTestId("triage-status")).toHaveText("Dikirim");

    await page.goto(triagePath(seed.project.slug, 3));
    await page.getByTestId("triage-duplicate").click();
    await page.getByTestId("triage-duplicate-search").fill("login");
    await expect(page.getByTestId("triage-duplicate-option-1")).toBeVisible();
    await expect(page.getByTestId("triage-duplicate-option-2")).toBeVisible();
    await expect(page.getByTestId("triage-duplicate-option-3")).toHaveCount(0);
    await expect(page.getByTestId("triage-duplicate-option-4")).toHaveCount(0);
    await page.getByTestId("triage-duplicate-search").fill("1");
    await expect(page.getByTestId("triage-duplicate-option-2")).toHaveCount(0);
    await page.getByTestId("triage-duplicate-option-1").check();
    await page.getByTestId("triage-save").click();
    await expect(page.getByTestId("triage-status")).toHaveText("Duplikat");
    await expect(page.getByTestId("triage-result")).toContainText("Login gagal");
  });

  // Final review Important 2: nomor laporan asli di luar halaman pertama kandidat tetap bisa dicari.
  test("duplikat: cari nomor laporan asli lama di cycle dengan lebih dari 50 laporan diterima", async ({ api, signedInPage }) => {
    test.setTimeout(120_000);
    const seed = await seedCrowd(api);
    const cycle = seed.cycles[0]!;
    const testers = [await joinedTester(api, cycle), await joinedTester(api, cycle)];
    for (let i = 0; i < 52; i++) {
      const r = await api.submitCrowdReport(testers[i % 2]!, cycle.id, crowdReportBody({ title: `Laporan diterima ${i + 1}` }));
      await api.triage(seed.owner, seed.project.slug, r.number, { version: r.version, decision: "accept" });
    }
    await api.submitCrowdReport(testers[0]!, cycle.id, crowdReportBody({ title: "Laporan kembar dari yang pertama" }));

    const { page } = await signedInPage(seed.owner);
    await page.goto(triagePath(seed.project.slug, 53));
    await page.getByTestId("triage-duplicate").click();
    await page.getByTestId("triage-duplicate-search").fill("1");
    await expect(page.getByTestId("triage-duplicate-option-1")).toBeVisible();
    await page.getByTestId("triage-duplicate-option-1").check();
    await page.getByTestId("triage-save").click();
    await expect(page.getByTestId("triage-status")).toHaveText("Duplikat");
    await expect(page.getByTestId("triage-result")).toContainText("Laporan diterima 1");
  });

  // Final review Minor 6 (dinaikkan): Enter di kotak cari duplikat tidak boleh menyimpan keputusan.
  test("Enter di kotak cari duplikat tidak menyimpan keputusan triase", async ({ api, signedInPage }) => {
    const seed = await seedCrowd(api);
    const cycle = seed.cycles[0]!;
    const tester = await joinedTester(api, cycle);
    await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: "Laporan asli" }));
    await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: "Laporan kedua" }));

    const { page } = await signedInPage(seed.owner);
    await page.goto(triagePath(seed.project.slug, 2));
    await page.getByTestId("triage-duplicate").click();
    await page.getByTestId("triage-duplicate-option-1").check();
    await page.getByTestId("triage-duplicate-search").fill("asli");
    await page.getByTestId("triage-duplicate-search").press("Enter");
    await expect(page.getByTestId("triage-duplicate-option-1")).toBeVisible();
    await expect(page.getByTestId("triage-status")).toHaveText("Dikirim");
    await expect(page.getByTestId("triage-save")).toBeVisible();
  });

  test("komentar dua arah dan Simpan & berikutnya", async ({ api, signedInPage }) => {
    const seed = await seedCrowd(api);
    const cycle = seed.cycles[0]!;
    const tester = await joinedTester(api, cycle);
    const report = await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: "Laporan pertama" }));
    await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: "Laporan kedua" }));

    const { page } = await signedInPage(seed.owner);
    await page.goto(triagePath(seed.project.slug, 1));
    await page.getByTestId("crowd-comment-input").fill("Bisa kirim video?");
    await page.getByTestId("crowd-comment-submit").click();
    await expect(page.getByTestId("crowd-comments")).toContainText("Bisa kirim video?");

    const { page: testerPage } = await signedInPage(tester);
    await testerPage.goto(`/crowd/r/${report.id}`);
    await expect(testerPage.getByTestId("crowd-comments")).toContainText("Bisa kirim video?");
    await testerPage.getByTestId("crowd-comment-input").fill("Sudah saya lampirkan");
    await testerPage.getByTestId("crowd-comment-submit").click();
    await expect(testerPage.getByTestId("crowd-comments")).toContainText("Sudah saya lampirkan");
    await page.reload();
    await expect(page.getByTestId("crowd-comments")).toContainText("Sudah saya lampirkan");

    await page.getByTestId("triage-accept").click();
    await page.getByTestId("triage-save-next").click();
    await expect(page).toHaveURL(new RegExp(`${triagePath(seed.project.slug, 2)}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Laporan kedua" })).toBeVisible();
    await page.getByTestId("triage-accept").click();
    await page.getByTestId("triage-save-next").click();
    await expect(page).toHaveURL(new RegExp(`/p/${seed.project.slug}/cycles/1$`));
    await expect(page.getByTestId("triage-queue-empty")).toBeVisible();
  });

  test("dua anggota menerima laporan yang sama → satu sukses, yang lain melihat banner bentrok", async ({ api, signedInPage }) => {
    const seed = await seedCrowd(api);
    const tester = await joinedTester(api, seed.cycles[0]!);
    await api.submitCrowdReport(tester, seed.cycles[0]!.id, crowdReportBody());
    const teamTester = await api.addMember(seed.owner, seed.project.slug, "tester");
    const { page: a } = await signedInPage(seed.owner);
    const { page: b } = await signedInPage(teamTester);
    await a.goto(triagePath(seed.project.slug, 1));
    await b.goto(triagePath(seed.project.slug, 1));
    await expect(a.getByTestId("triage-panel")).toBeVisible();
    await expect(b.getByTestId("triage-panel")).toBeVisible();

    await a.getByTestId("triage-accept").click();
    await a.getByTestId("triage-save").click();
    await expect(a.getByTestId("triage-bug-link")).toHaveText("Bug #1 dibuat");

    await b.getByTestId("triage-accept").click();
    await b.getByTestId("triage-severity").selectOption("blocker");
    await b.getByTestId("triage-save").click();
    await expect(b.getByTestId("triage-conflict")).toBeVisible();
    await expect(b.getByTestId("triage-severity")).toHaveValue("blocker");
    await b.getByTestId("triage-conflict-reload").click();
    await expect(b.getByTestId("triage-bug-link")).toHaveText("Bug #1 dibuat");
  });

  test("viewer membaca halaman triase tanpa panel keputusan; kartu dashboard menunjukkan menunggu triase", async ({
    api,
    signedInPage,
  }) => {
    const seed = await seedCrowd(api);
    const tester = await joinedTester(api, seed.cycles[0]!);
    await api.submitCrowdReport(tester, seed.cycles[0]!.id, crowdReportBody({ title: "Untuk viewer" }));
    const viewer = await api.addMember(seed.owner, seed.project.slug, "viewer");
    const { page } = await signedInPage(viewer);
    await page.goto(triagePath(seed.project.slug, 1));
    await expect(page.getByRole("heading", { level: 1, name: "Untuk viewer" })).toBeVisible();
    await expect(page.getByTestId("triage-accept")).toHaveCount(0);
    await expect(page.getByTestId("crowd-comment-input")).toHaveCount(0);

    // Project tanpa run CI: kartu tetap tampil (pola Ruling R10 Tahap 4).
    await page.goto(`/p/${seed.project.slug}`);
    const card = page.getByTestId("crowd-card");
    await expect(card).toContainText("1 cycle berlangsung");
    await expect(card).toContainText("1 menunggu triase");
    await expect(card).toContainText("0 diterima 30 hari terakhir");
  });

  test("di 375 px halaman triase dengan teks panjang tidak melebar", async ({ api, newContext }) => {
    const seed = await seedCrowd(api);
    const tester = await joinedTester(api, seed.cycles[0]!);
    await api.submitCrowdReport(
      tester,
      seed.cycles[0]!.id,
      crowdReportBody({ title: "T".repeat(200), steps: `${"panjang".repeat(80)}\n\n\`\`\`\n${"x".repeat(400)}\n\`\`\``, environment: "E".repeat(200) }),
    );
    const context = await newContext(await mobileContextOptions(seed.owner));
    const page = await context.newPage();
    await page.goto(triagePath(seed.project.slug, 1));
    await expect(page.getByTestId("triage-panel")).toBeVisible();
    await page.getByTestId("triage-reject").click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
