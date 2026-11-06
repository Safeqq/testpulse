# Test Plan Tahap 3: Bug Tracker & Deteksi Regresi Antar Versi

Rencana pengujian untuk lingkup tahap 3 (lihat [spec](../superpowers/specs/2026-11-04-testpulse-tahap3-design.md), bagian 3 sampai 11). Strategi umum dan alasan tiap lapisan ada di [TEST_STRATEGY.md](../TEST_STRATEGY.md); keputusan arsitektur di [ADR 0005](../adr/0005-perbandingan-versi-dan-markdown-aman.md).

Singkatan lapisan: **U** unit, **I** integration, **A** API (Playwright request), **C** contract (Pact), **E** E2E, **V** visual regression, **P** performa (k6), **S** smoke production.

## 1. Lingkup

**Diuji:**

- **Bug tracker**: buat (manual dan dari test gagal), daftar dengan filter dan pagination, detail, edit field, transisi status dan resolusi, label dan link, komentar (tulis, edit, hapus lunak), riwayat perubahan, hapus bug oleh admin, optimistic concurrency (`409 BUG_CONFLICT`), nomor bug berurutan per project, dan pengosongan assignee saat anggota keluar.
- **Tautan bug dan test**: badge bug di detail run, daftar flaky, riwayat test, dan perbandingan; petunjuk status test (`testHint`) di detail bug; tombol "Laporkan bug" dengan isian awal dari test dan run.
- **Versi run**: query `version` pada upload, `GET /runs?version=`, `GET /versions`, urutan versi (semver, pre-release, prefiks `v`, campuran non-semver).
- **Perbandingan**: `GET /compare` (pembanding default, base dan target eksplisit, enam kelompok, pagination kelompok, mode `groups=none`), kalimat kesimpulan, kartu dashboard, panel detail run, halaman perbandingan dan halaman versi.
- **Markdown aman** untuk deskripsi dan komentar (tanpa HTML mentah, tautan terfilter, gambar jadi tautan).
- **Navigasi tab project** dan label versi di daftar run.
- **Reporter**: opsi `--app-version`; **dogfooding** dengan versi dari `package.json`.
- **Visual regression** (lima halaman, dua tema, dua viewport) dan **performa** (k6 baca: bug, versi, perbandingan).

**Tidak diuji (sengaja):** lihat [TEST_STRATEGY.md bagian 6](../TEST_STRATEGY.md#6-sengaja-tidak-diuji-dan-alasannya) dan bagian 13 spec (notifikasi email, mention, satu bug ke banyak test, impor/ekspor, integrasi GitHub Issues, workflow kustom, lampiran, perubahan status bug otomatis, synthetic monitoring). Tidak ada baseline visual untuk keadaan kosong atau galat.

## 2. Kriteria masuk

- Kode ter-merge ke branch kerja dan `pnpm install` berhasil; migrasi 0003 (kolom `projects.bug_seq` dan `runs.version`; tabel `bugs`, `bug_labels`, `bug_links`, `bug_comments`, `bug_events`) berjalan tanpa error di atas data Tahap 2.
- Docker tersedia (Testcontainers, Docker Compose, container Playwright untuk visual regression, dan image k6).
- `packages/shared` ter-build (schema dan kode error baru: `BUG_NOT_FOUND`, `COMMENT_NOT_FOUND`, `BUG_CONFLICT`, `INVALID_TRANSITION`; aksi izin `bugs:write` dan `bugs:delete`).
- Untuk smoke dan dogfooding di production: Tahap 2 sudah live dan `TESTPULSE_TOKEN` terpasang ([deploy.md](../deploy.md), Langkah 12).

## 3. Kriteria keluar

- Lint, typecheck, dan `pnpm audit --audit-level high` bersih.
- Semua test unit, integration, contract (web dan reporter sebagai consumer), API, dan E2E (3 browser) lulus di CI; test yang lulus hanya setelah retry dicatat sebagai flaky dan diselidiki.
- Coverage `src/modules/**/domain` >= 80% (tabel transisi, urutan versi, klasifikasi, pembanding default termasuk di dalamnya).
- Visual regression hijau (76 screenshot, toleransi ketat) dan gate k6 hijau: p95 baca < 300 ms (kini termasuk `bugs`, `compare`, `compare?groups=none`, `versions`), `http_req_failed` < 1%.
- ZAP baseline: 0 temuan High; gate CSP hijau di seluruh E2E, termasuk halaman bug dan Markdown berbahaya.
- Setelah deploy: `/p/testpulse` di production menampilkan run berversi `0.3.0` dengan kartu perbandingan.
- Tidak ada cacat severity tinggi yang terbuka untuk fitur tahap 3.

## 4. Skenario per fitur

### 4.1 Model dan transisi bug

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| BUG-01 | Tabel transisi: 16 pasangan dari-ke | Hanya `open`→`in_progress`/`resolved`/`closed`, `in_progress`→`open`/`resolved`/`closed`, `resolved`→`closed`/`open`, `closed`→`open`; status ke dirinya sendiri tidak diizinkan | U | [transitions.test.ts](../../apps/api/src/modules/bugs/domain/transitions.test.ts) |
| BUG-02 | Aturan resolusi dan tanggal | Masuk `resolved`/`closed` dari `open`/`in_progress` wajib `resolution`; `resolved`→`closed` boleh tanpa resolusi (memakai yang ada); buka ulang mengosongkan `resolution`, `resolvedAt`, `closedAt`; `INVALID_TRANSITION` dicek sebelum `RESOLUTION_REQUIRED` | U, I | transitions.test.ts, [bugs.int.test.ts](../../apps/api/test/integration/bugs.int.test.ts) |
| BUG-03 | Validasi field: judul 3 sampai 200 (di-trim), deskripsi sampai 20.000, label maks. 10 unik `[a-z0-9-]` dinormalkan, link maks. 10 http/https tanpa kredensial, karakter kontrol ditolak, default `medium`/`major` | 400 `VALIDATION_ERROR` dengan `fields`; boundary dites tepat | U | [bugs.test.ts](../../packages/shared/src/schemas/bugs.test.ts) |
| BUG-04 | Buat bug | 201; nomor 1 untuk bug pertama dengan default; reporter = pembuat; tanpa email di respons; semua field (label diurutkan, urutan link dipertahankan, assignee, test asal) | I, A, C | bugs.int.test.ts, [bugs.spec.ts](../../tests/api/bugs.spec.ts), [bugs.pact.test.ts](../../apps/web/test/contract/bugs.pact.test.ts) |
| BUG-05 | 20 bug dibuat paralel; nomor tidak dipakai ulang setelah dihapus | Nomor 1 sampai 20 unik dan berurutan; setelah #20 dihapus bug baru bernomor 21 | I | bugs.int.test.ts |
| BUG-06 | `assigneeId` bukan anggota; `testCaseId`/`runId` milik project lain; run tanpa hasil test itu; `runId` tanpa `testCaseId` | 400 dengan `fields.assigneeId`/`testCaseId`/`runId`; tidak ada bug tersimpan | I, A | bugs.int.test.ts, bugs.spec.ts |
| BUG-07 | Edit: satu event per field berubah (deskripsi tanpa menyalin nilai), `version` naik 1, `updatedAt` berubah; nilai yang sama (label beda urutan atau huruf) adalah no-op 200 tanpa event | Sesuai spec 3.3 | I | bugs.int.test.ts |
| BUG-08 | Konflik: `version` usang; dua PATCH paralel dengan `version` sama | 409 `BUG_CONFLICT` tanpa perubahan; tepat satu pemenang, event hanya dari pemenang | I, A, C, E | bugs.int.test.ts, bugs.spec.ts, bugs.pact.test.ts, [bug-detail.spec.ts](../../tests/e2e/bug-detail.spec.ts) |
| BUG-09 | Transisi tidak sah dan transisi lewat API | 409 `INVALID_TRANSITION` (mis. `closed`→`resolved`); `resolved` tanpa resolusi 400 pada `fields.resolution`; PATCH ke status sama adalah no-op (Ruling T11-a) | I, A, C | bugs.int.test.ts, bugs.spec.ts, bugs.pact.test.ts |
| BUG-10 | Update gagal di tengah (error dipaksa) | 500; bug tidak berubah dan tidak ada event tertulis (transaksi yang sama) | I | bugs.int.test.ts |
| BUG-11 | Anggota dikeluarkan atau keluar sendiri | Assignee semua bug project itu dikosongkan dengan event (actor = pengeluar atau orang itu); ubah role tidak menyentuh assignee | I | bugs.int.test.ts |
| BUG-12 | Run asal terhapus | `runId` jadi null, test asal tetap; kartu test asal menampilkan "Run asal tidak tersedia" (Ruling F-a) | I, E | bugs.int.test.ts, bug-detail.spec.ts |
| BUG-13 | Hapus bug (admin) | 204; GET berikutnya 404 `BUG_NOT_FOUND`; tester dan viewer 403 | I, A, C, E | bugs.int.test.ts, bugs.spec.ts, bugs.pact.test.ts, bug-detail.spec.ts |
| BUG-14 | Skema database | Tabel dan indeks spec bagian 5 (termasuk indeks parsial), `CHECK` enum, default, nomor unik per project, `ON DELETE` (run dan test asal `SET NULL`, anak bug dan project `CASCADE`); data Tahap 2 utuh; migrasi 0004 menambah `bug_links (bug_id, position)`, `bugs (run_id)`, dan `bugs (test_case_id)` di atas data 0003 (indeks parsial lencana tetap) | I | [migration-0003.int.test.ts](../../apps/api/test/integration/migration-0003.int.test.ts), [migration-0004.int.test.ts](../../apps/api/test/integration/migration-0004.int.test.ts) |

### 4.2 Daftar bug, label, dan komentar

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| LST-01 | Filter `status` (`active` bawaan, `done`, `all`, satu status), `assignee` (`me`, `none`, uuid), `priority`, `severity`, `label` (tidak peka huruf besar-kecil dan spasi), `q` (judul, tidak peka huruf, `%`/`_`/`\` literal) | Hasil sesuai; anonim dengan `assignee=me` di project publik: 200 daftar kosong (Ruling T4-a) | I, A | bugs.int.test.ts, bugs.spec.ts |
| LST-02 | Urutan `updated` (bawaan), `created`, `priority` (urgent dulu lalu `updated_at` turun) | Sesuai | I | bugs.int.test.ts |
| LST-03 | Pagination: 30 bug, 25 per halaman lalu cursor | Tanpa duplikat atau terlewat, juga untuk waktu kembar dan selisih mikrodetik, di ketiga urutan; cursor rusak atau dari urutan lain: 400 `fields.cursor` | U, I | [cursor.test.ts](../../apps/api/src/modules/bugs/cursor.test.ts), bugs.int.test.ts |
| LST-04 | `GET /bugs/labels` | Label unik project ini, urut code unit (tidak bergantung collation), maks. 200 | I | bugs.int.test.ts |
| LST-05 | `GET /bugs/:number` | 404 `BUG_NOT_FOUND` untuk nomor tak dikenal, bukan angka, di luar int4, atau milik project lain; query melewati `statement_timeout`: 503 (otorisasi tetap lebih dulu) | I, A, C | bugs.int.test.ts, bugs.spec.ts, bugs.pact.test.ts |
| CMT-01 | Komentar: tulis, edit sendiri, hapus lunak ("Komentar dihapus"), 1 sampai 10.000 karakter setelah trim | 201/200/204; edit mengisi `editedAt`; komentar baru memperbarui `updatedAt` bug tanpa menaikkan `version` (Ruling T5-a) | U, I, A, C | [bug-comments.int.test.ts](../../apps/api/test/integration/bug-comments.int.test.ts), bugs.spec.ts, bugs.pact.test.ts |
| CMT-02 | Hak komentar | Penulis (tester/admin) mengubah dan menghapus miliknya; admin menghapus milik siapa pun; komentar orang lain tidak bisa diedit siapa pun; hapus ulang 204 (idempoten); edit komentar terhapus 404 `COMMENT_NOT_FOUND` (Ruling T5-b) | I, A, E | bug-comments.int.test.ts, bugs.spec.ts, bug-detail.spec.ts |
| CMT-03 | Aktivitas: komentar dan event digabung lama ke baru, 50 per halaman | Cursor aktivitas stabil; lebih dari 50 item dimuat bertahap dan komentar baru tetap tampil di akhir | U, I, E | [activity-cursor.test.ts](../../apps/api/src/modules/bugs/activity-cursor.test.ts), bug-comments.int.test.ts, bug-detail.spec.ts |

### 4.3 Otorisasi bug

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| AUT-01 | Matriks bagian 6.3 spec untuk 6 aktor (anonim publik/privat, non-anggota publik/privat, viewer, tester, admin) di semua endpoint bug | GET: privat 404 / publik 200 untuk anonim dan non-anggota; tulis: anonim 401, non-anggota 404/403, viewer 403, tester 2xx; hapus bug: tester 403, admin 204; komentar orang lain: 403 / admin hapus 204 | U, I, A | [permissions.test.ts](../../apps/api/src/modules/projects/domain/permissions.test.ts), bugs.int.test.ts, [authorization-matrix.ts](../../tests/api/authorization-matrix.ts), [authorization.spec.ts](../../tests/api/authorization.spec.ts) |
| AUT-02 | Token CI bukan kredensial di endpoint bug, versi, dan perbandingan | Bearer sah diperlakukan anonim: project privat 404, project publik hanya baca | I, A | bugs.int.test.ts, [compare.int.test.ts](../../apps/api/test/integration/compare.int.test.ts), bugs.spec.ts, [compare.spec.ts](../../tests/api/compare.spec.ts) |
| AUT-03 | Akses project diputuskan sebelum validasi body atau query | Non-anggota project privat selalu 404, tidak 400 | I | bugs.int.test.ts |

### 4.4 Versi run dan urutan versi

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| VER-01 | Validasi `version`: 1 sampai 50 karakter `[A-Za-z0-9._+-]` | Bentuk lain (`1%200`, `a/b`, kosong, 51 karakter): 400 `fields.version` dan tidak ada run | U, I, A | [results.test.ts](../../packages/shared/src/schemas/results.test.ts), [run-version.int.test.ts](../../apps/api/test/integration/run-version.int.test.ts), compare.spec.ts |
| VER-02 | Upload dengan dan tanpa `version` | Tersimpan di `runs.version` dan tampil di semua DTO run; tanpa `version`: null dan upload tetap diterima | I, A | run-version.int.test.ts, compare.spec.ts |
| VER-03 | `GET /runs?version=` | Menyaring run, bisa digabung dengan `branch` dan cursor; nilai tidak sah 400 | I, A | run-version.int.test.ts, compare.spec.ts |
| VER-04 | Penguraian dan perbandingan semver | Bentuk sah dan tidak sah; numerik bukan leksikal dan eksak untuk bilangan sangat besar; pre-release menurut semver 2.0 (rantai contoh resminya); prefiks `v` dan `+build` diabaikan | U | [versions.test.ts](../../apps/api/src/modules/results/domain/versions.test.ts) |
| VER-05 | Urutan versi per branch | Semua semver: urut semver tak bergantung waktu; satu non-semver: semua versi branch itu menurut waktu run terakhir; ejaan semver-setara digabung hanya bila semua semver; stabil pada waktu kembar dan urutan input | U | versions.test.ts |
| VER-06 | `GET /versions` | Terbaru dulu, `runCount`, `passRate` (null bila tanpa test dijalankan), `passRateDelta` terhadap versi di bawahnya (null untuk yang terendah); maks. 100 dengan delta versi ke-100 tetap benar; `v1.0.1` dan `1.0.1` satu entri; project tanpa run: `[]` | I, A, C | compare.int.test.ts, compare.spec.ts, [compare.pact.test.ts](../../apps/web/test/contract/compare.pact.test.ts) |

### 4.5 Perbandingan

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| CMP-01 | `classify` untuk semua kelompok | Regresi, diperbaiki, masih gagal, lebih lambat, baru, hilang; `skipped` hanya terdaftar sebagai baru/hilang; lulus-setelah-retry dihitung lulus dengan tanda flaky; tes yang tidak berubah tidak muncul | U | [compare.test.ts](../../apps/api/src/modules/results/domain/compare.test.ts) |
| CMP-02 | Ambang "lebih lambat" tepat di batas | `1000→1500` bukan (rasio 1,5); `2000→3001` ya; `2000→3000` bukan; `100→1200` ya; `100→1100` bukan (selisih persis 1000); lebih cepat tidak pernah; dasar 0 ms bisa | U | compare.test.ts |
| CMP-03 | Pembanding default (`pickBaseline`) | Run terakhir versi tepat di bawah (melewati run versi sendiri); `v1.0.1` dan `1.0.1` satu versi; tanpa versi atau versi terendah: run tepat sebelumnya; mode waktu bila ada non-semver; run tunggal: null | U | [baseline.test.ts](../../apps/api/src/modules/results/domain/baseline.test.ts) |
| CMP-04 | Target default (`pickDefaultTarget`) | Run terakhir dari versi tertinggi (bukan run terbaru); tanpa versi: run terakhir | U | baseline.test.ts |
| CMP-05 | `GET /compare` pembanding default | `1.0.0` (2 run) lalu `1.0.1`: base = run terakhir `1.0.0`; tanpa versi: run terakhir vs sebelumnya; satu run atau tanpa run: `base`/`target` null dan semua kelompok kosong | I, A, C | compare.int.test.ts, compare.spec.ts, compare.pact.test.ts |
| CMP-06 | Kelompok pada data berpola | Isi tiap kelompok benar, urut suite lalu nama; `skipped` diabaikan | I | compare.int.test.ts |
| CMP-07 | Pagination kelompok | 250 test baru: 200 pertama + `nextCursor`; `?group=added&cursor=` memberi 50 sisanya; cursor terikat pada pasangan run (upload baru menggeser default: 400 `fields.cursor`); kontrak halaman kelompok memakai cursor buatan provider (`fromProviderState`) | U, I, A, C | [cursor.test.ts](../../apps/api/src/modules/results/cursor.test.ts), compare.int.test.ts, compare.spec.ts, compare.pact.test.ts |
| CMP-08 | Mode ringkasan `groups=none` (Ruling T10-d) | Angka ringkasan sama dengan mode penuh, semua kelompok kosong, tanpa query pesan dan badge bug; tanpa pembanding bentuk sama; nilai lain atau bersama `group`: 400; ringkasan di-cache per (project, base, target), pasangan lain dan respons penuh dihitung segar, otorisasi dan run terhapus tetap diperiksa (Ruling F-b) | I, A, C | compare.int.test.ts, compare.spec.ts, compare.pact.test.ts, [compare.test.ts](../../packages/shared/src/schemas/compare.test.ts) |
| CMP-09 | Parameter tidak valid | `base` sama dengan `target`: 400; id run tak dikenal, project lain, atau bukan UUID: 404 `RUN_NOT_FOUND`; cursor tanpa `group`, cursor rusak, `group` tak dikenal: 400 | I, A, C | compare.int.test.ts, compare.spec.ts, compare.pact.test.ts |
| CMP-10 | Kalimat kesimpulan | Semua kasus: regresi (dengan dan tanpa perbaikan), hanya perbaikan, bersih, tanpa pembanding; label versi dengan `v` hanya bila diawali angka; label kembar dibedakan id run (Ruling T10-a/b/c) | U | [compareSummary.test.ts](../../apps/web/src/lib/compareSummary.test.ts) |
| CMP-11 | Badge bug pada data hasil test | Bug non-`closed` yang tertaut ke test muncul di detail run, daftar flaky, riwayat test, dan perbandingan (maks. 5, terbaru dulu); jumlah query sama untuk 1 dan 100 test bertaut; daftar flaky ter-cache langsung mengikuti bug baru dan bug yang ditutup (Ruling T1-b); bug project lain tidak pernah muncul | I | compare.int.test.ts, [results-read.int.test.ts](../../apps/api/test/integration/results-read.int.test.ts) |
| CMP-12 | `testHint` di detail bug | 20 hasil terakhir di branch run asal, `consecutivePasses`, `lastStatus`; run asal terhapus: branch dari hasil terbaru; bug tanpa test: null | I, C | compare.int.test.ts, bugs.pact.test.ts |
| CMP-13 | Otorisasi baca | Publik: anonim 200; privat: anonim, non-anggota, dan Bearer token CI 404 `PROJECT_NOT_FOUND`; viewer 200 | I, A | compare.int.test.ts, compare.spec.ts |

### 4.6 Tampilan: navigasi, bug, perbandingan, versi

Semua halaman di bawah lolos `expectNoA11yViolationsInBothThemes` (0 pelanggaran axe serious/critical di dua tema), tanpa gulir horizontal di 375 px, dan gate CSP.

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| NAV-01 | Tab project (Ringkasan, Run, Versi, Bug, Flaky, Pengaturan) | Anggota melihat enam tab, pengunjung lima; `aria-current` pada tab aktif; tampil di Run, Flaky, detail run, dan Pengaturan (aktif); `?branch=` dibawa tab Ringkasan, Run, Versi, dan Flaky; keyboard menjangkau semua tab; di 375 px dan 320 px tab bergulir di wadahnya dan tab aktif tergulir ke tampilan | U, E | [navigation.test.ts](../../apps/web/src/lib/navigation.test.ts), [navigation.spec.ts](../../tests/e2e/navigation.spec.ts) |
| UIB-01 | Daftar bug | Tab Aktif/Selesai/Semua dan filter tersimpan di URL (bertahan setelah reload); "Bug saya", "Belum di-assign"; parameter URL tidak valid hanya menggugurkan dirinya; 30 bug: 25 lalu "Muat lagi"; keadaan kosong; kontrol Buat bug hanya untuk tester dan admin | E | [bugs.spec.ts](../../tests/e2e/bugs.spec.ts) |
| UIB-02 | Buat bug | Judul wajib (pesan di bawah field dan fokus); pratinjau Markdown aman; label dan link dinormalkan lalu tersimpan; kesalahan 400 dipetakan ke baris yang benar; viewer dan anonim tidak bisa | U, E | [bugForm.test.ts](../../apps/web/src/lib/bugForm.test.ts), bugs.spec.ts |
| UIB-03 | Laporkan bug dari test gagal (detail run, perbandingan, riwayat) | Form terisi (judul = nama test tanpa karakter kontrol, maks. 200 karakter tanpa memotong pasangan surrogate; deskripsi: suite, branch, commit, link CI, pesan error dalam blok kode; severity `major`); badge menggantikan tombol; viewer dan anonim melihat badge saja; suite atau link CI berbahaya tidak menjadi Markdown | U, E | [bugReport.test.ts](../../apps/web/src/lib/bugReport.test.ts), [bugReportSource.test.ts](../../apps/web/src/pages/project/bugReportSource.test.ts), bugs.spec.ts, [compare.spec.ts](../../tests/e2e/compare.spec.ts) |
| UIB-04 | Detail bug: alur lengkap | Assign, mulai kerjakan, komentar, selesai dengan resolusi inline, buka ulang; timeline memuat semuanya; edit inline judul dan deskripsi; konfirmasi hapus inline; konflik dua tab menampilkan banner dan memuat ulang | U, E | [bugTransitions.test.ts](../../apps/web/src/lib/bugTransitions.test.ts), [bugSave.test.ts](../../apps/web/src/lib/bugSave.test.ts), [bugActivity.test.ts](../../apps/web/src/lib/bugActivity.test.ts), bug-detail.spec.ts |
| UIB-05 | Detail bug: galat, fokus, dan pengumuman | Galat server tampil di bawah kolomnya dan nilai kembali; fokus berpindah ke kolom atau tombol yang tepat (galat daftar link memfokuskan pesannya, bukan tombol Tambah yang nonaktif di 10 link); status diumumkan lewat region live; `INVALID_TRANSITION` tidak mengubah status | E | bug-detail.spec.ts |
| UIB-06 | Badge bug di daftar flaky dan riwayat test; kartu test asal | Menaut ke bug dan hilang setelah ditutup; petunjuk "Lulus N run terakhir" atau "Masih gagal" | E | bug-detail.spec.ts |
| UIB-07 | Hak baca bug | Viewer dan anonim di project publik hanya membaca; project privat dan nomor tak dikenal: tidak ditemukan | E | bugs.spec.ts, bug-detail.spec.ts |
| UIC-01 | Kartu perbandingan di dashboard | Kalimat peringatan dan angka, lalu menuju halaman perbandingan; tanpa versi memakai run sebelumnya; run versi sama dibedakan id run; kartu memesan tempat tanpa menggeser isi; galat ringkasan di dalam kartu dengan Coba lagi; satu run: kartu tidak tampil | E | compare.spec.ts |
| UIC-02 | Halaman perbandingan | Judul, kalimat, ringkasan berurutan, kelompok terbuka/tertutup, isi baris (status, durasi, pesan error); kelompok kosong satu baris; mengganti base/target lewat `<select>` dan URL dapat dibagikan; base sama dengan target dan run tak dikenal ditolak dengan pesan; kelompok besar: 200 pertama lalu "Muat lagi" dan cursor usang menawarkan muat ulang | E | compare.spec.ts |
| UIC-03 | Panel perbandingan di detail run | "Dibanding {base}" dengan ringkasan yang sama; halaman tampil lebih dulu dan panel memesan tempat; galat di dalam panel | E | compare.spec.ts |
| UIC-04 | Halaman versi dan label versi | Tabel dengan pass rate, perubahan, dan tautan bandingkan; daftar terpotong di batas API tidak menyebut "Versi pertama"; pemilih branch dan keadaan kosong; label versi di daftar run; anonim membuka halaman project publik | E | compare.spec.ts |
| UIC-05 | Layar 375 px | Dashboard, perbandingan, dan versi tanpa gulir mendatar; kolom sebelum/sesudah bertumpuk | E | compare.spec.ts |
| MKD-01 | Sanitasi Markdown | `javascript:`, `data:`, `vbscript:` dan variasinya (huruf campur, spasi, tab, entity) dibuang; `http`, `https`, `mailto` lolos; gambar jadi tautan; HTML mentah jadi teks; tanpa atribut `style`; catatan kaki jadi teks | U | [markdown-url.test.ts](../../apps/web/src/lib/markdown-url.test.ts), [Markdown.test.ts](../../apps/web/src/components/Markdown.test.ts) |
| MKD-02 | Markdown berbahaya di browser | `<script>`, `<img onerror>`, tautan `javascript:`, gambar eksternal tampil inert untuk pemilik, viewer, dan anonim; pratinjau juga inert; tautan aman membuka tab baru tanpa opener; nol pelanggaran CSP | E | [markdown.spec.ts](../../tests/e2e/markdown.spec.ts) |

### 4.7 Reporter, dogfooding, dan klien

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| REP-09 | `--app-version` pada reporter | Divalidasi sama dengan server (exit 2 bila salah); dikirim sebagai query `version`; kontrak: upload dengan `version` diverifikasi provider | U, C | [args.test.ts](../../packages/reporter/src/args.test.ts), [cli.test.ts](../../packages/reporter/src/cli.test.ts), [upload.test.ts](../../packages/reporter/src/upload.test.ts), [ingest.pact.test.ts](../../packages/reporter/test/contract/ingest.pact.test.ts) |
| REP-10 | Dijalankan manual terhadap stack Docker dengan `--app-version` | Exit 0; run tampil berversi di daftar run, halaman versi, dan kartu perbandingan | (manual, dicatat di laporan tugas) | |
| DOG-05 | Dogfooding mengirim versi | `deploy.yml` memberi `--app-version` dari `version` di `package.json` root (`0.3.0`); naikkan nilainya setiap rilis tahap | (CI) | [deploy.yml](../../.github/workflows/deploy.yml) |
| SMK-02 | Setelah deploy | `/p/testpulse` menampilkan run berversi `0.3.0` dan kartu perbandingan (pemeriksaan manual setelah deploy pertama Tahap 3; smoke otomatis tetap hanya memeriksa adanya run) | (manual) | [smoke.spec.ts](../../tests/smoke/smoke.spec.ts) |
| CLI-01 | Klien API web | Fungsi dan tipe bug, versi, dan perbandingan memakai schema shared; `formatDuration`, persen, dan tanggal | U | [api-client.test.ts](../../apps/web/test/unit/api-client.test.ts), [format.test.ts](../../apps/web/src/lib/format.test.ts) |
| CTR-01 | Kontrak web dan API untuk endpoint baru | Satu interaksi sukses per endpoint baru, plus `404 BUG_NOT_FOUND`, `404 COMMENT_NOT_FOUND`, `404 RUN_NOT_FOUND`, `409 BUG_CONFLICT`, `409 INVALID_TRANSITION`; provider memverifikasi terhadap API dan Postgres asli | C | bugs.pact.test.ts, compare.pact.test.ts, [states.ts](../../apps/api/test/contract/states.ts) |

### 4.8 Visual regression dan performa

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| VIS-01 | Landing, dashboard, perbandingan, daftar bug, detail bug; tema terang dan gelap; 1280 x 800 dan 375 x 812; daftar dan detail bug juga sebagai tester | 76 screenshot (halaman penuh dan elemen kunci) cocok dengan baseline dengan toleransi ketat (50 piksel halaman, 10 piksel elemen) | V | [pages.spec.ts](../../tests/visual/pages.spec.ts), [seed.ts](../../tests/visual/seed.ts), [timestamps.ts](../../tests/visual/timestamps.ts) |
| VIS-02 | Render deterministik dan sebanding antar mesin | Container Playwright resmi yang sepaket dengan versi terpasang; jam dibekukan, waktu di respons API ditulis ulang, animasi dimatikan, font dimuat; gate benar-benar bisa gagal (mengubah satu warna utama menggagalkan 14 screenshot) | V | [visual.sh](../../scripts/visual.sh), [visual-baselines.yml](../../.github/workflows/visual-baselines.yml) |
| PRF-03 | `read`: 10 VU x 30 detik membaca `stats`, `runs`, `flaky`, `bugs`, `compare`, `compare?groups=none`, `versions` pada project berisi 55 run berversi dan 120 bug | p95 durasi < 300 ms; `http_req_failed` < 1%; `checks` > 0,99 (respons diperiksa isinya: halaman penuh 25 bug dengan cursor, pembanding terisi, minimal 50 versi); `http_reqs` > 0 (gagal tertutup) | P | [read.js](../../tests/perf/read.js), [setup.mjs](../../tests/perf/setup.mjs) |

### 4.9 Keamanan tambahan

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| SEC-07 | XSS lewat Markdown (deskripsi dan komentar project publik) | Tidak ada elemen atau handler dari input; tautan terfilter; gambar tidak dimuat; CSP tidak dilonggarkan dan tidak ada pelanggaran | U, E | markdown-url.test.ts, Markdown.test.ts, markdown.spec.ts |
| SEC-08 | Kebocoran email dan keberadaan project | Respons bug dan komentar hanya memuat id dan nama pengguna, tanpa email; project privat 404 identik | I, A | bugs.int.test.ts, bugs.spec.ts |
| SEC-09 | Injeksi lewat pencarian dan filter | `q` dengan `%`, `_`, `\` dicocokkan literal (query berparameter); `label` dinormalkan; cursor dari urutan lain atau rusak ditolak | I | bugs.int.test.ts |
| SEC-10 | Karakter kontrol dan batas ukuran | Karakter kontrol (kecuali tab, baris baru) ditolak di judul, deskripsi, dan komentar; batas panjang tepat di boundary (Ruling T5-c) | U, I | bugs.test.ts, bug-comments.int.test.ts |
| SEC-11 | Pindai ZAP baseline | 0 temuan High terhadap stack yang sama | (CI) | job `zap` di ci.yml |

## 5. Cara menjalankan

Perintah lengkap per lapisan ada di [README](../../README.md#menjalankan-test-per-lapisan). Pipeline otomatis ada di [`ci.yml`](../../.github/workflows/ci.yml); hasil terbaru dilaporkan di <https://safeqq.github.io/testpulse/> dan di dashboard TestPulse sendiri (`/p/testpulse`).

Tambahan untuk Tahap 3:

```bash
pnpm test:contract                                # web (bug, perbandingan) dan reporter sebagai consumer, lalu provider API
docker compose up -d --build --wait
pnpm test:visual                                  # bandingkan dengan baseline; pnpm test:visual:update bila perubahan disengaja
node tests/perf/setup.mjs                         # data k6: 55 run berversi 0.1.0 .. 0.55.0 dan 120 bug; skenario read memakainya
BASE_URL=http://localhost:8080 pnpm --filter @testpulse/tests screenshots   # screenshot dokumentasi (stack kosong)
```

## 6. Risiko pengujian dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Nomor bug ganda atau melompat saat pembuatan paralel | Nomor dari `UPDATE projects SET bug_seq = bug_seq + 1 ... RETURNING` dalam transaksi yang sama; 20 bug paralel diuji di database asli |
| Dua penyunting menimpa perubahan satu sama lain | `version` pada setiap PATCH; konflik 409 diuji paralel di integration, API, kontrak, dan UI (banner dan muat ulang) |
| Riwayat tidak sinkron dengan data (event tertulis tanpa update, atau sebaliknya) | Event dan update dalam satu transaksi; test memaksa error di tengah dan memeriksa tidak ada event |
| Urutan versi tidak konsisten (campuran semver dan non-semver) | Satu aturan per branch ([ADR 0005](../adr/0005-perbandingan-versi-dan-markdown-aman.md)); unit test untuk rantai semver resmi, pre-release, prefiks `v`, dan campuran |
| Perbandingan menandai terlalu banyak (atau terlalu sedikit) regresi | Definisi tegas dan diuji tepat di batas (1,5x dan 1000 ms; `skipped` diabaikan); data berpola di integration test |
| Pembanding default membandingkan versi dengan dirinya sendiri | Aturan "versi tepat di bawah" diuji, termasuk `v1.0.1` vs `1.0.1`, run ulang versi sama, dan cursor yang terikat pada pasangan run |
| Perbandingan atau daftar bug lambat pada skala besar | `statement_timeout` 5 detik (503), halaman 200/100 per kelompok, mode ringkasan; gate k6 pada 55 run berversi dan 120 bug; badge bug satu query untuk semua test |
| XSS atau pelonggaran CSP lewat Markdown pengguna | Tanpa HTML mentah, URL terfilter, gambar jadi tautan, tanpa `style`; E2E dengan muatan berbahaya di bawah gate CSP |
| Tab, filter, dan formulir tidak bisa dipakai keyboard atau pembaca layar | Fokus dan pengumuman diuji di E2E; axe di dua tema pada setiap halaman baru, termasuk keadaan konflik dan konfirmasi |
| Tampilan berubah tanpa disengaja | Visual regression ketat di container resmi; baseline diperbarui hanya lewat `test:visual:update` setelah gambar ditinjau; noise render lintas mesin ditangani workflow `visual-baselines.yml` |
| Perubahan skema merusak data production | Migrasi hanya menambah; diuji di atas database berisi data Tahap 2 |
| Dogfooding berversi menggagalkan deploy | Langkah tetap `continue-on-error`; `--app-version` dibaca dari `package.json` dengan `node -p` tanpa tool tambahan; kedua workflow dilint dengan actionlint |
