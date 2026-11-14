// Dogfooding Tahap 4: membuat suite dan test case manual milik TestPulse sendiri di project `testpulse` lewat API
// (Node 24, fetch bawaan, tanpa dependensi).
//
//   TP_EMAIL=... TP_PASSWORD=... node scripts/seed-dogfood-manual.mjs
//
// Environment:
//   TP_BASE_URL   alamat aplikasi, default https://testpulse-d2p.pages.dev
//   TP_EMAIL      email akun tester/admin di project itu (wajib)
//   TP_PASSWORD   password akun itu (wajib)
//   TP_SLUG       slug project, default `testpulse`
//
// Isi sendiri TP_EMAIL dan TP_PASSWORD di shell lokal; jangan menaruhnya di berkas atau chat. Skrip ini tidak pernah
// mencetak cookie sesi maupun password, dan tidak menulis apa pun ke disk.
//
// Perilaku:
//   - login lewat POST /api/v1/auth/login dengan header Origin = TP_BASE_URL (pemeriksaan CSRF API), lalu memakai
//     cookie `tp_session` yang diterima;
//   - idempoten: suite dan case yang judulnya sudah ada (tanpa peduli huruf besar/kecil, termasuk case yang diarsipkan)
//     dilewati, jadi menjalankannya ulang tidak membuat apa pun;
//   - case baru ditautkan ke automated test yang setara lewat GET /tests?q= bila ada padanannya; case yang sudah ada
//     tidak diubah;
//   - keluar dengan kode 2 bila environment wajib kosong, dan kode 1 bila login atau permintaan lain gagal.
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

let origin;
try {
  origin = new URL(BASE_URL).origin;
} catch {
  console.error("TP_BASE_URL bukan URL yang sah.");
  process.exit(2);
}
const API = `${BASE_URL}/api/v1`;

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

/** Semua judul case project ini, termasuk yang diarsipkan, supaya case lama tidak dibuat ulang. */
async function existingCaseTitles() {
  const titles = new Set();
  for (const archived of ["false", "true"]) {
    let cursor = "";
    do {
      const page = await call(
        "GET",
        `/projects/${SLUG}/cases?archived=${archived}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        undefined,
        200,
        "Membaca daftar case",
      );
      for (const item of page.items) titles.add(key(item.title));
      cursor = page.nextCursor ?? "";
    } while (cursor);
  }
  return titles;
}

/** Id automated test pertama yang cocok dengan kata cari, atau null bila belum ada padanannya. */
async function findAutomatedTest(query) {
  const found = await call("GET", `/projects/${SLUG}/tests?q=${encodeURIComponent(query)}`, undefined, 200, "Mencari automated test");
  return found[0]?.id ?? null;
}

async function main() {
  await login();
  console.log(`Masuk ke ${origin}, project "${SLUG}".`);

  const suites = new Map((await call("GET", `/projects/${SLUG}/suites`, undefined, 200, "Membaca daftar suite")).map((suite) => [key(suite.name), suite.id]));
  let suitesCreated = 0;
  for (const { name, description } of SUITES) {
    if (suites.has(key(name))) continue;
    const created = await call("POST", `/projects/${SLUG}/suites`, { name, description }, 201, `Membuat suite "${name}"`);
    suites.set(key(name), created.id);
    suitesCreated += 1;
    console.log(`  suite baru: ${name}`);
  }

  const titles = await existingCaseTitles();
  let casesCreated = 0;
  let linked = 0;
  let unlinked = 0;
  for (const { suite, title, priority, labels, preconditions, steps, automation } of CASES) {
    if (titles.has(key(title))) continue;
    const automatedTestId = automation === undefined ? null : await findAutomatedTest(automation);
    const created = await call(
      "POST",
      `/projects/${SLUG}/cases`,
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
    `Selesai: ${suitesCreated} suite dan ${casesCreated} case baru` +
      ` (${linked} tertaut ke automated test${unlinked > 0 ? `, ${unlinked} belum ada padanannya` : ""}); sisanya sudah ada dan dilewati.`,
  );
}

main().catch((error) => {
  // Hanya pesan yang kita susun sendiri (tanpa kredensial) atau galat jaringan; tidak ada cookie atau password di sini.
  console.error(error instanceof SeedError ? error.message : `Permintaan gagal: ${error?.message ?? error}`);
  // exitCode, bukan process.exit: di Windows keluar paksa saat koneksi fetch masih menutup memicu assertion libuv.
  process.exitCode = 1;
});
