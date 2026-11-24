// Dogfooding Tahap 5: membuka cycle crowdtesting publik "Uji TestPulse <versi>" di project `testpulse` lewat API
// (Node 24, fetch bawaan, tanpa dependensi).
//
//   TP_EMAIL=... TP_PASSWORD=... node scripts/seed-dogfood-crowd.mjs
//
// Environment:
//   TP_BASE_URL   alamat aplikasi, default https://testpulse-d2p.pages.dev; wajib https kecuali host lokal
//                 (localhost, 127.0.0.1, [::1], *.localhost). Alamat ini juga menjadi link aplikasi di cycle.
//   TP_EMAIL      email akun admin project itu (wajib; membuat dan membuka cycle khusus admin)
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
//   - idempoten: bila cycle berjudul sama sudah ada (tanpa peduli huruf besar/kecil), cycle itu tidak dibuat ulang dan
//     isinya tidak diubah; hanya dibuka bila masih draf. Cycle yang sudah berlangsung atau selesai dibiarkan;
//   - versi aplikasi diambil dari `version` di package.json root, sama dengan versi yang diunggah deploy.yml;
//   - keluar dengan kode 2 bila environment wajib kosong atau TP_BASE_URL tidak sah, dan kode 1 bila login atau
//     permintaan lain gagal.
//
// Jangan dijalankan terhadap production tanpa sengaja: ia membuat cycle publik sungguhan di project itu.
import { readFileSync } from "node:fs";

const BASE_URL = (process.env.TP_BASE_URL ?? "https://testpulse-d2p.pages.dev").replace(/\/+$/, "");
const EMAIL = process.env.TP_EMAIL ?? "";
const PASSWORD = process.env.TP_PASSWORD ?? "";
const SLUG = process.env.TP_SLUG ?? "testpulse";
// Render free tier bisa butuh sekitar satu menit untuk bangun setelah idle.
const REQUEST_TIMEOUT_MS = 90_000;
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

class SeedError extends Error {}

if (!EMAIL || !PASSWORD) {
  console.error("TP_EMAIL dan TP_PASSWORD wajib diisi (opsional: TP_BASE_URL, TP_SLUG).");
  console.error("Contoh: TP_EMAIL=anda@contoh.com TP_PASSWORD=... node scripts/seed-dogfood-crowd.mjs");
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

const CYCLE = {
  title: `Uji TestPulse ${VERSION}`,
  summary: "Coba TestPulse dari ujung ke ujung: daftar, buat project, kirim hasil test, catat bug, dan jalankan test manual.",
  links: [{ url: origin, label: "TestPulse (production)" }],
  instructions: [
    "## Alur yang perlu dicoba",
    "",
    "1. **Daftar** akun baru, lalu masuk dan keluar lagi.",
    "2. **Buat project**, undang akun kedua lewat link undangan, dan coba ketiga role (admin, tester, viewer).",
    "3. **Upload JUnit via curl**: buat token CI di Pengaturan project, lalu kirim berkas `junit.xml` dengan",
    "   `curl -X POST <alamat>/api/v1/projects/<slug>/runs --url-query branch=main -H \"Authorization: Bearer <token>\" --data-binary @junit.xml`.",
    "   Periksa dashboard, detail run, dan halaman Flaky.",
    "4. **Bug**: laporkan bug dari test yang gagal, ubah status dan prioritasnya, lalu beri komentar.",
    "5. **Test manual**: susun suite dan case, buat run manual, eksekusi per langkah, dan laporkan bug dari case yang gagal.",
    "",
    "Laporkan juga masalah tampilan di layar kecil, tema gelap, dan navigasi keyboard.",
  ].join("\n"),
  inScope: [
    "- Akun, project, tim, dan undangan",
    "- Upload hasil test, dashboard, run, flaky, dan perbandingan versi",
    "- Bug tracker",
    "- Test case dan run manual",
    "- Crowdtesting (halaman ini sendiri)",
  ].join("\n"),
  outOfScope: [
    "- Serangan DoS atau uji beban",
    "- Social engineering terhadap pengguna atau pengelola",
    "- Akun dan data milik orang lain",
  ].join("\n"),
  environments: ["Chrome", "Firefox", "Safari", "HP (Android/iOS)"],
  appVersion: VERSION,
};

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

/** Cycle project berjudul `title` (semua halaman daftar), atau `null`. */
async function findCycle(title) {
  let cursor = "";
  do {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const page = await call("GET", `${PROJECT}/cycles${query}`, undefined, 200, "Membaca daftar cycle");
    const found = page.items.find((cycle) => key(cycle.title) === key(title));
    if (found) return found;
    cursor = page.nextCursor ?? "";
  } while (cursor);
  return null;
}

async function open(cycle) {
  return call("PATCH", `${PROJECT}/cycles/${cycle.number}`, { version: cycle.version, status: "open" }, 200, `Membuka cycle CY-${cycle.number}`);
}

async function main() {
  // Dicetak sebelum login supaya tujuan yang salah (mis. production) terlihat sebelum kredensial dikirim.
  console.log(`Tujuan: ${origin}, project "${SLUG}".`);
  await login();
  console.log("Berhasil masuk.");

  const existing = await findCycle(CYCLE.title);
  if (existing === null) {
    const created = await call("POST", `${PROJECT}/cycles`, CYCLE, 201, `Membuat cycle "${CYCLE.title}"`);
    const opened = await open(created);
    console.log(`Selesai: cycle baru CY-${opened.number} "${CYCLE.title}" dibuat dan dibuka di ${origin}/crowd/c/${opened.id}`);
    return;
  }
  if (existing.status === "draft") {
    const opened = await open(existing);
    console.log(`Selesai: cycle CY-${opened.number} "${CYCLE.title}" sudah ada sebagai draf dan kini dibuka di ${origin}/crowd/c/${opened.id}`);
    return;
  }
  console.log(`Selesai: cycle CY-${existing.number} "${CYCLE.title}" sudah ada (${existing.status}); tidak ada yang diubah.`);
}

main().catch((error) => {
  // Hanya pesan yang kita susun sendiri (tanpa kredensial) atau galat jaringan; tidak ada cookie atau password di sini.
  // Penyebab dari undici (mis. "unexpected redirect", "connect ECONNREFUSED") memperjelas "fetch failed".
  const cause = error?.cause?.message ? ` (${error.cause.message})` : "";
  console.error(error instanceof SeedError ? error.message : `Permintaan gagal: ${error?.message ?? error}${cause}`);
  // exitCode, bukan process.exit: di Windows keluar paksa saat koneksi fetch masih menutup memicu assertion libuv.
  process.exitCode = 1;
});
