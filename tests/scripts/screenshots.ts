/**
 * Menghasilkan screenshot dokumentasi (landing dan halaman project publik, tema terang dan gelap) dari stack lokal.
 *
 * Bukan test: berkas ini berada di luar `testDir` Playwright (`e2e`, `api`, `smoke`) sehingga tidak ikut ditemukan.
 * Data disiapkan lewat API: satu user sekali pakai dan satu project publik berslug `testpulse`, jadi jalankan hanya
 * terhadap stack lokal yang baru dan kosong (`docker compose up -d --build --wait`), bukan production.
 *
 *   BASE_URL=http://localhost:8080 pnpm --filter @testpulse/tests screenshots
 *
 * Keluaran: docs/images/{landing,project}-{light,dark}.png (viewport 1280x800, bukan full page).
 */
import { chromium } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const OUT_DIR = fileURLToPath(new URL("../../docs/images/", import.meta.url));
const SLUG = "testpulse";
const MAX_BYTES = 400 * 1024;

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

/** Mendaftarkan user sekali pakai, membuat project publik "TestPulse", lalu mengembalikan slug-nya. */
async function seedPublicProject(): Promise<void> {
  const suffix = randomBytes(4).toString("hex");
  const register = await api("/auth/register", {
    method: "POST",
    body: { name: "Penulis Dokumentasi", email: `docs-${suffix}@example.test`, password: randomBytes(12).toString("hex") },
  });
  await expectOk(register, "register");
  const cookie = register.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  await expectOk(await api("/projects", { method: "POST", cookie, body: { name: "TestPulse", slug: SLUG } }), "buat project");
  await expectOk(await api(`/projects/${SLUG}`, { method: "PATCH", cookie, body: { visibility: "public" } }), "ubah visibilitas");
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await seedPublicProject();

  const browser = await chromium.launch();
  try {
    for (const [name, path] of [
      ["landing", "/"],
      ["project", `/p/${SLUG}`],
    ] as const) {
      for (const scheme of ["light", "dark"] as const) {
        // Context baru per gambar: anonim, preferensi tema tetap "system" sehingga mengikuti emulasi.
        const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 }, colorScheme: scheme });
        const page = await context.newPage();
        await page.goto(path);
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        const file = `${OUT_DIR}${name}-${scheme}.png`;
        await page.screenshot({ path: file, type: "png" });
        await context.close();

        const { size } = await stat(file);
        console.log(`${file}  ${(size / 1024).toFixed(0)} KB`);
        if (size >= MAX_BYTES) throw new Error(`${file} melebihi ${MAX_BYTES / 1024} KB`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
