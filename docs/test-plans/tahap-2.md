# Test Plan Tahap 2: Dashboard Hasil Test & Deteksi Flaky

Rencana pengujian untuk lingkup tahap 2 (lihat [spec](../superpowers/specs/2026-10-28-testpulse-tahap2-design.md), bagian 3 sampai 12). Strategi umum dan alasan tiap lapisan ada di [TEST_STRATEGY.md](../TEST_STRATEGY.md); keputusan arsitektur di [ADR 0004](../adr/0004-ingest-sinkron-dan-definisi-flaky.md). Struktur dokumen ini mengikuti [test plan tahap 1](./tahap-1.md). Setiap skenario di bawah merujuk berkas test yang mengotomatiskannya.

Singkatan lapisan: **U** unit, **I** integration, **A** API (Playwright request), **C** contract (Pact), **E** E2E, **P** performa (k6), **S** smoke production.

## 1. Lingkup

**Diuji:**

- **Token CI**: buat, daftar, cabut, batas 10 token aktif, hash di database, `last_used_at`.
- **Upload hasil test** (`POST /projects/:slug/runs`, JUnit XML dengan token Bearer): autentikasi, validasi query, batas ukuran, parsing JUnit, penggabungan kemunculan ganda, total, reuse `test_cases`, upload paralel, retensi 200 run, rate limit per token.
- **Perhitungan flaky**: fungsi murni `flakyScore` dan paritasnya dengan query SQL.
- **API baca**: branch, daftar run (pagination cursor), detail run (filter status), statistik tren, daftar flaky, riwayat test, hapus run.
- **Reporter CLI** (`packages/reporter`): argumen, glob, penggabungan, batas ukuran, exit code, tidak membocorkan token.
- **UI**: dashboard `/p/:slug`, daftar run, detail run, daftar flaky, riwayat test, Token CI di pengaturan; dua tema, 375 px, aksesibilitas, gate CSP, akses publik dan privat.
- **Performa** stack Docker (k6) dan **dogfooding** (CI mengunggah hasilnya sendiri ke `/p/testpulse` di production).

**Tidak diuji (sengaja):** lihat [TEST_STRATEGY.md bagian 6](../TEST_STRATEGY.md#6-sengaja-tidak-diuji-dan-alasannya) dan bagian 14 spec (notifikasi, lampiran, perbandingan dua run, mute test flaky, format selain JUnit, ekspor data). Performa free tier (Render, Neon) tidak diukur.

## 2. Kriteria masuk

- Kode ter-merge ke branch kerja dan `pnpm install` berhasil; migrasi Tahap 2 (`project_tokens`, `runs`, `test_cases`, `test_results`) berjalan tanpa error.
- Docker tersedia (Testcontainers, Docker Compose, dan image k6).
- `packages/shared` ter-build (schema dan kode error baru: `RUN_NOT_FOUND`, `TEST_NOT_FOUND`, `TOKEN_NOT_FOUND`, `TOKEN_LIMIT`, `PAYLOAD_TOO_LARGE`, `INVALID_REPORT`).
- Untuk smoke dan dogfooding di production: Tahap 1 sudah live dan project publik `testpulse` ada ([deploy.md](../deploy.md), Langkah 9). Run nyata baru muncul setelah pemilik repo membuat `TESTPULSE_TOKEN` ([deploy.md](../deploy.md), Langkah 12).

## 3. Kriteria keluar

- Lint, typecheck, dan `pnpm audit --audit-level high` bersih.
- Semua test unit, integration, contract (termasuk reporter sebagai consumer kedua), API, dan E2E (3 browser) lulus di CI; test yang lulus hanya setelah retry dicatat sebagai flaky dan diselidiki.
- Coverage `src/modules/**/domain` >= 80% (parser JUnit dan `flakyScore` termasuk di dalamnya).
- Gate k6 hijau: p95 upload < 1500 ms, p95 baca < 300 ms, `http_req_failed` < 1%.
- ZAP baseline: 0 temuan High; gate CSP hijau di seluruh E2E.
- Laporan Allure terpublikasi; JUnit tiap job tersedia untuk dogfooding.
- Setelah `TESTPULSE_TOKEN` dipasang: `/p/testpulse` di production menampilkan run nyata dari CI, dan smoke dashboard lulus (bukan dilewati).
- Tidak ada cacat severity tinggi yang terbuka untuk fitur tahap 2.

## 4. Skenario per fitur

### 4.1 Token CI

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| TOK-01 | Admin membuat token | 201; nilai `tp_` + 43 karakter base64url hanya tampil sekali; database hanya menyimpan hash SHA-256; daftar tidak memuat nilainya | I, A, C | [tokens.int.test.ts](../../apps/api/test/integration/tokens.int.test.ts), [tokens.spec.ts](../../tests/api/tokens.spec.ts), [tokens.pact.test.ts](../../apps/web/test/contract/tokens.pact.test.ts) |
| TOK-02 | Nama token: kosong, lebih dari 60 karakter, bukan string | 400 `VALIDATION_ERROR` dengan `fields.name` | U, I, A | [results.test.ts](../../packages/shared/src/schemas/results.test.ts), tokens.int.test.ts, tokens.spec.ts |
| TOK-03 | Token ke-11 aktif; mencabut satu membuka slot; batas per project; pembuatan serentak | 409 `TOKEN_LIMIT`; tidak pernah lebih dari 10 token aktif | I, A, E | tokens.int.test.ts, tokens.spec.ts, [tokens.spec.ts (E2E)](../../tests/e2e/tokens.spec.ts) |
| TOK-04 | Mencabut token | 204; hilang dari daftar; upload dengannya 401; run lama tetap ada (`runs.token_id` NULL bila token dihapus); cabut ulang atau token project lain 404 `TOKEN_NOT_FOUND` | I, A, E | tokens.int.test.ts, tokens.spec.ts, tokens.spec.ts (E2E) |
| TOK-05 | Otorisasi CRUD token | Admin 2xx; viewer dan tester 403; non-anggota publik 403; non-anggota privat 404; anonim 401 | I, A | tokens.int.test.ts, [authorization-matrix.ts](../../tests/api/authorization-matrix.ts), [authorization.spec.ts](../../tests/api/authorization.spec.ts) |
| TOK-06 | Autentikasi token (`authenticateIngestToken`) dan `last_used_at` | Token valid menghasilkan project; dicabut, salah, tanpa header, atau format salah menghasilkan null; skema `Bearer` tidak peka huruf besar-kecil; `last_used_at` terisi setelah upload berhasil dan tidak setelah upload gagal | I, A | tokens.int.test.ts, [ingest.int.test.ts](../../apps/api/test/integration/ingest.int.test.ts), [results.spec.ts](../../tests/api/results.spec.ts) |
| TOK-07 | Skema database | Tabel dan indeks sesuai spec; unik `(project_id, suite, name)`, `(run_id, test_case_id)`, `token_hash`; cascade dan `SET NULL`; `CHECK` status hasil | I | tokens.int.test.ts |
| TOK-08 | UI Token CI di pengaturan project | Admin membuat token (kotak "token baru" sekali tampil, contoh curl terisi, tombol salin memberi tahu hasil clipboard), memakainya, lalu mencabutnya; nama kosong dan token ke-11 ditolak dengan pesan; tester dan viewer tidak melihat bagian ini; 375 px tanpa gulir horizontal | E | tokens.spec.ts (E2E) |

### 4.2 Upload hasil test (ingest)

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| ING-01 | Upload laporan valid | 201 `{ runId, url, totals }`; baris `runs`, `test_cases`, `test_results` benar; `commit`, `ciUrl`, `name` opsional tersimpan atau NULL; `text/xml` dan charset utf-8 diterima | I, A, C | ingest.int.test.ts, results.spec.ts, [ingest.pact.test.ts](../../packages/reporter/test/contract/ingest.pact.test.ts) |
| ING-02 | Autentikasi hanya Bearer token | Tanpa token, dicabut, format salah, tidak dikenal, atau cookie sesi admin: 401 dengan pesan identik; token project A ke slug B dan slug tidak ada: 404 `PROJECT_NOT_FOUND` yang sama; token tidak berlaku di endpoint lain | I, A | ingest.int.test.ts, results.spec.ts, authorization.spec.ts |
| ING-03 | Content-Type | `application/json` atau charset selain utf-8: 400 `VALIDATION_ERROR` (dicek pertama, juga tanpa token); `application/xml` dan `text/xml` diterima | I, A | ingest.int.test.ts, results.spec.ts |
| ING-04 | Validasi query: `branch` (wajib, 1 sampai 200, `[A-Za-z0-9._/-]`), `commit` (hex 7 sampai 40), `ciUrl` (http/https, maks. 500), `name` (maks. 120) | 400 dengan `fields` per parameter; commit dinormalkan | U, I, A | [results.test.ts](../../packages/shared/src/schemas/results.test.ts), ingest.int.test.ts, results.spec.ts |
| ING-05 | Ukuran body | Tepat 5 MB diterima; 5 MB + 1 byte: 413 `PAYLOAD_TOO_LARGE` berformat JSON dari API (di bawah batas nginx 6 MB); 20.000 testcase tersimpan, lebih dari itu 422 | I, A | ingest.int.test.ts, results.spec.ts, [junit.test.ts](../../apps/api/src/modules/results/domain/junit.test.ts) |
| ING-06 | Urutan pengecekan | Content-Type, lalu 401, 404, 400, 413, 422; token salah dengan body besar tetap 401 tanpa membaca body | I, A | ingest.int.test.ts, results.spec.ts |
| ING-07 | Laporan tidak valid | `<!DOCTYPE`, XML rusak, bukan JUnit, tanpa testcase, karakter kontrol mentah: 422 `INVALID_REPORT`, bukan 500; laporan yang ditolak tidak membuat run | U, I, A | junit.test.ts, ingest.int.test.ts, results.spec.ts |
| ING-08 | Pemakaian ulang `test_cases` dan identitas test | Upload kedua memakai ulang baris untuk test yang sama; `login` di suite A dan suite B menjadi dua test | I | ingest.int.test.ts |
| ING-09 | Upload paralel dengan test yang sama (urutan berbeda) | Semua 201, tanpa duplikat `test_cases` dan tanpa 500 | I | ingest.int.test.ts |
| ING-10 | Retensi 200 run per project, juga saat upload serentak | Tepat 200 tersisa, run terlama hilang, run baru ada | I | ingest.int.test.ts |
| ING-11 | Rate limit per token | Setelah batas (uji dengan batas 3), upload berikutnya 429; token lain di project yang sama punya jatah sendiri; di stack test respons memuat `x-ratelimit-limit` dan `x-ratelimit-remaining` yang turun | I, A | ingest.int.test.ts, results.spec.ts |
| ING-12 | Keamanan permukaan upload | Origin asing tetap 403 `FORBIDDEN` (pemeriksaan Origin tidak dilewati); pengecualian "body harus JSON" hanya untuk path ini dan Content-Type XML | I | ingest.int.test.ts, [security.int.test.ts](../../apps/api/test/integration/security.int.test.ts) |
| ING-13 | Alur upload lewat proxy (nginx) dari luar proses | 201 sesuai schema bersama; query tersimpan di run; endpoint baca mengembalikan data setelah upload | A | results.spec.ts |

### 4.3 Parser JUnit dan skor flaky

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| PAR-01 | Struktur: `<testsuites>` atau `<testsuite>` tunggal, suite bersarang; identitas `classname` atau nama suite terdekat, di-trim | Hasil sesuai spec bagian 4.1 | U | junit.test.ts |
| PAR-02 | Status, durasi, dan pesan | `failure`/`error` gagal, `skipped` dilewati; `time` detik ke milidetik; pesan dari atribut atau isi teks | U | junit.test.ts |
| PAR-03 | Kemunculan ganda digabung | Lulus dan gagal: `passed` dengan `flaky_in_run`; semua gagal: `failed`; semua skip: `skipped`; `retries`, durasi dijumlah, pesan dari kegagalan terakhir | U, I | junit.test.ts, ingest.int.test.ts |
| PAR-04 | Konvensi Surefire (`flakyFailure`, `rerunFailure`) | Lulus dengan `flaky_in_run` dan `retries` sesuai jumlah elemen | U | junit.test.ts |
| PAR-05 | Pemotongan dan encoding | Nama 500 karakter, pesan 4096 byte UTF-8 tanpa memecah karakter, encoding ditangani | U | junit.test.ts |
| PAR-06 | Penolakan | `<!DOCTYPE` (XXE, entity expansion), XML rusak, root bukan JUnit, kosong, lebih dari 20.000 testcase | U | junit.test.ts |
| FLK-01 | `flakyScore` untuk semua contoh spec bagian 6 | L L L L = 0; G G G G = 0; L G L G = 75; 9 L + 1 L-dengan-retry = 10; hanya skip = 0 | U | [flaky.test.ts](../../apps/api/src/modules/results/domain/flaky.test.ts) |
| FLK-02 | Kasus tepi: pembulatan setengah, batas 100, `n = 0` | Sesuai rumus | U | flaky.test.ts |
| FLK-03 | Paritas rumus SQL dan `flakyScore` | Pada 6 pola acak-terkendali, skor SQL sama dengan `flakyScore` atas 20 run terakhir yang memuat test | I | [results-read.int.test.ts](../../apps/api/test/integration/results-read.int.test.ts) |

### 4.4 API baca dan hapus run

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| RES-01 | Daftar run: 25 run | Halaman 1 berisi 20 terbaru dengan `nextCursor`; halaman 2 berisi 5 dan `nextCursor` null; tepat 20 run menghasilkan null; filter branch; tanpa duplikat atau terlewat bahkan untuk `created_at` kembar | I, A, C | results-read.int.test.ts, results.spec.ts, [results.pact.test.ts](../../apps/web/test/contract/results.pact.test.ts) |
| RES-02 | Cursor dan parameter tidak valid | Cursor rusak atau di luar rentang: 400 `VALIDATION_ERROR` dengan `fields.cursor`; cursor buram dan stabil | U, I, A | [cursor.test.ts](../../apps/api/src/modules/results/cursor.test.ts), results-read.int.test.ts, results.spec.ts |
| RES-03 | Detail run dan filter status | Bawaan hanya `failed`; `flaky` hanya `flaky_in_run`; `all` semua, 100 per halaman dengan cursor; run project lain, id tak dikenal, atau bukan UUID: 404 `RUN_NOT_FOUND` | I, A, C | results-read.int.test.ts, results.spec.ts, results.pact.test.ts |
| RES-04 | Statistik tren | 30 titik terbaru urut waktu dengan `passRate` (1 desimal; null bila tidak ada lulus dan gagal); tanpa `branch` memakai branch run terbaru; project atau branch tanpa run kosong | I, A, C | results-read.int.test.ts, results.spec.ts, results.pact.test.ts |
| RES-05 | Daftar flaky | Maks. 50, urut skor turun lalu nama; test gagal konsisten tidak muncul; tanpa branch memakai branch run terbaru | I, A, C | results-read.int.test.ts, results.spec.ts, results.pact.test.ts |
| RES-06 | Riwayat test | 20 hasil terbaru urut waktu per branch; test project lain atau id salah: 404 `TEST_NOT_FOUND` | I, A, C | results-read.int.test.ts, results.spec.ts, results.pact.test.ts |
| RES-07 | Daftar branch | Urut run terbaru dengan `lastRun`; branch ber-slash (`feature/x`) ikut tampil dan bisa difilter | I, A | results-read.int.test.ts, results.spec.ts |
| RES-08 | Hapus run | Tester dan admin 204 dan hasilnya ikut terhapus (cascade); viewer dan non-anggota publik 403; non-anggota privat 404; anonim 401; hapus ulang 404 `RUN_NOT_FOUND` | I, A, C | results-read.int.test.ts, results.spec.ts, results.pact.test.ts |
| RES-09 | Otorisasi baca (matriks bagian 7.1 spec) | Publik: anonim dan non-anggota 200; privat: anonim dan non-anggota 404 `PROJECT_NOT_FOUND` sebelum validasi query; viewer 200; token CI tidak diterima di endpoint baca | I, A | results-read.int.test.ts, authorization-matrix.ts, authorization.spec.ts |
| RES-10 | Project tanpa run | Endpoint baca mengembalikan daftar kosong, bukan error | I, A | results-read.int.test.ts, results.spec.ts |

### 4.5 Reporter CLI

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| REP-01 | Argumen: wajib `--url`, `--project`, `--branch`, minimal satu berkas; `TESTPULSE_TOKEN` dari env, bentuk token diperiksa | Kurang atau salah: exit 2, pesan Indonesia, tanpa upload; tidak ada flag token | U | [args.test.ts](../../packages/reporter/src/args.test.ts), [cli.test.ts](../../packages/reporter/src/cli.test.ts) |
| REP-02 | Berkas dan glob | Beberapa berkas digabung dalam satu upload, glob dan path literal digabung tanpa duplikat; glob tanpa hasil atau berkas tidak ada: exit 2 | U | cli.test.ts, [merge.test.ts](../../packages/reporter/src/merge.test.ts) |
| REP-03 | Penggabungan JUnit | Semua `<testsuite>` dari tiap dokumen masuk ke satu `<testsuites>`; `<!DOCTYPE`, XML rusak, dan `<testsuites>` bersarang ditolak sebelum upload | U | merge.test.ts, cli.test.ts |
| REP-04 | Batas ukuran 5 MB pada dokumen gabungan | Tepat 5 MB lolos; 5 MB + 1 ditolak (exit 2) sebelum upload | U | cli.test.ts |
| REP-05 | Hasil upload dan exit code | 201: exit 0 dan mencetak total dan URL run; 401 atau 422 atau jaringan gagal: exit 1 dengan pesan API; galat tak terduga: exit 1 tanpa stack | U | cli.test.ts, [upload.test.ts](../../packages/reporter/src/upload.test.ts) |
| REP-06 | Token tidak pernah bocor | Tidak tercetak (juga bila server memantulkannya atau token diketik sebagai flag); karakter kontrol dari server dibuang; peringatan untuk `http://` ke host non-lokal | U | cli.test.ts, args.test.ts |
| REP-07 | Kontrak: reporter sebagai consumer kedua untuk `POST runs` | Provider API memverifikasi pact reporter terhadap API dan Postgres asli | C | ingest.pact.test.ts, [provider.pact.test.ts](../../apps/api/test/contract/provider.pact.test.ts) |
| REP-08 | Dijalankan manual terhadap stack Docker dengan berkas JUnit lokal | Exit 0, run tampil di dashboard project | (manual, dicatat di laporan tugas) | |

### 4.6 Tampilan: dashboard, run, flaky, dan riwayat

Semua halaman di bawah lolos `expectNoA11yViolationsInBothThemes` (0 pelanggaran axe serious/critical di dua tema), tanpa gulir horizontal di 375 px, dan gate CSP (bagian 4.7 test plan tahap 1).

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| DSH-01 | Dashboard `/p/:slug` dengan run: branch `main` bawaan | Kartu status run terakhir, pass rate, jumlah test, jumlah flaky; grafik tren SVG (dengan alternatif teks); 5 run terbaru; 5 test paling flaky; tautan "Lihat semua" | E | [dashboard.spec.ts](../../tests/e2e/dashboard.spec.ts) |
| DSH-02 | Mengganti branch | Semua angka berpindah ke data branch itu | E | dashboard.spec.ts |
| DSH-03 | Tanpa run: anggota admin, tester, pengunjung publik | Anggota melihat panduan setup berisi slug dan endpoint upload; tautan Token CI hanya untuk admin; pengunjung publik melihat "Belum ada hasil test" tanpa panduan | E | dashboard.spec.ts |
| DSH-04 | Akses: anonim di project publik dengan run, dan project privat | Anonim melihat dashboard hanya-baca; project privat tampil sebagai "tidak ditemukan" yang sama untuk non-anggota dan anonim | E | dashboard.spec.ts, [runs.spec.ts](../../tests/e2e/runs.spec.ts) |
| DSH-05 | 375 px, nama branch sangat panjang | Tanpa gulir horizontal | E | dashboard.spec.ts |
| RUN-01 | Daftar run | 20 run dulu, "Muat lebih banyak" menambah sisanya lalu hilang; filter branch tersimpan di URL; keadaan kosong | E | runs.spec.ts |
| RUN-02 | Detail run | Header: branch, commit mono, tautan CI aman, durasi, total; filter bawaan Gagal; filter Flaky dan Semua; pesan di `<details>` dengan spasi putih terjaga; lebih dari 100 hasil dimuat bertahap | E | runs.spec.ts |
| RUN-03 | Hapus run | Tester menghapus lewat konfirmasi inline (bukan dialog) lalu kembali ke daftar; viewer dan anonim tidak melihat tombol hapus | E | runs.spec.ts |
| RUN-04 | Kegagalan memuat dan run tidak ada | Gagal mengunduh chunk halaman menampilkan pesan dengan tombol muat ulang (bukan layar kosong); run tidak ada: "Run tidak ditemukan" | E | runs.spec.ts |
| FLK-04 | Daftar flaky | Urut skor, bar skor, tautan ke riwayat; keadaan kosong tanpa test flaky | E | runs.spec.ts |
| FLK-05 | Riwayat test | 20 hasil terbaru dengan label teks status (bukan hanya warna), hasil flaky ditandai; riwayat dibuka untuk branch yang benar; test tidak ada: "tidak ditemukan" | E | runs.spec.ts |
| UI-13 | Akses keempat halaman | Anonim membuka keempat halaman project publik; project privat tampil "tidak ditemukan" di keempat halaman; tautan Masuk mempertahankan query tujuan | E | runs.spec.ts |
| UI-14 | Logika klien murni: format durasi dan pass rate, `withBranch`, daftar bercursor, klien API | Sesuai kontrak; hasil basi tidak menimpa hasil terbaru | U | [format.test.ts](../../apps/web/src/lib/format.test.ts), [navigation.test.ts](../../apps/web/src/lib/navigation.test.ts), [cursorList.test.ts](../../apps/web/src/lib/cursorList.test.ts), [api-client.test.ts](../../apps/web/test/unit/api-client.test.ts) |
| UI-15 | Landing: kartu dashboard "Tersedia", roadmap Tahap 2 Live dan Tahap 3 Berikutnya, badge "Segera" tinggal tiga (Tahap 3 sampai 5) | Sesuai | E | [landing.spec.ts](../../tests/e2e/landing.spec.ts) |

### 4.7 Performa (k6)

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| PRF-01 | `ingest`: 5 VU x 30 detik mengunggah laporan sekitar 500 test, token bergiliran per VU | p95 durasi < 1500 ms; tanpa 429; `http_req_failed` < 1%; `http_reqs` > 0 (gagal tertutup) | P | [ingest.js](../../tests/perf/ingest.js) |
| PRF-02 | `read`: 10 VU x 30 detik membaca `stats`, `runs`, `flaky` pada project berisi lebih dari 50 run | p95 durasi < 300 ms; `http_req_failed` < 1% | P | [read.js](../../tests/perf/read.js), [setup.mjs](../../tests/perf/setup.mjs) |

### 4.8 Dogfooding dan smoke production

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| DOG-01 | CI menulis JUnit | Vitest menulis `junit-*.xml` ke `allure-results`; Playwright menulis `junit-api.xml` dan `junit-e2e-<shard>.xml` (hanya saat `CI` diset; nama proyek browser dicantumkan di nama test, percobaan ulang ditulis sebagai `flakyFailure`/`rerunFailure`) | (CI) | [playwright.config.ts](../../tests/playwright.config.ts), [ci.yml](../../.github/workflows/ci.yml) |
| DOG-02 | Deploy mengunggah hasil CI ke `testpulse` setelah smoke lulus | Mengunduh artifact `allure-results-*` dari run CI pemicu, hanya `junit-*.xml` yang dikirim, branch `main`, commit = SHA deploy, `ciUrl` = URL run CI | (CI) | [deploy.yml](../../.github/workflows/deploy.yml) |
| DOG-03 | `TESTPULSE_TOKEN` kosong, deploy manual (tanpa run CI pemicu), unduhan atau upload gagal | Langkah dilewati atau berwarna `::warning::`; deploy tetap hijau (`continue-on-error`); token hanya lewat environment | (CI) | deploy.yml |
| DOG-04 | Reporter dijalankan terhadap stack Docker dengan JUnit hasil suite sungguhan | Exit 0 dan run tampil | (manual, dicatat di laporan tugas) | |
| SMK-01 | Smoke: dashboard `/p/testpulse` | Menampilkan minimal satu run; **dilewati dengan pesan** bila project belum punya run (sebelum dogfooding pertama); tetap dijaga gate CSP | S | [smoke.spec.ts](../../tests/smoke/smoke.spec.ts) |

### 4.9 Keamanan tambahan

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| SEC-01 | XXE dan entity expansion lewat `<!DOCTYPE` | Ditolak di parser API (422) dan di reporter (exit 2) | U, I, A | junit.test.ts, ingest.int.test.ts, results.spec.ts, cli.test.ts |
| SEC-02 | Kebocoran token | Hanya hash di database; nilai tidak ada di daftar token, log, atau keluaran reporter; header `authorization` disensor di log | I, U | tokens.int.test.ts, [logging.int.test.ts](../../apps/api/test/integration/logging.int.test.ts), cli.test.ts |
| SEC-03 | Cookie tidak berlaku di upload dan token tidak berlaku di endpoint lain | 401 untuk cookie sesi di `POST runs` (semua aktor); Bearer valid di endpoint lain diperlakukan seperti tidak login | I, A | ingest.int.test.ts, authorization.spec.ts |
| SEC-04 | Retensi dan batas ukuran sebagai pelindung penyimpanan | 200 run per project, 5 MB per upload, 20.000 testcase per laporan | I | ingest.int.test.ts |
| SEC-05 | Origin dan CSRF tetap berlaku | Upload dengan Origin asing 403 | I | ingest.int.test.ts, security.int.test.ts |
| SEC-06 | Pindai ZAP baseline | 0 temuan High terhadap stack yang sama | (CI) | job `zap` di ci.yml |

## 5. Cara menjalankan

Perintah lengkap per lapisan ada di [README](../../README.md#menjalankan-test-per-lapisan). Pipeline otomatis ada di [`ci.yml`](../../.github/workflows/ci.yml); hasil terbaru dilaporkan di <https://safeqq.github.io/testpulse/> dan, setelah dogfooding aktif, di dashboard TestPulse sendiri (`/p/testpulse`).

Tambahan untuk Tahap 2:

```bash
pnpm --filter @testpulse/reporter test:unit       # reporter CLI
pnpm test:contract                                # web dan reporter sebagai consumer, lalu provider API (butuh Docker)
node tests/perf/setup.mjs                         # data k6 (BASE_URL=http://localhost:8080), lalu jalankan skenario seperti job perf di ci.yml
```

## 6. Risiko pengujian dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Parser menerima XML berbahaya (XXE, entity expansion) | `<!DOCTYPE` ditolak sebelum parsing di API dan reporter; diuji di unit, integration, dan API |
| Skor flaky di SQL menyimpang dari fungsi murni | Test paritas pada pola acak-terkendali di integration test |
| Upload paralel menghasilkan duplikat atau 500 | Upsert `test_cases` dalam satu transaksi; test paralel di integration test dan hasil retensi serentak |
| Rate limit upload mengganggu suite paralel dan k6 | Stack test memakai `INGEST_RATE_LIMIT_MAX` tinggi (API test memeriksa header `x-ratelimit-*`); 429 dibuktikan di integration test dengan batas 3; k6 membuat beberapa token supaya tidak ada 429 |
| Test performa tidak stabil di runner CI | Threshold mengikuti spec, image k6 dipin, hanya terhadap stack Docker (bukan free tier), gagal tertutup bila tidak ada sampel |
| Dogfooding mengganggu deploy | Seluruh langkah `continue-on-error`, dilewati dengan `::warning::` tanpa token; token hanya lewat environment dan tidak pernah dicetak |
| Smoke dashboard gagal sebelum dogfooding pertama | Dilewati dengan pesan bila project belum punya run, bukan gagal |
| Hasil E2E tiga browser tergabung sebagai "retry" saat diunggah | JUnit Playwright memakai `includeProjectInTestName` sehingga tiap browser menjadi test tersendiri |
| UI dashboard melonggarkan CSP (grafik, tabel, `<details>`) | Grafik SVG buatan sendiri tanpa library, komponen shadcn dibatasi, `<select>` native; gate CSP di setiap E2E |
