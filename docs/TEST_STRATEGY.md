# Strategi Testing TestPulse (Tahap 1)

Dokumen ini menjelaskan **apa** yang diuji, **di lapisan mana**, dan **kenapa**, termasuk apa yang sengaja tidak diuji. Daftar skenario per fitur ada di [test-plans/tahap-1.md](./test-plans/tahap-1.md); keputusan arsitektur yang memengaruhi strategi ini ada di [adr/](./adr/).

## 1. Prinsip

1. **Uji aturan di lapisan terendah yang bisa membuktikannya.** Aturan murni (role, admin terakhir, slug, kedaluwarsa undangan) diuji sebagai unit; perilaku yang butuh database asli diuji sebagai integration; hanya alur lintas-layar yang diuji E2E. Piramida tetap lebar di bawah dan sempit di atas.
2. **Risiko menentukan kedalaman, bukan jumlah halaman.** Bagian yang gagalnya merugikan (otorisasi, sesi, race condition) mendapat banyak lapisan; bagian kosmetik hanya satu.
3. **Test harus independen dan paralel.** Setiap test membuat datanya sendiri (email unik, project unik) lewat API/factory, tidak berbagi state, sehingga aman dijalankan paralel dan disharding di CI.
4. **Database asli, bukan mock, untuk perilaku data.** Integration test memakai Postgres sungguhan lewat Testcontainers, karena bug seperti race condition dan constraint tidak muncul di mock.
5. **Quality gate otomatis.** Coverage domain, ZAP High, audit dependensi, dan seluruh lapisan test harus hijau di CI sebelum deploy.

## 2. Lapisan test

| Lapisan | Tool | Lokasi | Yang dibuktikan |
|---|---|---|---|
| Unit | Vitest | `packages/shared/src`, `apps/api/src`, `apps/web/src` (`*.test.ts`) | Aturan domain murni, schema Zod, hashing, penyensoran log, pemilihan kunci rate limit, logika tema dan `theme-init.js` di web. Gate coverage >= 80% untuk `src/modules/**/domain` |
| Integration | Vitest + Testcontainers (Postgres asli) | `apps/api/test/integration` | Migrasi, repository, dan seluruh rute lewat `fastify.inject` dengan DB asli, termasuk uji paralel terkunci untuk aturan admin terakhir |
| API | Playwright `request` | `tests/api` | Kontrak HTTP dari luar proses: alur auth, validasi negatif dan boundary, dan **matriks otorisasi yang dibangkitkan dari tabel data** (`tests/api/authorization-matrix.ts`) |
| Contract | Pact JS | `apps/web/test/contract` (consumer), `apps/api/test/contract` (provider) | Web dan API sepakat soal bentuk request/response di setiap endpoint tahap 1; perubahan sepihak membuat verifikasi provider gagal |
| E2E | Playwright (POM, custom fixtures; Chromium, Firefox, WebKit) | `tests/e2e`, `tests/pages` | Alur pengguna lintas halaman: daftar, buat project, undang, terima, hak akses per role, admin terakhir, ubah visibilitas; landing page, tema, dan responsif HP (lihat bagian 2.1) |
| Accessibility | `@axe-core/playwright` | dipanggil dari `tests/e2e` lewat `tests/support/a11y.ts` | Landing dan halaman utama (masuk/daftar, daftar dan buat project, ringkasan project, pengaturan, pratinjau undangan) bebas pelanggaran `serious`/`critical` **di tema terang dan gelap** (bagian 2.1) |
| Gate CSP | listener `securitypolicyviolation` + pesan console, dipasang di fixture Playwright | `tests/support/csp.ts`, `tests/support/fixtures.ts` | Tidak ada satu pun pelanggaran Content Security Policy selama test E2E (bagian 2.1) |
| Proxy dan header | Vitest | `apps/web/test/functions` | Pages Function meneruskan request dengan benar; header keamanan nginx dan Cloudflare `_headers` identik |
| Security | OWASP ZAP baseline, `pnpm audit`, Dependabot | job `zap` dan `lint-typecheck` di [`ci.yml`](../.github/workflows/ci.yml); gate di `tests/security/check-zap-report.mjs` | 0 temuan High dari ZAP, 0 dependensi high/critical |
| Smoke production | Playwright, tag `@smoke` | `tests/smoke` | Setelah deploy: health, halaman masuk, login akun smoke, project publik terbuka tanpa login. Hanya membaca |

### Kenapa tiap lapisan ada

- **Unit:** cepat (detik) dan menunjuk penyebab dengan tepat. Cocok untuk aturan yang punya banyak kombinasi (misalnya keputusan akses: aksi x role x visibilitas) yang mahal jika diuji lewat browser.
- **Integration:** aturan domain benar belum berarti SQL-nya benar. Lapisan ini menangkap constraint, transaksi, dan kunci baris yang hanya ada di database asli.
- **API:** memverifikasi sistem yang sudah berjalan sebagai kotak hitam (nginx, API, DB di Docker), tanpa biaya browser. Matriks otorisasi berupa **data**, sehingga menambah role atau endpoint berarti menambah baris, bukan menulis test baru, dan tidak ada kombinasi yang terlupa.
- **Contract:** web dan API dikembangkan terpisah dalam satu repo. Test API saja tidak menjamin web memakai respons dengan benar, dan E2E terlalu lambat untuk menangkap setiap penyimpangan bentuk data. Pact memeriksa batas itu langsung.
- **E2E:** dibatasi pada alur yang benar-benar butuh browser dan beberapa pengguna (context terpisah). Data awal dibuat lewat API supaya test cepat dan fokus. Tiga browser dijalankan untuk menangkap perbedaan perilaku (misalnya clipboard).
- **Accessibility:** semua form punya label terhubung dan bisa dioperasikan keyboard; axe menjaga hal itu tidak mundur.
- **Proxy dan header:** dua komponen yang tidak bisa dijalankan sama persis di CI (Cloudflare) tetap bisa diuji sebagai unit: logika proxy sebagai fungsi, dan kesetaraan header sebagai perbandingan berkas.
- **Security:** pemindaian otomatis murah, menangkap kelas masalah umum (header, kerentanan dependensi). Ini baseline, bukan pengganti pemodelan ancaman.
- **Smoke:** satu-satunya lapisan yang menyentuh production sungguhan, sengaja kecil dan read-only supaya tidak mengotori data.

### 2.1 Tema, gate CSP, dan landing page

Tampilan baru (Tailwind CSS v4 + shadcn/ui, dua tema, dan landing page; lihat [ADR 0003](./adr/0003-tailwind-shadcn.md)) menambah empat hal yang diuji di lapisan E2E. Semuanya ada di `tests/e2e` dan `tests/support`.

**Aksesibilitas di dua tema.** Fixture `expectNoA11yViolationsInBothThemes` ([`tests/support/a11y.ts`](../tests/support/a11y.ts)) menjalankan `expectNoA11yViolations` di tema terang lalu gelap. Pilihan tema aplikasi tetap `"system"`; tema diganti dengan `page.emulateMedia({ colorScheme })`, dan axe baru dijalankan setelah kelas `dark` di `<html>` sesuai. Sebelum axe, helper menunggu transisi dan animasi berhingga selesai (mis. `transition-colors` saat tema berganti) agar axe tidak membaca warna di tengah transisi dan melaporkan kontras palsu. Penantian ini dibatasi 1500 ms dan animasi tak berhingga (mis. `animate-spin`) tidak ditunggu, sehingga tidak pernah menggantung; perilaku itu sendiri diuji di [`a11y-helper.spec.ts`](../tests/e2e/a11y-helper.spec.ts). Dipakai di landing ([`landing.spec.ts`](../tests/e2e/landing.spec.ts)), `/login` dan `/register` ([`auth.spec.ts`](../tests/e2e/auth.spec.ts)), daftar dan buat project serta ringkasan project (anggota dan anonim publik) ([`projects.spec.ts`](../tests/e2e/projects.spec.ts)), pengaturan dan pratinjau undangan ([`team.spec.ts`](../tests/e2e/team.spec.ts)). Kriteria sama seperti sebelumnya: 0 pelanggaran `serious`/`critical`.

**Gate CSP.** CSP production (`default-src 'self'; ... style-src 'self'; script-src 'self'; ...`, tanpa `'unsafe-inline'`, nonce, atau hash) tidak boleh dilonggarkan demi tampilan baru. Gate-nya ada di fixture `context`/`newContext` ([`tests/support/csp.ts`](../tests/support/csp.ts), [`fixtures.ts`](../tests/support/fixtures.ts)) sehingga **setiap test E2E gagal di teardown bila ada pelanggaran CSP**, di halaman mana pun yang dibuka test itu:

- Dua jalur deteksi: event `securitypolicyviolation` (init script + `exposeBinding` di setiap dokumen dan frame) dan pesan console error/warning yang menyebut Content Security Policy. Satu pelanggaran yang dilaporkan kedua jalur dihitung sekali.
- **Gagal tertutup:** bila binding tidak tersedia di suatu dokumen, init script menulis penanda dan itu dicatat sebagai pelanggaran `tp-guard-missing`, bukan guard yang diam-diam mati.
- **Pengecualian WebKit:** WebKit melaporkan `style-src-attr` setiap kali elemen `<select>` dibuat lewat script, padahal tidak ada atribut `style` (bug mesin). Pelanggaran semacam itu dikecualikan hanya untuk `<select>` tanpa atribut `style`; atribut `style` asli tetap terdeteksi. Karena pesan console WebKit untuk artefak itu tidak bisa dibedakan dari style inline asli, entri console `style-src*` selalu dibuang (event sudah meliputi halaman).
- Pelanggaran di dalam worker tidak terlihat sebagai event di `window`; hanya WebKit yang menampilkannya lewat console Playwright, jadi jalur console dipertahankan untuk kasus itu.
- Gate itu sendiri diuji di [`csp-guard.spec.ts`](../tests/e2e/csp-guard.spec.ts) dengan halaman probe yang CSP-nya disajikan lewat `page.route`.
- **Hanya bermakna di stack Docker/nginx** (dan CI `stack-tests`), karena di situlah header CSP production dipasang. Di mode dev Vite (`localhost:5173`) tidak ada header CSP sehingga gate selalu hijau; jalankan E2E terhadap `BASE_URL=http://localhost:8080` untuk membuktikan CSP.
- Satu pelanggaran nyata yang harus ditutup agar gate ini bisa hijau: zod menguji dukungan `new Function` (JIT) dan di bawah CSP tanpa `unsafe-eval` probe itu dilaporkan sebagai pelanggaran `script-src` walau errornya ditelan. Perbaikannya `config({ jitless: true })` di [`apps/web/src/lib/zod-config.ts`](../apps/web/src/lib/zod-config.ts), dimuat paling awal; jangan dihapus.

**Test tema** ([`theme.spec.ts`](../tests/e2e/theme.spec.ts)): `"system"` mengikuti `colorScheme` yang diemulasikan, termasuk saat emulasi berubah tanpa reload; pilihan Terang/Gelap lewat `ThemeToggle` tersimpan setelah reload dan menang atas sistem; tanpa kedip (kelas `dark` sudah terpasang sebelum bundle React dimuat, karena `theme-init.js` dimuat sinkron); `localStorage` yang melempar error atau nilai `tp-theme` tak dikenal diperlakukan sebagai sistem; `<meta name="theme-color">` mengikuti tema; pemilih tema dapat dioperasikan dengan keyboard; dan perilaku menu mobile pada viewport 375x812 (tanpa scroll horizontal).

**Test landing** ([`landing.spec.ts`](../tests/e2e/landing.spec.ts)): semua bagian tampil untuk anonim di `/` tanpa dialihkan; tombol Daftar dan Lihat demo mengarah ke `/register` dan `/p/testpulse`; link Allure/CI/Source/Strategi memiliki `href` persis dan `target="_blank"` dengan `rel` aman; badge "Segera" hanya pada fitur Tahap 2 sampai 5; pengguna yang masuk melihat "Project saya" (bukan landing); status auth memuat dan galat sesi (503) tidak merender landing dan tidak mengalihkan; logout dari `/` berakhir di `/login`; tanpa scroll horizontal di 375 px.

## 3. Risiko utama dan cakupannya

| Risiko | Dampak | Cara dicakup | Lokasi |
|---|---|---|---|
| **Kebocoran keberadaan project privat** (membedakan "privat" dari "tidak ada") | Orang luar bisa menebak slug project | Bukan anggota mendapat `404 PROJECT_NOT_FOUND` identik untuk project privat dan yang tidak ada; badan respons dibandingkan sama persis. UI menampilkan pesan yang sama | `tests/api/authorization.spec.ts`, `apps/api/test/integration/projects.int.test.ts`, `tests/e2e/projects.spec.ts`, unit `permissions.test.ts` |
| **Race condition admin terakhir** | Dua request paralel sama-sama lolos, project tanpa admin | Transaksi dengan `SELECT ... FOR UPDATE` pada membership admin. Test memaksa konkurensi: kedua request lolos pengecekan akses lebih dulu, lalu harus diserialkan; hasilnya tepat satu sukses dan satu `409 LAST_ADMIN` | `apps/api/test/integration/members.int.test.ts` (kasus "paralel terkunci"), unit `admins.test.ts` |
| **Otorisasi salah di salah satu kombinasi role x endpoint** | Eskalasi hak | Matriks otorisasi dibangkitkan dari data (6 aktor x endpoint yang terikat project, yaitu baris tabel spec bagian 7), plus urutan pengecekan (anonim selalu 401 di endpoint wajib login) | `tests/api/authorization-matrix.ts`, `tests/api/authorization.spec.ts` |
| **CSRF** | Aksi atas nama user dari situs lain | Lapis berganda: `SameSite=Lax`, wajib `Content-Type: application/json` pada body, pemeriksaan header `Origin` terhadap `APP_ORIGIN` | `apps/api/test/integration/security.int.test.ts` ("proteksi CSRF dan header") |
| **Keamanan sesi** | Pembajakan atau penyalahgunaan sesi | Token acak 32 byte, DB hanya menyimpan hash SHA-256, cookie `HttpOnly`/`SameSite`/`Secure`, sesi kedaluwarsa ditolak dan dibersihkan, logout menghapus baris sesi dan hanya sesi yang dipakai | `apps/api/test/integration/auth.int.test.ts`, unit `tokens.test.ts` |
| **Kerahasiaan token undangan** | Undangan dipakai pihak lain | Hanya hash di DB, token mentah tidak tersimpan, URL berisi token disensor dari log, undangan sekali pakai (accept serentak: tepat satu sukses) | `apps/api/test/integration/invitations.int.test.ts`, `apps/api/test/integration/logging.int.test.ts`, unit `logging.test.ts` |
| **Bypass rate limit lewat header IP palsu** | Brute force login | Kunci rate limit memakai `x-tp-client-ip` (diisi Pages Function dari `CF-Connecting-IP`) hanya jika header `x-proxy-secret` cocok (`PROXY_SECRET`, perbandingan `timingSafeEqual`); selain itu memakai IP koneksi langsung. `X-Forwarded-For` tidak pernah dibaca untuk kunci, sehingga perantara yang mengubahnya tidak berpengaruh. Secret tidak boleh masuk log | `apps/api/test/integration/security.int.test.ts`, `apps/api/src/http/client-ip.test.ts`, `apps/web/test/functions/proxy.test.ts` |
| **Enumerasi akun lewat login** | Mengetahui email terdaftar | Pesan `INVALID_CREDENTIALS` identik untuk email tak terdaftar dan password salah; scrypt tetap dijalankan terhadap hash dummy | `apps/api/test/integration/auth.int.test.ts`, `tests/api/auth.spec.ts` |
| **Header keamanan berbeda antar-lingkungan (drift)** | Production kurang terlindungi dibanding yang diuji ZAP | Test membandingkan `security-headers.conf` (nginx) dengan `_headers` (Cloudflare Pages): empat header yang sama, nilai sama persis | `apps/web/test/functions/headers.test.ts` |
| **Drift kontrak web dan API** | UI rusak diam-diam setelah perubahan API | Pact consumer menulis kontrak, provider memverifikasinya terhadap API asli dengan state yang disiapkan; keduanya berjalan di job CI yang sama | `apps/web/test/contract`, `apps/api/test/contract` |
| **Aksesibilitas** | Halaman tidak bisa dipakai pengguna pembaca layar atau keyboard, atau kontras gagal di salah satu tema | axe pada landing, halaman masuk/daftar, daftar dan buat project, ringkasan, pengaturan, serta undangan, **di tema terang dan gelap**; label terhubung di semua input | `tests/e2e`, `tests/support/a11y.ts` |
| **Tampilan melonggarkan CSP** (komponen UI menyuntikkan `<style>` atau atribut `style`) | Production kehilangan perlindungan CSP, atau halaman rusak di bawah CSP | Gate CSP di fixture E2E: test gagal bila ada pelanggaran CSP; bermakna di stack Docker/nginx (bagian 2.1) | `tests/support/csp.ts`, `tests/e2e/csp-guard.spec.ts`, [ADR 0003](./adr/0003-tailwind-shadcn.md) |

## 4. Data dan lingkungan test

- **Data:** dibuat per test lewat factory (`@faker-js/faker`, `tests/support/data.ts`) dan klien API (`tests/support/api-client.ts`). Tidak ada seed global untuk test API/E2E.
- **Isolasi E2E:** pengguna berbeda memakai browser context berbeda (admin, anggota, pengunjung anonim).
- **Lingkungan:** unit tanpa dependensi eksternal; integration dan contract memakai container Postgres sementara; API dan E2E berjalan terhadap stack Docker Compose (nginx + API + Postgres) yang sama dengan yang dipakai pengembang lokal; smoke berjalan terhadap production.
- **Rate limit pada test:** stack lokal/test memakai `RATE_LIMIT_MAX=1000` agar suite paralel tidak terkena 429; production memakai default 10 per menit. Perilaku 429 dibuktikan di integration test dengan batas 10.
- **Flaky:** CI memakai `retries: 2`; test yang lulus setelah retry ditandai flaky di laporan Allure, bukan disembunyikan.

## 5. Pelaporan dan quality gate

Setiap job CI menulis hasil ke `allure-results`; job `report` menggabungkan semuanya menjadi satu laporan Allure yang dipublikasikan ke GitHub Pages dari `main`: <https://safeqq.github.io/testpulse/>. Pipeline lengkap ada di [`ci.yml`](../.github/workflows/ci.yml) dan deploy di [`deploy.yml`](../.github/workflows/deploy.yml).

| Gate | Ambang | Ditegakkan oleh |
|---|---|---|
| Lint dan typecheck | 0 error | `pnpm lint`, `pnpm typecheck` |
| Dependensi | 0 high/critical | `pnpm audit --audit-level high` |
| Coverage domain | >= 80% (lines, branches, functions, statements) | Vitest coverage `thresholds` di `apps/api/vitest.config.ts` |
| Unit, integration, contract, API, E2E | semua lulus | job `unit`, `integration`, `contract`, `stack-tests` |
| ZAP baseline | 0 temuan High | `tests/security/check-zap-report.mjs` (dites di `check-zap-report.test.mjs`) |
| Smoke production | semua lulus setelah deploy | `deploy.yml` |

### Jumlah test (snapshot per commit `ad6b30d`, 2026-10-27)

Angka ini adalah **snapshot**: hasil menjalankan suite secara lokal pada commit tersebut, dan akan bergeser seiring pengembangan. Angka terbaru ada di laporan Allure dan run CI terakhir. Angka yang sama dicantumkan di bagian "Dibangun dengan standar QA" pada landing page (`apps/web/src/pages/landing/Quality.tsx`); perbarui keduanya bersamaan.

| Suite | Jumlah test |
|---|---|
| Unit: `packages/shared` | 30 |
| Unit: `apps/api` | 110 |
| Unit: `apps/web` (tema dan `theme-init.js` 34, Pages Function 17, paritas header 6) | 57 |
| Integration (`apps/api`, Postgres Testcontainers) | 125 |
| Contract: consumer (web) | 27 test (satu interaksi per test) |
| Contract: provider (API) | 1 test yang memverifikasi seluruh pact |
| API (Playwright, termasuk matriks otorisasi) | 156 |
| E2E (Playwright) | 77 skenario per browser, dijalankan di 3 browser (a11y-helper 1, auth 12, csp-guard 13, landing 12, projects 16, team 10, theme 13) |
| Smoke production (`@smoke`) | 4 |

## 6. Sengaja tidak diuji (dan alasannya)

| Hal | Alasan | Rencana |
|---|---|---|
| Performa dan beban | Tahap 1 tidak punya endpoint berat; angka performa dari free tier (Render cold start) tidak bermakna | k6 di tahap 2 |
| Visual regression | UI masih berubah cepat; screenshot baseline sekarang akan terus rusak tanpa nilai | Tahap 3 |
| Mutation testing | Perlu suite yang sudah stabil dan domain yang lebih besar | Tahap 4 |
| Alur email (reset password, verifikasi) | Fiturnya sengaja tidak ada di tahap 1; undangan berupa link yang disalin manual | Tidak direncanakan |
| Perilaku edge Cloudflare (cache, TLS, routing) | Tidak bisa direplikasi di CI. Yang bisa diuji (logika Pages Function, kesetaraan header) diuji sebagai unit; sisanya dicek lewat smoke test production | Smoke test |
| Pagination, ganti slug, ganti email/password, OAuth, 2FA | Di luar lingkup tahap 1 (spec bagian 4) | Tahap berikut sesuai kebutuhan |
| Pengujian penetrasi manual | ZAP baseline hanya pemindaian pasif otomatis, bukan pengganti uji penetrasi | Di luar lingkup portfolio |
| Beban pada Render/Neon free tier (cold start, batas koneksi) | Dikendalikan penyedia; didokumentasikan jujur di [deploy.md](./deploy.md) | Dicatat sebagai keterbatasan |

## 7. Keterbatasan yang diketahui

- ZAP baseline bersifat pasif; ia tidak menjalankan serangan aktif atau alur yang butuh login.
- Gate CSP hanya efektif bila E2E berjalan terhadap nginx dengan header CSP production (stack Docker dan job CI `stack-tests`); di dev server Vite ia tidak punya yang dijaga. Ia juga tidak memverifikasi header Cloudflare Pages secara langsung, melainkan mengandalkan paritas `_headers` dan `security-headers.conf` (`headers.test.ts`).
- Screenshot di `docs/images` hanya dokumentasi, bukan baseline visual regression.
- E2E berjalan di stack lokal dengan rate limit longgar, bukan di production; yang menyentuh production hanya smoke test.
- Smoke test bergantung pada satu akun khusus dan satu project publik yang didaftarkan manual (lihat [deploy.md](./deploy.md)).
