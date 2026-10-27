import { faker } from "@faker-js/faker";
import { AppShell } from "../pages/AppShell.js";
import { NewProjectPage } from "../pages/NewProjectPage.js";
import { ProjectPage } from "../pages/ProjectPage.js";
import { ProjectsPage } from "../pages/ProjectsPage.js";
import { expect, test } from "../support/fixtures.js";

const NOT_FOUND = "Project tidak ditemukan. Jika ini project privat, silakan masuk.";
const MANUAL_SLUG = "Slug tidak dapat dibuat dari nama ini, isi slug secara manual";

function uniqueSuffix(): string {
  return faker.string.alphanumeric({ length: 6, casing: "lower" });
}

test.describe("Project", () => {
  test("user baru melihat daftar kosong, lalu membuat project dengan pratinjau slug langsung", async ({
    signedInPage,
  }) => {
    const { page } = await signedInPage();
    const projects = new ProjectsPage(page);
    const create = new NewProjectPage(page);
    const project = new ProjectPage(page);
    const suffix = uniqueSuffix();

    await projects.goto();
    await expect(projects.empty).toBeVisible();
    await expect(projects.list).toHaveCount(0);

    await projects.newProject.click();
    await expect(page).toHaveURL(/\/projects\/new$/);

    await create.typeName("Proyek E2E");
    await expect(create.slugPreview).toHaveText("proyek-e2e");
    await create.typeName(` ${suffix}`);
    await expect(create.slugPreview).toHaveText(`proyek-e2e-${suffix}`);

    await create.submit.click();

    await expect(page).toHaveURL(new RegExp(`/p/proyek-e2e-${suffix}$`));
    await expect(project.title).toHaveText(`Proyek E2E ${suffix}`);
    await expect(project.emptyResults).toContainText("Belum ada hasil test");
    await expect(project.settingsLink).toBeVisible();
  });

  test("slug manual dipakai menggantikan slug dari nama", async ({ signedInPage }) => {
    const { page } = await signedInPage();
    const create = new NewProjectPage(page);
    const slug = `manual-${uniqueSuffix()}`;

    await create.goto();
    await create.typeName("Nama Bebas");
    await create.slug.fill(slug);
    await expect(create.slugPreview).toHaveText(slug);
    await create.submit.click();

    await expect(page).toHaveURL(new RegExp(`/p/${slug}$`));
    await expect(new ProjectPage(page).title).toHaveText("Nama Bebas");
  });

  test("daftar project saya menampilkan project yang dibuat", async ({ api, signedInPage }) => {
    const owner = await api.register();
    const created = await api.createProject(owner);
    const { page } = await signedInPage(owner);
    const projects = new ProjectsPage(page);

    await projects.goto();

    await expect(projects.empty).toHaveCount(0);
    await expect(projects.item(created.slug)).toContainText(created.name);
    await projects.item(created.slug).getByRole("link", { name: created.name }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${created.slug}$`));
  });

  test("slug yang sudah dipakai menampilkan error pada field slug (409)", async ({ api, signedInPage }) => {
    const owner = await api.register();
    const taken = await api.createProject(owner);
    const { page } = await signedInPage();
    const create = new NewProjectPage(page);

    await create.goto();
    await create.create({ name: "Proyek Lain", slug: taken.slug });

    await expect(create.fieldError("slug")).toHaveText("Slug sudah dipakai");
    await expect(page).toHaveURL(/\/projects\/new$/);
  });

  test("nama yang tidak menghasilkan slug valid meminta slug manual tanpa request ke server", async ({
    signedInPage,
  }) => {
    const { page } = await signedInPage();
    const create = new NewProjectPage(page);
    const requests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/projects")) requests.push(req.url());
    });

    await create.goto();
    await create.create({ name: "测试" });

    await expect(create.fieldError("slug")).toHaveText(MANUAL_SLUG);
    expect(requests).toEqual([]);
  });

  test("nama kosong ditolak di sisi klien", async ({ signedInPage }) => {
    const { page } = await signedInPage();
    const create = new NewProjectPage(page);

    await create.goto();
    await create.submit.click();

    await expect(create.fieldError("name")).toBeVisible();
  });

  test("project publik terbuka tanpa login: penanda hanya-baca dan tanpa tautan pengaturan", async ({
    api,
    newContext,
  }) => {
    const owner = await api.register();
    const created = await api.createProject(owner);
    await api.setVisibility(owner, created.slug, "public");

    const context = await newContext();
    try {
      const page = await context.newPage();
      const project = new ProjectPage(page);

      await project.goto(created.slug);

      await expect(project.title).toHaveText(created.name);
      await expect(project.publicBadge).toHaveText("Project publik · hanya-baca");
      await expect(project.emptyResults).toContainText("Belum ada hasil test");
      await expect(project.settingsLink).toHaveCount(0);
      await expect(project.loginButton).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("user masuk yang bukan anggota melihat project publik tanpa tautan pengaturan", async ({
    api,
    signedInPage,
  }) => {
    const owner = await api.register();
    const created = await api.createProject(owner);
    await api.setVisibility(owner, created.slug, "public");
    const { page } = await signedInPage();
    const project = new ProjectPage(page);

    await project.goto(created.slug);

    await expect(project.publicBadge).toBeVisible();
    await expect(project.settingsLink).toHaveCount(0);
    await expect(project.loginButton).toHaveCount(0);
  });

  test("project privat dibuka tanpa login tampil sebagai tidak ditemukan", async ({ api, newContext }) => {
    const owner = await api.register();
    const created = await api.createProject(owner);

    const context = await newContext();
    try {
      const page = await context.newPage();
      const project = new ProjectPage(page);

      await project.goto(created.slug);

      await expect(project.notFound).toContainText(NOT_FOUND);
      await expect(project.title).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("project yang tidak ada tampil sama seperti project privat", async ({ signedInPage }) => {
    const { page } = await signedInPage();
    const project = new ProjectPage(page);

    await project.goto(`tidak-ada-${uniqueSuffix()}`);

    await expect(project.notFound).toContainText(NOT_FOUND);
  });

  test("/ dan /projects/new mengarahkan user anonim ke login", async ({ page }) => {
    await page.goto("/projects/new");
    await expect(page).toHaveURL(/\/login\?next=%2Fprojects%2Fnew$/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("logout dari halaman terlindungi berakhir di /login tanpa next", async ({ signedInPage }) => {
    const { page } = await signedInPage();
    const create = new NewProjectPage(page);
    const shell = new AppShell(page);

    await create.goto();
    await shell.logout();

    await shell.expectAnonymous();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("halaman daftar, buat, dan ringkasan lolos pemeriksaan aksesibilitas di kedua tema", async ({
    api,
    signedInPage,
    newContext,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const owner = await api.register();
    const created = await api.createProject(owner);
    await api.setVisibility(owner, created.slug, "public");
    const { page } = await signedInPage(owner);

    const projects = new ProjectsPage(page);
    await projects.goto();
    await expect(projects.item(created.slug)).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);

    await new NewProjectPage(page).goto();
    await expectNoA11yViolationsInBothThemes(page);

    await new ProjectPage(page).goto(created.slug);
    await expectNoA11yViolationsInBothThemes(page);

    const anon = await newContext();
    try {
      const anonPage = await anon.newPage();
      await new ProjectPage(anonPage).goto(created.slug);
      await expectNoA11yViolationsInBothThemes(anonPage);

      await new ProjectPage(anonPage).goto(`tidak-ada-${uniqueSuffix()}`);
      await expectNoA11yViolationsInBothThemes(anonPage);
    } finally {
      await anon.close();
    }
  });

  test("daftar kosong dan ringkasan project (empty state) lolos aksesibilitas di kedua tema", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const { page } = await signedInPage();
    const projects = new ProjectsPage(page);
    await projects.goto();
    await expect(projects.empty).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);

    const owner = await api.register();
    const created = await api.createProject(owner);
    const member = await signedInPage(owner);
    await new ProjectPage(member.page).goto(created.slug);
    await expect(new ProjectPage(member.page).emptyResults).toBeVisible();
    await expectNoA11yViolationsInBothThemes(member.page);
  });

  test("keadaan error (slug dipakai, nama kosong, gagal memuat) lolos aksesibilitas di kedua tema", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const owner = await api.register();
    const taken = await api.createProject(owner);
    const { page } = await signedInPage();
    const create = new NewProjectPage(page);

    await create.goto();
    await create.submit.click();
    await expect(create.fieldError("name")).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);

    await create.create({ name: "Proyek Lain", slug: taken.slug });
    await expect(create.fieldError("slug")).toHaveText("Slug sudah dipakai");
    await expectNoA11yViolationsInBothThemes(page);

    await page.route("**/api/v1/projects", (route) =>
      route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Gagal memuat project." } } }),
    );
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Coba lagi" })).toBeVisible();
    await expectNoA11yViolationsInBothThemes(page);
  });

  test("nama project 80 karakter dipotong dengan elipsis tanpa scroll horizontal di HP", async ({
    api,
    signedInPage,
    expectNoA11yViolationsInBothThemes,
  }) => {
    const owner = await api.register();
    const name = `Proyek ${uniqueSuffix()} ${"panjang ".repeat(12)}`.trim().slice(0, 80).trim();
    expect(name.length).toBeGreaterThan(70);
    const created = await api.createProject(owner, { name });
    const { page } = await signedInPage(owner);
    await page.setViewportSize({ width: 375, height: 812 });

    const projects = new ProjectsPage(page);
    await projects.goto();
    const link = projects.item(created.slug).getByRole("link", { name: created.name });
    await expect(link).toBeVisible();

    const noHorizontalScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await noHorizontalScroll()).toBe(true);
    await expect(link).toHaveAttribute("title", created.name);
    await expect(link).toHaveCSS("text-overflow", "ellipsis");
    expect(await link.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expectNoA11yViolationsInBothThemes(page);

    const project = new ProjectPage(page);
    await project.goto(created.slug);
    await expect(project.title).toHaveAttribute("title", created.name);
    await expect(project.title).toHaveCSS("text-overflow", "ellipsis");
    expect(await noHorizontalScroll()).toBe(true);
  });
});
