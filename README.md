# TestPulse

[![CI](https://github.com/Safeqq/testpulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Safeqq/testpulse/actions/workflows/ci.yml)

**TestPulse** adalah aplikasi web untuk tim QA/dev: satu tempat untuk memantau kesehatan testing, mulai dari hasil automated test dan deteksi test flaky, project dan tim, bug tracker dan deteksi regresi antar versi, test case manual dan run manual, hingga (di tahap berikutnya) crowdtesting. Kategori produk yang serupa: TestRail, Qase, ReportPortal, Allure TestOps.

- **Tahap 1** adalah fondasinya: akun, project (privat atau publik), tim dengan role `admin`/`tester`/`viewer`, dan undangan lewat link, lengkap dengan seluruh pipeline QA di bawahnya.
- **Tahap 2** menghadirkan fitur inti: CI mengunggah hasil test (JUnit XML) dengan token CI, lalu **dashboard** menampilkan tren, riwayat run, dan **test flaky** beserta skornya. Ada reporter CLI, gate performa k6, dan **dogfooding**: hasil test TestPulse sendiri dilaporkan ke project publik `testpulse` ([lihat di production](https://testpulse-d2p.pages.dev/p/testpulse)).
- **Tahap 3** menambahkan **bug tracker** (bug manual atau dari test yang gagal, status, prioritas, assignee, label, komentar, dan riwayat) dan **deteksi regresi antar versi**: run boleh membawa `version`, dan TestPulse otomatis membandingkan versi terbaru dengan versi sebelumnya dalam satu kalimat kesimpulan. Lapisan QA baru: **visual regression** dengan Playwright. TestPulse mengirim hasil CI-nya sendiri dengan versi `0.3.0`.
- **Tahap 4** menambahkan **test case manual** (suite, case dengan langkah terstruktur, tautan ke automated test) dan **run manual** (tester mengeksekusi case per langkah, lalu melaporkan bug dari case yang gagal), yang tampil berdampingan dengan hasil CI di halaman Versi dan dashboard. Lapisan QA baru: **mutation testing** dengan StrykerJS pada kode domain (skor 100%, [laporan live](https://safeqq.github.io/testpulse/mutation/)). TestPulse menguji dirinya sendiri secara manual juga: test case manualnya ada di project publik `testpulse` dan dikirim dengan versi `0.4.0`.

| | |
|---|---|
| Laporan test (Allure, live) | <https://safeqq.github.io/testpulse/> |
| Laporan mutation testing (live) | <https://safeqq.github.io/testpulse/mutation/> (diperbarui setiap Senin lewat [mutation.yml](https://github.com/Safeqq/testpulse/actions/workflows/mutation.yml)) |
| CI (GitHub Actions) | [ci.yml](https://github.com/Safeqq/testpulse/actions/workflows/ci.yml) |
| Demo live | <https://testpulse-d2p.pages.dev> · project publik: <https://testpulse-d2p.pages.dev/p/testpulse> (API di Render free tier: request pertama setelah idle bisa ±1 menit) |
| Dokumen QA | [Strategi test](docs/TEST_STRATEGY.md) · [Test plan tahap 1](docs/test-plans/tahap-1.md) · [Test plan tahap 2](docs/test-plans/tahap-2.md) · [Test plan tahap 3](docs/test-plans/tahap-3.md) · [Test plan tahap 4](docs/test-plans/tahap-4.md) · [ADR](docs/adr/) |

## Kenapa proyek ini ada

TestPulse punya dua tujuan sekaligus:

1. **Produk yang berguna** untuk tim QA/dev.
2. **Portfolio QA/SDET**: TestPulse sendiri diuji dengan test pyramid lengkap yang berjalan otomatis di CI, dengan quality gate dan laporan publik.

Sejak tahap 2 **hasil test TestPulse dilaporkan ke TestPulse itu sendiri** (dogfooding), dan sejak tahap 3 dengan versi aplikasinya (`version` di `package.json` root, kini `0.4.0`): setelah setiap deploy, [deploy.yml](.github/workflows/deploy.yml) mengunggah JUnit dari run CI yang memicunya ke project publik `testpulse`, sehingga dashboard kualitas yang nyata bisa dilihat lewat <https://testpulse-d2p.pages.dev/p/testpulse> tanpa perlu mendaftar. Dashboard di production terisi setelah pemilik repo memasang secret `TESTPULSE_TOKEN` (langkahnya ada di [docs/deploy.md](docs/deploy.md), Langkah 12).

## Tampilan

Tampilan memakai Tailwind CSS v4 dan komponen shadcn/ui dengan dua tema: **terang** (terinspirasi gaya dashboard Cloudflare: abu muda dan aksen oranye) dan **gelap** (terinspirasi gaya Neon: hampir hitam dan aksen mint). Ini inspirasi gaya, bukan penyalinan logo atau aset merek mana pun. Tema dipilih lewat tombol di header: **Sistem** (default, mengikuti pengaturan perangkat), **Terang**, atau **Gelap**; pilihan disimpan di browser dan diterapkan sebelum halaman tampil, sehingga tidak berkedip. Semua ini berjalan di bawah CSP ketat tanpa `unsafe-inline` ([ADR 0003](docs/adr/0003-tailwind-shadcn.md)).

Pengunjung yang belum masuk melihat **landing page** di `/` (sebelumnya langsung dialihkan ke halaman masuk); pengguna yang sudah masuk melihat daftar project.

| | Terang | Gelap |
|---|---|---|
| **Landing page** (`/`) | ![Landing page, tema terang](docs/images/landing-light.png) | ![Landing page, tema gelap](docs/images/landing-dark.png) |
| **Project publik** (`/p/testpulse`), belum ada run | ![Halaman project publik tanpa run, tema terang](docs/images/project-light.png) | ![Halaman project publik tanpa run, tema gelap](docs/images/project-dark.png) |
| **Dashboard hasil test** (`/p/testpulse`, setelah run diunggah) | ![Dashboard hasil test, tema terang](docs/images/dashboard-light.png) | ![Dashboard hasil test, tema gelap](docs/images/dashboard-dark.png) |
| **Perbandingan versi** (`/p/testpulse/compare`) | ![Perbandingan versi 0.3.0 dengan 0.2.0, tema terang](docs/images/compare-light.png) | ![Perbandingan versi 0.3.0 dengan 0.2.0, tema gelap](docs/images/compare-dark.png) |
| **Daftar bug** (`/p/testpulse/bugs`) | ![Daftar bug, tema terang](docs/images/bugs-light.png) | ![Daftar bug, tema gelap](docs/images/bugs-dark.png) |
| **Versi dengan kolom Manual** (`/p/testpulse/versions`) | ![Halaman Versi dengan kolom Manual, tema terang](docs/images/versions-light.png) | ![Halaman Versi dengan kolom Manual, tema gelap](docs/images/versions-dark.png) |
| **Run manual** (`/p/testpulse/manual-runs/1`) | ![Detail run manual dengan progres, tema terang](docs/images/manual-run-light.png) | ![Detail run manual dengan progres, tema gelap](docs/images/manual-run-dark.png) |
| **Eksekusi case manual** (`/p/testpulse/manual-runs/1/cases/<id>`) | ![Halaman eksekusi case dengan saran status, tema terang](docs/images/manual-exec-light.png) | ![Halaman eksekusi case dengan saran status, tema gelap](docs/images/manual-exec-dark.png) |

Screenshot dibuat otomatis dari stack lokal (Docker Compose) oleh [`tests/scripts/screenshots.ts`](tests/scripts/screenshots.ts): `pnpm --filter @testpulse/tests screenshots` dengan `BASE_URL=http://localhost:8080`. Skrip itu membuat user, project publik, token CI, 12 run JUnit contoh (tiga berversi 0.1.0, 0.2.0, 0.3.0; dibangun dengan helper `buildJUnit`), beberapa bug, dua suite berisi delapan test case manual, dan satu run manual "Regresi 0.3.0" yang sebagian sudah dieksekusi di database lokal yang kosong; datanya buatan, bukan hasil test sungguhan.

## Fitur Tahap 2: hasil test dan deteksi flaky

1. **Admin membuat token CI** di Pengaturan project, bagian **Token CI** (nilai `tp_...` tampil sekali; database hanya menyimpan hash-nya; maksimal 10 token aktif).
2. **CI mengunggah laporan JUnit XML** dengan token itu, lewat curl atau reporter CLI.
3. **Dashboard** (`/p/:slug`) menampilkan status run terakhir, pass rate, jumlah test, jumlah flaky, tren 30 run terakhir, run terbaru, dan test paling flaky. Ada juga daftar run, detail run (filter Gagal/Flaky/Semua), daftar flaky, dan riwayat 20 hasil per test. Project publik bisa dilihat siapa saja, tanpa login.

**Flaky** ([ADR 0004](docs/adr/0004-ingest-sinkron-dan-definisi-flaky.md)): test dianggap flaky bila skornya lebih dari 0. Skor dihitung dari 20 run terakhir branch itu yang memuat test tersebut: `round(100 x (jumlah pergantian lulus/gagal + jumlah hasil yang lulus setelah retry) / jumlah hasil)`, maksimal 100. Test yang gagal terus-menerus bukan flaky.

### Mengunggah dengan curl

```bash
curl -X POST "https://testpulse-d2p.pages.dev/api/v1/projects/<slug>/runs" \
  --url-query "branch=main" --url-query "commit=<sha>" \
  --url-query "ciUrl=<url-run-ci>" --url-query "name=<nama-run>" \
  --url-query "version=1.2.0" \
  -H "Authorization: Bearer $TESTPULSE_TOKEN" \
  -H "Content-Type: application/xml" \
  --data-binary @junit.xml
# 201 {"runId":"...","url":"https://.../p/<slug>/runs/<runId>","totals":{"total":..,"passed":..,"failed":..,"skipped":..,"flaky":..}}
```

`branch` wajib (1 sampai 200 karakter `A-Za-z0-9._/-`); `commit` (hex 7 sampai 40), `ciUrl` (http/https), `name`, dan `version` (versi aplikasi yang diuji, 1 sampai 50 karakter `A-Za-z0-9._+-`; Tahap 3) opsional. Nilai query harus di-URL-encode (`ciUrl` sendiri memuat `:`, `/`, dan sering `?`/`&`; `name` bisa berspasi; `+` pada `version`, mis. `1.0.0+build.5`, menjadi `%2B`, kalau tidak server membacanya sebagai spasi dan menolaknya): `--url-query` (curl 7.87 ke atas) melakukannya otomatis; pada curl yang lebih lama, encode sendiri, mis. `ciUrl=https%3A%2F%2Fci.example.com%2Frun%2F42`. Batas: body 5 MB, 20.000 testcase per laporan, 60 unggahan per jam per token, dan 200 run terbaru per project disimpan. Hanya token Bearer yang diterima di endpoint ini (cookie sesi tidak), dan laporan dengan `<!DOCTYPE` ditolak.

### Mengunggah dengan reporter CLI

[`packages/reporter`](packages/reporter) menggabungkan beberapa file JUnit (path atau glob) menjadi satu laporan, memeriksa ukurannya, lalu mengunggahnya. Token dibaca dari environment `TESTPULSE_TOKEN` (tidak ada flag token) dan tidak pernah dicetak. Exit code: `0` berhasil, `1` unggah gagal, `2` argumen atau berkas salah (termasuk argumen yang ditolak server dengan `400 VALIDATION_ERROR`; pesan server dicetak).

```bash
pnpm --filter @testpulse/reporter build
read -rs TESTPULSE_TOKEN && export TESTPULSE_TOKEN   # ketik atau tempel token: tidak tampil dan tidak masuk riwayat shell
node packages/reporter/dist/cli.js \
  --url https://testpulse-d2p.pages.dev --project <slug> --branch main \
  --commit "$(git rev-parse HEAD)" --ci-url "$RUN_URL" --name "CI #42" \
  --app-version "$(node -p "require('./package.json').version")" \
  'allure-results/junit-*.xml'
# Laporan terkirim (N berkas): 1171 test, 1170 lulus, 0 gagal, 1 dilewati, 0 flaky
```

Di PowerShell: `$env:TESTPULSE_TOKEN = Read-Host "Token CI"`, lalu jalankan `node packages/reporter/dist/cli.js ...` dalam satu baris. Jangan menaruh token langsung di baris perintah.

`--app-version` (bukan `--version`, yang lazim berarti versi tool) mengirim versi aplikasi yang diuji dan divalidasi sama dengan server (exit `2` bila salah). Dogfooding memakai perintah yang sama di [deploy.yml](.github/workflows/deploy.yml), dengan versi dari `package.json` root yang dinaikkan setiap rilis tahap.

## Fitur Tahap 3: bug tracker dan perbandingan versi

**Bug tracker** (`/p/:slug/bugs`; tester dan admin menulis, semua anggota dan pengunjung project publik membaca):

- Bug dibuat manual atau dari test yang gagal lewat tombol **Laporkan bug** (judul, deskripsi, severity, serta tautan ke test dan run terisi otomatis) di detail run, perbandingan, dan riwayat test. Test yang punya bug aktif menampilkan badge **Bug #12 · Open** di halaman hasil test.
- Status tetap `open` → `in_progress` → `resolved` → `closed` (plus buka ulang) dengan resolusi (`fixed`, `wont_fix`, `duplicate`, `cannot_reproduce`), prioritas, severity, assignee, label, link, komentar Markdown, dan riwayat perubahan. Edit bersamaan dijaga (`409 BUG_CONFLICT`); status bug tidak pernah berubah otomatis.
- Markdown aman: HTML mentah tidak dirender, tautan hanya `http`, `https`, `mailto`, dan gambar tampil sebagai tautan, sehingga CSP tidak dilonggarkan ([ADR 0005](docs/adr/0005-perbandingan-versi-dan-markdown-aman.md)).

**Versi dan perbandingan** (`/p/:slug/versions`, `/p/:slug/compare`):

- Run yang diunggah dengan `version` diurutkan per branch (semver bila semua semver, selain itu menurut waktu). Dashboard menampilkan kartu "**v0.3.0 vs v0.2.0**" dengan kalimat kesimpulan, mis. "⚠ v0.3.0 punya **2 regresi baru** dibanding v0.2.0, sementara 1 test yang dulu gagal kini lulus. Periksa sebelum rilis.", dan detail run punya panel yang sama.
- Halaman perbandingan mengelompokkan test menjadi **regresi baru**, **diperbaiki**, **masih gagal**, **lebih lambat** (lebih dari 1,5 kali dan lebih dari 1 detik), **test baru**, dan **test hilang**, dengan pilihan base dan target, dan tombol Laporkan bug di tiap baris. Halaman Versi memuat pass rate dan perubahannya per versi.
- Navigasi project berupa tab: Ringkasan, Run, Versi, Bug, Flaky, dan Pengaturan (anggota).

## Fitur Tahap 4: test case manual dan run manual

**Test case** (tab **Test manual**, `/p/:slug/cases`; tester dan admin menulis, semua anggota dan pengunjung project publik membaca):

- Suite satu tingkat (nama unik tanpa peka huruf besar/kecil, urutan bisa diubah, hanya suite kosong yang bisa dihapus) berisi case bernomor `TC-<n>`: judul, prasyarat dan langkah (**aksi** dan **hasil yang diharapkan**, 1 sampai 50, urutan bisa diubah, Markdown aman), prioritas, dan label. Case bisa diarsipkan dan dipulihkan; edit bersamaan dijaga (`409 CASE_CONFLICT`).
- Case bisa **ditautkan ke automated test** Tahap 2 (cari lewat nama atau suite). Meter **cakupan otomasi** menunjukkan berapa case aktif yang sudah punya padanan otomatis ("12 dari 40 case aktif sudah diotomasi, 30%").

**Run manual** (`/p/:slug/manual-runs`):

- Buat run (`TR-<n>`, dengan versi aplikasi opsional) dari suite dan/atau case satuan. TestPulse **menyalin** isi case ke run (snapshot), sehingga mengedit atau menghapus case tidak mengubah catatan run yang sudah dijalankan ([ADR 0006](docs/adr/0006-run-manual-snapshot-dan-mutation-testing.md)).
- Halaman eksekusi: hasil **per langkah** (lulus, gagal, diblokir, dilewati) dengan catatan, lalu status case. TestPulse menyarankan status dari hasil langkah, tetapi tidak pernah menyimpannya otomatis; **Simpan & lanjut** membawa ke case belum dites berikutnya. Dua tester di case berbeda tidak saling bentrok.
- Run bisa **diselesaikan** (hanya-baca) dan **dibuka ulang**. Case yang gagal bisa langsung **dilaporkan sebagai bug** dengan isian awal dari snapshot (langkah gagal, catatan, versi, run); detail bug menaut balik ke halaman eksekusinya.

**Terpadu dengan Tahap 2 dan 3:** halaman **Versi** menampilkan kolom **Manual** di samping pass rate otomatis (run manual berversi `v0.4.0` dan run CI `0.4.0` jadi satu baris; versi yang hanya punya run manual tetap tampil), dan dashboard punya kartu "Test manual" dengan run terbaru dan cakupan otomasi.

**Mutation testing:** StrykerJS memutasi kode domain `apps/api` dan `packages/shared` dan menuntut test unit gagal bila aturannya diubah. Skor awal 80,31% (api) dan 90,63% (shared) diperkuat menjadi 100% di keduanya, dengan 29 mutan yang dikecualikan lewat komentar beralasan: 23 benar-benar setara dengan kode asli dan 6 saudara yang terbunuh pada ekspresi yang sama, yang disebut di komentar itu ([TEST_STRATEGY.md](docs/TEST_STRATEGY.md#mutation-testing-tahap-4)). Gate `break: 80`; berjalan setiap Senin dan lewat `workflow_dispatch`, laporannya di <https://safeqq.github.io/testpulse/mutation/>.

### Dogfooding: test manual TestPulse sendiri

[`scripts/seed-dogfood-manual.mjs`](scripts/seed-dogfood-manual.mjs) membuat 5 suite dan 12 test case manual milik TestPulse (autentikasi, upload hasil, bug tracker, perbandingan versi, test manual), sebagian ditautkan ke automated test yang setara. Skrip login lewat API dengan email dan password yang **Anda isi sendiri** di shell (tidak pernah ditulis di berkas, tidak dicetak), dan idempoten: judul suite dan case yang sudah ada tidak dibuat ulang.

```bash
read -rs TP_PASSWORD && export TP_PASSWORD          # ketik password: tidak tampil dan tidak masuk riwayat shell
export TP_EMAIL=anda@contoh.com                     # akun tester atau admin di project testpulse
node scripts/seed-dogfood-manual.mjs                # TP_BASE_URL (default production), TP_SLUG (default testpulse)
```

Di PowerShell: `$env:TP_EMAIL = "..."; $env:TP_PASSWORD = Read-Host "Password"`, lalu `node scripts/seed-dogfood-manual.mjs`. Jalankan skrip **setelah** halaman Versi `/p/testpulse` menampilkan baris CI `0.4.0`: tautan ke automated test dicari lewat `GET /tests?q=`, jadi sebelum run CI itu ada case dibuat tanpa tautan (menjalankan skrip lagi setelahnya menautkan case aktif yang belum tertaut, tanpa membuat case ganda). Skrip mencetak origin tujuan sebelum login, menolak `TP_BASE_URL` non-https kecuali host lokal, dan tidak mengikuti redirect. Setelah deploy `0.4.0`, buat run "Regresi 0.4.0" di UI dan eksekusi semua case-nya sendiri; skrip tidak pernah mengisi hasil. Langkah di production ada di [docs/deploy.md](docs/deploy.md).

## Highlights untuk recruiter

- **Matriks otorisasi dibangkitkan dari data.** [`authorization-matrix.ts`](tests/api/authorization-matrix.ts) mendefinisikan 6 aktor x endpoint yang terikat project (baris tabel spec bagian 7), dan [`authorization.spec.ts`](tests/api/authorization.spec.ts) menghasilkan satu test per kombinasi. Menambah role atau endpoint berarti menambah baris data.
- **Race condition dibuktikan, bukan diasumsikan.** Aturan "minimal satu admin" dijaga dengan `SELECT ... FOR UPDATE`; [test integrasi](apps/api/test/integration/members.int.test.ts) memaksa dua request paralel lolos pengecekan akses lebih dulu lalu memastikan hasilnya tepat satu sukses dan satu `409 LAST_ADMIN`.
- **Tidak membocorkan keberadaan project privat.** Project privat dan yang tidak ada menghasilkan `404` yang identik (badan respons dibandingkan sama persis).
- **Contract test web dan API** dengan Pact: consumer menulis kontrak, provider memverifikasinya terhadap API dan Postgres asli.
- **Integration test memakai Postgres asli** lewat Testcontainers, bukan mock.
- **Keamanan sebagai gate**: OWASP ZAP baseline (gagal jika ada temuan High), `pnpm audit`, Dependabot, serta test untuk CSRF, rate limit, hash token sesi/undangan, dan penyensoran token di log.
- **Rate limit tahan header IP palsu**: IP klien (header `x-tp-client-ip` dari Pages Function) hanya dipercaya jika header rahasia bersama (`PROXY_SECRET`) cocok; `X-Forwarded-For` tidak dipakai untuk kunci.
- **Paritas header keamanan** nginx (lokal) dan Cloudflare Pages (production) dijaga oleh test, agar yang dipindai ZAP sama dengan yang di-deploy.
- **E2E di 3 browser** (Chromium, Firefox, WebKit) dengan Page Object Model, custom fixtures, pengguna di context terpisah, dan pemeriksaan aksesibilitas axe di **tema terang dan gelap** pada landing, halaman masuk/daftar, daftar dan buat project, ringkasan, pengaturan, serta undangan.
- **Gate CSP di E2E**: setiap test gagal bila ada pelanggaran Content Security Policy (event dan console, gagal tertutup), sehingga tampilan baru terbukti tidak melonggarkan CSP production.
- **CI penuh dengan Allure**: lint, typecheck, unit + coverage gate, integration, contract, API + E2E (sharding), ZAP, laporan gabungan di GitHub Pages; deploy otomatis (menunggu revisi API baru aktif, lalu deploy web) diikuti smoke test production.
- **Dogfooding.** TestPulse memantau kualitas dirinya sendiri: JUnit dari CI diunggah ke project publik `testpulse` di production setelah smoke lulus, tanpa menggagalkan deploy bila token tidak ada ([ADR 0004](docs/adr/0004-ingest-sinkron-dan-definisi-flaky.md), [test plan tahap 2](docs/test-plans/tahap-2.md), dan sejak tahap 3 berversi).
- **Rumus flaky dibuktikan dua kali.** Skor dihitung sebagai fungsi murni dan sebagai query SQL; integration test dengan Postgres asli menuntut keduanya identik pada pola hasil acak-terkendali.
- **Ingest yang aman dan berbatas.** Token CI di-hash dan hanya berlaku untuk upload, parser menolak `<!DOCTYPE` (XXE), batas ukuran/jumlah/laju/retensi diuji, dan upload paralel tidak menghasilkan duplikat.
- **Reporter CLI sebagai consumer kontrak kedua** (Pact) dan **gate performa k6** (p95 upload < 1500 ms, p95 baca < 300 ms; baca mencakup bug, versi, dan perbandingan) di CI.
- **Bug tracker yang tahan race condition.** Nomor bug berurutan walau 20 bug dibuat paralel, dua penyunting yang bentrok menghasilkan tepat satu `409 BUG_CONFLICT`, dan setiap perubahan menulis riwayatnya dalam transaksi yang sama (dibuktikan di Postgres asli).
- **Deteksi regresi antar versi** dengan aturan tegas dan diuji tepat di batas (urutan semver, pre-release, pembanding default, ambang "lebih lambat" 1,5x dan 1000 ms) serta kalimat kesimpulan yang jelas; keputusannya dicatat di [ADR 0005](docs/adr/0005-perbandingan-versi-dan-markdown-aman.md).
- **Markdown pengguna tanpa melonggarkan CSP**: HTML mentah, `javascript:`, dan gambar eksternal tampil inert, dibuktikan E2E di bawah gate CSP.
- **Visual regression** Playwright di container resmi (render sama di lokal dan CI), dengan toleransi ketat yang dibuktikan bisa gagal; **gate k6** kini juga mencakup daftar bug, versi, dan perbandingan pada 55 run berversi dan 120 bug.
- **Mutation testing** (StrykerJS) pada kode domain dengan gate 80 dan hasil 100%: skor awal 80,31% dan 90,63% menunjukkan test yang lemah (pesan galat, batas "lebih lambat", parser JUnit) yang lalu diperkuat; 29 mutan dikecualikan lewat komentar beralasan (23 setara dengan kode asli, 6 saudaranya yang terbunuh pada ekspresi yang sama), dan laporannya publik. Pilihan runner dan jebakan skor palsu (timeout, mutan statis) dicatat di [ADR 0006](docs/adr/0006-run-manual-snapshot-dan-mutation-testing.md).
- **Run manual sebagai catatan yang tahan waktu.** Snapshot membuat edit atau hapus case tidak mengubah run lama; hasil tidak bisa tersimpan setelah run diselesaikan (dibuktikan paralel di Postgres asli), dan saran status tidak pernah menjadi status tanpa pilihan tester.
- **Dogfooding manual**: test case manual TestPulse sendiri ada di project publiknya, dibuat dengan skrip idempoten yang diverifikasi dua kali terhadap stack lokal.
- **Dokumentasi QA nyata**: strategi test (termasuk apa yang sengaja tidak diuji), test plan dengan rujukan ke test, dan ADR.

## Roadmap

| Tahap | Isi | Status |
|---|---|---|
| **1** | Fondasi: akun, project, tim dan role, undangan, seluruh pipeline QA | ✅ Selesai dan live (status CI: lihat badge di atas) |
| **2** | Dashboard hasil test, deteksi flaky, reporter CLI, token CI, dogfooding, test performa (k6) | ✅ Selesai dan live (dashboard production terisi setelah `TESTPULSE_TOKEN` dipasang) |
| **3** | Bug tracker (bug dari test yang gagal), deteksi regresi antar versi, visual regression, k6 untuk bug dan perbandingan | ✅ Selesai; setelah deploy, `/p/testpulse` menampilkan run berversi `0.3.0` |
| **4** | Test case management dan test run manual (snapshot, eksekusi per langkah, bug dari case gagal), kolom Manual di halaman Versi, mutation testing (StrykerJS) | ✅ Selesai; setelah deploy, `/p/testpulse` berisi test case manual TestPulse dan run berversi `0.4.0` |
| 5 | Crowdtesting: test cycle publik, crowd tester mengirim bug, triase, reputasi dan leaderboard (aplikasi berupa link, tanpa pembayaran) | Direncanakan |
| 6 (opsional) | Aplikasi desktop Electron (notifikasi build gagal, tray) yang diuji dengan Playwright | Opsional |

Setiap tahap melewati siklus spec, rencana implementasi, lalu implementasi. Spec: [tahap 1](docs/superpowers/specs/2026-10-23-testpulse-tahap1-design.md), [tahap 2](docs/superpowers/specs/2026-10-28-testpulse-tahap2-design.md), [tahap 3](docs/superpowers/specs/2026-11-04-testpulse-tahap3-design.md), [tahap 4](docs/superpowers/specs/2026-11-08-testpulse-tahap4-design.md).

## Arsitektur

Modular monolith: satu API Fastify + PostgreSQL, SPA React, dan paket bersama untuk schema. Alasannya ada di [ADR 0001](docs/adr/0001-modular-monolith.md); model sesi di [ADR 0002](docs/adr/0002-cookie-session.md); pilihan Tailwind + shadcn dan kendala CSP di [ADR 0003](docs/adr/0003-tailwind-shadcn.md); ingest sinkron dan definisi flaky di [ADR 0004](docs/adr/0004-ingest-sinkron-dan-definisi-flaky.md); urutan versi, definisi regresi, dan Markdown aman di [ADR 0005](docs/adr/0005-perbandingan-versi-dan-markdown-aman.md); run manual (snapshot, JSONB, saran status, versi manual-saja) dan mutation testing di [ADR 0006](docs/adr/0006-run-manual-snapshot-dan-mutation-testing.md).

```mermaid
flowchart LR
  B[Browser] -->|"/ (statis)"| W["Web: React + Vite SPA"]
  B -->|"/api/*"| P["Proxy satu-origin<br/>nginx (lokal) / Pages Function (production)"]
  P --> A["API: Fastify + TypeScript"]
  A --> D[("PostgreSQL")]
  S["packages/shared<br/>schema Zod, tipe, kode error"] -. dipakai .-> W
  S -. dipakai .-> A
```

| Bagian | Teknologi | Production |
|---|---|---|
| API | Fastify, Drizzle ORM, Zod | Render (Docker, free tier; ada cold start sekitar 30 sampai 60 detik setelah idle) |
| Web | React, Vite, React Router, Tailwind CSS v4, shadcn/ui | Cloudflare Pages (+ Pages Function untuk `/api/*`) |
| Database | PostgreSQL | Neon (free) |

Browser hanya melihat satu origin sehingga cookie sesi `HttpOnly` aman dan first-party.

## Pipeline kualitas

Seluruh lapisan berjalan otomatis di [CI](.github/workflows/ci.yml); detail dan alasan tiap lapisan ada di [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md).

| Lapisan | Tool | Lokasi |
|---|---|---|
| Unit (coverage domain >= 80%) | Vitest | `packages/shared/src`, `apps/api/src`, `apps/web/src`, `packages/reporter/src` |
| Integration (Postgres asli) | Vitest + Testcontainers | `apps/api/test/integration` |
| API + matriks otorisasi | Playwright `request` | `tests/api` |
| Contract (web dan reporter sebagai consumer) | Pact JS | `apps/web/test/contract`, `packages/reporter/test/contract`, `apps/api/test/contract` |
| E2E (3 browser) + aksesibilitas dua tema + gate CSP | Playwright (POM) + axe | `tests/e2e`, `tests/pages`, `tests/support` |
| Proxy dan paritas header | Vitest | `apps/web/test/functions` |
| Visual regression (8 halaman, dua tema, desktop dan HP) | Playwright `toHaveScreenshot()` di container resmi | `tests/visual`, `scripts/visual.sh` |
| Performa (gate p95 upload dan baca, termasuk bug, versi, perbandingan, case, dan run manual) | k6 | `tests/perf` |
| Mutation testing (domain, skor >= 80, mingguan) | StrykerJS | `apps/api/stryker.config.mjs`, `packages/shared/stryker.config.mjs`, `.github/workflows/mutation.yml` |
| Security (0 temuan High) | OWASP ZAP, `pnpm audit`, Dependabot | `tests/security`, `.github/` |
| Smoke production (`@smoke`, read-only; termasuk dashboard `/p/testpulse`) | Playwright | `tests/smoke` |

Jumlah test per lapisan (snapshot per commit `178610a`, 2026-11-14; bisa bergeser) ada di [TEST_STRATEGY.md](docs/TEST_STRATEGY.md#jumlah-test-snapshot-per-commit-178610a-2026-11-14).

## Menjalankan secara lokal

Prasyarat: Node.js 24 (lihat `.nvmrc`), [pnpm](https://pnpm.io) 10, dan Docker (untuk Compose, Testcontainers, dan ZAP).

```bash
pnpm install
```

**Opsi A: seluruh stack dengan Docker Compose** (Postgres + API + web via nginx):

```bash
docker compose up -d --build --wait
# buka http://localhost:8080  (ganti port dengan WEB_PORT=9090)
docker compose down        # tambahkan -v untuk menghapus data
```

**Opsi B: mode pengembangan** (hot reload). Butuh Postgres di `localhost:5432` dengan kredensial yang sama seperti `.env.example` (Compose sengaja tidak membuka port Postgres ke host).

```bash
docker run -d --name tp-pg -e POSTGRES_USER=testpulse -e POSTGRES_PASSWORD=testpulse -e POSTGRES_DB=testpulse -p 5432:5432 postgres:17-alpine
cp .env.example .env
pnpm dev
# web: http://localhost:5173  ·  API: http://localhost:3000/api/health
```

Jika port 5432 sudah terpakai (misalnya Postgres bawaan mesin), petakan port lain (`-p 5433:5432`) dan ubah `DATABASE_URL` di `.env` ke `localhost:5433`. Migrasi berjalan otomatis saat API menyala.

Variabel lingkungan API: `DATABASE_URL`, `APP_ORIGIN`, `COOKIE_SECURE`, `PORT`, `RATE_LIMIT_MAX` dan `INGEST_RATE_LIMIT_MAX` (batas upload per jam per token, default 60; lihat [.env.example](.env.example)), serta `PROXY_SECRET` (opsional, hanya production). Cloudflare Pages Function memakai `API_ORIGIN` dan `PROXY_SECRET`. Penjelasan production ada di [docs/deploy.md](docs/deploy.md). Tidak ada secret di repo.

## Menjalankan test per lapisan

```bash
pnpm lint && pnpm typecheck                      # lint dan typecheck

pnpm test:unit                                   # unit: shared, api, web (proxy + paritas header), reporter, dan helper tests/
pnpm --filter @testpulse/api exec vitest run --project unit --coverage   # unit API + gate coverage domain

pnpm test:int                                    # integration (butuh Docker untuk Testcontainers)
pnpm test:contract                               # contract: consumer (web, reporter) lalu provider (API); butuh Docker
pnpm test:visual                                 # visual regression di container Playwright (butuh Docker dan stack Compose hidup); :update bila perubahan disengaja
pnpm test:mutation                               # mutation testing (StrykerJS) shared lalu api; api sekitar 21 menit; gagal bila skor < 80
```

Test API dan E2E berjalan terhadap stack yang sudah hidup. Cara paling mirip CI: jalankan Compose (Opsi A), lalu arahkan `BASE_URL` ke sana.

```bash
docker compose up -d --build --wait
pnpm --filter @testpulse/tests exec playwright install chromium firefox webkit   # sekali saja

export BASE_URL=http://localhost:8080            # PowerShell: $env:BASE_URL = "http://localhost:8080"
pnpm --filter @testpulse/tests test:api          # API test + matriks otorisasi
pnpm --filter @testpulse/tests test:e2e          # E2E semua browser + axe
pnpm --filter @testpulse/tests exec playwright test --project e2e-chromium   # satu browser
pnpm --filter @testpulse/tests test:security     # unit test untuk gate ZAP
```

Tanpa `BASE_URL`, Playwright menyalakan `pnpm dev` sendiri (butuh Postgres seperti Opsi B, termasuk perintah `docker run` di atas).

**Performa (k6)**, terhadap stack Compose yang hidup (sama dengan job `perf` di [ci.yml](.github/workflows/ci.yml); image `grafana/k6` dijalankan di jaringan Compose):

```bash
BASE_URL=http://localhost:8080 node tests/perf/setup.mjs      # user, project, token, 55 run berversi, 120 bug, 12 suite dengan 240 case manual, dan satu run manual 200 case (state di tests/perf/.state, tidak masuk git)
mkdir -p perf-results
docker run --rm --network testpulse_default -v "$PWD/tests/perf:/scripts:ro" -v "$PWD/perf-results:/results" \
  grafana/k6:1.3.0 run /scripts/ingest.js -e BASE_URL=http://web:8080 --summary-export /results/ingest-summary.json
# ganti ingest.js dengan read.js untuk skenario baca (stats, runs, flaky, bugs, compare, compare?groups=none, versions, cases, manual-runs/:number, manual-runs/:number/cases)
```

**OWASP ZAP baseline** (terhadap stack Compose yang hidup; sama dengan job `zap` di [ci.yml](.github/workflows/ci.yml)):

```bash
mkdir -p zap && chmod 777 zap
docker run --rm --network testpulse_default -v "$PWD/zap:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://web:8080 -J report.json -r report.html -I
node tests/security/check-zap-report.mjs zap/report.json   # gagal jika ada temuan High
```

**Smoke production** (hanya membaca; butuh akun smoke di production, lihat [docs/deploy.md](docs/deploy.md)):

```bash
BASE_URL=https://<url-production> SMOKE_EMAIL=... SMOKE_PASSWORD=... SMOKE_PUBLIC_SLUG=... \
  pnpm --filter @testpulse/tests exec playwright test --project smoke
```

## Struktur proyek

```
apps/
  api/            Fastify + Drizzle; src/modules/{auth,projects,invitations,tokens,results,bugs,manual}, test/{integration,contract}
  web/            React + Vite SPA; functions/ (Cloudflare Pages Function), test/{contract,functions}
packages/
  shared/         Schema Zod, tipe, enum role, kode error
  reporter/       CLI testpulse-report: menggabungkan dan mengunggah laporan JUnit
tests/
  api/            Playwright request + matriks otorisasi
  e2e/ pages/     Playwright E2E dan Page Object Model
  visual/         Regresi visual (screenshot, baseline di __screenshots__); jalankan lewat pnpm test:visual (Docker)
  smoke/          Smoke test production (@smoke)
  perf/           Skenario k6 (ingest, read) dan penyiapan datanya (termasuk data manual)
  security/       Gate hasil ZAP
  support/        Fixtures, klien API, factory data, helper axe, gate CSP
  scripts/        Skrip bantu (screenshot dokumentasi), bukan test
docs/
  TEST_STRATEGY.md   test-plans/   adr/   images/ (screenshot)   deploy.md   superpowers/ (spec dan rencana)
.github/          Workflow CI dan deploy, Dependabot
scripts/          visual.sh: regresi visual di container Playwright resmi; seed-dogfood-manual.mjs: test case manual TestPulse sendiri
docker-compose.yml  render.yaml
```

## Deploy

Production memakai layanan gratis (Neon, Render, Cloudflare Pages) dan di-deploy otomatis oleh [deploy.yml](.github/workflows/deploy.yml) setelah CI hijau di `main`, diikuti smoke test. Setup satu kali ada di [docs/deploy.md](docs/deploy.md). Status saat ini: **live** di <https://testpulse-d2p.pages.dev>; smoke test production hijau setelah setiap deploy. Dogfooding (unggah hasil CI ke `/p/testpulse`) aktif setelah secret opsional `TESTPULSE_TOKEN` dipasang oleh pemilik repo.

## Keterbatasan yang diketahui

- Render free tier tidur saat idle; request pertama bisa lambat sekitar 30 sampai 60 detik.
- Tahap 1 sengaja tidak memuat reset password, verifikasi email, dan OAuth/2FA. Tahap 2 hanya menerima JUnit XML dan tidak memuat notifikasi, lampiran test, atau mute test flaky; hanya 200 run terbaru per project yang disimpan. Tahap 3 tidak memuat notifikasi email, mention, lampiran bug (hanya link), integrasi GitHub Issues, atau perubahan status bug otomatis. Tahap 4 tidak memuat suite bertingkat, langkah bersama, case berparameter, riwayat versi case, impor/ekspor (CSV, TestRail), lampiran hasil, kloning atau penjadwalan run, atau perubahan status case otomatis dari hasil CI.
- Unggahan diproses sinkron (ADR 0004): laporan sangat besar (mendekati 5 MB) memegang request lebih lama, terutama setelah cold start Render.
- Mutation testing hanya mencakup kode domain `apps/api` dan `packages/shared`, berjalan mingguan (bukan per push), dan laporan di Pages berasal dari run sukses terakhir; di `apps/api` ia memakai runner `command` sehingga satu run penuh sekitar 21 menit.
- Hal yang sengaja tidak diuji (performa free tier, mutation testing untuk web dan reporter, dan lainnya) beserta alasannya: [TEST_STRATEGY.md bagian 6](docs/TEST_STRATEGY.md#6-sengaja-tidak-diuji-dan-alasannya).
