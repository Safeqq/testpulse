/**
 * Menghasilkan screenshot dokumentasi (landing, halaman project publik yang masih kosong, dan dashboard hasil test,
 * masing-masing di tema terang dan gelap) dari stack lokal.
 *
 * Bukan test: berkas ini berada di luar `testDir` Playwright (`e2e`, `api`, `smoke`) sehingga tidak ikut ditemukan.
 * Data disiapkan lewat API: satu user sekali pakai dan satu project publik berslug `testpulse`. Setelah screenshot
 * project yang masih kosong diambil, skrip membuat token CI dan mengunggah beberapa run JUnit (dibangun dengan
 * `buildJUnit`) agar dashboard terisi. Jalankan hanya terhadap stack lokal yang baru dan kosong
 * (`docker compose up -d --build --wait`), bukan production.
 *
 *   BASE_URL=http://localhost:8080 pnpm --filter @testpulse/tests screenshots
 *
 * Keluaran: docs/images/{landing,project,dashboard}-{light,dark}.png (lebar 1280; landing dan project 1280x800,
 * dashboard 1280x1280; bukan full page).
 */
import { chromium, type Browser, type Locator, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildJUnit, type JUnitCase } from "../support/junit.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const OUT_DIR = fileURLToPath(new URL("../../docs/images/", import.meta.url));
const SLUG = "testpulse";
const MAX_BYTES = 400 * 1024;
const RUN_COUNT = 12;

async function api(path: string, init: { method: string; body?: unknown; cookie?: string }): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1${path}`, {
    method: init.method,
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.cookie ? { Cookie: init.cookie } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function expectOk(res: Response, what: string): Promise<void> {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
}

/** Mendaftarkan user sekali pakai dan membuat project publik "TestPulse"; mengembalikan cookie sesi pemiliknya. */
async function seedPublicProject(): Promise<string> {
  const suffix = randomBytes(4).toString("hex");
  const register = await api("/auth/register", {
    method: "POST",
    body: { name: "Penulis Dokumentasi", email: `docs-${suffix}@example.test`, password: randomBytes(12).toString("hex") },
  });
  await expectOk(register, "register");
  const cookie = register.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  await expectOk(await api("/projects", { method: "POST", cookie, body: { name: "TestPulse", slug: SLUG } }), "buat project");
  await expectOk(await api(`/projects/${SLUG}`, { method: "PATCH", cookie, body: { visibility: "public" } }), "ubah visibilitas");
  return cookie;
}

const SUITES: Array<{ suite: string; tests: string[] }> = [
  { suite: "auth.spec.ts", tests: ["daftar akun baru", "masuk dengan email dan password", "keluar menghapus sesi", "password salah ditolak"] },
  { suite: "projects.spec.ts", tests: ["membuat project", "mengubah visibilitas", "slug sudah dipakai", "daftar project saya", "menghapus project"] },
  { suite: "team.spec.ts", tests: ["mengundang anggota", "menerima undangan", "mengubah role", "admin terakhir tidak bisa keluar", "link undangan kedaluwarsa"] },
  { suite: "results.spec.ts", tests: ["unggah laporan JUnit", "dashboard menampilkan tren", "filter hasil gagal", "riwayat satu test", "hapus run"] },
  { suite: "checkout.spec.ts", tests: ["menghitung total keranjang", "menerapkan kupon", "pembayaran berhasil", "stok habis"] },
];

/** Hasil satu run: hampir semua lulus; dua test flaky bergantian lulus/gagal, satu test gagal pada dua run berurutan. */
function casesForRun(index: number): JUnitCase[] {
  return SUITES.flatMap(({ suite, tests }) =>
    tests.map((name): JUnitCase => {
      const key = `${suite} ${name}`;
      const timeSec = 0.2 + ((key.length * 37 + index * 11) % 90) / 100;
      if (key === "checkout.spec.ts pembayaran berhasil") {
        // Flaky: pada run genap gagal dulu lalu lulus pada percobaan ulang; gagal total pada satu run.
        if (index === 7) return { suite, name, status: "failed", message: "Timeout 5000ms menunggu tombol Bayar", timeSec };
        return index % 2 === 0 ? { suite, name, retries: 1, timeSec } : { suite, name, timeSec };
      }
      if (key === "team.spec.ts link undangan kedaluwarsa") {
        return index % 3 === 0 ? { suite, name, retries: 1, timeSec } : { suite, name, timeSec };
      }
      if (key === "results.spec.ts filter hasil gagal" && index >= 8 && index <= 9) {
        return { suite, name, status: "failed", message: "Expected 3 rows, received 2", timeSec };
      }
      if (key === "projects.spec.ts menghapus project") return { suite, name, status: "skipped", timeSec: 0 };
      return { suite, name, timeSec };
    }),
  );
}

/** Membuat token CI lalu mengunggah beberapa run ke branch `main`, dari yang lama ke yang baru. */
async function seedRuns(cookie: string): Promise<void> {
  const created = await api(`/projects/${SLUG}/tokens`, { method: "POST", cookie, body: { name: "CI GitHub Actions" } });
  await expectOk(created, "buat token CI");
  const { token } = (await created.json()) as { token: string };

  for (let index = 0; index < RUN_COUNT; index++) {
    const params = new URLSearchParams({
      branch: "main",
      commit: (0x1a2b3c4 + index * 0x1111).toString(16).padStart(7, "0"),
      ciUrl: `https://github.com/Safeqq/testpulse/actions/runs/${1000 + index}`,
      name: `CI #${1000 + index}`,
    });
    const res = await fetch(`${BASE_URL}/api/v1/projects/${SLUG}/runs?${params.toString()}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/xml" },
      body: buildJUnit(casesForRun(index)),
    });
    await expectOk(res, `unggah run ${index + 1}`);
  }
}

interface Shot {
  name: string;
  path: string;
  height: number;
  /** Elemen yang harus tampil sebelum gambar diambil. */
  ready: (page: Page) => Locator;
}

async function capture(browser: Browser, shot: Shot): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    // Context baru per gambar: anonim, preferensi tema tetap "system" sehingga mengikuti emulasi.
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1280, height: shot.height },
      colorScheme: scheme,
    });
    const page = await context.newPage();
    await page.goto(shot.path);
    await shot.ready(page).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const file = `${OUT_DIR}${shot.name}-${scheme}.png`;
    await page.screenshot({ path: file, type: "png" });
    await context.close();

    const { size } = await stat(file);
    console.log(`${file}  ${(size / 1024).toFixed(0)} KB`);
    if (size >= MAX_BYTES) throw new Error(`${file} melebihi ${MAX_BYTES / 1024} KB`);
  }
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 }).first();

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const cookie = await seedPublicProject();

  const browser = await chromium.launch();
  try {
    // Landing dan project publik yang masih kosong (sebelum ada run); dashboard setelah run diunggah.
    await capture(browser, { name: "landing", path: "/", height: 800, ready: heading });
    await capture(browser, { name: "project", path: `/p/${SLUG}`, height: 800, ready: heading });
    await seedRuns(cookie);
    await capture(browser, {
      name: "dashboard",
      path: `/p/${SLUG}`,
      height: 1280,
      ready: (page) => page.getByTestId("top-flaky"),
    });
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
