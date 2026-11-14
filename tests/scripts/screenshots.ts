/**
 * Menghasilkan screenshot dokumentasi (landing, halaman project publik yang masih kosong, dashboard hasil test,
 * perbandingan versi, daftar bug, halaman Versi dengan kolom Manual, detail run manual, dan halaman eksekusi case,
 * masing-masing di tema terang dan gelap) dari stack lokal.
 *
 * Bukan test: berkas ini berada di luar `testDir` Playwright (`e2e`, `api`, `smoke`) sehingga tidak ikut ditemukan.
 * Data disiapkan lewat API: satu user sekali pakai dan satu project publik berslug `testpulse`. Setelah screenshot
 * project yang masih kosong diambil, skrip membuat token CI dan mengunggah beberapa run JUnit (dibangun dengan
 * `buildJUnit`; tiga di antaranya berversi 0.1.0, 0.2.0, dan 0.3.0 dengan regresi, perbaikan, test lebih lambat, dan
 * test baru di versi terakhir) agar dashboard dan perbandingan terisi, lalu membuat beberapa bug (dua tertaut ke
 * regresi). Tahap 4: dua suite berisi delapan test case manual (beberapa ditautkan ke automated test), satu run manual
 * berversi 0.3.0 yang sebagian sudah dieksekusi (satu case gagal dengan bug, satu case terisi sebagian sehingga saran
 * status tampil). Jalankan hanya terhadap stack lokal yang baru dan kosong
 * (`docker compose up -d --build --wait`), bukan production.
 *
 *   BASE_URL=http://localhost:8080 pnpm --filter @testpulse/tests screenshots
 *
 * Keluaran: docs/images/{landing,project,dashboard,compare,bugs,versions,manual-run,manual-exec}-{light,dark}.png
 * (lebar 1280; landing dan project 1280x800, dashboard 1280x1280, compare 1280x1400, bugs 1280x960, versions 1280x800,
 * manual-run 1280x1100, manual-exec 1280x1500; bukan full page).
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
/** Run (indeks) yang diunggah dengan `version`; run lain tanpa versi, seperti sebelum Tahap 3. */
const VERSIONS = new Map([
  [3, "0.1.0"],
  [9, "0.2.0"],
  [11, "0.3.0"],
]);
const LAST_RUN = RUN_COUNT - 1;

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

/**
 * Hasil satu run: hampir semua lulus; dua test flaky bergantian lulus/gagal, satu test gagal pada dua run berurutan.
 * Run terakhir (versi 0.3.0) dibanding run versi 0.2.0 memuat dua regresi (kupon dan stok), satu perbaikan (filter
 * hasil gagal), satu test jadi lebih lambat (tren), dan satu test baru.
 */
function casesForRun(index: number): JUnitCase[] {
  const cases = SUITES.flatMap(({ suite, tests }) =>
    tests.map((name): JUnitCase => {
      const key = `${suite} ${name}`;
      const timeSec = 0.2 + ((key.length * 37 + index * 11) % 90) / 100;
      if (index >= 10 && key === "checkout.spec.ts menerapkan kupon") {
        return { suite, name, status: "failed", message: "Kupon HEMAT10 ditolak: diskon tidak diterapkan ke total", timeSec };
      }
      if (index === LAST_RUN && key === "checkout.spec.ts stok habis") {
        return { suite, name, status: "failed", message: "Expected pesan 'Stok habis' tampil, received tombol Bayar aktif", timeSec };
      }
      if (index === LAST_RUN && key === "results.spec.ts dashboard menampilkan tren") {
        return { suite, name, timeSec: 3.4 };
      }
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
  if (index === LAST_RUN) cases.push({ suite: "checkout.spec.ts", name: "kupon kedaluwarsa ditolak", timeSec: 0.4 });
  return cases;
}

/** Membuat token CI lalu mengunggah beberapa run ke branch `main`, dari yang lama ke yang baru; mengembalikan id run terakhir. */
async function seedRuns(cookie: string): Promise<string> {
  const created = await api(`/projects/${SLUG}/tokens`, { method: "POST", cookie, body: { name: "CI GitHub Actions" } });
  await expectOk(created, "buat token CI");
  const { token } = (await created.json()) as { token: string };

  let lastRunId = "";
  for (let index = 0; index < RUN_COUNT; index++) {
    const params = new URLSearchParams({
      branch: "main",
      commit: (0x1a2b3c4 + index * 0x1111).toString(16).padStart(7, "0"),
      ciUrl: `https://github.com/Safeqq/testpulse/actions/runs/${1000 + index}`,
      name: `CI #${1000 + index}`,
    });
    const version = VERSIONS.get(index);
    if (version !== undefined) params.set("version", version);
    const res = await fetch(`${BASE_URL}/api/v1/projects/${SLUG}/runs?${params.toString()}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/xml" },
      body: buildJUnit(casesForRun(index)),
    });
    await expectOk(res, `unggah run ${index + 1}`);
    lastRunId = ((await res.json()) as { runId: string }).runId;
  }
  return lastRunId;
}

interface SeedBug {
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  severity: "minor" | "major" | "critical" | "blocker";
  labels: string[];
  /** Nama test gagal di run terakhir yang ditautkan, bila ada. */
  test?: string;
  /** Status akhir; tanpa nilai bug dibiarkan `open`. */
  status?: "in_progress" | "resolved";
}

const BUGS: SeedBug[] = [
  {
    title: "Kupon HEMAT10 tidak mengurangi total pembayaran",
    description: "Setelah kupon diterapkan, total di keranjang tetap sama.\n\n**Langkah:** tambahkan barang, masukkan kupon `HEMAT10`.",
    priority: "urgent",
    severity: "critical",
    labels: ["checkout", "regresi"],
    test: "checkout.spec.ts menerapkan kupon",
    status: "in_progress",
  },
  {
    title: "Tombol Bayar tetap aktif saat stok habis",
    description: "Pelanggan bisa menekan Bayar padahal stok barang 0.",
    priority: "high",
    severity: "major",
    labels: ["checkout", "regresi"],
    test: "checkout.spec.ts stok habis",
  },
  {
    title: "Pembayaran berhasil kadang timeout di CI",
    description: "Gagal sesekali dengan `Timeout 5000ms`, lulus setelah retry.",
    priority: "medium",
    severity: "major",
    labels: ["flaky", "checkout"],
  },
  {
    title: "Filter hasil gagal menampilkan jumlah baris salah",
    description: "Diperbaiki di 0.3.0.",
    priority: "medium",
    severity: "minor",
    labels: ["results"],
    status: "resolved",
  },
  {
    title: "Undangan kedaluwarsa tidak punya pesan yang jelas",
    description: "Halaman hanya menampilkan 'tidak ditemukan'.",
    priority: "low",
    severity: "minor",
    labels: ["tim"],
  },
];

/** Membuat beberapa bug contoh (dua tertaut ke regresi di run terakhir) sebagai pemilik project. */
async function seedBugs(cookie: string, lastRunId: string): Promise<void> {
  const failed = await api(`/projects/${SLUG}/runs/${lastRunId}?status=failed`, { method: "GET" });
  await expectOk(failed, "hasil gagal run terakhir");
  const { results } = (await failed.json()) as { results: Array<{ testCaseId: string; suite: string; name: string }> };
  const testId = (test: string) => results.find((result) => `${result.suite} ${result.name}` === test)?.testCaseId;

  for (const { test, status, ...bug } of BUGS) {
    const testCaseId = test === undefined ? undefined : testId(test);
    if (test !== undefined && testCaseId === undefined) throw new Error(`test gagal tidak ditemukan: ${test}`);
    const link = testCaseId === undefined ? {} : { testCaseId, runId: lastRunId };
    const created = await api(`/projects/${SLUG}/bugs`, { method: "POST", cookie, body: { ...bug, ...link } });
    await expectOk(created, `buat bug "${bug.title}"`);
    if (status === undefined) continue;
    const { number, version } = (await created.json()) as { number: number; version: number };
    const patch = { version, status, ...(status === "resolved" ? { resolution: "fixed" } : {}) };
    await expectOk(await api(`/projects/${SLUG}/bugs/${number}`, { method: "PATCH", cookie, body: patch }), `ubah status bug #${number}`);
  }
}

interface SeedCase {
  suite: string;
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
  labels: string[];
  steps: Array<{ action: string; expected: string }>;
  /** Kata cari automated test (GET /tests?q=) yang setara; tanpa nilai berarti hanya diuji manual. */
  automation?: string;
}

const MANUAL_SUITES = ["Autentikasi", "Checkout"];

const MANUAL_CASES: SeedCase[] = [
  {
    suite: "Autentikasi",
    title: "Login dengan password salah",
    priority: "high",
    labels: ["auth"],
    steps: [
      { action: "Buka halaman `/login`.", expected: "Form masuk tampil." },
      { action: "Isi email valid dan password salah, lalu tekan **Masuk**.", expected: "Muncul pesan galat umum." },
    ],
    automation: "masuk dengan email dan password",
  },
  {
    suite: "Autentikasi",
    title: "Logout menghapus sesi",
    priority: "medium",
    labels: ["auth"],
    steps: [
      { action: "Tekan tombol keluar di header.", expected: "Anda diarahkan ke `/login`." },
      { action: "Tekan Kembali di browser.", expected: "Halaman terlindungi tidak terbuka." },
    ],
    automation: "keluar menghapus sesi",
  },
  {
    suite: "Checkout",
    title: "Terapkan kupon di keranjang",
    priority: "urgent",
    labels: ["checkout", "regresi"],
    steps: [
      { action: "Tambahkan satu barang ke keranjang.", expected: "Total sama dengan harga barang." },
      { action: "Masukkan kupon `HEMAT10` lalu tekan **Terapkan**.", expected: "Total berkurang 10%." },
      { action: "Lanjut ke pembayaran.", expected: "Total di pembayaran sama dengan total keranjang." },
    ],
    automation: "menerapkan kupon",
  },
  {
    suite: "Checkout",
    title: "Pembayaran berhasil",
    priority: "high",
    labels: ["checkout"],
    steps: [
      { action: "Isi alamat dan pilih metode bayar.", expected: "Tombol **Bayar** aktif." },
      { action: "Tekan **Bayar**.", expected: "Halaman konfirmasi dengan nomor pesanan tampil." },
    ],
    automation: "pembayaran berhasil",
  },
  {
    suite: "Checkout",
    title: "Stok habis menonaktifkan tombol Bayar",
    priority: "high",
    labels: ["checkout", "regresi"],
    steps: [
      { action: "Buka barang yang stoknya 0.", expected: "Label **Stok habis** tampil." },
      { action: "Coba tambahkan ke keranjang.", expected: "Tombol **Bayar** tetap nonaktif." },
    ],
    automation: "stok habis",
  },
  {
    suite: "Checkout",
    title: "Kupon kedaluwarsa ditolak",
    priority: "medium",
    labels: ["checkout"],
    steps: [
      { action: "Masukkan kupon yang sudah lewat tanggalnya.", expected: "Pesan **Kupon kedaluwarsa** tampil." },
    ],
    automation: "kupon kedaluwarsa",
  },
  {
    suite: "Autentikasi",
    title: "Undangan kedaluwarsa menampilkan pesan yang jelas",
    priority: "low",
    labels: ["tim"],
    steps: [
      { action: "Buka link undangan yang sudah kedaluwarsa.", expected: "Halaman menjelaskan bahwa undangan tidak berlaku." },
    ],
  },
  {
    suite: "Checkout",
    title: "Struk dapat dicetak",
    priority: "low",
    labels: ["checkout"],
    steps: [
      { action: "Buka konfirmasi pesanan lalu tekan **Cetak struk**.", expected: "Pratinjau cetak memuat rincian pesanan." },
    ],
  },
];

interface RunCaseRow {
  id: string;
  caseNumber: number;
  title: string;
}

/** Id automated test pertama yang cocok dengan kata cari, atau null. */
async function findAutomatedTest(cookie: string, query: string): Promise<string | null> {
  const res = await api(`/projects/${SLUG}/tests?q=${encodeURIComponent(query)}`, { method: "GET", cookie });
  await expectOk(res, `cari automated test "${query}"`);
  const found = (await res.json()) as Array<{ id: string }>;
  return found[0]?.id ?? null;
}

/**
 * Tahap 4: suite, test case manual (sebagian ditautkan ke automated test), dan run "Regresi 0.3.0" dari semua case.
 * Hasil: dua case lulus, satu case gagal di langkah 2 dengan bug yang tertaut, satu diblokir, satu terisi sebagian
 * (status masih belum dites, jadi saran "Gagal" tampil di halaman eksekusi), sisanya belum dites. Mengembalikan nomor
 * run dan id run case yang terisi sebagian.
 */
async function seedManual(cookie: string): Promise<{ runNumber: number; partialRunCaseId: string }> {
  const suiteIds = new Map<string, string>();
  for (const name of MANUAL_SUITES) {
    const res = await api(`/projects/${SLUG}/suites`, { method: "POST", cookie, body: { name } });
    await expectOk(res, `buat suite "${name}"`);
    suiteIds.set(name, ((await res.json()) as { id: string }).id);
  }

  const numbers = new Map<string, number>();
  for (const { suite, title, priority, labels, steps, automation } of MANUAL_CASES) {
    const automatedTestId = automation === undefined ? null : await findAutomatedTest(cookie, automation);
    const res = await api(`/projects/${SLUG}/cases`, {
      method: "POST",
      cookie,
      body: { suiteId: suiteIds.get(suite), title, priority, labels, steps, automatedTestId },
    });
    await expectOk(res, `buat case "${title}"`);
    numbers.set(title, ((await res.json()) as { number: number }).number);
  }

  const created = await api(`/projects/${SLUG}/manual-runs`, {
    method: "POST",
    cookie,
    body: { name: "Regresi 0.3.0", appVersion: "0.3.0", suiteIds: [...suiteIds.values()] },
  });
  await expectOk(created, "buat run manual");
  const { number: runNumber } = (await created.json()) as { number: number };

  const listed = await api(`/projects/${SLUG}/manual-runs/${runNumber}/cases`, { method: "GET", cookie });
  await expectOk(listed, "daftar case run manual");
  const rows = ((await listed.json()) as { items: RunCaseRow[] }).items;
  const rowFor = (title: string): RunCaseRow => {
    const row = rows.find((item) => item.title === title);
    if (row === undefined) throw new Error(`case tidak ada di run: ${title}`);
    return row;
  };

  async function updateRunCase(row: RunCaseRow, body: Record<string, unknown>): Promise<void> {
    const path = `/projects/${SLUG}/manual-runs/${runNumber}/cases/${row.id}`;
    const detail = await api(path, { method: "GET", cookie });
    await expectOk(detail, `baca run case ${row.title}`);
    const { version } = (await detail.json()) as { version: number };
    await expectOk(await api(path, { method: "PATCH", cookie, body: { version, ...body } }), `isi hasil ${row.title}`);
  }

  await updateRunCase(rowFor("Login dengan password salah"), { status: "passed" });
  await updateRunCase(rowFor("Logout menghapus sesi"), { status: "passed" });
  await updateRunCase(rowFor("Pembayaran berhasil"), { status: "blocked", note: "Gateway pembayaran sandbox sedang mati." });

  const failing = rowFor("Stok habis menonaktifkan tombol Bayar");
  await updateRunCase(failing, {
    status: "failed",
    stepResults: [
      { status: "passed", note: "" },
      { status: "failed", note: "Tombol Bayar tetap aktif walau stok 0." },
    ],
  });
  const bug = await api(`/projects/${SLUG}/bugs`, {
    method: "POST",
    cookie,
    body: {
      title: `Tombol Bayar tetap aktif saat stok habis (dari TC-${numbers.get(failing.title)})`,
      description: "Ditemukan saat eksekusi run Regresi 0.3.0.",
      priority: "high",
      severity: "major",
      labels: ["checkout", "regresi"],
      manualRunCaseId: failing.id,
    },
  });
  await expectOk(bug, "buat bug dari run case");

  // Terisi sebagian: langkah 1 lulus, langkah 2 gagal, langkah 3 kosong; status belum diubah, jadi muncul saran.
  const partial = rowFor("Terapkan kupon di keranjang");
  await updateRunCase(partial, {
    stepResults: [
      { status: "passed", note: "" },
      { status: "failed", note: "Total tidak berubah setelah kupon diterapkan." },
      { status: null, note: "" },
    ],
  });
  return { runNumber, partialRunCaseId: partial.id };
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
    // Markdown dimuat malas: tunggu sampai tidak ada lagi penanda "Memuat" sebelum gambar diambil.
    await page.waitForFunction(() => !document.body.innerText.includes("Memuat"));
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
    const lastRunId = await seedRuns(cookie);
    await seedBugs(cookie, lastRunId);
    await capture(browser, {
      name: "dashboard",
      path: `/p/${SLUG}`,
      height: 1280,
      ready: (page) => page.getByTestId("top-flaky"),
    });
    await capture(browser, {
      name: "compare",
      path: `/p/${SLUG}/compare`,
      height: 1400,
      ready: (page) => page.getByTestId("compare-sentence"),
    });
    await capture(browser, { name: "bugs", path: `/p/${SLUG}/bugs`, height: 960, ready: (page) => page.getByTestId("bugs-list") });

    const { runNumber, partialRunCaseId } = await seedManual(cookie);
    await capture(browser, {
      name: "versions",
      path: `/p/${SLUG}/versions`,
      height: 800,
      ready: (page) => page.getByTestId("version-manual-0.3.0"),
    });
    await capture(browser, {
      name: "manual-run",
      path: `/p/${SLUG}/manual-runs/${runNumber}`,
      height: 1100,
      ready: (page) => page.getByTestId("run-header"),
    });
    await capture(browser, {
      name: "manual-exec",
      path: `/p/${SLUG}/manual-runs/${runNumber}/cases/${partialRunCaseId}`,
      height: 1500,
      ready: (page) => page.getByTestId("exec-suggestion"),
    });
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
