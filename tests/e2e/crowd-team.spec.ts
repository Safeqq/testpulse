import { horizontalOverflow, mobileContextOptions } from "../support/bugs.js";
import { crowdReportBody, cycleBody, joinedTester, seedCrowd } from "../support/crowd.js";
import { expect, test } from "../support/fixtures.js";
import { buildJUnit } from "../support/junit.js";

const cyclesPath = (slug: string) => `/p/${slug}/cycles`;

test.describe("Crowdtesting tim: daftar dan form cycle", () => {
  test("daftar menampilkan status efektif dan jumlah laporan menunggu triase", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const seed = await seedCrowd(api, { titles: ["Cycle terbuka"] });
    await api.createCycle(seed.owner, seed.project.slug, cycleBody({ title: "Cycle draf" }));
    const tester = await joinedTester(api, seed.cycles[0]!);
    await api.submitCrowdReport(tester, seed.cycles[0]!.id, crowdReportBody());

    const { page } = await signedInPage(seed.owner);
    await page.goto(`/p/${seed.project.slug}`);
    await page.getByTestId("tab-crowd").click();
    await expect(page).toHaveURL(new RegExp(`${cyclesPath(seed.project.slug)}$`));
    await expect(page.getByTestId("cycle-row-1")).toContainText("Berlangsung");
    await expect(page.getByTestId("cycle-awaiting-1")).toHaveText("1 menunggu triase");
    await expect(page.getByTestId("cycle-row-2")).toContainText("Draf");
    await expect(page.getByTestId("cycle-awaiting-2")).toHaveCount(0);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("admin membuat cycle: validasi, link, chip lingkungan, Markdown, saran versi, endsAt", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const seed = await seedCrowd(api, { titles: [] });
    const { token } = await api.createToken(seed.owner, seed.project.slug);
    const upload = await api.uploadRun(token, seed.project.slug, buildJUnit([{ name: "login", status: "passed" }]), {
      branch: "main",
      version: "v2.3.0",
    });
    expect(upload.status()).toBe(201);

    const { page } = await signedInPage(seed.owner);
    await page.goto(cyclesPath(seed.project.slug));
    await expect(page.getByTestId("cycles-empty")).toBeVisible();
    await page.getByTestId("cycle-create").click();
    await expect(page.getByTestId("cycle-form")).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);

    await page.getByTestId("cycle-save").click();
    await expect(page.getByTestId("field-error-title")).toBeVisible();
    await expect(page.getByTestId("cycle-title")).toBeFocused();

    await page.getByTestId("cycle-title").fill("Uji checkout v2");
    await page.getByTestId("cycle-summary").fill("Coba alur checkout baru dan laporkan masalahnya.");
    await page.getByTestId("cycle-link-0-url").fill("https://staging.example.com");
    await page.getByTestId("cycle-link-0-label").fill("Web staging");
    await page.getByTestId("cycle-link-add").click();
    await page.getByTestId("cycle-link-1-url").fill("https://example.com/app.apk");
    await page.getByTestId("cycle-link-1-label").fill("APK Android");
    await page.getByRole("button", { name: "Pindah link 2 ke atas" }).click();
    await expect(page.getByTestId("cycle-link-0-label")).toHaveValue("APK Android");
    await page.getByTestId("cycle-link-add").click();
    await page.getByRole("button", { name: "Hapus link 3" }).click();
    await expect(page.getByTestId("cycle-link-2-url")).toHaveCount(0);

    await page.getByTestId("cycle-instructions").fill("1. Masuk\n2. Klik **Bayar**");
    await page.getByTestId("cycle-instructions-tab-preview").click();
    await expect(page.getByTestId("cycle-instructions-preview").locator("strong")).toHaveText("Bayar");
    await page.getByTestId("cycle-instructions-tab-write").click();
    await page.getByTestId("cycle-in-scope").fill("Checkout");
    await page.getByTestId("cycle-out-scope").fill("Serangan DoS");

    for (const env of ["Chrome desktop", "Android", "chrome desktop"]) {
      await page.getByTestId("cycle-env-input").fill(env);
      await page.getByTestId("cycle-env-input").press("Enter");
    }
    await expect(page.getByTestId("cycle-envs").getByRole("listitem")).toHaveCount(2);
    await page.getByRole("button", { name: "Hapus lingkungan Android" }).click();
    await expect(page.getByTestId("cycle-envs").getByRole("listitem")).toHaveCount(1);

    await expect(page.locator("datalist option[value='v2.3.0']")).toHaveCount(1);
    await page.getByTestId("cycle-app-version").fill("v2.3.0");

    await page.getByTestId("cycle-ends-at").fill("2020-01-01T10:00");
    await page.getByTestId("cycle-save").click();
    await expect(page.getByTestId("field-error-endsAt")).toContainText("masa depan");
    await page.getByTestId("cycle-ends-at").fill(`${new Date().getFullYear() + 1}-06-01T10:00`);
    await page.getByTestId("cycle-save").click();

    await expect(page).toHaveURL(new RegExp(`${cyclesPath(seed.project.slug)}/1$`));
    await expect(page.getByTestId("cycle-status")).toContainText("Draf");
    await expect(page.getByRole("heading", { level: 1, name: "Uji checkout v2" })).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);
  });

  // Final review Important 1: cycle yang sudah lewat endsAt tetap bisa diedit tanpa menyentuh endsAt.
  test("mengubah judul cycle yang sudah lewat waktu berakhirnya → tersimpan, tetap selesai", async ({ api, signedInPage }) => {
    const seed = await seedCrowd(api, { titles: [] });
    const endsAt = new Date(Date.now() + 3_000).toISOString();
    const cycle = await api.createOpenCycle(seed.owner, seed.project.slug, cycleBody({ title: "Cycle singkat", endsAt }));
    const { page } = await signedInPage(seed.owner);
    await page.waitForTimeout(Math.max(0, Date.parse(endsAt) - Date.now() + 500));
    await page.goto(`${cyclesPath(seed.project.slug)}/${cycle.number}/edit`);
    await expect(page.getByTestId("cycle-title")).toHaveValue("Cycle singkat");
    await page.getByTestId("cycle-title").fill("Cycle singkat (diperbaiki)");
    await page.getByTestId("cycle-save").click();
    await expect(page).toHaveURL(new RegExp(`${cyclesPath(seed.project.slug)}/${cycle.number}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Cycle singkat (diperbaiki)" })).toBeVisible();
    await expect(page.getByTestId("cycle-status")).toContainText("Selesai");
  });

  test("bentrok dua tab saat mengubah cycle → banner, isian tetap", async ({ api, signedInPage }) => {
    const seed = await seedCrowd(api);
    const edit = `${cyclesPath(seed.project.slug)}/1/edit`;
    const { page } = await signedInPage(seed.owner);
    const { page: other } = await signedInPage(seed.owner);
    await page.goto(edit);
    await other.goto(edit);
    await expect(page.getByTestId("cycle-title")).toHaveValue("Uji rilis");
    await expect(other.getByTestId("cycle-title")).toHaveValue("Uji rilis");

    await page.getByTestId("cycle-title").fill("Judul dari tab A");
    await page.getByTestId("cycle-save").click();
    await expect(page.getByRole("heading", { level: 1, name: "Judul dari tab A" })).toBeVisible();

    await other.getByTestId("cycle-title").fill("Judul dari tab B");
    await other.getByTestId("cycle-save").click();
    await expect(other.getByTestId("cycle-conflict")).toBeVisible();
    await expect(other.getByTestId("cycle-title")).toHaveValue("Judul dari tab B");
    await other.getByRole("button", { name: "Muat versi terbaru" }).click();
    await expect(other.getByTestId("cycle-title")).toHaveValue("Judul dari tab A");
  });
});

test.describe("Crowdtesting tim: detail cycle", () => {
  test("buka, tutup, buka ulang dengan konfirmasi inline; salin dan lihat sebagai crowd tester", async ({
    api,
    signedInPage,
    browserName,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const seed = await seedCrowd(api, { titles: [] });
    const cycle = await api.createCycle(seed.owner, seed.project.slug, cycleBody({ title: "Cycle baru" }));
    const { page } = await signedInPage(seed.owner);
    if (browserName === "chromium") await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`${cyclesPath(seed.project.slug)}/${cycle.number}`);
    await expect(page.getByTestId("cycle-status")).toContainText("Draf");
    await expect(page.getByTestId("cycle-copy-link")).toHaveCount(0);

    await page.getByTestId("cycle-open").click();
    await expect(page.getByRole("group", { name: "Konfirmasi" })).toContainText("Buka cycle ini untuk publik?");
    await expectNoA11yViolationsInBothThemes(page);
    await page.getByTestId("cycle-status-confirm").click();
    await expect(page.getByTestId("cycle-status")).toContainText("Berlangsung");

    await page.getByTestId("cycle-close").click();
    await page.getByRole("button", { name: "Batal" }).click();
    await expect(page.getByTestId("cycle-status")).toContainText("Berlangsung");
    await page.getByTestId("cycle-close").click();
    await page.getByTestId("cycle-status-confirm").click();
    await expect(page.getByTestId("cycle-status")).toContainText("Selesai");
    await page.getByTestId("cycle-reopen").click();
    await page.getByTestId("cycle-status-confirm").click();
    await expect(page.getByTestId("cycle-status")).toContainText("Berlangsung");

    await page.getByTestId("cycle-copy-link").click();
    await expect(page.getByTestId("cycle-control-message")).not.toBeEmpty();
    if (browserName === "chromium") {
      await expect(page.getByTestId("cycle-control-message")).toHaveText("Link publik disalin.");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/crowd/c/${cycle.id}$`));
    }
    await page.getByTestId("cycle-view-public").click();
    await expect(page).toHaveURL(new RegExp(`/crowd/c/${cycle.id}$`));
    await expect(page.getByTestId("cycle-public-header")).toContainText("Cycle baru");
  });

  test("antrian triase dengan filter status, severity, dan pencarian", async ({ api, signedInPage, expectNoA11yViolationsInBothThemes }) => {
    const seed = await seedCrowd(api);
    const cycle = seed.cycles[0]!;
    const tester = await joinedTester(api, cycle);
    await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: "Login lambat", suggestedSeverity: "minor" }));
    await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: "Checkout macet", suggestedSeverity: "critical" }));
    const accepted = await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: "Logo pecah" }));
    await api.triage(seed.owner, seed.project.slug, accepted.number, { version: accepted.version, decision: "accept" });

    const { page } = await signedInPage(seed.owner);
    await page.goto(`${cyclesPath(seed.project.slug)}/1`);
    const queue = page.getByTestId("triage-queue");
    await expect(queue.getByTestId("triage-row-1")).toContainText("Login lambat");
    await expect(queue.getByTestId("triage-row-2")).toContainText("Checkout macet");
    await expect(queue.getByTestId("triage-row-3")).toHaveCount(0);
    await expect(queue.getByTestId("triage-row-1").getByRole("link")).toHaveAttribute("href", `/p/${seed.project.slug}/crowd-reports/1`);
    await expectNoA11yViolationsInBothThemes(page);

    await page.getByTestId("triage-filter-severity").selectOption("critical");
    await expect(queue.getByTestId("triage-row-1")).toHaveCount(0);
    await expect(queue.getByTestId("triage-row-2")).toBeVisible();
    await page.getByTestId("triage-filter-severity").selectOption("");

    await page.getByTestId("triage-search").fill("login");
    await page.getByTestId("triage-search").press("Enter");
    await expect(queue.getByTestId("triage-row-2")).toHaveCount(0);
    await expect(queue.getByTestId("triage-row-1")).toBeVisible();
    await page.getByTestId("triage-search").fill("");
    await page.getByTestId("triage-search").press("Enter");

    await page.getByTestId("triage-filter-status").selectOption("accepted");
    await expect(queue.getByTestId("triage-row-3")).toContainText("Logo pecah");
    await expect(queue.getByTestId("triage-row-1")).toHaveCount(0);
    await page.getByTestId("triage-filter-status").selectOption("rejected");
    await expect(page.getByTestId("triage-queue-empty")).toBeVisible();
  });

  test("peserta dikeluarkan dengan alasan; peserta itu melihat pesan dikeluarkan; leaderboard", async ({ api, signedInPage }) => {
    const seed = await seedCrowd(api);
    const cycle = seed.cycles[0]!;
    const tester = await joinedTester(api, cycle);
    const report = await api.submitCrowdReport(tester, cycle.id, crowdReportBody());
    await api.triage(seed.owner, seed.project.slug, report.number, { version: report.version, decision: "accept", severity: "critical" });

    const { page } = await signedInPage(seed.owner);
    await page.goto(`${cyclesPath(seed.project.slug)}/1`);
    await page.getByTestId("cycle-team-tab-leaderboard").click();
    await expect(page).toHaveURL(/\?tab=leaderboard$/);
    await expect(page.getByTestId("leaderboard-row-1")).toContainText(tester.user.name);
    await expect(page.getByTestId("leaderboard-row-1")).toContainText("5");

    await page.getByTestId("cycle-team-tab-peserta").click();
    const row = page.getByTestId(`participant-row-${tester.user.id}`);
    await expect(row).toContainText("Aktif");
    await expect(row).toContainText("1 laporan, 1 diterima");
    await page.getByTestId(`participant-remove-${tester.user.id}`).click();
    await page.getByTestId("participant-remove-reason").fill("Spam berulang");
    await page.getByTestId("participant-remove-confirm").click();
    await expect(row).toContainText("Dikeluarkan");
    await expect(page.getByTestId(`participant-remove-${tester.user.id}`)).toHaveCount(0);

    const { page: testerPage } = await signedInPage(tester);
    await testerPage.goto(`/crowd/c/${cycle.id}`);
    await expect(testerPage.getByTestId("cycle-action")).toContainText("dikeluarkan dari cycle ini");
    await expect(testerPage.getByTestId("cycle-report")).toHaveCount(0);
  });

  test("hapus cycle: tanpa laporan bisa; dengan laporan tombol menjelaskan kenapa tidak", async ({ api, signedInPage }) => {
    const seed = await seedCrowd(api, { titles: ["Ada laporan"] });
    const tester = await joinedTester(api, seed.cycles[0]!);
    await api.submitCrowdReport(tester, seed.cycles[0]!.id, crowdReportBody());
    const empty = await api.createCycle(seed.owner, seed.project.slug, cycleBody({ title: "Cycle kosong" }));

    const { page } = await signedInPage(seed.owner);
    await page.goto(`${cyclesPath(seed.project.slug)}/1`);
    await expect(page.getByTestId("cycle-delete")).toBeDisabled();
    await expect(page.getByTestId("cycle-delete")).toHaveAccessibleDescription(/tidak bisa dihapus/);

    await page.goto(`${cyclesPath(seed.project.slug)}/${empty.number}`);
    await page.getByTestId("cycle-delete").click();
    await page.getByTestId("cycle-delete-confirm").click();
    await expect(page).toHaveURL(new RegExp(`${cyclesPath(seed.project.slug)}$`));
    await expect(page.getByTestId("cycle-row-1")).toBeVisible();
    await expect(page.getByTestId(`cycle-row-${empty.number}`)).toHaveCount(0);
  });
});

test.describe("Crowdtesting tim: akses dan tata letak", () => {
  test("tester tanpa kontrol admin; viewer hanya baca; anonim di project publik tanpa antrian/peserta", async ({
    api,
    signedInPage,
    page,
  }) => {
    const seed = await seedCrowd(api, { visibility: "public" });
    const crowdTester = await joinedTester(api, seed.cycles[0]!);
    const detail = `${cyclesPath(seed.project.slug)}/1`;

    const teamTester = await api.addMember(seed.owner, seed.project.slug, "tester");
    const { page: testerPage } = await signedInPage(teamTester);
    await testerPage.goto(cyclesPath(seed.project.slug));
    await expect(testerPage.getByTestId("cycle-row-1")).toBeVisible();
    await expect(testerPage.getByTestId("cycle-create")).toHaveCount(0);
    await testerPage.goto(detail);
    await expect(testerPage.getByTestId("triage-queue")).toBeVisible();
    for (const id of ["cycle-close", "cycle-edit", "cycle-delete"]) await expect(testerPage.getByTestId(id)).toHaveCount(0);
    await expect(testerPage.getByTestId("cycle-copy-link")).toBeVisible();
    await testerPage.getByTestId("cycle-team-tab-peserta").click();
    await expect(testerPage.getByTestId(`participant-remove-${crowdTester.user.id}`)).toBeVisible();
    await testerPage.goto(`${cyclesPath(seed.project.slug)}/new`);
    await expect(testerPage.getByTestId("cycle-form-forbidden")).toBeVisible();

    const viewer = await api.addMember(seed.owner, seed.project.slug, "viewer");
    const { page: viewerPage } = await signedInPage(viewer);
    await viewerPage.goto(detail);
    await expect(viewerPage.getByTestId("triage-queue")).toBeVisible();
    await expect(viewerPage.getByTestId("cycle-close")).toHaveCount(0);
    await viewerPage.getByTestId("cycle-team-tab-peserta").click();
    await expect(viewerPage.getByTestId(`participant-row-${crowdTester.user.id}`)).toBeVisible();
    await expect(viewerPage.getByTestId(`participant-remove-${crowdTester.user.id}`)).toHaveCount(0);

    await page.goto(`${detail}?tab=peserta`);
    await expect(page.getByTestId("cycle-status")).toContainText("Berlangsung");
    await expect(page.getByTestId("triage-queue")).toHaveCount(0);
    await expect(page.getByTestId("participants-list")).toHaveCount(0);
    await expect(page.getByTestId("cycle-team-tab-antrian")).toHaveCount(0);
    await expect(page.getByTestId("cycle-team-tab-peserta")).toHaveCount(0);
    await expect(page.getByTestId("cycle-close")).toHaveCount(0);
  });

  test("di 375 px daftar, form, dan detail dengan teks panjang tidak melebar", async ({ api, newContext }) => {
    const seed = await seedCrowd(api, { titles: ["J".repeat(120)], cycle: { summary: "R".repeat(280) } });
    const tester = await joinedTester(api, seed.cycles[0]!);
    await api.submitCrowdReport(tester, seed.cycles[0]!.id, crowdReportBody({ title: "L".repeat(200) }));
    const context = await newContext(await mobileContextOptions(seed.owner));
    const page = await context.newPage();
    for (const path of ["", "/1", "/1/edit"]) {
      await page.goto(`${cyclesPath(seed.project.slug)}${path}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId(path === "/1/edit" ? "cycle-form" : path === "/1" ? "triage-row-1" : "cycle-row-1")).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    }
  });
});
