import type { Page } from "@playwright/test";
import type { CreateBugBody, ProjectDto, RunDetailDto } from "@testpulse/shared";
import { BugNewPage } from "../pages/BugNewPage.js";
import { BugPage } from "../pages/BugPage.js";
import { BugsPage } from "../pages/BugsPage.js";
import { FlakyPage } from "../pages/FlakyPage.js";
import { RunDetailPage } from "../pages/RunDetailPage.js";
import { TestHistoryPage } from "../pages/TestHistoryPage.js";
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

  test("dua perubahan filter beruntun dalam satu tick sama-sama tersimpan di URL", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, SEED);
    const { page } = await signedInPage(owner);
    const bugs = new BugsPage(page);
    await bugs.goto(project.slug);
    await expect(bugs.rows).toHaveCount(3);

    // Dua event change dikirim sinkron sebelum React sempat render ulang; yang kedua tidak boleh menimpa yang pertama.
    await page.evaluate(() => {
      for (const [testId, value] of [
        ["bugs-filter-priority", "high"],
        ["bugs-filter-severity", "blocker"],
      ] as const) {
        const select = document.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`)!;
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    await expect(page).toHaveURL(/priority=high/);
    await expect(page).toHaveURL(/severity=blocker/);
    await expect(bugs.priority).toHaveValue("high");
    await expect(bugs.severity).toHaveValue("blocker");
    await expect(bugs.rows).toHaveCount(1);
    await expect(bugs.row(1)).toBeVisible();
  });

  test("kolom cari tetap fokus setelah submit dan mengikuti URL saat filter diatur ulang", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, SEED);
    const { page } = await signedInPage(owner);
    const bugs = new BugsPage(page);
    await bugs.goto(project.slug);

    await bugs.search.fill("  login ");
    await bugs.search.press("Enter");
    await expect(page).toHaveURL(/q=login$/);
    await expect(bugs.rows).toHaveCount(1);
    await expect(bugs.search).toBeFocused();
    await expect(bugs.search).toHaveValue("login");

    await bugs.reset.click();
    await expect(bugs.search).toHaveValue("");
    await expect(bugs.rows).toHaveCount(3);
  });

  test("parameter URL yang tidak valid hanya menggugurkan dirinya; Atur ulang filter membersihkannya", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, SEED);
    const { page } = await signedInPage(owner);
    const bugs = new BugsPage(page);

    await bugs.goto(project.slug, "?priority=bogus&severity=blocker&status=ngawur&label=BAD%20LABEL");

    // severity valid tetap berlaku; status jatuh ke Aktif; sisanya diabaikan.
    await expect(bugs.rows).toHaveCount(1);
    await expect(bugs.row(1)).toBeVisible();
    await expect(bugs.severity).toHaveValue("blocker");
    await expect(bugs.priority).toHaveValue("");
    await expect(bugs.statusTab("active")).toHaveAttribute("aria-pressed", "true");

    await bugs.reset.click();
    await expect(page).toHaveURL(new RegExp(`/p/${project.slug}/bugs$`));
    await expect(bugs.rows).toHaveCount(3);
    await expect(bugs.severity).toHaveValue("");
  });

  test("parameter yang semuanya tidak valid tetap menampilkan Atur ulang filter yang berfungsi", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, SEED);
    const { page } = await signedInPage(owner);
    const bugs = new BugsPage(page);

    await bugs.goto(project.slug, "?priority=bogus");
    await expect(bugs.rows).toHaveCount(3);
    await expect(bugs.reset).toBeVisible();
    await bugs.reset.click();
    await expect(page).toHaveURL(new RegExp(`/p/${project.slug}/bugs$`));
    await expect(bugs.reset).toHaveCount(0);
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

  test("Buat bug membuka formulir lewat navigasi klien dan Batal kembali ke daftar", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, [{ title: "Satu bug" }]);
    const { page } = await signedInPage(owner);
    const bugs = new BugsPage(page);
    const form = new BugNewPage(page);
    await bugs.goto(project.slug);

    await bugs.create.click();
    await expect(page).toHaveURL(`/p/${project.slug}/bugs/new`);
    await expect(form.form).toBeVisible();

    await page.getByRole("link", { name: "Batal" }).click();
    await expect(page).toHaveURL(`/p/${project.slug}/bugs`);
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

  test("kesalahan validasi menandai baris link yang benar walau ada baris kosong di depannya", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);
    await form.goto(project.slug);

    await form.title.fill("Bug dengan link salah");
    await form.linkAdd.click(); // baris 0 dibiarkan kosong
    await form.linkAdd.click();
    await form.linkUrl(1).fill("ftp://bukan-http");
    await form.submit.click();

    await expect(form.linkError(1)).toContainText("URL harus berupa URL http atau https");
    await expect(form.linkError(0)).toHaveCount(0);
    await expect(form.linkUrl(1)).toBeFocused();
  });

  test("kesalahan 400 dari server dipetakan ke baris link dan label yang tepat", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);
    await form.goto(project.slug);
    await page.route("**/api/v1/projects/*/bugs", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Data tidak valid",
            // Indeks 0 = link pertama yang terkirim (baris formulir 1, karena baris 0 kosong).
            fields: { "links.0.url": "URL ditolak server", "labels.0": "Label ditolak server" },
          },
        }),
      });
    });

    await form.title.fill("Bug untuk uji server");
    await form.labelInput.fill("ok");
    await form.labelInput.press("Enter");
    await form.linkAdd.click();
    await form.linkAdd.click();
    await form.linkUrl(1).fill("https://example.com/ok");
    await form.submit.click();

    await expect(form.linkError(1)).toHaveText("URL ditolak server");
    await expect(form.linkError(0)).toHaveCount(0);
    await expect(form.labelsError).toHaveText("Label ditolak server");
    await expect(page).toHaveURL(/\/bugs\/new$/);
    await expect(form.submit).toBeEnabled();
  });

  test("kesalahan server tanpa field ditampilkan sebagai pesan umum", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);
    await form.goto(project.slug);
    await page.route("**/api/v1/projects/*/bugs", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "BUG_CONFLICT", message: "Server sedang sibuk" } }),
      });
    });

    await form.title.fill("Bug untuk uji server");
    await form.submit.click();

    await expect(page.getByTestId("form-error")).toHaveText("Server sedang sibuk");
  });

  test("draf label tidak valid menahan penyimpanan; draf valid yang belum jadi chip ikut tersimpan", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);
    await form.goto(project.slug);
    await form.title.fill("Bug dengan draf label");

    await form.labelInput.fill("tidak valid!");
    await form.submit.click();
    await expect(form.labelsError).toContainText("Label hanya boleh berisi");
    await expect(form.labelInput).toBeFocused();
    await expect(page).toHaveURL(/\/bugs\/new$/);
    const before = await owner.request.get(`/api/v1/projects/${project.slug}/bugs?status=all`);
    expect(((await before.json()) as { bugs: unknown[] }).bugs).toHaveLength(0);

    // requestSubmit melewati blur, jadi draf "Backend" belum menjadi chip saat formulir dikirim.
    await form.labelInput.fill("Backend");
    await form.form.evaluate((element) => (element as HTMLFormElement).requestSubmit());
    await page.waitForURL(new RegExp(`/p/${project.slug}/bugs/1$`));
    const bug = (await (await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1`)).json()) as { labels: string[] };
    expect(bug.labels).toEqual(["backend"]);
  });

  test("kesalahan deskripsi saat di Pratinjau mengembalikan ke Tulis dan memfokuskan kolomnya", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);
    await form.goto(project.slug);
    await form.title.fill("Bug dengan deskripsi terlalu panjang");
    await form.description.fill("a".repeat(20_001));
    await form.descriptionPreviewTab.click();
    await expect(form.description).toBeHidden();

    await form.submit.click();

    await expect(page.getByTestId("field-error-description")).toContainText("Deskripsi maksimal 20.000 karakter");
    await expect(form.description).toBeVisible();
    await expect(form.description).toBeFocused();
    await expect(form.descriptionWrite).toHaveAttribute("aria-pressed", "true");
  });

  test("pratinjau yang gagal dimuat hanya menampilkan pesan; formulir dan isinya tetap utuh", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);
    // Chunk Markdown diblokir: berkas modul (dev) atau chunk hasil build (produksi).
    await page.route(/\/(components\/Markdown\.tsx|assets\/Markdown-[^/]+\.js)(\?.*)?$/, (route) => route.abort());
    await form.goto(project.slug);
    await form.title.fill("Judul tetap ada");
    await form.description.fill("Isi **tetap** ada");

    await form.descriptionPreviewTab.click();

    await expect(page.getByTestId("bug-description-preview-error")).toContainText("Pratinjau gagal dimuat");
    await expect(page.getByTestId("chunk-error")).toHaveCount(0);
    await form.descriptionWrite.click();
    await expect(form.description).toHaveValue("Isi **tetap** ada");
    await expect(form.title).toHaveValue("Judul tetap ada");
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
    const reportButton = page.getByTestId(`report-bug-${ids["B gagal"]!}`);
    await expect(reportButton).toBeVisible();
    // Nama aksesibel tetap "Laporkan bug"; nama test menjadi deskripsinya.
    await expect(page.getByRole("link", { name: "Laporkan bug", exact: true })).toHaveCount(1);
    await expect(reportButton).toHaveAccessibleDescription("B gagal");
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

  test("test yang tidak ditemukan menampilkan kesalahan dan tautan ke formulir tanpa tautan test", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    const runId = await uploadRun(api, owner, project.slug, CASES);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);

    await page.goto(`/p/${project.slug}/bugs/new?testCaseId=00000000-0000-4000-8000-000000000000&runId=${runId}`);

    await expect(page.getByRole("alert").filter({ hasText: /tidak/i })).toBeVisible();
    await expect(form.form).toHaveCount(0);
    const plain = page.getByRole("link", { name: "Buat bug tanpa tautan test" });
    await expect(plain).toHaveAttribute("href", `/p/${project.slug}/bugs/new`);

    await plain.click();
    await expect(form.form).toBeVisible();
    await expect(form.origin).toHaveCount(0);
    await expect(form.title).toHaveValue("");
  });

  test("run asal sudah dihapus: form tetap terisi dari riwayat test dan bug tersimpan tanpa tautan run", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const runId = await uploadRun(api, owner, project.slug, CASES);
    const ids = await testCaseIds(owner, project.slug, runId);
    // Run lain agar test "B gagal" tetap punya riwayat setelah run asal dihapus.
    await uploadRun(api, owner, project.slug, CASES);
    const deleted = await owner.request.delete(`/api/v1/projects/${project.slug}/runs/${runId}`);
    expect(deleted.status()).toBe(204);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);

    await form.goto(project.slug, `?testCaseId=${ids["B gagal"]!}&runId=${runId}`);

    await expect(form.title).toHaveValue("B gagal");
    await expect(form.origin).toContainText("B gagal");
    await expect(form.origin).not.toContainText("run tersebut");
    await expect(form.description).toHaveValue(/checkout/);
    await expect(form.description).not.toHaveValue(/Pesan error/);

    await form.submit.click();
    await page.waitForURL(new RegExp(`/p/${project.slug}/bugs/1$`));
    const created = (await (await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1`)).json()) as {
      runId: string | null;
      testCase: { id: string } | null;
    };
    expect(created.runId).toBeNull();
    expect(created.testCase?.id).toBe(ids["B gagal"]);
  });

  test("suite dan link CI berbahaya tidak menjadi Markdown di deskripsi terisi", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    const { token } = await api.createToken(owner, project.slug);
    const res = await api.uploadRun(
      token,
      project.slug,
      buildJUnit([{ suite: "[klik](https://e.vil) `x`", name: "T gagal", status: "failed", message: "boom" }]),
      { branch: "main", ciUrl: "https://ci.example.com/a b](https://e.vil)" },
    );
    expect(res.status(), await res.text()).toBe(201);
    const runId = ((await res.json()) as { runId: string }).runId;
    const ids = await testCaseIds(owner, project.slug, runId);
    const { page } = await signedInPage(owner);
    const form = new BugNewPage(page);

    await form.goto(project.slug, `?testCaseId=${ids["T gagal"]!}&runId=${runId}`);
    await form.descriptionPreviewTab.click();

    // Tidak ada tautan dari data run; semuanya teks di dalam code span.
    await expect(form.descriptionPreview.getByRole("link")).toHaveCount(0);
    await expect(form.descriptionPreview.locator("code").first()).toContainText("[klik](https://e.vil)");
  });
});

/** Run pertama berisi test gagal "G gagal" dan test flaky "F flaky"; mengembalikan id run dan id test-nya. */
async function failingRun(api: TestApi, owner: TestUser, slug: string) {
  const runId = await uploadRun(api, owner, slug, [
    { suite: "checkout", name: "G gagal", status: "failed", message: "boom" },
    { suite: "checkout", name: "F flaky", retries: 1, message: "percobaan pertama gagal" },
  ]);
  return { runId, ids: await testCaseIds(owner, slug, runId) };
}

test.describe("Detail bug", () => {
  test("assign, mulai kerjakan, komentar, tandai selesai dengan resolusi inline, lalu buka ulang; riwayat memuat semuanya", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const tester = await api.addMember(owner, project.slug, "tester");
    await api.createBug(owner, project.slug, {
      title: "Tombol login macet",
      description: "Klik **tidak** merespons",
      labels: ["ui"],
    });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);

    await bug.goto(project.slug, 1);
    await expect(bug.title).toHaveText("Tombol login macet");
    await expect(bug.status).toContainText("Open");
    await expect(bug.description.locator("strong")).toHaveText("tidak");
    await expect(bug.transition("in_progress")).toHaveText("Mulai kerjakan");
    await expect(bug.transition("resolved")).toHaveText("Tandai selesai");
    await expect(bug.transition("closed")).toHaveText("Tutup");
    await expect(bug.transition("open")).toHaveCount(0);
    await expectNoA11yViolationsInBothThemes(page);

    await bug.assignee.selectOption({ label: tester.user.name });
    await expect(bug.event(`menugaskan bug ini ke ${tester.user.name}`)).toHaveCount(1);
    await expect(bug.assignee).toHaveValue(tester.user.id);

    await bug.transition("in_progress").click();
    await expect(bug.status).toContainText("In progress");
    await expect(bug.event("mengubah status Open → In progress")).toContainText(owner.user.name);
    await expect(bug.event("mengubah status Open → In progress")).toContainText("baru saja");

    await bug.commentInput.fill("Sedang **diperiksa**");
    await bug.commentSubmit.click();
    await expect(bug.comment("Sedang diperiksa")).toBeVisible();
    await expect(bug.comment("Sedang diperiksa").getByTestId("markdown").locator("strong")).toHaveText("diperiksa");
    await expect(bug.commentInput).toHaveValue("");

    // Resolusi wajib dipilih inline sebelum masuk Resolved.
    await bug.transition("resolved").click();
    await expect(bug.resolution).toBeVisible();
    await expect(bug.resolution).toBeFocused();
    await bug.resolutionConfirm.click();
    await expect(bug.resolutionError).toHaveText("Pilih resolusi lebih dulu");
    await expect(bug.status).toContainText("In progress");
    await bug.resolution.selectOption("fixed");
    await bug.resolutionConfirm.click();
    await expect(bug.status).toContainText("Resolved");
    await expect(bug.status).toContainText("Diperbaiki");
    await expect(bug.resolution).toHaveCount(0);
    await expect(bug.event("mengubah status In progress → Resolved")).toHaveCount(1);
    await expect(bug.event("menetapkan resolusi Diperbaiki")).toHaveCount(1);
    await expect(bug.transition("in_progress")).toHaveCount(0);
    await expect(bug.transition("closed")).toBeVisible();
    await expect(bug.transition("open")).toHaveText("Buka ulang");

    await bug.transition("open").click();
    await expect(bug.status).toContainText("Open");
    await expect(bug.status).not.toContainText("Diperbaiki");
    await expect(bug.event("mengubah status Resolved → Open")).toHaveCount(1);
    await expect(bug.event("menghapus resolusi (Diperbaiki)")).toHaveCount(1);

    // Urutan linimasa: lama → baru, komentar di antara event.
    const texts = await bug.activity.locator("> li").allTextContents();
    const index = (needle: string) => texts.findIndex((text) => text.includes(needle));
    expect(index("menugaskan bug ini ke")).toBeLessThan(index("Open → In progress"));
    expect(index("Open → In progress")).toBeLessThan(index("Sedang diperiksa"));
    expect(index("Sedang diperiksa")).toBeLessThan(index("In progress → Resolved"));
    expect(index("In progress → Resolved")).toBeLessThan(index("Resolved → Open"));

    await page.reload();
    await expect(bug.status).toContainText("Open");
    await expect(bug.comments).toHaveCount(1);
    await expect(bug.assignee).toHaveValue(tester.user.id);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("tutup dari Open memilih resolusi inline; Batal membatalkan; dari Resolved menutup tanpa resolusi baru", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await createBugs(api, owner, project.slug, [{ title: "Bug satu" }, { title: "Bug dua" }]);
    await api.updateBug(owner, project.slug, 2, { version: 1, status: "resolved", resolution: "duplicate" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);

    await bug.goto(project.slug, 1);
    await bug.transition("closed").click();
    await expect(bug.resolution).toBeVisible();
    await bug.resolutionCancel.click();
    await expect(bug.resolution).toHaveCount(0);
    await expect(bug.transition("closed")).toBeFocused();
    await expect(bug.status).toContainText("Open");

    await bug.transition("closed").click();
    await bug.resolution.selectOption("wont_fix");
    await bug.resolutionConfirm.click();
    await expect(bug.status).toContainText("Closed");
    await expect(bug.status).toContainText("Tidak akan diperbaiki");
    await expect(bug.transition("open")).toHaveText("Buka ulang");

    await bug.goto(project.slug, 2);
    await bug.transition("closed").click();
    await expect(bug.resolution).toHaveCount(0);
    await expect(bug.status).toContainText("Closed");
    await expect(bug.status).toContainText("Duplikat");
  });

  test("judul dan deskripsi diedit inline; validasi, Batal, dan Escape", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Judul awal", description: "Deskripsi awal" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    await bug.titleEdit.click();
    await expect(bug.titleInput).toBeFocused();
    await expect(bug.titleInput).toHaveValue("Judul awal");
    await bug.titleInput.fill("ab");
    await bug.titleSave.click();
    await expect(bug.titleError).toHaveText("Judul minimal 3 karakter");
    await expect(bug.titleInput).toBeFocused();
    await bug.titleInput.press("Escape");
    await expect(bug.titleInput).toHaveCount(0);
    await expect(bug.title).toHaveText("Judul awal");
    await expect(bug.titleEdit).toBeFocused();

    await bug.titleEdit.click();
    await bug.titleInput.fill("Judul baru yang jelas");
    await bug.titleInput.press("Enter");
    await expect(bug.title).toHaveText("Judul baru yang jelas");
    await expect(bug.event("mengubah judul “Judul awal” → “Judul baru yang jelas”")).toHaveCount(1);

    await bug.descriptionEdit.click();
    await expect(bug.descriptionInput).toHaveValue("Deskripsi awal");
    await bug.descriptionInput.fill("Diubah dan dibatalkan");
    await bug.descriptionCancel.click();
    await expect(bug.description).toContainText("Deskripsi awal");

    await bug.descriptionEdit.click();
    await bug.descriptionInput.fill("## Langkah\n\n- satu\n- dua");
    await bug.descriptionSave.click();
    await expect(bug.description.locator("h2")).toHaveText("Langkah");
    await expect(bug.description.locator("li")).toHaveCount(2);
    await expect(bug.event("mengubah deskripsi")).toHaveCount(1);

    const saved = (await (await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1`)).json()) as {
      title: string;
      description: string;
      version: number;
    };
    expect(saved).toMatchObject({ title: "Judul baru yang jelas", description: "## Langkah\n\n- satu\n- dua", version: 3 });
  });

  test("prioritas, severity, label, dan link diubah dari panel samping", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug panel", labels: ["lama"] });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    await expect(bug.priority).toHaveValue("medium");
    await expect(bug.severity).toHaveValue("major");
    await bug.priority.selectOption("urgent");
    await expect(bug.event("mengubah prioritas Sedang → Mendesak")).toHaveCount(1);
    await bug.severity.selectOption("blocker");
    await expect(bug.event("mengubah severity Major → Blocker")).toHaveCount(1);
    await expect(bug.priority).toHaveValue("urgent");

    await expect(bug.labels).toContainText("lama");
    await bug.labelsEdit.click();
    await page.getByTestId("bug-labels").fill("Baru!");
    await bug.labelsSave.click();
    await expect(page.getByTestId("field-error-labels")).toContainText("Label hanya boleh berisi");
    await page.getByTestId("bug-labels").fill("Baru");
    await bug.labelsSave.click();
    await expect(bug.labels).toContainText("baru");
    await expect(bug.labels).toContainText("lama");
    await expect(bug.event("mengubah label lama → baru, lama")).toHaveCount(1);

    await bug.linksEdit.click();
    await page.getByTestId("bug-link-add").click();
    await page.getByTestId("bug-link-url-0").fill("bukan url");
    await bug.linksSave.click();
    await expect(page.getByTestId("field-error-links.0.url")).toContainText("URL harus berupa URL http atau https");
    await page.getByTestId("bug-link-url-0").fill("https://tracker.example.com/issue/7");
    await page.getByTestId("bug-link-title-0").fill("Issue 7");
    await bug.linksSave.click();
    const link = bug.links.getByRole("link", { name: "Issue 7" });
    await expect(link).toHaveAttribute("href", "https://tracker.example.com/issue/7");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(bug.event("mengubah link")).toHaveCount(1);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("edit dan hapus komentar sendiri; komentar orang lain: tester tidak bisa, admin hanya menghapus", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const tester = await api.addMember(owner, project.slug, "tester");
    await api.createBug(owner, project.slug, { title: "Bug komentar" });
    await api.addComment(owner, project.slug, 1, { body: "Komentar pemilik" });
    const { page } = await signedInPage(tester);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    const others = bug.comment("Komentar pemilik");
    await expect(others).toBeVisible();
    await expect(bug.commentAction("edit", others)).toHaveCount(0);
    await expect(bug.commentAction("delete", others)).toHaveCount(0);

    await bug.commentInput.fill("Komentar tester");
    await bug.commentSubmit.click();
    const mine = bug.comment("Komentar tester");
    await expect(mine).toBeVisible();
    await expect(mine).not.toContainText("diedit");

    await bug.commentAction("edit", mine).click();
    await expect(bug.commentEditInput(mine)).toBeFocused();
    await bug.commentEditInput(mine).fill("Komentar tester **direvisi**");
    await bug.commentEditSave(mine).click();
    await expect(bug.comment("Komentar tester direvisi")).toContainText("diedit");
    await expect(bug.comment("Komentar tester direvisi").getByTestId("markdown").locator("strong")).toHaveText("direvisi");

    const revised = bug.comment("Komentar tester direvisi");
    await bug.commentAction("delete", revised).click();
    await expect(bug.commentDeleteConfirm(revised)).toBeVisible();
    await expect(revised).toContainText("Komentar tester direvisi");
    await bug.commentDeleteConfirm(revised).click();
    await expect(bug.comments.filter({ hasText: "Komentar dihapus" })).toHaveCount(1);
    await expect(bug.comments.filter({ hasText: "Komentar tester" })).toHaveCount(0);
    await expect(bug.comments).toHaveCount(2);

    // Admin: menghapus komentar tester, tetapi tidak bisa mengubahnya.
    await api.addComment(tester, project.slug, 1, { body: "Komentar kedua tester" });
    const { page: adminPage } = await signedInPage(owner);
    const adminBug = new BugPage(adminPage);
    await adminBug.goto(project.slug, 1);
    const testers = adminBug.comment("Komentar kedua tester");
    await expect(adminBug.commentAction("edit", testers)).toHaveCount(0);
    await adminBug.commentAction("delete", testers).click();
    await adminBug.commentDeleteConfirm(testers).click();
    await expect(adminBug.comments.filter({ hasText: "Komentar dihapus" })).toHaveCount(2);
    await expect(adminBug.commentAction("edit", adminBug.comment("Komentar pemilik"))).toBeVisible();
  });

  test("hapus komentar bisa dibatalkan dan komentar kosong ditolak di tempat", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug komentar" });
    await api.addComment(owner, project.slug, 1, { body: "Tetap ada" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    const comment = bug.comment("Tetap ada");
    await bug.commentAction("delete", comment).click();
    await page.getByTestId(new RegExp(`^comment-delete-cancel-`)).click();
    await expect(bug.commentDeleteConfirm(comment)).toHaveCount(0);
    await expect(bug.commentAction("delete", comment)).toBeFocused();

    await bug.commentInput.fill("   ");
    await bug.commentSubmit.click();
    await expect(page.getByTestId("field-error-comment")).toHaveText("Komentar wajib diisi");
    await expect(bug.commentInput).toBeFocused();
    await expect(bug.comments).toHaveCount(1);
  });

  test("konflik: dua konteks, yang menyimpan belakangan melihat banner dan memuat ulang versi terbaru", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Judul versi satu" });
    const { page: pageA } = await signedInPage(owner);
    const { page: pageB } = await signedInPage(owner);
    const a = new BugPage(pageA);
    const b = new BugPage(pageB);
    await a.goto(project.slug, 1);
    await b.goto(project.slug, 1);

    await a.titleEdit.click();
    await a.titleInput.fill("Judul dari A");
    await a.titleSave.click();
    await expect(a.title).toHaveText("Judul dari A");
    await expect(a.conflict).toHaveCount(0);

    await b.priority.selectOption("urgent");
    await expect(b.conflict).toBeVisible();
    await expect(b.conflict).toContainText("Bug ini baru saja diubah orang lain");
    // Tidak ada perubahan yang tersimpan dari konteks B.
    const current = (await (await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1`)).json()) as {
      priority: string;
      title: string;
      version: number;
    };
    expect(current).toMatchObject({ priority: "medium", title: "Judul dari A", version: 2 });

    await b.conflictReload.click();
    await expect(b.conflict).toHaveCount(0);
    await expect(b.title).toHaveText("Judul dari A");
    await expect(b.priority).toHaveValue("medium");
    await expect(b.event("mengubah judul")).toHaveCount(1);

    await b.priority.selectOption("urgent");
    await expect(b.event("mengubah prioritas Sedang → Mendesak")).toHaveCount(1);
    await expect(b.conflict).toHaveCount(0);
  });

  test("konflik saat transisi: banner, lalu memuat ulang membuang pilihan resolusi yang belum disimpan", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug transisi" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await bug.transition("resolved").click();
    await bug.resolution.selectOption("fixed");
    await api.updateBug(owner, project.slug, 1, { version: 1, status: "in_progress" });

    await bug.resolutionConfirm.click();

    await expect(bug.conflict).toBeVisible();
    await bug.conflictReload.click();
    await expect(bug.conflict).toHaveCount(0);
    await expect(bug.status).toContainText("In progress");
    await expect(bug.resolution).toHaveCount(0);
  });

  test("admin menghapus bug dengan konfirmasi inline lalu kembali ke daftar; tester tidak melihat tombol hapus", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    const tester = await api.addMember(owner, project.slug, "tester");
    await createBugs(api, owner, project.slug, [{ title: "Akan dihapus" }, { title: "Tetap ada" }]);

    const { page: testerPage } = await signedInPage(tester);
    const testerBug = new BugPage(testerPage);
    await testerBug.goto(project.slug, 1);
    await expect(testerBug.title).toBeVisible();
    await expect(testerBug.deleteButton).toHaveCount(0);

    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await bug.deleteButton.click();
    await expect(bug.deleteConfirm).toBeVisible();
    await expect(bug.deleteCancel).toBeFocused();
    await bug.deleteCancel.click();
    await expect(bug.deleteConfirm).toHaveCount(0);
    await expect(bug.deleteButton).toBeFocused();
    await expect((await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1`)).status()).toBe(200);

    await bug.deleteButton.click();
    await bug.deleteConfirm.click();

    await page.waitForURL(new RegExp(`/p/${project.slug}/bugs$`));
    const list = new BugsPage(page);
    await expect(list.rows).toHaveCount(1);
    await expect(list.row(2)).toContainText("Tetap ada");
    await expect((await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1`)).status()).toBe(404);

    await bug.goto(project.slug, 1);
    await expect(bug.bugNotFound).toBeVisible();
  });

  test("viewer dan anonim di project publik hanya membaca; nomor tak dikenal dan project privat", async ({
    api,
    signedInPage,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api, "public");
    const viewer = await api.addMember(owner, project.slug, "viewer");
    await api.createBug(owner, project.slug, {
      title: "Bug publik",
      description: "Isi *deskripsi*",
      labels: ["ui"],
      assigneeId: owner.user.id,
      links: [{ url: "https://tracker.example.com/1", title: "Tracker" }],
    });
    await api.addComment(owner, project.slug, 1, { body: "Komentar publik" });

    const { page: viewerPage } = await signedInPage(viewer);
    const anonymousPage = await (await newContext()).newPage();
    for (const page of [viewerPage, anonymousPage]) {
      const bug = new BugPage(page);
      await bug.goto(project.slug, 1);
      await expect(bug.title).toHaveText("Bug publik");
      await expect(bug.status).toContainText("Open");
      await expect(bug.description.locator("em")).toHaveText("deskripsi");
      await expect(bug.comment("Komentar publik")).toBeVisible();
      await expect(bug.labels).toContainText("ui");
      await expect(bug.assignee).toContainText(owner.user.name);
      await expect(bug.links.getByRole("link", { name: "Tracker" })).toBeVisible();
      for (const control of [
        bug.titleEdit,
        bug.descriptionEdit,
        bug.labelsEdit,
        bug.linksEdit,
        bug.deleteButton,
        bug.commentInput,
        bug.commentSubmit,
        bug.transition("in_progress"),
        bug.transition("resolved"),
        bug.transition("closed"),
        page.locator("select"),
      ]) {
        await expect(control).toHaveCount(0);
      }
      await expect(bug.priority).toContainText("Sedang");
      await expect(bug.severity).toContainText("Major");
      await expectNoA11yViolationsInBothThemes(page);
    }

    const missing = new BugPage(anonymousPage);
    await missing.goto(project.slug, 999);
    await expect(missing.bugNotFound).toBeVisible();
    await missing.goto(project.slug, "abc");
    await expect(missing.bugNotFound).toBeVisible();

    const { owner: privateOwner, project: privateProject } = await newProject(api);
    await api.createBug(privateOwner, privateProject.slug, { title: "Rahasia" });
    await missing.goto(privateProject.slug, 1);
    await expect(missing.notFound).toBeVisible();
    await expect(missing.title).toHaveCount(0);
  });

  test("kartu test asal: petunjuk gagal, lulus berturut-turut, link riwayat dan run, run asal dihapus", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const { runId, ids } = await failingRun(api, owner, project.slug);
    await api.createBug(owner, project.slug, {
      title: "Bug dari test",
      testCaseId: ids["G gagal"]!,
      runId,
    });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);

    await bug.goto(project.slug, 1);
    await expect(bug.testHint).toContainText("G gagal");
    await expect(bug.testHint).toContainText("checkout");
    await expect(bug.testHint).toContainText("Masih gagal di run terakhir di main");
    await expect(bug.testHistoryLink).toHaveAttribute("href", `/p/${project.slug}/tests/${ids["G gagal"]!}?branch=main`);
    await expect(bug.testRunLink).toHaveAttribute("href", `/p/${project.slug}/runs/${runId}`);
    await expectNoA11yViolationsInBothThemes(page);

    // Dua run lulus berikutnya: petunjuk ikut berubah, status bug tidak.
    for (let i = 0; i < 2; i++) await uploadRun(api, owner, project.slug, [{ suite: "checkout", name: "G gagal" }]);
    await page.reload();
    await expect(bug.testHint).toContainText("Lulus 2 run terakhir berturut-turut di main");
    await expect(bug.status).toContainText("Open");

    await bug.testHistoryLink.click();
    await expect(page.getByTestId("test-history")).toBeVisible();
    await expect(page.getByTestId(`bug-badge-1`)).toBeVisible();

    const deleted = await owner.request.delete(`/api/v1/projects/${project.slug}/runs/${runId}`);
    expect(deleted.status()).toBe(204);
    await bug.goto(project.slug, 1);
    await expect(bug.testHint).toContainText("Run asal sudah dihapus");
    await expect(bug.testHint).toContainText("Lulus 2 run terakhir berturut-turut di main");
    await expect(bug.testRunLink).toHaveCount(0);
    await expect(bug.testHistoryLink).toBeVisible();
  });

  test("bug tanpa test asal tidak menampilkan kartu test", async ({ api, signedInPage }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug mandiri" });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);
    await expect(bug.title).toBeVisible();
    await expect(bug.testHint).toHaveCount(0);
  });

  test("badge bug muncul di daftar flaky dan riwayat test, menaut ke bug, dan hilang setelah ditutup", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const { runId, ids } = await failingRun(api, owner, project.slug);
    await api.createBug(owner, project.slug, { title: "Bug flaky", testCaseId: ids["F flaky"]!, runId });
    const { page } = await signedInPage(owner);
    const flaky = new FlakyPage(page);
    const history = new TestHistoryPage(page);

    await flaky.goto(project.slug);
    const item = page.getByTestId(`flaky-item-${ids["F flaky"]!}`);
    const badge = item.getByTestId("bug-badge-1");
    await expect(badge).toHaveText("Bug #1 · Open");
    await expect(badge).toHaveAttribute("href", `/p/${project.slug}/bugs/1`);
    await expect(item.getByRole("link")).toHaveCount(2);
    await expectNoA11yViolationsInBothThemes(page);

    await history.goto(project.slug, ids["F flaky"]!);
    await expect(page.getByTestId("bug-badge-1")).toHaveText("Bug #1 · Open");
    await expectNoA11yViolationsInBothThemes(page);

    await page.getByTestId("bug-badge-1").click();
    await expect(new BugPage(page).title).toHaveText("Bug flaky", { timeout: 15_000 });

    await api.updateBug(owner, project.slug, 1, { version: 1, status: "closed", resolution: "fixed" });
    await flaky.goto(project.slug);
    await expect(item).toBeVisible();
    await expect(item.getByTestId("bug-badge-1")).toHaveCount(0);
  });

  test("Review Focus 4: judul, komentar, dan blok kode panjang tersimpan utuh tanpa scroll horizontal di 375 px", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const title = `${"x".repeat(190)}😀😀😀😀😀`;
    const comment = `${"k".repeat(280)}😀😀😀😀😀😀😀😀😀😀`;
    const code = "y".repeat(500);
    await api.createBug(owner, project.slug, { title, description: `Kode:\n\n\`\`\`\n${code}\n\`\`\`` });
    const context = await newContext({
      storageState: await owner.request.storageState(),
      viewport: { width: 375, height: 800 },
    });
    const page = await context.newPage();
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    await bug.commentInput.fill(comment);
    await bug.commentSubmit.click();
    await expect(bug.comments).toHaveCount(1);

    await expect(bug.title).toHaveText(title);
    await expect(bug.description.locator("pre")).toHaveText(code);
    await expect(bug.comments.first()).toContainText(comment);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const saved = (await (await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1`)).json()) as {
      title: string;
      description: string;
    };
    expect(saved.title).toBe(title);
    expect(saved.description).toContain(code);
    const activity = (await (await owner.request.get(`/api/v1/projects/${project.slug}/bugs/1/activity`)).json()) as {
      items: { kind: string; body?: string }[];
    };
    expect(activity.items.find((item) => item.kind === "comment")?.body).toBe(comment);

    // Mode edit dan komentar panjang di dalam daftar tidak melebarkan halaman juga.
    await bug.titleEdit.click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await bug.titleCancel.click();
    await bug.transition("resolved").click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("375 px: panel, linimasa, dan kartu test tanpa scroll horizontal", async ({
    api,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { owner, project } = await newProject(api);
    const { runId, ids } = await failingRun(api, owner, project.slug);
    await api.createBug(owner, project.slug, {
      title: "Bug 375",
      testCaseId: ids["G gagal"]!,
      runId,
      labels: ["label-yang-cukup-panjang-ya", "a", "b", "c"],
      links: [{ url: `https://example.com/${"p".repeat(150)}`, title: "z".repeat(100) }],
    });
    await api.addComment(owner, project.slug, 1, { body: "komentar" });
    const context = await newContext({
      storageState: await owner.request.storageState(),
      viewport: { width: 375, height: 800 },
    });
    const page = await context.newPage();
    const bug = new BugPage(page);

    await bug.goto(project.slug, 1);
    await expect(bug.testHint).toBeVisible();
    await expect(bug.comments).toHaveCount(1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("lebih dari 50 item aktivitas: halaman pertama lalu Muat lagi; komentar baru tetap tampil di akhir", async ({
    api,
    signedInPage,
  }) => {
    const { owner, project } = await newProject(api);
    await api.createBug(owner, project.slug, { title: "Bug ramai" });
    for (let i = 1; i <= 52; i++) await api.addComment(owner, project.slug, 1, { body: `Komentar ke-${i}` });
    const { page } = await signedInPage(owner);
    const bug = new BugPage(page);
    await bug.goto(project.slug, 1);

    await expect(bug.comments).toHaveCount(50);
    await bug.activityMore.click();
    await expect(bug.comments).toHaveCount(52);
    await expect(bug.activityMore).toHaveCount(0);

    await bug.commentInput.fill("Komentar terakhir");
    await bug.commentSubmit.click();
    await expect(bug.comments).toHaveCount(53);
    await expect(bug.comments.last()).toContainText("Komentar terakhir");
  });
});
