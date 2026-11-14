# Test Plan Tahap 4: Test Case Manual, Run Manual, dan Mutation Testing

Rencana pengujian untuk lingkup tahap 4 (lihat [spec](../superpowers/specs/2026-11-08-testpulse-tahap4-design.md), bagian 3 sampai 14). Strategi umum dan alasan tiap lapisan ada di [TEST_STRATEGY.md](../TEST_STRATEGY.md); keputusan arsitektur di [ADR 0006](../adr/0006-run-manual-snapshot-dan-mutation-testing.md).

Singkatan lapisan: **U** unit, **I** integration, **A** API (Playwright request), **C** contract (Pact), **E** E2E, **V** visual regression, **P** performa (k6), **M** mutation testing, **S** smoke production.

## 1. Lingkup

**Diuji:**

- **Suite**: buat, ganti nama (huruf besar/kecil nama sendiri boleh, nama suite lain yang sama ditolak), ubah urutan, hapus hanya bila kosong (termasuk case arsip), batas 200 suite.
- **Test case**: buat, ubah, pindah suite, arsipkan dan pulihkan, hapus (admin); langkah terstruktur (1 sampai 50, urutan bisa diubah), prasyarat, prioritas, label; nomor `TC-<n>` berurutan dan tidak dipakai ulang; optimistic concurrency (`409 CASE_CONFLICT`); daftar dengan filter, pencarian, dan pagination; tautan ke automated test (`GET /tests?q=`) dan meter cakupan otomasi.
- **Run manual**: dibuat dari suite dan/atau case (seleksi gabungan, tanpa duplikat, tanpa arsip, 1 sampai 500 case), snapshot yang tidak ikut berubah, nomor `TR-<n>`, daftar dan detail dengan progres, ganti nama, selesai, buka ulang, hapus (admin).
- **Eksekusi**: hasil per langkah, saran status (tidak pernah disimpan otomatis), status case, catatan, assignee, "Simpan & lanjut" ke case belum dites berikutnya (berputar), konflik (`409 MANUAL_RUN_CONFLICT`), run selesai hanya-baca (`409 RUN_COMPLETED`) dengan isian yang belum tersimpan tetap terlihat.
- **Bug dari case gagal**: isian awal dari snapshot (dengan escape Markdown), `manualRunCaseId`, `manualOrigin` dan tautan ke halaman eksekusi, badge bug di daftar dan eksekusi.
- **Integrasi**: halaman Versi dengan kolom Manual dan versi manual-saja, kartu "Test manual" di dashboard (juga tanpa run CI), riwayat hasil dan hasil terakhir automated test di detail case.
- **Mutation testing** StrykerJS pada kode domain (`apps/api`, `packages/shared`): gate, mutan yang dikecualikan, workflow terjadwal, dan publikasi laporan.
- **Visual regression** (tiga halaman manual, dua tema, dua viewport), **performa** (k6 baca: case, run manual, versi dengan data manual), dan **dogfooding** (skrip seed, versi `0.4.0`).

**Tidak diuji (sengaja):** lihat [TEST_STRATEGY.md bagian 6](../TEST_STRATEGY.md#6-sengaja-tidak-diuji-dan-alasannya) dan bagian 15 spec (suite bertingkat, langkah bersama, case berparameter, riwayat versi case, impor/ekspor, lampiran, kloning dan penjadwalan run, test plan dan milestone, run manual otomatis dari CI, tautan otomasi otomatis, status otomatis dari hasil CI, mutation testing untuk web dan reporter, notifikasi). Tidak ada baseline visual untuk keadaan kosong atau galat.

## 2. Kriteria masuk

- Kode ter-merge ke branch kerja dan `pnpm install` berhasil; migrasi 0005 (tabel `case_suites`, `manual_cases`, `manual_case_labels`, `manual_runs`, `manual_run_cases`; kolom `projects.case_seq`, `projects.manual_run_seq`, dan `bugs.manual_run_case_id`) berjalan tanpa error di atas data Tahap 3.
- Docker tersedia (Testcontainers, Docker Compose, container Playwright untuk visual regression, dan image k6).
- `packages/shared` ter-build (schema manual dan kode error baru: `SUITE_NOT_FOUND`, `SUITE_NOT_EMPTY`, `CASE_NOT_FOUND`, `CASE_CONFLICT`, `MANUAL_RUN_NOT_FOUND`, `RUN_CASE_NOT_FOUND`, `MANUAL_RUN_CONFLICT`, `RUN_COMPLETED`; aksi izin `manual:write` dan `manual:delete`).
- Untuk smoke dan dogfooding di production: Tahap 3 sudah live dan `TESTPULSE_TOKEN` terpasang ([deploy.md](../deploy.md), Langkah 12).

## 3. Kriteria keluar

- Lint, typecheck, dan `pnpm audit --audit-level high` bersih.
- Semua test unit, integration, contract (web dan reporter sebagai consumer), API, dan E2E (3 browser) lulus di CI; test yang lulus hanya setelah retry dicatat sebagai flaky dan diselidiki.
- Coverage `src/modules/**/domain` >= 80% (domain manual termasuk di dalamnya).
- **Mutation score >= 80%** di `apps/api` dan `packages/shared` (`pnpm test:mutation`); hasil akhir 100% di keduanya, dengan 29 mutan setara yang dikecualikan dan beralasan (TEST_STRATEGY).
- Visual regression hijau (100 screenshot, toleransi ketat) dan gate k6 hijau: p95 baca < 300 ms (kini termasuk `cases`, `manual-runs/:number`, `manual-runs/:number/cases`, dan `versions` dengan data manual), `http_req_failed` < 1%.
- ZAP baseline: 0 temuan High; gate CSP hijau di seluruh E2E, termasuk halaman manual dan Markdown berbahaya.
- Setelah deploy: `/p/testpulse` di production berisi test case manual TestPulse sendiri (skrip seed) dan run "Regresi 0.4.0" yang dieksekusi pemilik repo lewat UI; baris versi `0.4.0` menampilkan kolom Manual.
- Tidak ada cacat severity tinggi yang terbuka untuk fitur tahap 4.

## 4. Skenario per fitur

### 4.1 Suite

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| SUI-01 | Validasi suite: nama 1 sampai 100 setelah trim, deskripsi sampai 2000, karakter kontrol ditolak | 400 `VALIDATION_ERROR` dengan `fields`; batas diuji tepat | U, I | [manual.test.ts](../../packages/shared/src/schemas/manual.test.ts), [manual-cases.int.test.ts](../../apps/api/test/integration/manual-cases.int.test.ts) |
| SUI-02 | Nama unik per project tanpa peka huruf besar/kecil (Review Focus 1) | `login` menjadi `Login` diterima (suite sendiri); suite lain bernama `LOGIN` ditolak `400 fields.name` "Nama suite sudah dipakai"; pembuatan paralel dengan nama sama: satu berhasil | I, A | manual-cases.int.test.ts, [manual.spec.ts](../../tests/api/manual.spec.ts) |
| SUI-03 | Posisi dan pemindahan | Suite baru di posisi terakhir; pindah ke awal atau akhir menomori ulang tanpa celah; `position` di luar rentang dibatasi; pemindahan paralel tetap menghasilkan 0 sampai n-1 | U, I, E | [order.test.ts](../../apps/api/src/modules/manual/domain/order.test.ts), manual-cases.int.test.ts, [manual-cases.spec.ts](../../tests/e2e/manual-cases.spec.ts) |
| SUI-04 | Batas 200 suite | Suite ke-201: 400; pesan server tampil di kolom tambah suite | I, E | manual-cases.int.test.ts, manual-cases.spec.ts |
| SUI-05 | Hapus suite | Kosong: 204 (admin); berisi case termasuk arsip: `409 SUITE_NOT_EMPTY` "Pindahkan atau hapus case di suite ini terlebih dahulu."; tester 403 | I, A, C, E | manual-cases.int.test.ts, manual.spec.ts, [manual.pact.test.ts](../../apps/web/test/contract/manual.pact.test.ts), manual-cases.spec.ts |
| SUI-06 | Jumlah case aktif dan arsip per suite; suite project lain | `activeCount` dan `archivedCount` benar; suite project lain atau id bukan UUID: 404 `SUITE_NOT_FOUND` | I, C | manual-cases.int.test.ts, manual.pact.test.ts |

### 4.2 Test case

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| CAS-01 | Validasi case: judul 3 sampai 200, prasyarat sampai 5000, langkah 1 sampai 50 (`action` 1 sampai 2000, `expected` sampai 2000), label (aturan bug), prioritas | 400 dengan `fields`; error langkah memakai `steps.<i>.action`; batas tepat 1 dan 50 langkah | U, I | manual.test.ts, manual-cases.int.test.ts |
| CAS-02 | Buat case | 201; `TC-1` untuk case pertama dengan prioritas `medium`; 20 case paralel mendapat `TC-1` sampai `TC-20` unik; setelah `TC-20` dihapus, case baru bernomor `TC-21` | I, A, C | manual-cases.int.test.ts, manual.spec.ts, manual.pact.test.ts |
| CAS-03 | `suiteId` dan `automatedTestId` milik project lain | 400 pada `fields.suiteId` atau `fields.automatedTestId`; tidak ada case tersimpan | I | manual-cases.int.test.ts |
| CAS-04 | Konflik: `version` usang; dua PATCH paralel dengan `version` sama | `409 CASE_CONFLICT` tanpa perubahan; tepat satu pemenang; perubahan tanpa efek tidak menaikkan `version` | I, A, C, E | manual-cases.int.test.ts, manual.spec.ts, manual.pact.test.ts, manual-cases.spec.ts |
| CAS-05 | Ubah case | Pindah suite, arsip dan pulihkan, `steps` dan `labels` mengganti seluruh daftar, lepas tautan otomasi; PATCH tanpa field: 400 | I, C | manual-cases.int.test.ts, manual.pact.test.ts |
| CAS-06 | Pemindahan posisi langkah | Naik dan turun di batas awal dan akhir; daftar sumber tidak diubah; di UI langkah 3 ke posisi 1 tersimpan dan terbaca di detail | U, E | order.test.ts, [manualSteps.test.ts](../../apps/web/src/lib/manualSteps.test.ts), manual-cases.spec.ts |
| CAS-07 | Daftar case | Urut posisi suite lalu nomor; filter suite, prioritas, label, `automated`, `archived` (R4: `archived=true` hanya yang arsip); `q` literal (`%`, `_`) tidak peka huruf besar/kecil; 60 case: 50 lalu cursor lalu 10; cursor rusak: 400 | U, I, E | [cursor.test.ts](../../apps/api/src/modules/manual/cursor.test.ts), manual-cases.int.test.ts, manual-cases.spec.ts |
| CAS-08 | Cakupan otomasi | `coverage` dihitung dari seluruh case aktif, tidak ikut filter; menghapus automated test melepas tautan; pembulatan ke bawah (39 dari 40 adalah 97%), 0 case: tanpa persen | U, I, E | [manual-logic.test.ts](../../packages/shared/src/manual-logic.test.ts), manual-cases.int.test.ts, manual-cases.spec.ts |
| CAS-09 | Cari automated test `GET /tests?q=` | 2 sampai 100 karakter, nama atau suite, maks 20, hanya project ini; di UI memilih test menaikkan meter dan melepasnya mengembalikan "Belum diotomasi" | I, A, C, E | manual-cases.int.test.ts, manual.spec.ts, manual.pact.test.ts, manual-cases.spec.ts |
| CAS-10 | Label unik project, urut abjad, maks 200 | Sesuai | I, C | manual-cases.int.test.ts, manual.pact.test.ts |
| CAS-11 | Hapus case (admin) | 204; sesudahnya 404 `CASE_NOT_FOUND`; label ikut terhapus; tester 403 | I, C, E | manual-cases.int.test.ts, manual.pact.test.ts, manual-cases.spec.ts |
| CAS-12 | Detail case: riwayat dan hasil terakhir automated (R6) | `recentResults` maks 10 run case terakhir case itu **termasuk yang `untested`**, terbaru dulu (nomor TR tertinggi); `lastResult` dari branch default project | I, E | [manual-integration.int.test.ts](../../apps/api/test/integration/manual-integration.int.test.ts), manual-cases.spec.ts |

### 4.3 Run manual dan snapshot

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| RUN-01 | Seleksi run | Gabungan suite dan case satuan tanpa duplikat, urut posisi suite lalu nomor; case arsip dibuang; suite hanya berisi arsip, id suite atau nomor case tak dikenal, atau tanpa pilihan: 400 pada `fields.selection`, `suiteIds`, atau `caseNumbers`; tepat 500 diterima, 501 ditolak (Review Focus 2) | U, I | [selection.test.ts](../../apps/api/src/modules/manual/domain/selection.test.ts), [manual-runs.int.test.ts](../../apps/api/test/integration/manual-runs.int.test.ts) |
| RUN-02 | Buat run | 201 dengan `TR-<n>`; 10 run paralel menghasilkan `TR-1` sampai `TR-10` unik; 500 case: run case dipaginasi 100 per halaman | I, A, C | manual-runs.int.test.ts, manual.spec.ts, manual.pact.test.ts |
| RUN-03 | Snapshot | Edit langkah, pindah suite, arsip, lalu hapus case: run case tetap memakai snapshot, `caseId` menjadi null, hasil utuh; di UI halaman eksekusi tetap menampilkan langkah lama dan menyebut salinan | U, I, E | [snapshot.test.ts](../../apps/api/src/modules/manual/domain/snapshot.test.ts), manual-runs.int.test.ts, [manual-runs.spec.ts](../../tests/e2e/manual-runs.spec.ts) |
| RUN-04 | Ringkasan dan progres | `counts`, `total`, `progress = (total - untested) / total`; total 0 memberi 0 (bukan NaN) | U | [summary.test.ts](../../apps/api/src/modules/manual/domain/summary.test.ts) |
| RUN-05 | Daftar run | Terbaru dulu, filter `status` dan `appVersion`, 25 run: 20 lalu cursor lalu 5; cursor rusak: 400 | I, C, E | manual-runs.int.test.ts, manual.pact.test.ts, manual-runs.spec.ts |
| RUN-06 | Ubah run | Ganti nama dan `appVersion` (bisa dikosongkan) selama `open`; `version` usang: `409 MANUAL_RUN_CONFLICT`; run tak dikenal: 404 `MANUAL_RUN_NOT_FOUND` | I, A, C, E | manual-runs.int.test.ts, manual.spec.ts, manual.pact.test.ts, manual-runs.spec.ts |
| RUN-07 | Selesai dan buka ulang | Selesai: PATCH run case dan ganti nama 409 `RUN_COMPLETED`, hanya `status: open` diterima; buka ulang menulis lagi; menyelesaikan run sementara PATCH run case berjalan tidak meninggalkan hasil bertanggal setelah `completed` | I, A, C, E | manual-runs.int.test.ts, manual.spec.ts, manual.pact.test.ts, manual-runs.spec.ts |
| RUN-08 | Hapus run (admin) | 204; run case ikut terhapus; tautan bug menjadi null dan bug tetap ada; tester 403 | I, C, E | manual-runs.int.test.ts, manual-integration.int.test.ts, manual-runs.spec.ts |
| RUN-09 | Anggota dikeluarkan | `assigneeId` run case project itu menjadi `null` (hanya di project itu) | I | manual-runs.int.test.ts |
| RUN-10 | Skema database | Tabel, indeks, `CHECK` enum, nomor unik per project, `ON DELETE` (run case dan bug `SET NULL`, anak run `CASCADE`, suite `RESTRICT`); data Tahap 3 utuh; counter baru 0 | I | [migration-0005.int.test.ts](../../apps/api/test/integration/migration-0005.int.test.ts) |

### 4.4 Eksekusi

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| EXE-01 | Saran status | Lima aturan spec 4.3: langkah gagal menang atas diblokir, bahkan bila ada yang kosong; semua lulus atau lulus dan dilewati: lulus; semua dilewati: dilewati; ada langkah kosong atau tanpa langkah: tidak ada saran | U | [manual-logic.test.ts](../../packages/shared/src/manual-logic.test.ts) |
| EXE-02 | Saran tidak pernah disimpan otomatis | Mengisi hasil langkah tidak mengubah status run case; status hanya berubah lewat pilihan eksplisit | A, E | manual.spec.ts, manual-runs.spec.ts |
| EXE-03 | Isi hasil | `passed` mengisi `executedBy` dan `executedAt`; kembali ke `untested` mengosongkannya; `stepResults` salah panjang: 400 `fields.stepResults`; assignee bukan anggota: 400 `fields.assigneeId` | U, I | [results.test.ts](../../apps/api/src/modules/manual/domain/results.test.ts), manual-runs.int.test.ts |
| EXE-04 | Konkurensi | Dua run case berbeda di-PATCH paralel: keduanya 200; run case sama dengan `version` sama: tepat satu 409; di UI dua tab case berbeda tersimpan keduanya, case sama memunculkan banner bentrok dan isian tetap sampai dimuat ulang | I, E | manual-runs.int.test.ts, manual-runs.spec.ts |
| EXE-05 | Navigasi "Simpan & lanjut" | `nextUntestedId` menunjuk run case belum dites berikutnya, berputar ke awal, null bila semua sudah dites; di UI eksekusi beruntun sampai akhir run | I, E | manual-runs.int.test.ts, manual-runs.spec.ts |
| EXE-06 | Run diselesaikan di tab lain saat mengisi (Review Focus 3) | Simpan: banner `exec-completed`, form hanya-baca, isian yang belum tersimpan tetap terlihat | E | manual-runs.spec.ts |
| EXE-07 | Markdown berbahaya dan teks panjang (Review Focus 5) | `<script>`, `<img onerror>`, `javascript:` di prasyarat, langkah, dan catatan tampil inert, juga di isian awal bug; teks tanpa spasi, emoji, dan blok kode tersimpan utuh tanpa gulir horizontal di 375 px di editor, detail case, dan halaman eksekusi; nol pelanggaran CSP | E | manual-runs.spec.ts, manual-cases.spec.ts |

### 4.5 Bug dari case gagal

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| BGM-01 | Isian awal dari run case | Judul "TC-n gagal: ..." (maks 200 karakter, tanpa memotong pasangan surrogate); deskripsi memuat run, versi, suite, prasyarat, tabel langkah dengan hasil dan catatan, dan severity `major`; semua teks case di-escape (`codeSpan`, `fenceFor`, `stripControlChars`) | U, E | [manualBugReport.test.ts](../../apps/web/src/lib/manualBugReport.test.ts), manual-runs.spec.ts |
| BGM-02 | `POST /bugs` dengan `manualRunCaseId` | `manualOrigin` dari snapshot di detail dan setelah PATCH; run case project lain atau tak dikenal: 400 `fields.manualRunCaseId`; bersama `testCaseId`: 400 | I, A, C | manual-integration.int.test.ts, manual.spec.ts, bugs.pact.test.ts |
| BGM-03 | Badge bug di daftar dan detail run case | Hanya non-`closed`, maks 5, terbaru dulu; jumlah query sama untuk 1 dan 100 run case bertaut | I | manual-integration.int.test.ts |
| BGM-04 | Detail bug menautkan asal manual | "Dari test run manual TR-n · TC-m" menuju halaman eksekusi (`runCaseId`, Ruling R9); asal dihapus: null | U, I, E | [BugManualOrigin.test.ts](../../apps/web/src/components/BugManualOrigin.test.ts), manual-integration.int.test.ts, manual-runs.spec.ts |

### 4.6 Integrasi: Versi, dashboard, dan detail case

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| INT-01 | Pencocokan versi manual dan CI | Berpasangan (Ruling R3): kedua semver dibanding semver (`v0.4.0` manual dan `0.4.0` CI satu baris); selain itu string sama persis; satu versi non-semver di CI tidak merusak pasangan semver lain | U | [versions.test.ts](../../apps/api/src/modules/manual/domain/versions.test.ts) |
| INT-02 | Baris versi dengan kolom Manual | Dua run manual `v0.4.0` dan satu run CI `0.4.0`: satu baris dengan run manual bernomor TR terbesar (Ruling R5; Review Focus 4); run manual tanpa `appVersion` diabaikan | U, I, E | versions.test.ts, manual-integration.int.test.ts, [manual-integration.spec.ts](../../tests/e2e/manual-integration.spec.ts) |
| INT-03 | Versi manual-saja | Semver (`0.3.5`) disisipkan di posisi semver dengan `run: null`, `runCount: 0`; non-semver (`build-7`) di bawah semua versi automated; tampil di setiap pilihan branch, juga di project tanpa run CI; `passRateDelta` automated tidak berubah; "Bandingkan dengan versi sebelumnya" melewati baris manual-saja | U, I, E | versions.test.ts, manual-integration.int.test.ts, manual-integration.spec.ts |
| INT-04 | Batas 100 baris | Total dipotong 100 setelah penggabungan, tertinggi dulu | I | manual-integration.int.test.ts |
| INT-05 | `GET /manual/summary` dan kartu dashboard | Tanpa case: `latestRun` null dan cakupan 0/0 (kartu tidak tampil); dengan data: run bernomor terbesar dan cakupan otomasi case aktif; kartu tampil juga bila project belum punya run CI (Ruling R10) dan di bawah panduan setup; anonim di project publik melihat kartu; 375 px tanpa gulir horizontal | I, C, E | manual-integration.int.test.ts, manual.pact.test.ts, manual-integration.spec.ts |
| INT-06 | Kontrak `GET /versions` | Satu interaksi dengan `manual` terisi dan satu dengan `run: null` | C | [compare.pact.test.ts](../../apps/web/test/contract/compare.pact.test.ts) |

### 4.7 Otorisasi

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| AUT-01 | Matriks spec 7.1 untuk 6 aktor (anonim publik/privat, non-anggota publik/privat, viewer, tester, admin) di semua endpoint baru | Semua `GET`: privat 404 / publik 200 untuk anonim dan non-anggota, viewer 200; tulis: anonim 401, non-anggota 404 / 403, viewer 403, tester 2xx; hapus suite, case, run: tester 403, admin 204 | I, A | manual-cases.int.test.ts, manual-runs.int.test.ts, [authorization-matrix.ts](../../tests/api/authorization-matrix.ts), [authorization.spec.ts](../../tests/api/authorization.spec.ts) |
| AUT-02 | Token CI bukan kredensial di endpoint manual | Bearer sah diperlakukan anonim: project privat 404, publik hanya baca, tulis 401 | I, A | manual-cases.int.test.ts, manual-runs.int.test.ts, manual.spec.ts |
| AUT-03 | Aksi izin baru | `manual:write` untuk tester dan admin, `manual:delete` hanya admin | U | [permissions.test.ts](../../apps/api/src/modules/projects/domain/permissions.test.ts) |
| AUT-04 | Viewer dan anonim di UI | Hanya membaca: tanpa tombol tulis; project privat bagi non-anggota: "tidak ditemukan" | E | manual-cases.spec.ts, manual-runs.spec.ts |

### 4.8 Tampilan

Semua halaman di bawah lolos `expectNoA11yViolationsInBothThemes` (0 pelanggaran axe serious/critical di dua tema), tanpa gulir horizontal di 375 px, dan gate CSP.

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| UIM-01 | Tab "Test manual" dan sub-tab | Tampil di semua halaman project, tidak membawa `?branch=`, aktif di `/cases`; sub-tab Test case dan Run manual berpindah lewat URL | E | manual-cases.spec.ts |
| UIM-02 | Sidebar suite dan kelola suite | "Semua suite" dan tiap suite dengan jumlah case aktif; tambah, ganti nama (Escape membatalkan), naik/turun, dan hapus dengan konfirmasi inline; di 375 px diganti `suite-select` dengan kontrol suite terpilih, dan pindah suite membuang draf ganti nama, konfirmasi hapus, dan galat suite sebelumnya | E | manual-cases.spec.ts |
| UIM-03 | Daftar case | Baris (kode, judul, suite, prioritas, label, jumlah langkah, tautan), filter dan pencarian tersimpan di URL, parameter tidak valid hanya menggugurkan dirinya, 60 case: "Muat lagi", meter cakupan | E | manual-cases.spec.ts |
| UIM-04 | Editor case | Judul dan langkah wajib dengan pesan di bawah field dan fokus; galat langkah mengikuti langkahnya saat dipindah atau dihapus; langkah terakhir menjadi satu langkah kosong, tombol tambah berhenti di 50; pratinjau Markdown aman; konflik dua tab: banner `case-conflict` tanpa membuang isian; teks panjang tanpa gulir | U, E | [manual.test.ts](../../apps/web/src/lib/manual.test.ts), manualSteps.test.ts, manual-cases.spec.ts |
| UIM-05 | Detail case | Judul, kode, prasyarat, langkah, kartu otomasi dengan hasil terakhir, riwayat eksekusi menaut ke halaman eksekusi; arsip dan pulihkan; admin menghapus dengan konfirmasi inline | E | manual-cases.spec.ts |
| UIM-06 | Daftar run dan buat run | Progres dan legenda per run, filter status dan versi di URL, 20 per halaman; ringkasan seleksi tanpa hitung ganda; saran versi dari `GET /versions` di datalist; isian tidak valid per kolom | E | manual-runs.spec.ts |
| UIM-07 | Detail run | Header, progres, case dikelompokkan per suite; filter status, assignee (Case saya, Belum di-assign), suite; Mulai eksekusi; Selesaikan run dengan konfirmasi inline (jumlah belum dites), hanya-baca, Buka ulang; ganti nama inline; hapus (admin) | E | manual-runs.spec.ts |
| UIM-08 | Halaman eksekusi | Langkah dengan hasil per langkah, saran status, catatan, Simpan dan Simpan & lanjut, Laporkan bug, bug badge; banner konflik dan banner selesai; 375 px | E | manual-runs.spec.ts |
| UIM-09 | Kolom Manual di halaman Versi dan kartu dashboard | Lihat INT-02, INT-03, INT-05; di layar sempit hasil manual dipadatkan di bawah versi | E | manual-integration.spec.ts |
| UIM-10 | Landing | Kartu "Test case manual" Tersedia, tepat satu badge "Segera" (Tahap 5), roadmap Tahap 4 Live dan Tahap 5 Berikutnya, hero menyebut test manual, tautan laporan mutation di bagian Kualitas dan footer | E | [landing.spec.ts](../../tests/e2e/landing.spec.ts) |

### 4.9 Mutation testing

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| MUT-01 | Gate skor | `pnpm test:mutation` (shared lalu api, satu per satu, `--no-bail`): skor >= 80 atau keluar bukan nol; dibuktikan bisa gagal dengan `thresholds.break` sementara di atas skor terukur (exit 1), lalu dikembalikan | M | `stryker.config.mjs` ([api](../../apps/api/stryker.config.mjs), [shared](../../packages/shared/stryker.config.mjs)) |
| MUT-02 | Skor akhir dan skor awal | `packages/shared` 90,63% menjadi 100%; `apps/api` 80,31% menjadi 100% (runner Vitest sebelum beralih ke runner `command`) | M | Task 14 (TEST_STRATEGY) |
| MUT-03 | Mutan selamat ditindaklanjuti | Test diperkuat untuk yang menunjukkan celah (pesan galat, batas "lebih lambat", `.at(-1)`, urutan seleksi, `scrypt` dummy, pesan parser JUnit, urutan pre-release semver); hanya mutan setara yang diberi `// Stryker disable next-line <mutator>: <alasan>` (29: 25 di api dan 4 di shared); tiap komentar sah | U, M | unit test domain dan shared, daftar di [TEST_STRATEGY.md](../TEST_STRATEGY.md#mutation-testing-tahap-4) |
| MUT-04 | Workflow `mutation.yml` | Senin 02.00 UTC dan `workflow_dispatch`; cache incremental dengan kunci memuat hash test dan konfigurasi Vitest; artifact `mutation-report` (retensi 90 hari) tetap dibuat saat gate gagal; ringkasan skor di job summary | (CI) | [mutation.yml](../../.github/workflows/mutation.yml), [mutation-index.mjs](../../.github/scripts/mutation-index.mjs) |
| MUT-05 | Publikasi | Job `report` di `ci.yml` mengambil artifact run sukses terakhir ke `/mutation/` di samping Allure (tidak pernah menggagalkan job; halaman keterangan bila belum ada); ditautkan dari README dan landing | (CI), E | [ci.yml](../../.github/workflows/ci.yml), landing.spec.ts |

### 4.10 Visual regression, performa, dan dogfooding

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| VIS-03 | Daftar case (dengan sidebar dan meter), detail run, halaman eksekusi dengan saran status; tema terang dan gelap; 1280 x 800 dan 375 x 812 | 24 screenshot baru (halaman penuh dan elemen kunci) cocok dengan baseline dengan toleransi ketat; total 100 screenshot, 40 test | V | [pages.spec.ts](../../tests/visual/pages.spec.ts), [seed.ts](../../tests/visual/seed.ts) |
| VIS-04 | Baseline lama yang berubah karena landing baru | Baseline landing dibuat ulang setelah gambarnya ditinjau (Ruling R7) | V | pages.spec.ts |
| PRF-04 | `read`: 10 VU x 30 detik, ditambah `cases` (halaman pertama), `manual-runs/:number`, `manual-runs/:number/cases`, dan `versions` dengan kolom Manual, pada project berisi 12 suite, 240 case, dan satu run 200 case yang sebagian dieksekusi (120 hasil) | p95 durasi < 300 ms; `http_req_failed` < 1%; `checks` > 0,99 (isi respons diperiksa: 50 case dengan cursor dan cakupan >= 200, run 200 case yang sebagian sudah dites, halaman pertama 100 run case dengan cursor, minimal satu versi dengan `manual`); gate dibuktikan bisa gagal dengan threshold sementara (p95 < 10 ms: exit 99) | P | [read.js](../../tests/perf/read.js), [setup.mjs](../../tests/perf/setup.mjs) |
| DOG-06 | Skrip `scripts/seed-dogfood-manual.mjs` | Membuat 5 suite dan 12 case milik TestPulse (langkah nyata, sebagian ditautkan ke automated test lewat `GET /tests?q=`); idempoten (jalan kedua tidak membuat apa pun); keluar 2 bila `TP_EMAIL`/`TP_PASSWORD` kosong dan 1 bila login gagal; tidak pernah mencetak cookie atau password; diverifikasi terhadap stack Docker lokal dengan user uji, bukan production | (manual, dicatat di laporan tugas) | [seed-dogfood-manual.mjs](../../scripts/seed-dogfood-manual.mjs) |
| DOG-07 | Versi `0.4.0` | `deploy.yml` meneruskan `version` root (`0.4.0`) sebagai `--app-version`; run CI yang diunggah menjadi baris versi `0.4.0` | (CI) | [deploy.yml](../../.github/workflows/deploy.yml) |
| SMK-03 | Setelah deploy | `/p/testpulse` memuat test case manual dari skrip seed; pemilik repo membuat run "Regresi 0.4.0" di UI dan mengeksekusi semua case-nya sendiri, sehingga hasilnya test manual sungguhan; baris versi `0.4.0` menampilkan kolom Manual (pemeriksaan manual; smoke otomatis tetap hanya membaca) | (manual) | [smoke.spec.ts](../../tests/smoke/smoke.spec.ts) |

## 5. Cara menjalankan

Perintah lengkap per lapisan ada di [README](../../README.md#menjalankan-test-per-lapisan). Pipeline otomatis ada di [`ci.yml`](../../.github/workflows/ci.yml) dan [`mutation.yml`](../../.github/workflows/mutation.yml); hasil terbaru dilaporkan di <https://safeqq.github.io/testpulse/>, laporan mutation di <https://safeqq.github.io/testpulse/mutation/>, dan di dashboard TestPulse sendiri (`/p/testpulse`).

Tambahan untuk Tahap 4:

```bash
pnpm test:mutation                                # StrykerJS: shared lalu api (api sekitar 20 menit); gate skor >= 80
pnpm test:contract                                # kini juga manual.pact.test.ts (suite, case, run, run case, ringkasan)
docker compose up -d --build --wait
pnpm test:visual                                  # 100 screenshot; pnpm test:visual:update bila perubahan disengaja
node tests/perf/setup.mjs                         # data k6: 55 run berversi, 120 bug, 12 suite, 240 case manual, satu run 200 case
BASE_URL=http://localhost:8080 pnpm --filter @testpulse/tests screenshots   # screenshot dokumentasi, termasuk halaman manual (stack kosong)
TP_BASE_URL=http://localhost:8080 TP_EMAIL=... TP_PASSWORD=... TP_SLUG=<slug> node scripts/seed-dogfood-manual.mjs   # seed dogfooding (di production: isi TP_EMAIL dan TP_PASSWORD sendiri, jangan ke chat atau berkas)
```

## 6. Risiko pengujian dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Nomor case atau run ganda atau melompat saat pembuatan paralel | Nomor dari `UPDATE projects SET case_seq / manual_run_seq = ... + 1 RETURNING` dalam transaksi pembuatan; 20 case dan 10 run paralel diuji di database asli |
| Run lama berubah saat case diedit atau dihapus | Snapshot; edit, pindah suite, arsip, dan hapus diuji di integration dan E2E (halaman eksekusi tetap menampilkan langkah lama) |
| Hasil tersimpan setelah run diselesaikan | Status run diperiksa di transaksi yang sama dengan penulisan run case (kunci baris run); test paralel memastikan tidak ada hasil bertanggal setelah `completed` |
| Dua tester menimpa hasil satu sama lain | `version` per run case: case berbeda tidak bentrok, case sama tepat satu 409; UI menampilkan banner dan mempertahankan isian |
| Status case keliru tersimpan diam-diam | Saran status hanya saran: diuji di unit (semua cabang) dan API (hasil langkah tidak mengubah status) |
| Versi manual tidak menempel ke versi CI, atau urutan versi rusak karena baris manual-saja | Pencocokan berpasangan dan penempatan manual-saja diuji untuk semua kasus (`v` dan polos, non-semver, semver-saja, branch lain, tanpa run CI, 100 baris) |
| Teks case berbahaya atau sangat panjang merusak halaman atau CSP | Markdown aman Tahap 3; E2E dengan muatan berbahaya, teks tanpa spasi, emoji, dan blok kode di bawah gate CSP dan di 375 px |
| Test unit domain tampak kuat padahal lemah | Mutation testing dengan gate 80 (hasil 100) pada domain; mutan yang dikecualikan satu per satu dengan alasan |
| Mutation score palsu (timeout dihitung terbunuh, mutan statis tidak aktif) | Runner `command` untuk api, `timeoutMS` dan `concurrency` tetap, jumlah timeout ditampilkan di hasil; kunci cache incremental memuat hash test |
| Laporan mutation tidak tersedia atau basi di Pages | Langkah publikasi tidak pernah menggagalkan job dan menulis halaman keterangan; laporan dari run sukses terakhir (jadwal mingguan) |
| Gate k6 lolos karena data manual kosong | `ok` memeriksa isi respons (50 case, run 200 case sebagian dites, 100 run case, kolom Manual terisi) dan gate dibuktikan bisa gagal |
| Perubahan skema merusak data production | Migrasi 0005 hanya menambah; diuji di atas database berisi data Tahap 3 |
| Skrip seed merusak atau menggandakan data production, atau membocorkan kredensial | Idempoten (judul yang ada dilewati), kredensial hanya dari environment shell pemilik dan tidak pernah dicetak, diverifikasi dua kali di stack lokal dengan user uji; dijalankan pemilik repo, bukan CI |
| Tampilan berubah tanpa disengaja | Visual regression ketat di container resmi; baseline diperbarui hanya lewat `test:visual:update` setelah gambar ditinjau |
