# Test Plan Tahap 5: Crowdtesting

Rencana pengujian untuk lingkup tahap 5 (lihat [spec](../superpowers/specs/2026-11-16-testpulse-tahap5-design.md), bagian 3 sampai 14). Strategi umum dan alasan tiap lapisan ada di [TEST_STRATEGY.md](../TEST_STRATEGY.md); keputusan arsitektur di [ADR 0007](../adr/0007-crowdtesting-visibilitas-privasi-dan-anti-spam.md).

Singkatan lapisan: **U** unit, **I** integration, **A** API (Playwright request), **C** contract (Pact), **E** E2E, **V** visual regression, **P** performa (k6), **Z** ZAP, **M** mutation testing, **S** smoke production.

## 1. Lingkup

**Diuji:**

- **Cycle**: buat (selalu draf), ubah isi di status apa pun, buka, tutup, buka ulang, status efektif (`endsAt` lewat = selesai), hapus hanya tanpa laporan; nomor `CY-<n>`; konflik `409 CYCLE_CONFLICT`; visibilitas draf (404 bagi selain anggota) dan cycle publik di project privat (`project.slug = null`).
- **Peserta**: bergabung terbuka dengan persetujuan aturan, bergabung ulang idempoten, keluar, dikeluarkan (dengan alasan) dan tidak bisa kembali, anggota project tidak bisa bergabung.
- **Laporan**: kirim, ubah, tarik (hanya `submitted`), nomor `CR-<n>`, konflik `409 REPORT_CONFLICT`, anti-spam (10 menunggu, 50 per cycle, 30 per 24 jam, rate limit per IP), cycle ditutup saat form terbuka.
- **Triase**: terima (severity final dan prioritas, bug Tahap 3 berlabel `crowd` dibuat dalam transaksi yang sama, tepat satu bug saat paralel), tolak (alasan, catatan wajib untuk "Lainnya"), duplikat (hanya kandidat sah), kembalikan, sembunyikan dari masalah diketahui, "Simpan & berikutnya".
- **Komentar**: satu thread pelapor dan tim, Markdown aman, hapus milik sendiri (soft delete).
- **Reputasi**: poin 1/3/5/8, tingkat penerimaan (`null` bila belum ada keputusan), leaderboard per cycle dan global (urutan dan tie-break, cache 30 detik, posisi saya), profil tester.
- **Privasi dan keamanan**: tidak ada email di respons crowd mana pun, laporan orang lain 404, Markdown crowd yang meniru UI tim inert di triase, bug, dan laporan saya; deskripsi bug dengan metadata sebagai code span.
- **Integrasi**: tab Crowd di project, asal bug (`crowdOrigin`), kartu "Crowdtesting" di dashboard (juga tanpa run CI), menu Crowdtesting di header, landing.
- **Visual regression** (empat halaman crowd), **performa** (k6 baca: direktori, cycle, masalah diketahui, leaderboard global), **ZAP** (tiga halaman crowd), dan **dogfooding** (skrip seed, versi `0.5.0`).

**Tidak diuji (sengaja):** lihat [TEST_STRATEGY.md bagian 6](../TEST_STRATEGY.md#6-sengaja-tidak-diuji-dan-alasannya) dan bagian 16 spec (pembayaran dan hadiah, upload berkas, undangan privat, persetujuan peserta, notifikasi email, banding triase, moderasi otomatis, leaderboard per periode, profil yang bisa diedit). Tidak ada baseline visual untuk keadaan kosong atau galat halaman crowd.

## 2. Kriteria masuk

- Kode ter-merge ke branch kerja dan `pnpm install` berhasil; migrasi 0007 (delapan tabel `crowd_*`, kolom `projects.cycle_seq`, `projects.crowd_report_seq`, dan `bugs.crowd_report_id` dengan indeks `bugs_crowd_report_idx`) berjalan tanpa error di atas data Tahap 4.
- Docker tersedia (Testcontainers, Docker Compose, container Playwright untuk visual regression, image k6 dan ZAP).
- `packages/shared` ter-build (schema crowd, helper Markdown aman yang dipindah dari web, dan sepuluh kode error baru: `CYCLE_NOT_FOUND`, `CYCLE_NOT_OPEN`, `CYCLE_HAS_REPORTS`, `CYCLE_CONFLICT`, `MEMBER_CANNOT_JOIN`, `NOT_PARTICIPANT`, `PARTICIPANT_REMOVED`, `REPORT_NOT_FOUND`, `REPORT_CONFLICT`, `INVALID_TRIAGE`; aksi izin `crowd:read`, `crowd:triage`, `crowd:manage`).
- Untuk dogfooding di production: Tahap 4 sudah live dan akun admin project `testpulse` tersedia.

## 3. Kriteria keluar

- Lint, typecheck, dan `pnpm audit --audit-level high` bersih.
- Semua test unit, integration, contract (web dan reporter sebagai consumer), API, dan E2E (3 browser) lulus di CI; test yang lulus hanya setelah retry dicatat sebagai flaky dan diselidiki.
- Coverage `src/modules/**/domain` >= 80% (domain crowd termasuk di dalamnya) dan **mutation score >= 80%** (domain crowd otomatis ikut glob `src/modules/**/domain/**`).
- Visual regression hijau (132 screenshot, 56 test, toleransi ketat) dan gate k6 hijau: p95 baca < 300 ms (kini termasuk empat endpoint crowd), `http_req_failed` < 1%.
- ZAP baseline: 0 temuan High pada root situs dan tiga halaman crowd; gate CSP hijau di seluruh E2E, termasuk Markdown crowd berbahaya.
- Setelah deploy: `/crowd` di production menampilkan cycle "Uji TestPulse 0.5.0".
- Tidak ada cacat severity tinggi yang terbuka untuk fitur tahap 5.

## 4. Skenario per fitur

### 4.1 Cycle

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| CYC-01 | Validasi cycle: judul 3 sampai 120, ringkasan sampai 280, 1 sampai 5 link http(s) tanpa kredensial, instruksi dan cakupan Markdown, 0 sampai 10 lingkungan unik tanpa peka huruf besar/kecil, versi aplikasi, `endsAt` di masa depan | 400 dengan `fields` (mis. `links.1.url`, `endsAt` "Waktu berakhir harus di masa depan"); batas diuji tepat | U, I, E | [crowd.test.ts](../../packages/shared/src/schemas/crowd.test.ts), [crowd-cycles.int.test.ts](../../apps/api/test/integration/crowd-cycles.int.test.ts), [crowd-team.spec.ts](../../tests/e2e/crowd-team.spec.ts) |
| CYC-02 | Transisi: draf → buka → tutup → buka ulang; kembali ke draf ditolak; status sama = tanpa perubahan; membuka dengan `endsAt` lewat | `409 INVALID_TRANSITION` untuk transisi lain; `openedAt` hanya diisi pertama kali; `endsAt` lewat → `400 fields.endsAt` | U, I, E | [cycles.test.ts](../../apps/api/src/modules/crowd/domain/cycles.test.ts), crowd-cycles.int.test.ts, crowd-team.spec.ts |
| CYC-03 | Status efektif | `open` dengan `endsAt <= sekarang` = selesai (batas tepat); bergabung dan mengirim laporan `409 CYCLE_NOT_OPEN`; masuk tab Selesai di direktori | U, I, E | cycles.test.ts, crowd-cycles.int.test.ts, [crowd-public.spec.ts](../../tests/e2e/crowd-public.spec.ts) |
| CYC-04 | Nomor `CY-<n>` dan konflik | Nomor unik saat paralel, tidak dipakai ulang; `version` usang → `409 CYCLE_CONFLICT`; UI dua tab menampilkan banner tanpa membuang isian | I, A, C, E | crowd-cycles.int.test.ts, [crowd.spec.ts](../../tests/api/crowd.spec.ts), [crowd.pact.test.ts](../../apps/web/test/contract/crowd.pact.test.ts), crowd-team.spec.ts |
| CYC-05 | Hapus cycle | Tanpa laporan: 204 (admin); dengan laporan: `409 CYCLE_HAS_REPORTS`; UI menonaktifkan tombol dengan penjelasan | I, A, C, E | crowd-cycles.int.test.ts, crowd.spec.ts, crowd.pact.test.ts, crowd-team.spec.ts |
| CYC-06 | Visibilitas (Review Focus 5) | Draf: 404 bagi selain anggota; cycle publik di project privat tampil di direktori dengan nama project tanpa link (`slug: null`); `GET /projects/:slug` untuk anonim tetap 404; hasil CI, bug, case, dan anggota tidak ikut di DTO publik | I, E | [crowd-public.int.test.ts](../../apps/api/test/integration/crowd-public.int.test.ts), crowd-public.spec.ts, [crowd-cycle.spec.ts](../../tests/e2e/crowd-cycle.spec.ts) |

### 4.2 Peserta

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| PAR-01 | Bergabung | Login + `acceptRules: true` → 200 `me.state = joined`; bergabung ulang idempoten; join paralel tidak menggandakan baris; anonim 401 | U, I, A, C, E | [access.test.ts](../../apps/api/src/modules/crowd/domain/access.test.ts), crowd-public.int.test.ts, [authorization.spec.ts](../../tests/api/authorization.spec.ts), crowd.pact.test.ts, crowd-cycle.spec.ts |
| PAR-02 | Anggota project bergabung | `403 MEMBER_CANNOT_JOIN`; peserta yang kemudian menjadi anggota tidak bisa lagi mengirim laporan (kode yang sama) | U, I, A, C, E | access.test.ts, crowd-public.int.test.ts, crowd.spec.ts, crowd.pact.test.ts, crowd-cycle.spec.ts |
| PAR-03 | Keluar, dikeluarkan, lalu mencoba kembali (Review Focus 2) | Dikeluarkan → join dan kirim `403 PARTICIPANT_REMOVED`; keluar saat dikeluarkan tidak mengubah status; `me.state = removed`; laporan lama tetap ditriase dan poin tetap | U, I, A, C, E | access.test.ts, crowd-public.int.test.ts, crowd.spec.ts, crowd.pact.test.ts, crowd-team.spec.ts |
| PAR-04 | Daftar peserta (anggota) | 50 per halaman, cursor mikrodetik tanpa baris ganda (52 peserta), `reportCounts` per peserta, tanpa email | I, C, E | crowd-cycles.int.test.ts, crowd.pact.test.ts, crowd-team.spec.ts |

### 4.3 Laporan

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| REP-01 | Validasi laporan: judul 5 sampai 200, langkah 10 sampai 10.000, hasil 1 sampai 2000, lingkungan 3 sampai 200, severity usulan, 0 sampai 5 link bukti, karakter kontrol | 400 dengan `fields`; UI menampilkan galat per field dan memfokuskan field pertama | U, I, E | crowd.test.ts, [crowd-reports.int.test.ts](../../apps/api/test/integration/crowd-reports.int.test.ts), [crowd-report.spec.ts](../../tests/e2e/crowd-report.spec.ts) |
| REP-02 | Kirim, ubah, tarik | 201 `CR-<n>`; ubah hanya selama `submitted` (lainnya `409 INVALID_TRIAGE`); tarik → `withdrawn` (200 dengan laporan); konflik dua tab → banner, isian tetap | U, I, A, C, E | [reports.test.ts](../../apps/api/src/modules/crowd/domain/reports.test.ts), crowd-reports.int.test.ts, crowd.spec.ts, crowd.pact.test.ts, crowd-report.spec.ts |
| REP-03 | Anti-spam: 10 menunggu, 50 per cycle, 30 per 24 jam; 9 `submitted` + 5 kiriman paralel | `429 RATE_LIMITED` dengan pesan yang menyebut batas; batas diuji tepat; paralel: tepat 1 lolos; UI menampilkan pesan batas dan isian tetap | U, I, A, C, E | [limits.test.ts](../../apps/api/src/modules/crowd/domain/limits.test.ts), crowd-reports.int.test.ts, crowd.spec.ts, crowd.pact.test.ts, crowd-report.spec.ts |
| REP-04 | Cycle ditutup saat form terbuka (Review Focus 3) | Kirim → `409 CYCLE_NOT_OPEN`; pesan "Cycle sudah ditutup"; isian tetap terlihat; tombol kirim nonaktif | I, C, E | crowd-reports.int.test.ts, crowd.pact.test.ts, crowd-report.spec.ts |
| REP-05 | Laporan orang lain | Peserta lain, anggota project, dan pengguna lain: `404 REPORT_NOT_FOUND`; UI "Laporan tidak ditemukan" | I, A, C, E | crowd-reports.int.test.ts, authorization.spec.ts, crowd.pact.test.ts, crowd-report.spec.ts |
| REP-06 | Masalah yang sudah diketahui | Hanya laporan diterima yang tidak disembunyikan (judul, severity, waktu), terbaru dulu, bisa dicari di form laporan; disembunyikan → hilang | I, C, E | crowd-public.int.test.ts, crowd.pact.test.ts, crowd-report.spec.ts, [crowd-flow.spec.ts](../../tests/e2e/crowd-flow.spec.ts) |

### 4.4 Triase dan komentar

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| TRI-01 | Terima | Severity final (default usulan) dan prioritas (default `medium`); bug berlabel `crowd`, reporter = anggota yang menerima, deskripsi dari server; `crowdOrigin` di bug; UI "Bug #n dibuat" dan asal bug di detail bug | U, I, A, C, E | reports.test.ts, [crowd-triage.int.test.ts](../../apps/api/test/integration/crowd-triage.int.test.ts), crowd.spec.ts, crowd.pact.test.ts, [bugs.pact.test.ts](../../apps/web/test/contract/bugs.pact.test.ts), crowd-flow.spec.ts |
| TRI-02 | Dua penerimaan bersamaan | Tepat satu bug dan satu `409 REPORT_CONFLICT`; UI pihak kedua menampilkan banner bentrok dengan isian tetap | I, A, C, E | crowd-triage.int.test.ts, crowd.spec.ts, crowd.pact.test.ts, crowd-flow.spec.ts |
| TRI-03 | Tolak dan kembalikan | Alasan wajib, catatan wajib untuk "Lainnya"; alasan dan catatan terlihat pelapor; kembalikan mengosongkan alasan, catatan, target, pelaku, dan waktu triase; laporan diterima tidak bisa dikembalikan (`409 INVALID_TRIAGE`) | U, I, A, C, E | reports.test.ts, crowd-triage.int.test.ts, crowd.spec.ts, crowd.pact.test.ts, crowd-flow.spec.ts |
| TRI-04 | Duplikat | Target harus di cycle yang sama, dikirim lebih dulu (termasuk `submittedAt` sama dengan nomor lebih kecil), bukan dirinya, berstatus `submitted`/`accepted` (`400 fields.duplicateOf`); UI hanya menawarkan kandidat sah, bisa dicari nomor atau judul | U, I, E | reports.test.ts, crowd-triage.int.test.ts, crowd-flow.spec.ts |
| TRI-05 | Antrian dan "Simpan & berikutnya" | Antrian default `submitted` terlama dulu, filter status, severity, dan cari; `nextSubmittedNumber` berputar; tanpa laporan berikutnya kembali ke antrian | I, C, E | crowd-reports.int.test.ts, crowd.pact.test.ts, crowd-team.spec.ts, crowd-flow.spec.ts |
| TRI-06 | Komentar | Pelapor dan tester ke atas menulis; viewer hanya membaca; hapus milik sendiri; komentar dua arah terlihat di kedua sisi | I, A, C, E | crowd-reports.int.test.ts, authorization.spec.ts, crowd.pact.test.ts, crowd-flow.spec.ts |

### 4.5 Reputasi

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| REQ-01 | Poin dan tingkat penerimaan | 1/3/5/8 dari severity final; ditolak, duplikat, dan ditarik 0; tingkat penerimaan `null` tanpa keputusan | U, I | [reputation.test.ts](../../apps/api/src/modules/crowd/domain/reputation.test.ts), crowd-public.int.test.ts |
| REQ-02 | Leaderboard | Urutan poin, jumlah diterima, lalu waktu poin terakhir dicapai; top 50 + posisi saya; hanya poin > 0; global di-cache 30 detik dengan baris saya segar; tabel tetap tampil bila daftar kosong tetapi ada baris saya | U, I, A, C, E | reputation.test.ts, crowd-public.int.test.ts, crowd.spec.ts, crowd.pact.test.ts, crowd-public.spec.ts, crowd-flow.spec.ts |
| REQ-03 | Profil tester | Nama, poin, tingkat penerimaan, jumlah cycle, 10 laporan diterima terbaru tanpa yang disembunyikan; pengguna tanpa laporan diterima: profil kosong, bukan 404 | I, C, E | crowd-public.int.test.ts, crowd.pact.test.ts, crowd-public.spec.ts |

### 4.6 Privasi, keamanan, dan otorisasi

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| SEC-10 | Email | Seluruh body respons crowd (publik dan tim) dipindai: tidak ada email maupun kunci `email` | I, A, E | crowd-public.int.test.ts, crowd.spec.ts, [crowd-security.spec.ts](../../tests/e2e/crowd-security.spec.ts) |
| SEC-11 | Markdown crowd yang meniru UI tim (Review Focus 4): `## Status: Diterima`, tabel palsu, `<script>`, `<img onerror>`, link `javascript:`/`data:`, gambar eksternal, nama pelapor berisi backtick dan link | Inert di halaman triase, bug yang dibuat, dan laporan saya: tanpa `<img>` eksternal, tanpa dialog, tanpa href berbahaya, gate CSP bersih; status asli tidak berubah; metadata pelapor di bug tampil sebagai code span | U, E | [bug-description.test.ts](../../apps/api/src/modules/crowd/domain/bug-description.test.ts), [markdown-safe.test.ts](../../packages/shared/src/markdown-safe.test.ts), crowd-security.spec.ts |
| SEC-12 | Matriks otorisasi tim (spec §8.4): 6 aktor + anonim publik terhadap 15 endpoint crowd tim | Sesuai tabel; anonim pada project privat 401 (Ruling Task 1); token CI sah diperlakukan anonim; menjadikan `crowd:read` aksi baca publik menggagalkan sel (dibuktikan sengaja) | A | [authorization-matrix.ts](../../tests/api/authorization-matrix.ts), authorization.spec.ts |
| SEC-13 | Matriks otorisasi publik: anonim, login bukan peserta, peserta aktif, keluar, dikeluarkan, anggota project | Sesuai tabel kedua §8.4 dengan kode error persis; token CI sah = anonim | A | authorization-matrix.ts, authorization.spec.ts |
| SEC-14 | Open redirect lewat `?next=` setelah login dari halaman cycle (Review Focus 1) | Hanya path relatif berawalan `/` (bukan `//`, `/\`, atau skema) yang diikuti | U, E | [navigation.test.ts](../../apps/web/src/lib/navigation.test.ts), crowd-public.spec.ts |
| SEC-15 | Link aplikasi dan bukti | `target="_blank" rel="noopener noreferrer"` dan host tampil | E | crowd-cycle.spec.ts, crowd-report.spec.ts |

### 4.7 Tampilan dan integrasi

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| UI-10 | Direktori, cycle publik, form laporan, laporan saya, profil, leaderboard, ringkasan saya | Tab URL, pencarian, a11y dua tema, 375 px tanpa scroll horizontal dengan teks panjang | E | crowd-public.spec.ts, crowd-cycle.spec.ts, crowd-report.spec.ts |
| UI-11 | Tab Crowd tim: daftar cycle, form cycle, detail cycle (antrian, peserta, leaderboard), halaman triase | Kontrol sesuai role (tester tanpa kontrol admin, viewer hanya baca, anonim di project publik tanpa antrian dan peserta); a11y dua tema; 375 px | E | crowd-team.spec.ts, crowd-flow.spec.ts |
| UI-12 | Kartu Crowdtesting dan asal bug | Kartu menunjukkan cycle berlangsung, menunggu triase, dan diterima 30 hari, juga tanpa run CI; hanya anggota; asal bug bertaut ke triase untuk anggota | E | crowd-flow.spec.ts |
| UI-13 | Landing | Hero menyebut crowdtesting; kartu Crowdtesting "Tersedia"; tidak ada badge "Segera"; roadmap Tahap 5 Live, Tahap 6 Berikutnya | E | [landing.spec.ts](../../tests/e2e/landing.spec.ts) |

### 4.8 Visual regression, performa, keamanan, dan dogfooding

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| VIS-05 | Direktori, cycle publik (tab Instruksi), form laporan, halaman triase; tema terang dan gelap; 1280 x 800 dan 375 x 812 | 32 screenshot baru (halaman penuh dan elemen kunci) dari project terpisah; direktori dan leaderboard global disaring ke data seed; total 132 screenshot, 56 test; gate dibuktikan bisa gagal (warna badge diubah sementara: 307 piksel) | V | [pages.spec.ts](../../tests/visual/pages.spec.ts), [seed.ts](../../tests/visual/seed.ts), [timestamps.ts](../../tests/visual/timestamps.ts) |
| VIS-06 | Baseline lama yang berubah karena menu header dan tab Crowd | Baseline halaman project dan header dibuat ulang di task yang mengubahnya setelah gambarnya ditinjau | V | pages.spec.ts |
| PRF-05 | `read` ditambah `GET /crowd/cycles`, `/crowd/cycles/:id`, `/crowd/cycles/:id/known-issues`, `/crowd/leaderboard` pada 25 cycle, 200 tester, dan 1000 laporan diterima | p95 < 300 ms, `http_req_failed` < 1%, `checks` > 0,99 (isi diperiksa: direktori penuh 20 dengan cursor, cycle dengan >= 30 diterima, >= 30 masalah diketahui, leaderboard 50 entri); gate dibuktikan bisa gagal (p95 < 5 ms: exit 99) | P | [read.js](../../tests/perf/read.js), [setup.mjs](../../tests/perf/setup.mjs) |
| ZAP-03 | Baseline scan `/crowd`, `/crowd/c/<id>`, `/crowd/leaderboard` dengan data dari skrip seed | 0 High di tiap laporan (`check-zap-report.mjs`); scan root situs tetap | Z | [ci.yml](../../.github/workflows/ci.yml), [seed-crowd.mjs](../../tests/security/seed-crowd.mjs) |
| DOG-08 | Skrip `scripts/seed-dogfood-crowd.mjs` | Membuat dan membuka cycle "Uji TestPulse 0.5.0" (link production, instruksi alur, cakupan, di luar cakupan DoS dan social engineering, lingkungan Chrome/Firefox/Safari/HP, versi dari `package.json`); idempoten (jalan kedua tidak mengubah apa pun; draf dibuka); mencetak origin sebelum login; https saja kecuali host lokal; tanpa redirect; keluar 2 untuk environment atau URL salah dan 1 untuk login gagal; tidak pernah mencetak cookie atau password; diverifikasi terhadap stack Docker lokal dengan user uji, bukan production | (manual, dicatat di laporan tugas) | [seed-dogfood-crowd.mjs](../../scripts/seed-dogfood-crowd.mjs) |
| DOG-09 | Versi `0.5.0` | `deploy.yml` meneruskan `version` root (`0.5.0`) sebagai `--app-version` | (CI) | [deploy.yml](../../.github/workflows/deploy.yml) |
| SMK-04 | Setelah deploy | `/crowd` di production menampilkan cycle "Uji TestPulse 0.5.0" setelah pemilik repo menjalankan skrip seed; laporan dari pengunjung ditriase pemilik repo (pemeriksaan manual; smoke otomatis tetap hanya membaca) | (manual) | [smoke.spec.ts](../../tests/smoke/smoke.spec.ts) |

## 5. Cara menjalankan

Perintah lengkap per lapisan ada di [README](../../README.md#menjalankan-test-per-lapisan). Pipeline otomatis ada di [`ci.yml`](../../.github/workflows/ci.yml) dan [`mutation.yml`](../../.github/workflows/mutation.yml).

Tambahan untuk Tahap 5:

```bash
pnpm test:contract                                # kini juga crowd.pact.test.ts (semua endpoint crowd + error)
docker compose up -d --build --wait
pnpm test:visual                                  # 132 screenshot; pnpm test:visual:update bila perubahan disengaja
node tests/perf/setup.mjs                         # data k6, kini juga 25 cycle, 200 crowd tester, 1000 laporan diterima
BASE_URL=http://localhost:8080 node tests/security/seed-crowd.mjs   # satu cycle untuk scan ZAP halaman crowd
BASE_URL=http://localhost:8080 pnpm --filter @testpulse/tests screenshots   # screenshot dokumentasi, termasuk direktori dan triase (stack kosong)
TP_BASE_URL=http://localhost:8080 TP_EMAIL=... TP_PASSWORD=... TP_SLUG=<slug> node scripts/seed-dogfood-crowd.mjs   # seed dogfooding (di production: isi TP_EMAIL dan TP_PASSWORD sendiri, jangan ke chat atau berkas)
```

## 6. Risiko pengujian dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Isi project privat bocor lewat cycle publik | `slug: null`, DTO publik hanya berisi isi cycle, data laporan dan peserta khusus anggota (`crowd:read`), dan matriks otorisasi tim serta publik |
| Email tester bocor | DTO crowd tanpa email dengan schema `strip`; pemindaian respons di integration, API, E2E, dan Pact |
| Konten dari pihak luar menjalankan skrip atau meniru UI tim | Renderer Markdown aman Tahap 3 dan CSP ketat; metadata bug sebagai code span; E2E muatan berbahaya di tiga halaman di bawah gate CSP |
| Spam melewati batas lewat kiriman paralel | Batas dicek di transaksi di bawah kunci (advisory per pengguna untuk batas harian, lalu project, cycle, peserta); test paralel 9 + 5 → 1 |
| Dua bug dari satu laporan | Triase mengunci project dan laporan, bug dibuat di transaksi yang sama; test paralel → tepat satu bug |
| Poin tester hilang atau keliru | Poin disalin saat diterima, cycle berlaporan tidak bisa dihapus, kembalikan hanya dari ditolak/duplikat; leaderboard agregasi diuji urutan dan tie-break |
| Leaderboard global basi membingungkan tester | Baris saya selalu segar; tabel tampil walau daftar dari cache kosong |
| Visual regression berubah karena data run lain | Project crowd terpisah; direktori dan leaderboard global disaring ke data seed di route test |
| Gate k6 lolos karena data crowd kosong | `ok` memeriksa isi (direktori penuh, >= 30 diterima, leaderboard 50) dan gate dibuktikan bisa gagal |
| Skrip seed membuat cycle ganda di production atau membocorkan kredensial | Idempoten per judul, kredensial hanya dari environment shell pemilik dan tidak pernah dicetak, https saja, tanpa redirect; diverifikasi dua kali di stack lokal dengan user uji |
| Perubahan skema merusak data production | Migrasi 0007 hanya menambah; diuji di atas database berisi data Tahap 4 |
