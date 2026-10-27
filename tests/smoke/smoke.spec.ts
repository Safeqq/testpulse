import { AppShell } from "../pages/AppShell.js";
import { LoginPage } from "../pages/LoginPage.js";
import { ProjectPage } from "../pages/ProjectPage.js";
import { expect, test } from "../support/fixtures.js";

/**
 * Smoke test production (tag @smoke). Hanya membaca: tidak membuat, mengubah, atau menghapus data.
 * (Login membuat satu baris sesi, sama seperti pemakaian biasa; tidak ada logout/pembersihan.)
 *
 * Variabel lingkungan (GitHub Secrets pada deploy.yml):
 *   SMOKE_EMAIL, SMOKE_PASSWORD  akun khusus smoke yang sudah didaftarkan di production
 *   SMOKE_PUBLIC_SLUG            slug project publik yang sudah ada di production
 * Di CI variabel yang kurang membuat test GAGAL (konfigurasi deploy rusak); di lokal test di-skip.
 *
 * `test`/`expect` berasal dari fixtures bersama agar guard CSP ikut terpasang: smoke production ikut gagal bila
 * CSP Cloudflare sungguhan diblokir. Fixture `api` (pendaftaran user) sengaja TIDAK dipakai: production hanya dibaca.
 */

interface SmokeEnv {
  email: string;
  password: string;
  publicSlug: string;
}

function requireSmokeEnv(names: Array<"SMOKE_EMAIL" | "SMOKE_PASSWORD" | "SMOKE_PUBLIC_SLUG">): void {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length === 0) return;
  const message = `Variabel lingkungan smoke belum diisi: ${missing.join(", ")}`;
  if (process.env.CI) throw new Error(message);
  test.skip(true, `${message} (test dilewati di lokal)`);
}

function smokeEnv(): SmokeEnv {
  return {
    email: process.env.SMOKE_EMAIL?.trim() ?? "",
    password: process.env.SMOKE_PASSWORD ?? "",
    publicSlug: process.env.SMOKE_PUBLIC_SLUG?.trim() ?? "",
  };
}

test.describe("Smoke production", { tag: "@smoke" }, () => {
  test("health endpoint menjawab 200 dengan database terhubung", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(["string", "object"]).toContain(typeof body.commit);
  });

  test("halaman masuk tampil", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await expect(login.email).toBeVisible();
    await expect(login.password).toBeVisible();
  });

  test("akun smoke berhasil masuk", async ({ page }) => {
    requireSmokeEnv(["SMOKE_EMAIL", "SMOKE_PASSWORD"]);
    const { email, password } = smokeEnv();

    const login = new LoginPage(page);
    await login.goto();
    await login.login(email, password);

    await expect(new AppShell(page).currentUser).toBeVisible();
  });

  test("project publik terbuka tanpa login", async ({ page }) => {
    requireSmokeEnv(["SMOKE_PUBLIC_SLUG"]);
    const { publicSlug } = smokeEnv();

    // `page` selalu berasal dari context baru tanpa cookie, jadi ini pengunjung anonim.
    const project = new ProjectPage(page);
    await project.goto(publicSlug);

    await expect(project.publicBadge).toBeVisible();
    await expect(new AppShell(page).currentUser).toHaveCount(0);
  });
});
