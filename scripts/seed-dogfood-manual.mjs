// Dogfooding Tahap 4: membuat suite dan test case manual milik TestPulse sendiri di project `testpulse` lewat API
// (Node 24, fetch bawaan, tanpa dependensi).
//
//   TP_EMAIL=... TP_PASSWORD=... node scripts/seed-dogfood-manual.mjs
//
// Environment:
//   TP_BASE_URL   alamat aplikasi, default https://testpulse-d2p.pages.dev; wajib https kecuali host lokal
//                 (localhost, 127.0.0.1, [::1], *.localhost)
//   TP_EMAIL      email akun tester/admin di project itu (wajib)
//   TP_PASSWORD   password akun itu (wajib)
//   TP_SLUG       slug project, default `testpulse`
//
// Isi sendiri TP_EMAIL dan TP_PASSWORD di shell lokal; jangan menaruhnya di berkas atau chat. Skrip ini tidak pernah
// mencetak cookie sesi maupun password, dan tidak menulis apa pun ke disk.
//
// Perilaku:
//   - mencetak origin tujuan sebelum login, lalu login lewat POST /api/v1/auth/login dengan header Origin = TP_BASE_URL
//     (pemeriksaan CSRF API) dan memakai cookie `tp_session` yang diterima;
//   - tidak pernah mengikuti redirect (`redirect: "error"`), supaya password dan cookie sesi tidak terkirim ulang ke
//     alamat lain;
//   - idempoten: suite dan case yang judulnya sudah ada (tanpa peduli huruf besar/kecil, termasuk case yang diarsipkan)
//     tidak dibuat ulang, jadi menjalankannya ulang tidak membuat apa pun;
//   - case ditautkan ke automated test yang setara lewat GET /tests?q= bila ada padanannya. Case aktif yang sudah ada
//     tetapi belum tertaut (mis. dibuat sebelum CI mengunggah hasil 0.4.0) ditautkan lewat PATCH bila kini ada
//     padanannya; selain itu case yang sudah ada tidak diubah. Jalankan ulang skrip setelah upload CI untuk memulihkan;
//   - keluar dengan kode 2 bila environment wajib kosong atau TP_BASE_URL tidak sah, dan kode 1 bila login atau
//     permintaan lain gagal.
//
// Jangan dijalankan terhadap production tanpa sengaja: ia membuat data sungguhan di project itu.

const BASE_URL = (process.env.TP_BASE_URL ?? "https://testpulse-d2p.pages.dev").replace(/\/+$/, "");
const EMAIL = process.env.TP_EMAIL ?? "";
const PASSWORD = process.env.TP_PASSWORD ?? "";
const SLUG = process.env.TP_SLUG ?? "testpulse";
// Render free tier bisa butuh sekitar satu menit untuk bangun setelah idle.
const REQUEST_TIMEOUT_MS = 90_000;

const SUITES = [
  { name: "Autentikasi", description: "Masuk, keluar, dan sesi pengguna." },
  { name: "Upload hasil", description: "Mengunggah laporan JUnit dari CI dengan token." },
  { name: "Bug tracker", description: "Membuat, memproses, dan membuka ulang bug." },
  { name: "Perbandingan versi", description: "Regresi antar versi dan halaman Versi." },
  { name: "Test manual", description: "Suite, case, run manual, dan eksekusinya." },
];

// `automation` = kata cari untuk GET /tests?q= (nama atau suite automated test yang setara); tanpa nilai berarti case
// ini memang hanya diuji manual. Hasil pertama pencarian dipakai.
const CASES = [
  {
    suite: "Autentikasi",
    title: "Login dengan password salah",
    priority: "high",
    labels: ["auth"],
    preconditions: "Ada akun terdaftar. Anda belum masuk.",
    steps: [
      { action: "Buka halaman `/login`.", expected: "Form masuk tampil dengan kolom email dan password." },
      { action: "Isi email akun yang valid dan password yang salah, lalu tekan **Masuk**.", expected: "Muncul pesan galat umum yang sama dengan email tidak terdaftar; tidak ada petunjuk mana yang salah." },
      { action: "Buka halaman `/` lagi.", expected: "Anda tetap dianggap belum masuk (landing page tampil)." },
    ],
    automation: "password salah",
  },
  {
    suite: "Autentikasi",
    title: "Logout menghapus sesi",
    priority: "medium",
    labels: ["auth"],
    preconditions: "Anda sudah masuk.",
    steps: [
      { action: "Tekan tombol keluar di header.", expected: "Anda diarahkan ke `/login`." },
      { action: "Tekan tombol Kembali di browser, lalu muat ulang halaman project.", expected: "Halaman terlindungi tidak terbuka; Anda tetap di `/login`." },
    ],
    automation: "logout",
  },
  {
    suite: "Upload hasil",
    title: "Upload JUnit via curl",
    priority: "high",
    labels: ["ci", "upload"],
    preconditions: "Token CI aktif untuk project dan satu berkas `junit.xml` yang sah.",
    steps: [
      { action: "Kirim berkas dengan `curl -X POST .../runs --url-query branch=main -H \"Authorization: Bearer $TESTPULSE_TOKEN\" --data-binary @junit.xml`.", expected: "Respons `201` memuat `runId`, `url`, dan `totals`." },
      { action: "Buka `url` dari respons.", expected: "Detail run tampil dengan jumlah lulus, gagal, dilewati, dan flaky yang sama dengan `totals`." },
      { action: "Buka dashboard project.", expected: "Run baru muncul paling atas di daftar run terbaru." },
    ],
    automation: "201 sesuai schema",
  },
  {
    suite: "Upload hasil",
    title: "Token dicabut ditolak",
    priority: "high",
    labels: ["ci", "token"],
    preconditions: "Anda admin project dan ada satu token CI aktif.",
    steps: [
      { action: "Cabut token di Pengaturan, bagian **Token CI**.", expected: "Token hilang dari daftar." },
      { action: "Ulangi upload dengan token yang sudah dicabut.", expected: "Respons `401`; tidak ada run baru." },
      { action: "Buka daftar run project.", expected: "Run lama yang diunggah dengan token itu tetap ada." },
    ],
    automation: "mencabut token",
  },
  {
    suite: "Bug tracker",
    title: "Buat bug dari test gagal",
    priority: "high",
    labels: ["bug"],
    preconditions: "Ada run dengan minimal satu test gagal dan Anda tester atau admin.",
    steps: [
      { action: "Buka detail run, lalu tekan **Laporkan bug** pada test yang gagal.", expected: "Form bug terbuka dengan judul, deskripsi (suite, branch, commit, link CI, pesan error), dan severity terisi." },
      { action: "Simpan bug.", expected: "Detail bug tampil dengan kartu test asal." },
      { action: "Kembali ke detail run.", expected: "Tombol Laporkan bug pada test itu diganti badge bug." },
    ],
    automation: "form terisi dari run",
  },
  {
    suite: "Bug tracker",
    title: "Buka ulang bug",
    priority: "medium",
    labels: ["bug"],
    preconditions: "Ada bug berstatus `resolved` atau `closed`.",
    steps: [
      { action: "Buka detail bug, lalu pilih status **Open**.", expected: "Status berubah; resolusi dan tanggal selesai dikosongkan." },
      { action: "Buka bagian riwayat.", expected: "Perubahan status tercatat sebagai event baru." },
    ],
    automation: "mulai kerjakan, komentar",
  },
  {
    suite: "Bug tracker",
    title: "Komentar Markdown berbahaya tampil inert",
    priority: "high",
    labels: ["bug", "keamanan"],
    preconditions: "Anda tester atau admin dan ada satu bug.",
    steps: [
      { action: "Tulis komentar berisi `<script>alert(1)</script>`, `[x](javascript:alert(1))`, dan gambar eksternal.", expected: "Pratinjau menampilkannya sebagai teks atau tautan biasa; tidak ada skrip yang berjalan." },
      { action: "Kirim komentar lalu buka halaman sebagai pengunjung anonim (project publik).", expected: "Tampilan sama; konsol browser tidak melaporkan pelanggaran CSP." },
    ],
  },
  {
    suite: "Perbandingan versi",
    title: "Regresi tampil di halaman perbandingan",
    priority: "urgent",
    labels: ["compare"],
    preconditions: "Dua run berversi berbeda; satu test lulus di versi lama dan gagal di versi baru.",
    steps: [
      { action: "Buka dashboard project.", expected: "Kartu perbandingan menyebut regresi baru dalam satu kalimat." },
      { action: "Buka halaman perbandingan dari kartu itu.", expected: "Test tadi ada di kelompok **Regresi baru** dengan status dan pesan error." },
    ],
    automation: "membuka halaman perbandingan",
  },
  {
    suite: "Perbandingan versi",
    title: "Versi manual-saja tampil di halaman Versi",
    priority: "low",
    labels: ["versi"],
    preconditions: "Run manual berversi yang belum punya run CI, misalnya `build-7`.",
    steps: [
      { action: "Buka halaman **Versi**.", expected: "Versi itu tampil di bawah daftar versi dengan kolom Manual terisi dan tanpa pass rate otomatis." },
      { action: "Tekan Bandingkan pada versi automated di atasnya.", expected: "Pembanding default melewati baris manual-saja." },
    ],
    automation: "manual-saja non-semver",
  },
  {
    suite: "Test manual",
    title: "Buat case dengan tiga langkah dan ubah urutannya",
    priority: "high",
    labels: ["manual"],
    preconditions: "Anda tester atau admin dan ada minimal satu suite.",
    steps: [
      { action: "Buka tab **Test manual**, tekan **Buat case**, isi judul dan tiga langkah.", expected: "Case tersimpan dengan kode `TC-<n>` berikutnya." },
      { action: "Pindahkan langkah 3 ke posisi 1 dengan tombol naik.", expected: "Urutan baru tampil di detail case setelah disimpan." },
    ],
    automation: "tester membuat case 3 langkah",
  },
  {
    suite: "Test manual",
    title: "Selesaikan run lalu buka ulang",
    priority: "high",
    labels: ["manual", "run"],
    preconditions: "Ada run manual terbuka dengan beberapa case belum dites.",
    steps: [
      { action: "Tekan **Selesaikan run**.", expected: "Konfirmasi inline menyebut jumlah case yang belum dites." },
      { action: "Konfirmasi, lalu coba mengubah hasil sebuah case.", expected: "Run hanya-baca; perubahan ditolak." },
      { action: "Tekan **Buka ulang**.", expected: "Run terbuka lagi dan hasil yang sudah ada tetap utuh." },
    ],
    automation: "Selesaikan run meminta konfirmasi",
  },
  {
    suite: "Test manual",
    title: "Eksekusi beruntun dengan Simpan & lanjut",
    priority: "urgent",
    labels: ["manual", "run"],
    preconditions: "Ada run manual terbuka dengan minimal dua case belum dites.",
    steps: [
      { action: "Buka case pertama dari run dan tandai semua langkah lulus.", expected: "Saran status **Lulus** muncul." },
      { action: "Tekan **Simpan & lanjut**.", expected: "Hasil tersimpan dan halaman pindah ke case belum dites berikutnya." },
      { action: "Pada case berikutnya tandai langkah 2 gagal, lalu tekan **Laporkan bug**.", expected: "Saran status **Gagal**; form bug terisi dari case, langkah, dan run." },
    ],
    automation: "eksekusi beruntun",
  },
];

class SeedError extends Error {}

if (!EMAIL || !PASSWORD) {
  console.error("TP_EMAIL dan TP_PASSWORD wajib diisi (opsional: TP_BASE_URL, TP_SLUG).");
  console.error("Contoh: TP_EMAIL=anda@contoh.com TP_PASSWORD=... node scripts/seed-dogfood-manual.mjs");
  process.exit(2);
}

let target;
try {
  target = new URL(BASE_URL);
} catch {
  console.error("TP_BASE_URL bukan URL yang sah.");
  process.exit(2);
}
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isLocal = LOCAL_HOSTS.has(target.hostname) || target.hostname.endsWith(".localhost");
if (target.protocol !== "https:" && !(target.protocol === "http:" && isLocal)) {
  // Password dan cookie sesi tidak boleh lewat koneksi tanpa enkripsi ke host lain.
  console.error("TP_BASE_URL harus https (http hanya untuk localhost, 127.0.0.1, [::1], atau *.localhost).");
  process.exit(2);
}
const origin = target.origin;
const API = `${BASE_URL}/api/v1`;
const PROJECT = `/projects/${encodeURIComponent(SLUG)}`;

let cookie = "";

async function request(method, path, json) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      // Pemeriksaan CSRF API: Origin harus sama dengan APP_ORIGIN.
      origin,
      ...(json === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: json === undefined ? undefined : JSON.stringify(json),
    // API tidak pernah me-redirect; redirect berarti alamat salah, dan mengikutinya mengirim ulang password/cookie.
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return res;
}

/** Pesan galat ringkas dari respons API ({ error: { code, message } }); tidak pernah memuat isi permintaan. */
async function describe(res) {
  try {
    const { error } = await res.json();
    return `${res.status} ${error?.code ?? ""} ${error?.message ?? ""}`.trim();
  } catch {
    return String(res.status);
  }
}

async function call(method, path, json, expected, what) {
  const res = await request(method, path, json);
  if (res.status !== expected) throw new SeedError(`${what} gagal: ${await describe(res)}`);
  return expected === 204 ? undefined : res.json();
}

async function login() {
  const res = await request("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
  if (res.status !== 200) throw new SeedError(`Login gagal: ${await describe(res)}`);
  const session = res.headers.getSetCookie().find((value) => value.startsWith("tp_session="));
  if (!session) throw new SeedError("Login gagal: server tidak mengirim cookie sesi.");
  cookie = session.split(";", 1)[0];
}

const key = (text) => text.trim().toLowerCase();

/**
 * Semua case project ini menurut judul, termasuk yang diarsipkan, supaya case lama tidak dibuat ulang:
 * `{ number, automated, archived }`.
 */
async function existingCases() {
  const cases = new Map();
  for (const archived of ["false", "true"]) {
    let cursor = "";
    do {
      const page = await call(
        "GET",
        `${PROJECT}/cases?archived=${archived}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        undefined,
        200,
        "Membaca daftar case",
      );
      for (const item of page.items) {
        cases.set(key(item.title), { number: item.number, automated: item.automated, archived: item.archived });
      }
      cursor = page.nextCursor ?? "";
    } while (cursor);
  }
  return cases;
}

/** Menautkan case yang sudah ada ke automated test (PATCH dengan `version` terbaru dari detail case). */
async function linkExistingCase(number, automatedTestId) {
  const detail = await call("GET", `${PROJECT}/cases/${number}`, undefined, 200, `Membaca TC-${number}`);
  await call("PATCH", `${PROJECT}/cases/${number}`, { version: detail.version, automatedTestId }, 200, `Menautkan TC-${number}`);
}

/** Id automated test pertama yang cocok dengan kata cari, atau null bila belum ada padanannya. */
async function findAutomatedTest(query) {
  const found = await call("GET", `${PROJECT}/tests?q=${encodeURIComponent(query)}`, undefined, 200, "Mencari automated test");
  return found[0]?.id ?? null;
}

async function main() {
  // Dicetak sebelum login supaya tujuan yang salah (mis. production) terlihat sebelum kredensial dikirim.
  console.log(`Tujuan: ${origin}, project "${SLUG}".`);
  await login();
  console.log("Berhasil masuk.");

  const suites = new Map((await call("GET", `${PROJECT}/suites`, undefined, 200, "Membaca daftar suite")).map((suite) => [key(suite.name), suite.id]));
  let suitesCreated = 0;
  for (const { name, description } of SUITES) {
    if (suites.has(key(name))) continue;
    const created = await call("POST", `${PROJECT}/suites`, { name, description }, 201, `Membuat suite "${name}"`);
    suites.set(key(name), created.id);
    suitesCreated += 1;
    console.log(`  suite baru: ${name}`);
  }

  const existing = await existingCases();
  let casesCreated = 0;
  let linked = 0;
  let relinked = 0;
  let unlinked = 0;
  for (const { suite, title, priority, labels, preconditions, steps, automation } of CASES) {
    const found = existing.get(key(title));
    if (found) {
      // Case lama aktif yang belum tertaut: tautkan bila kini ada padanannya (case arsip dan yang sudah tertaut dibiarkan).
      if (automation === undefined || found.automated || found.archived) continue;
      const automatedTestId = await findAutomatedTest(automation);
      if (automatedTestId === null) {
        unlinked += 1;
        console.log(`  TC-${found.number} ${title} (sudah ada; belum ada automated test yang cocok)`);
        continue;
      }
      await linkExistingCase(found.number, automatedTestId);
      relinked += 1;
      console.log(`  TC-${found.number} ${title} (sudah ada; kini tertaut ke automated test)`);
      continue;
    }
    const automatedTestId = automation === undefined ? null : await findAutomatedTest(automation);
    const created = await call(
      "POST",
      `${PROJECT}/cases`,
      { suiteId: suites.get(key(suite)), title, preconditions, steps, priority, labels, automatedTestId },
      201,
      `Membuat case "${title}"`,
    );
    casesCreated += 1;
    if (automatedTestId !== null) linked += 1;
    else if (automation !== undefined) unlinked += 1;
    const link = automatedTestId !== null ? "tertaut ke automated test" : automation !== undefined ? "belum ada automated test yang cocok" : "hanya manual";
    console.log(`  TC-${created.number} ${title} (${link})`);
  }

  console.log(
    `Selesai: ${suitesCreated} suite dan ${casesCreated} case baru (${linked} tertaut ke automated test), ` +
      `${relinked} case lama baru ditautkan${unlinked > 0 ? `, ${unlinked} case belum ada padanannya` : ""}; ` +
      "sisanya sudah ada dan dilewati.",
  );
}

main().catch((error) => {
  // Hanya pesan yang kita susun sendiri (tanpa kredensial) atau galat jaringan; tidak ada cookie atau password di sini.
  // Penyebab dari undici (mis. "unexpected redirect", "connect ECONNREFUSED") memperjelas "fetch failed".
  const cause = error?.cause?.message ? ` (${error.cause.message})` : "";
  console.error(error instanceof SeedError ? error.message : `Permintaan gagal: ${error?.message ?? error}${cause}`);
  // exitCode, bukan process.exit: di Windows keluar paksa saat koneksi fetch masih menutup memicu assertion libuv.
  process.exitCode = 1;
});
