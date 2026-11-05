import type { Page } from "@playwright/test";
import type { CreateBugBody, ProjectDto, RunDetailDto } from "@testpulse/shared";
import { BugNewPage } from "../pages/BugNewPage.js";
import { BugsPage } from "../pages/BugsPage.js";
import { RunDetailPage } from "../pages/RunDetailPage.js";
import type { TestApi, TestUser } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { buildJUnit, type JUnitCase } from "../support/junit.js";

const COMMIT = "abcdef1234567890abcdef1234567890abcdef12";
const CI_URL = "https://ci.example.com/builds/42";
const ERROR_MESSAGE = "Diharapkan 3 tetapi 4\n    di baris berindentasi\nada ``` di pesan";

async function newProject(api: TestApi, visibility?: "public"): Promise<{ owner: TestUser; project: ProjectDto }> {
  const owner = await api.register();
  const project = await api.createProject(owner);
  if (visibility) await api.setVisibility(owner, project.slug, visibility);
  return { owner, project };
}

/** Bug dibuat berurutan agar nomornya (1, 2, ...) bisa diprediksi. */
async function createBugs(api: TestApi, owner: TestUser, slug: string, bugs: CreateBugBody[]): Promise<void> {
  for (const body of bugs) await api.createBug(owner, slug, body);
}

async function uploadRun(api: TestApi, owner: TestUser, slug: string, cases: JUnitCase[]): Promise<string> {
  const { token } = await api.createToken(owner, slug);
  const res = await api.uploadRun(token, slug, buildJUnit(cases), {
    branch: "main",
    commit: COMMIT,
    ciUrl: CI_URL,
    name: "Build #42",
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { runId: string }).runId;
}

async function testCaseIds(owner: TestUser, slug: string, runId: string): Promise<Record<string, string>> {
  const res = await owner.request.get(`/api/v1/projects/${slug}/runs/${runId}?status=all`);
  expect(res.status()).toBe(200);
  const detail = (await res.json()) as RunDetailDto;
  return Object.fromEntries(detail.results.map((r) => [r.name, r.testCaseId]));
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

const SEED: CreateBugBody[] = [
  { title: "Tombol login macet", priority: "high", severity: "blocker", labels: ["ui"] },
  { title: "Respons API lambat", priority: "low", severity: "minor", labels: ["api"] },
  { title: "Gambar profil buram", priority: "medium", severity: "major", labels: ["ui", "api"] },
];

test.describe("Daftar bug", () => {
  test("tab Aktif/Selesai/Semua memisahkan bug dan tersimpan di URL", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, SEED);
    await api.updateBug(owner, project.slug, 2, { version: 1, status: "in_progress" });
    await api.updateBug(owner, project.slug, 3, { version: 1, status: "resolved", resolution: "fixed" });
    const { page } = await signedInPage(owner);
    const bugs = new BugsPage(page);

    await bugs.goto(project.slug);
    await expect(bugs.statusTab("active")).toHaveAttribute("aria-pressed", "true");
    await expect(bugs.rows).toHaveCount(2);
    await expect(bugs.row(1)).toContainText("#1");
    await expect(bugs.row(1)).toContainText("Tombol login macet");
    await expect(bugs.row(1)).toContainText("Open");
    await expect(bugs.row(1)).toContainText("Tinggi");
    await expect(bugs.row(1)).toContainText("Blocker");
    await expect(bugs.row(1)).toContainText("Belum di-assign");
    await expect(bugs.row(1)).toContainText("ui");
    await expect(bugs.row(2)).toContainText("In progress");
    await expect(bugs.row(1).getByRole("link")).toHaveAttribute("href", `/p/${project.slug}/bugs/1`);
    await expectNoA11yViolationsInBothThemes(page);

    await bugs.statusTab("done").click();
    await expect(page).toHaveURL(/\?status=done$/);
    await expect(bugs.rows).toHaveCount(1);
    await expect(bugs.row(3)).toContainText("Resolved");
    await expect(bugs.row(3)).toContainText("Diperbaiki");

    await bugs.statusTab("all").click();
    await expect(bugs.rows).toHaveCount(3);

    await page.reload();
    await expect(bugs.statusTab("all")).toHaveAttribute("aria-pressed", "true");
    await expect(bugs.rows).toHaveCount(3);
  });

  test("filter prioritas, severity, label, dan cari tersimpan di URL dan bertahan setelah reload", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, SEED);
    const { page } = await signedInPage(owner);
    const bugs = new BugsPage(page);
    await bugs.goto(project.slug);
    await expect(bugs.rows).toHaveCount(3);

    await bugs.priority.selectOption("high");
    await expect(page).toHaveURL(/priority=high/);
    await expect(bugs.rows).toHaveCount(1);
    await expect(bugs.row(1)).toBeVisible();

    await bugs.priority.selectOption("");
    await expect(page).not.toHaveURL(/priority=/);
    await bugs.severity.selectOption("minor");
    await expect(page).toHaveURL(/severity=minor/);
    await expect(bugs.rows).toHaveCount(1);
    await expect(bugs.row(2)).toBeVisible();

    await bugs.severity.selectOption("");
    await expect(page).not.toHaveURL(/severity=/);
    await expect(bugs.label.locator("option")).toHaveText(["Semua label", "api", "ui"]);
    await bugs.label.selectOption("ui");
    await expect(page).toHaveURL(/label=ui/);
    await expect(bugs.rows).toHaveCount(2);

    await bugs.search.fill("PROFIL");
    await bugs.searchSubmit.click();
    await expect(page).toHaveURL(/q=PROFIL/);
    await expect(bugs.rows).toHaveCount(1);
    await expect(bugs.row(3)).toBeVisible();

    await page.reload();
    await expect(bugs.label).toHaveValue("ui");
    await expect(bugs.search).toHaveValue("PROFIL");
    await expect(bugs.rows).toHaveCount(1);
    await expect(bugs.row(3)).toBeVisible();

    await bugs.reset.click();
    await expect(page).toHaveURL(new RegExp(`/p/${project.slug}/bugs$`));
    await expect(bugs.rows).toHaveCount(3);
    await expect(bugs.search).toHaveValue("");
  });

  test("'Bug saya', 'Belum di-assign', dan anggota tertentu di filter assignee", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    const tester = await api.addMember(owner, project.slug, "tester");
    await createBugs(api, owner, project.slug, [
      { title: "Milik tester", assigneeId: tester.user.id },
      { title: "Milik owner", assigneeId: owner.user.id },
      { title: "Tanpa pemilik" },
    ]);
    const { page } = await signedInPage(tester);
    const bugs = new BugsPage(page);
    await bugs.goto(project.slug);
    await expect(bugs.rows).toHaveCount(3);

    const options = await bugs.assignee.locator("option").allTextContents();
    expect(options.slice(0, 3)).toEqual(["Semua assignee", "Bug saya", "Belum di-assign"]);
    expect([...options.slice(3)].sort()).toEqual([owner.user.name, tester.user.name].sort());

    await bugs.assignee.selectOption("me");
    await expect(page).toHaveURL(/assignee=me/);
    await expect(bugs.rows).toHaveCount(1);
    await expect(bugs.row(1)).toContainText("Milik tester");
    await expect(bugs.row(1)).toContainText(tester.user.name);

    await bugs.assignee.selectOption("none");
    await expect(page).toHaveURL(/assignee=none/);
    await expect(bugs.rows).toHaveCount(1);
    await expect(bugs.row(3)).toContainText("Tanpa pemilik");

    await bugs.assignee.selectOption({ label: owner.user.name });
    await expect(page).toHaveURL(new RegExp(`assignee=${owner.user.id}`));
    await expect(bugs.rows).toHaveCount(1);
    await expect(bugs.row(2)).toContainText("Milik owner");

    await page.reload();
    await expect(bugs.assignee).toHaveValue(owner.user.id);
    await expect(bugs.rows).toHaveCount(1);
  });

  test("30 bug: 25 pertama lalu 'Muat lagi' menambah sisanya", async ({ api, signedInPage, expectNoA11yViolationsInBothThemes }) => {
    const { owner, project } = await newProject(api);
    await createBugs(
      api,
      owner,
      project.slug,
      Array.from({ length: 30 }, (_, i) => ({ title: `Bug nomor ${i + 1}` })),
    );
    const { page } = await signedInPage(owner);
    const bugs = new BugsPage(page);

    await bugs.goto(project.slug);
    await expect(bugs.rows).toHaveCount(25);
    await expect(bugs.loadMore).toBeVisible();
    await expect(bugs.loadMore).toHaveText("Muat lagi");
    await expectNoA11yViolationsInBothThemes(page);

    await bugs.loadMore.click();
    await expect(bugs.rows).toHaveCount(30);
    await expect(bugs.loadMore).toHaveCount(0);
  });

  test("project tanpa bug dan filter tanpa hasil menampilkan keadaan kosong", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const bugs = new BugsPage(page);

    await bugs.goto(project.slug);
    await expect(bugs.empty).toContainText("Belum ada bug");

    await api.createBug(owner, project.slug, { title: "Satu bug saja" });
    await bugs.goto(project.slug, "?q=tidakada");
    await expect(bugs.empty).toContainText("Tidak ada bug yang cocok");
    await bugs.reset.click();
    await expect(bugs.rows).toHaveCount(1);
  });

  test("tester dan admin melihat Buat bug; viewer dan anonim tidak", async ({ api, signedInPage, newContext }) => {
    const { owner, project } = await newProject(api, "public");
    const tester = await api.addMember(owner, project.slug, "tester");
    const viewer = await api.addMember(owner, project.slug, "viewer");
    await createBugs(api, owner, project.slug, [{ title: "Bug publik" }]);

    for (const user of [owner, tester]) {
      const { page } = await signedInPage(user);
      const bugs = new BugsPage(page);
      await bugs.goto(project.slug);
      await expect(bugs.create).toBeVisible();
      await expect(bugs.create).toHaveAttribute("href", `/p/${project.slug}/bugs/new`);
    }

    const { page: viewerPage } = await signedInPage(viewer);
    const viewerBugs = new BugsPage(viewerPage);
    await viewerBugs.goto(project.slug);
    await expect(viewerBugs.rows).toHaveCount(1);
    await expect(viewerBugs.create).toHaveCount(0);

    const anonymous = await (await newContext()).newPage();
    const anonymousBugs = new BugsPage(anonymous);
    await anonymousBugs.goto(project.slug);
    await expect(anonymousBugs.rows).toHaveCount(1);
    await expect(anonymousBugs.create).toHaveCount(0);
    // Daftar anggota tidak pernah publik: anonim hanya punya "Belum di-assign".
    await expect(anonymousBugs.assignee.locator("option")).toHaveText(["Semua assignee", "Belum di-assign"]);
  });

  test("project privat tidak terlihat oleh anonim", async ({ api, newContext }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, [{ title: "Rahasia" }]);
    const anonymous = await (await newContext()).newPage();
    const bugs = new BugsPage(anonymous);

    await bugs.goto(project.slug);

    await expect(bugs.notFound).toBeVisible();
    await expect(bugs.rows).toHaveCount(0);
  });

  test("375 px: tanpa scroll horizontal walau judul dan label panjang", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, [
      {
        title: `Judul ${"sangatpanjangtanpaspasi".repeat(7)} dan seterusnya`,
        labels: ["label-yang-cukup-panjang-ya", "a", "b", "c", "d", "e"],
      },
    ]);
    const context = await newContext({
      storageState: await owner.request.storageState(),
      viewport: { width: 375, height: 800 },
    });
    const page = await context.newPage();
    const bugs = new BugsPage(page);

    await bugs.goto(project.slug);
    await expect(bugs.rows).toHaveCount(1);

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolationsInBothThemes(page);
  });
});

test.describe("Buat bug", () => {
  test("judul wajib: pesan di bawah field dan fokus ke sana; bug tidak terbuat", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);
    await form.goto(project.slug);

    await expect(form.priority).toHaveValue("medium");
    await expect(form.severity).toHaveValue("major");
    await expect(form.assignee).toHaveValue("");
    await expectNoA11yViolationsInBothThemes(page);

    await form.submit.click();
    await expect(form.titleError).toHaveText("Judul minimal 3 karakter");
    await expect(form.title).toBeFocused();
    await expect(form.title).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/bugs\/new$/);

    await form.title.fill("ab");
    await form.submit.click();
    await expect(form.titleError).toHaveText("Judul minimal 3 karakter");
    await expectNoA11yViolationsInBothThemes(page);

    const list = await owner.request.get(`/api/v1/projects/${project.slug}/bugs?status=all`);
    expect(((await list.json()) as { bugs: unknown[] }).bugs).toHaveLength(0);
  });

  test("pratinjau Markdown aman: HTML mentah jadi teks, kembali ke Tulis mempertahankan isi", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);
    await form.goto(project.slug);

    await form.description.fill("Ini **tebal**\n\n<script>alert(1)</script>\n\n[tautan](https://example.com/x)");
    await form.descriptionPreviewTab.click();

    await expect(form.descriptionPreview.locator("strong")).toHaveText("tebal");
    await expect(form.descriptionPreview).toContainText("<script>alert(1)</script>");
    await expect(form.descriptionPreview.locator("script")).toHaveCount(0);
    const link = form.descriptionPreview.getByRole("link", { name: "tautan" });
    await expect(link).toHaveAttribute("href", "https://example.com/x");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(form.description).toBeHidden();
    await expectNoA11yViolationsInBothThemes(page);

    await form.descriptionWrite.click();
    await expect(form.description).toHaveValue(/Ini \*\*tebal\*\*/);
  });

  test("label dan link: normalisasi, validasi, lalu tersimpan lewat API", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    const member = await api.addMember(owner, project.slug, "tester");
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);
    await form.goto(project.slug);

    await form.title.fill("  Bug dengan label dan link  ");
    await form.priority.selectOption("urgent");
    await form.severity.selectOption("critical");
    const assignees = await form.assignee.locator("option").allTextContents();
    expect(assignees[0]).toBe("Belum di-assign");
    expect([...assignees.slice(1)].sort()).toEqual([owner.user.name, member.user.name].sort());
    await form.assignee.selectOption({ label: member.user.name });

    // Label dinormalisasi (huruf kecil), duplikat diabaikan, karakter tidak valid ditolak di tempat.
    await form.labelInput.fill("  UI ");
    await form.labelInput.press("Enter");
    await expect(form.label("ui")).toBeVisible();
    await form.labelInput.fill("ui");
    await form.labelAdd.click();
    await expect(form.labelChips).toHaveCount(1);
    await form.labelInput.fill("tidak valid!");
    await form.labelAdd.click();
    await expect(form.labelsError).toContainText("Label hanya boleh berisi");
    await form.labelInput.fill("backend,");
    await expect(form.label("backend")).toBeVisible();
    await expect(form.labelsError).toHaveCount(0);
    await form.removeLabel("backend").click();
    await expect(form.label("backend")).toHaveCount(0);

    // Link: URL berbahaya ditolak di bawah barisnya.
    await form.linkAdd.click();
    await form.linkUrl(0).fill("javascript:alert(1)");
    await form.linkTitle(0).fill("Dokumen");
    await form.submit.click();
    await expect(form.linkError(0)).toContainText("URL harus berupa URL http atau https");
    await expect(form.linkUrl(0)).toBeFocused();

    await form.linkUrl(0).fill("https://example.com/dok");
    await form.submit.click();
    await page.waitForURL(new RegExp(`/p/${project.slug}/bugs/1$`));

    const res = await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1`);
    const bug = (await res.json()) as {
      title: string;
      priority: string;
      severity: string;
      labels: string[];
      links: { url: string; title: string | null }[];
      assignee: { id: string } | null;
      status: string;
    };
    expect(bug).toMatchObject({
      title: "Bug dengan label dan link",
      priority: "urgent",
      severity: "critical",
      labels: ["ui"],
      links: [{ url: "https://example.com/dok", title: "Dokumen" }],
      status: "open",
    });
    expect(bug.assignee?.id).toBe(member.user.id);
  });

  test("viewer dan anonim tidak bisa membuat bug", async ({ api, signedInPage, newContext }) => {
    const { owner, project } = await newProject(api, "public");
    const viewer = await api.addMember(owner, project.slug, "viewer");

    const { page: viewerPage } = await signedInPage(viewer);
    const viewerForm = new BugNewPage(viewerPage);
    await viewerForm.goto(project.slug);
    await expect(viewerForm.forbidden).toBeVisible();
    await expect(viewerForm.form).toHaveCount(0);

    const anonymous = await (await newContext()).newPage();
    const anonymousForm = new BugNewPage(anonymous);
    await anonymousForm.goto(project.slug);
    await expect(anonymousForm.forbidden).toBeVisible();
    await expect(anonymousForm.forbidden.getByRole("link", { name: "Masuk" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(`/p/${project.slug}/bugs/new`)}`,
    );
  });

  test("375 px: formulir tanpa scroll horizontal", async ({ api, newContext, expectNoA11yViolationsInBothThemes }) => {
    const { owner, project } = await newProject(api);
    const context = await newContext({
      storageState: await owner.request.storageState(),
      viewport: { width: 375, height: 800 },
    });
    const page = await context.newPage();
    const form = new BugNewPage(page);
    await form.goto(project.slug);
    await form.linkAdd.click();
    await form.linkUrl(0).fill(`https://example.com/${"x".repeat(150)}`);
    await form.labelInput.fill("label");
    await form.labelAdd.click();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolationsInBothThemes(page);
  });
});

test.describe("Laporkan bug dari test gagal", () => {
  const CASES: JUnitCase[] = [
    { suite: "checkout", name: "A lulus" },
    { suite: "checkout", name: "B gagal", status: "failed", message: ERROR_MESSAGE },
  ];

  test("form terisi dari run, tersimpan dengan tautan test+run, lalu badge menggantikan tombol", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const runId = await uploadRun(api, owner, project.slug, CASES);
    const ids = await testCaseIds(owner, project.slug, runId);
    const { page } = await signedInPage(owner);
    const run = new RunDetailPage(page);
    const form = new BugNewPage(page);

    await run.goto(project.slug, runId);
    await expect(page.getByTestId(`report-bug-${ids["B gagal"]!}`)).toBeVisible();
    await run.filter("all").click();
    await expect(run.rows).toHaveCount(2);
    // Tombol hanya untuk test yang gagal.
    await expect(page.getByTestId(`report-bug-${ids["A lulus"]!}`)).toHaveCount(0);
    await run.filter("failed").click();

    await page.getByTestId(`report-bug-${ids["B gagal"]!}`).click();
    await expect(form.form).toBeVisible();
    // Pesan error tidak ikut di URL.
    expect(page.url()).toContain(`/bugs/new?testCaseId=${ids["B gagal"]!}&runId=${runId}`);
    expect(decodeURIComponent(page.url())).not.toContain("Diharapkan");

    await expect(form.title).toHaveValue("B gagal");
    await expect(form.severity).toHaveValue("major");
    await expect(form.priority).toHaveValue("medium");
    await expect(form.origin).toContainText("B gagal");
    await expect(form.origin).toContainText("checkout");
    await expect(form.description).toHaveValue(/checkout/);
    await expect(form.description).toHaveValue(/main/);
    await expect(form.description).toHaveValue(new RegExp(COMMIT));
    await expect(form.description).toHaveValue(new RegExp(CI_URL.replace(/[.]/g, "\\.")));
    // Pesan di blok kode; pagar lebih panjang dari backtick di dalam pesan.
    const description = await form.description.inputValue();
    expect(description).toContain(`\n\`\`\`\`\n${ERROR_MESSAGE}\n\`\`\`\``);
    await expectNoA11yViolationsInBothThemes(page);

    await form.submit.click();
    await page.waitForURL(new RegExp(`/p/${project.slug}/bugs/1$`));

    const created = (await (await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1`)).json()) as {
      title: string;
      severity: string;
      testCase: { id: string } | null;
      runId: string | null;
    };
    expect(created).toMatchObject({ title: "B gagal", severity: "major", runId });
    expect(created.testCase?.id).toBe(ids["B gagal"]);

    // Kembali ke run: badge menggantikan tombol.
    await run.goto(project.slug, runId);
    const badge = page.getByTestId("bug-badge-1");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Bug #1");
    await expect(badge).toContainText("Open");
    await expect(badge).toHaveAttribute("href", `/p/${project.slug}/bugs/1`);
    await expect(page.getByTestId(`report-bug-${ids["B gagal"]!}`)).toHaveCount(0);
    await expectNoA11yViolationsInBothThemes(page);

    // Bug ditutup: tidak lagi dianggap, tombol muncul lagi.
    await api.updateBug(owner, project.slug, 1, { version: 1, status: "closed", resolution: "wont_fix" });
    await run.goto(project.slug, runId);
    await expect(page.getByTestId("bug-badge-1")).toHaveCount(0);
    await expect(page.getByTestId(`report-bug-${ids["B gagal"]!}`)).toBeVisible();
  });

  test("viewer dan anonim tidak melihat tombol tetapi melihat badge", async ({ api, signedInPage, newContext }) => {
    const { owner, project } = await newProject(api, "public");
    const viewer = await api.addMember(owner, project.slug, "viewer");
    const runId = await uploadRun(api, owner, project.slug, CASES);
    const ids = await testCaseIds(owner, project.slug, runId);
    const button = (page: Page) => page.getByTestId(`report-bug-${ids["B gagal"]!}`);

    const { page: viewerPage } = await signedInPage(viewer);
    const viewerRun = new RunDetailPage(viewerPage);
    await viewerRun.goto(project.slug, runId);
    await expect(viewerRun.rows).toHaveCount(1);
    await expect(button(viewerPage)).toHaveCount(0);

    await api.createBug(owner, project.slug, { title: "B gagal", testCaseId: ids["B gagal"]!, runId });
    const anonymous = await (await newContext()).newPage();
    const anonymousRun = new RunDetailPage(anonymous);
    for (const [page, run] of [
      [viewerPage, viewerRun],
      [anonymous, anonymousRun],
    ] as const) {
      await run.goto(project.slug, runId);
      await expect(page.getByTestId("bug-badge-1")).toBeVisible();
      await expect(button(page)).toHaveCount(0);
    }
  });

  test("URL tautan test yang tidak ada di run tetap memuat form dengan pesan jelas", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    const runId = await uploadRun(api, owner, project.slug, CASES);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);

    await page.goto(`/p/${project.slug}/bugs/new?testCaseId=00000000-0000-4000-8000-000000000000&runId=${runId}`);

    await expect(page.getByRole("alert").filter({ hasText: /tidak/i })).toBeVisible();
    await expect(form.form).toHaveCount(0);
  });
});
