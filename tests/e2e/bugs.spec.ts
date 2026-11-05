import type { Page } from "@playwright/test";
import type { CreateBugBody } from "@testpulse/shared";
import { BugNewPage } from "../pages/BugNewPage.js";
import { BugsPage } from "../pages/BugsPage.js";
import { RunDetailPage } from "../pages/RunDetailPage.js";
import { expect, test } from "../support/fixtures.js";
import { CI_URL, COMMIT, createBugs, horizontalOverflow, mobileContextOptions, newProject, testCaseIds, uploadRun } from "../support/bugs.js";
import { buildJUnit, type JUnitCase } from "../support/junit.js";

const ERROR_MESSAGE = "Diharapkan 3 tetapi 4\n    di baris berindentasi\nada ``` di pesan";

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
    const context = await newContext(await mobileContextOptions(owner));
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
    const context = await newContext(await mobileContextOptions(owner));
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
