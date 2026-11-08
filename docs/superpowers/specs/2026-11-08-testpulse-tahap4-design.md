# TestPulse — Spec Tahap 4: Test case manual, test run manual & mutation testing

- **Tanggal:** 2026-11-08
- **Status:** Draft, menunggu review
- **Prasyarat:** Tahap 3 live (bug tracker, versi & perbandingan, visual regression, dogfooding `0.3.0` ke `/p/testpulse`).
- **Ruang lingkup:** `apps/api` (modul baru `manual`, perluasan `bugs` dan `results`), `apps/web` (tab "Test manual", halaman case/run/eksekusi, perluasan Versi, dashboard, bug), `packages/shared` (schema), `tests/` (semua lapisan + baseline visual baru), `tests/perf`, workflow CI baru `mutation.yml`, skrip seed dogfooding, dokumentasi. Juga mengikat: spec Tahap 1 (otorisasi, keamanan), spec UI 2026-10-26 (CSP, komponen, tema), spec Tahap 2 (hasil test), spec Tahap 3 (bug, versi, Markdown aman, visual regression).

## 1. Konteks & tujuan

Sampai Tahap 3, TestPulse hanya menampung hasil **automated test** yang dikirim dari CI. Tahap 4 menambahkan sisi **test manual** agar satu tim bisa mengelola keduanya di satu tempat:

1. **Test case manual**: case tersusun dalam suite, dengan prasyarat dan langkah terstruktur (aksi + hasil yang diharapkan), prioritas, label, dan tautan opsional ke automated test yang menggantikannya.
2. **Test run manual**: tester memilih suite/case, TestPulse menyalin isinya ke run (snapshot), lalu tester mengeksekusi case satu per satu dengan hasil per langkah. Case gagal bisa langsung dilaporkan menjadi bug.
3. **Satu tampilan per versi**: halaman Versi menampilkan hasil automated dan manual untuk versi yang sama berdampingan, ditambah **cakupan otomasi** (berapa case manual yang sudah punya automated test).

Lapisan QA baru untuk TestPulse sendiri: **mutation testing** dengan StrykerJS pada kode domain, untuk membuktikan test unit benar-benar menangkap kesalahan, bukan sekadar menjalankan baris kode.

**Kriteria sukses:**

- Tim bisa menyusun suite dan case, membuat run untuk sebuah versi, mengeksekusinya sampai selesai, dan melaporkan bug dari case yang gagal.
- Halaman Versi dan dashboard menampilkan hasil manual di samping hasil CI.
- Mutation score kode domain ≥ 80% dengan laporan publik.
- `/p/testpulse` di production berisi test case manual milik TestPulse sendiri dan satu run manual nyata untuk `0.4.0`.

## 2. Keputusan

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Struktur case | **Suite satu tingkat + langkah terstruktur** (aksi + hasil yang diharapkan) | Format standar QA, cukup rapi tanpa kerumitan folder bertingkat. |
| Model run | **Snapshot + hasil per langkah** | Run lama tidak berubah saat case diedit; hasil per langkah membuat laporan bug presisi. |
| Integrasi | **Satu tampilan per versi** + cakupan otomasi lewat tautan ke test Tahap 2 | Menjawab "apakah versi ini siap rilis?" dari dua sisi sekaligus. |
| Arsitektur | **Hybrid**: entitas relasional (suite, case, run, run case); langkah dan hasil langkah disimpan sebagai **JSONB** | Langkah selalu dibaca/ditulis bersama case-nya; menghindari ratusan baris per run tanpa kehilangan integritas relasi. |
| Mutation testing | **StrykerJS pada folder domain**, workflow terjadwal + manual, gate ≥ 80% | Bukti kualitas test yang jarang dimiliki portfolio; dijadwalkan agar CI utama tetap cepat. |

## 3. Model test case

### 3.1 Suite

| Field | Aturan |
|---|---|
| `name` | Di-trim, 1–100 karakter, unik per project tanpa membedakan huruf besar/kecil (`400 VALIDATION_ERROR`, `fields.name`: "Nama suite sudah dipakai"). |
| `description` | Teks biasa, 0–2000 karakter. |
| `position` | Urutan tampil (0, 1, 2, …). Suite baru di posisi terakhir. |

- Pindah urutan: `PATCH` dengan `position` tujuan (0-based, dibatasi ke rentang yang ada). Server menomori ulang semua suite project itu dalam satu transaksi.
- Suite hanya bisa dihapus bila **tidak berisi case sama sekali**, termasuk case yang diarsipkan (`409 SUITE_NOT_EMPTY`). Pesan: "Pindahkan atau hapus case di suite ini terlebih dahulu."
- Suite tidak punya `version` (edit terakhir yang menang): datanya kecil dan jarang diedit bersamaan.

### 3.2 Case

| Field | Aturan |
|---|---|
| `number` | `TC-<n>`, urut per project mulai 1; tidak dipakai ulang walau case dihapus. |
| `suiteId` | Wajib, suite milik project ini (`400`, `fields.suiteId`). Case bisa dipindah ke suite lain. |
| `title` | Di-trim, 3–200 karakter. |
| `preconditions` | Markdown, 0–5000 karakter. |
| `steps` | 1–50 langkah, urutan bermakna. Tiap langkah `{ action, expected }`: `action` Markdown 1–2000 karakter (di-trim, wajib), `expected` Markdown 0–2000 karakter. Error per langkah memakai `fields["steps.<i>.action"]`. |
| `priority` | `low` · `medium` · `high` · `urgent` (default `medium`). |
| `labels` | Sama dengan aturan label bug: maks 10, unik, 1–30 karakter `[a-z0-9-]`, input di-lowercase. |
| `automatedTestId` | Opsional; `test_case` (hasil Tahap 2) milik project ini (`400`, `fields.automatedTestId`). Bila test itu terhapus → `null`. |
| `archivedAt` | `null` = aktif. Case diarsipkan tidak bisa dipilih untuk run baru; riwayat run tetap ada. Bisa dipulihkan. |
| `createdBy`, `updatedBy`, `createdAt`, `updatedAt`, `version` | Diisi server. `version` (integer, mulai 1) untuk optimistic concurrency → `409 CASE_CONFLICT`. |

- Hapus permanen hanya admin. Run lama tetap utuh karena memakai snapshot; tautannya ke case menjadi `null`.
- Markdown memakai renderer aman Tahap 3 (HTML mentah di-escape, link hanya http/https/mailto, gambar tampil sebagai link).

## 4. Model test run manual

### 4.1 Run

| Field | Aturan |
|---|---|
| `number` | `TR-<n>`, urut per project mulai 1; tidak dipakai ulang. |
| `name` | Di-trim, 3–120 karakter. |
| `appVersion` | Opsional, format sama dengan versi run CI: 1–50 karakter `[A-Za-z0-9._+-]`. |
| `status` | `open` · `completed`. Run baru `open`. |
| `createdBy`, `createdAt`, `updatedAt`, `completedBy`, `completedAt`, `version` | Diisi server. `version` → `409 MANUAL_RUN_CONFLICT`. |

Nama field `appVersion` dipakai di seluruh modul manual agar tidak tertukar dengan `version` untuk concurrency.

### 4.2 Membuat run

- Input: `suiteIds[]` dan/atau `caseNumbers[]` (minimal salah satu tidak kosong).
- Seleksi = semua case **aktif** di suite terpilih ∪ case satuan terpilih, tanpa duplikat, diurut posisi suite lalu nomor case. Hasilnya harus 1–500 case (`400`, `fields.selection`: "Pilih 1–500 case aktif").
- Suite tak dikenal → `400 fields.suiteIds`. Nomor case tak dikenal atau diarsipkan → `400 fields.caseNumbers`.
- Setiap case disalin menjadi **run case** (snapshot): nomor case, judul, nama & posisi suite, prasyarat, langkah, prioritas. Snapshot tidak pernah ikut berubah saat case diedit, dipindah, diarsipkan, atau dihapus.
- Dibuat dalam satu transaksi (nomor run + semua run case).

### 4.3 Run case (hasil eksekusi)

| Field | Aturan |
|---|---|
| `status` | `untested` · `passed` · `failed` · `blocked` · `skipped`. Awal `untested`. Selalu **dipilih tester secara eksplisit**. |
| `stepResults` | Array sepanjang langkah snapshot (panjang lain → `400 fields.stepResults`). Tiap elemen `{ status: passed\|failed\|blocked\|skipped\|null, note }`, `note` 0–1000 karakter. |
| `note` | Markdown, 0–5000 karakter. |
| `assigneeId` | Anggota project atau `null` (`400 fields.assigneeId`). Anggota dikeluarkan → `null`. |
| `executedBy`, `executedAt` | Diisi server saat status diubah ke selain `untested`; dikosongkan saat kembali ke `untested`. |
| `version` | Optimistic concurrency → `409 MANUAL_RUN_CONFLICT`. |

**Saran status** (fungsi murni, ditampilkan UI sebagai saran, tidak disimpan otomatis):

1. Ada langkah `failed` → `failed`.
2. Ada langkah `blocked` → `blocked`.
3. Semua langkah terisi, minimal satu `passed`, sisanya `passed`/`skipped` → `passed`.
4. Semua langkah `skipped` → `skipped`.
5. Selain itu (ada langkah belum diisi) → tidak ada saran.

### 4.4 Menyelesaikan & membuka ulang

- `open → completed` dan `completed → open` diizinkan kapan saja oleh tester+. Menyelesaikan run dengan case `untested` diizinkan; UI meminta konfirmasi inline dengan jumlahnya.
- Selama `completed`: semua perubahan run (selain membuka ulang) dan run case ditolak `409 RUN_COMPLETED`. "Laporkan bug" tetap bisa.
- Status run diperiksa di transaksi yang sama dengan penulisan run case (kunci baris run), sehingga hasil tidak bisa tersimpan setelah run diselesaikan.
- Dua tester yang mengerjakan **case berbeda** di run yang sama tidak saling bentrok (`version` per run case).

### 4.5 Ringkasan run

`counts = { untested, passed, failed, blocked, skipped }`, `total`, `progress = (total − untested) / total` (run kosong tidak mungkin, tapi fungsi mengembalikan 0). Dihitung di query, bukan disimpan.

## 5. Integrasi

### 5.1 Halaman Versi (`GET /versions`)

Setiap baris versi mendapat `manual: ManualRunRef | null` = run manual **terbaru** (urut `createdAt`) yang `appVersion`-nya sama dengan versi itu. Pencocokan memakai `sameVersion` Tahap 3: bila keduanya semver, dibandingkan secara semver (prefiks `v` dan `+build` diabaikan); selain itu string harus sama persis. `ManualRunRef = { number, name, status, total, counts }`.

Versi yang **hanya punya run manual** juga tampil, dengan `run: null`, `runCount: 0`, `passRate: null`, `passRateDelta: null`:

1. Urutan versi automated di branch tetap persis aturan Tahap 3. `passRateDelta` hanya dihitung antarversi automated.
2. Bila versi automated semuanya semver (atau tidak ada), dan semua versi manual-saja juga semver, versi manual-saja disisipkan di posisi semver-nya.
3. Selain itu, versi manual-saja ditaruh di bawah semua versi automated, diurut waktu run manual terbarunya (terbaru dulu).
4. Total maksimal 100 baris (`MAX_VERSIONS`), terbaru dulu.

Run manual tidak punya branch. Karena itu versi manual-saja tampil di setiap pilihan branch.

### 5.2 Dashboard

`GET /manual/summary` → `{ latestRun: ManualRunSummaryDto | null, coverage: { active, automated } }`. Kartu "Test manual" menampilkan run terbaru (nama, versi, status, progres, hitungan) dan cakupan otomasi: "**12 dari 40** case aktif sudah diotomasi (30%)". Kartu tidak tampil bila project belum punya case. Persen cakupan dibulatkan ke bawah ke bilangan bulat (39/40 → 97%, bukan 98%); bila case aktif 0, persen `null` dan tidak ditampilkan.

### 5.3 Case ↔ automated test

Detail case dengan `automatedTestId` menampilkan test itu (suite, nama) beserta status terakhirnya di branch default project (branch run terbaru, sama dengan `stats`): `{ status, runId, createdAt, branch } | null`. Link ke riwayat test Tahap 2.

### 5.4 Bug dari run case

- `POST /bugs` menerima `manualRunCaseId` (opsional). Run case harus milik project ini (`400 fields.manualRunCaseId`). Tidak boleh digabung dengan `testCaseId`/`runId` (`400`).
- Isian awal dari UI: judul "TC-12 gagal: {judul case}" (dipotong ke 200 karakter); deskripsi berisi nama run, versi, suite, prasyarat, tabel langkah dengan hasil per langkah (langkah gagal ditandai **✗**) dan catatannya, serta catatan case. Severity `major`. Semua teks dari case di-escape untuk Markdown seperti prefill Tahap 3.
- `BugDto` + `manualOrigin: { runNumber, runName, caseNumber, caseTitle } | null`. Detail bug menampilkan "Dari test run manual **TR-3 · TC-12**" dengan link ke halaman eksekusinya.
- Run case DTO + `bugs: BugRef[]` (bug non-`closed` tertaut, maks 5, terbaru dulu), diambil dengan **satu** query untuk semua run case dalam respons.
- Menghapus run → `bugs.manual_run_case_id` menjadi `null`; bug tetap ada.

## 6. Model data

Migrasi `0005`, hanya menambah tabel/kolom/index (aman untuk DB production yang berisi data).

```
projects          + case_seq integer NOT NULL DEFAULT 0, + manual_run_seq integer NOT NULL DEFAULT 0
case_suites       id uuid PK, project_id uuid FK→projects ON DELETE CASCADE, name text, description text,
                  position integer, created_at, updated_at timestamptz,
                  UNIQUE INDEX (project_id, lower(name)), INDEX (project_id, position)
manual_cases      id uuid PK, project_id uuid FK→projects ON DELETE CASCADE, number integer,
                  suite_id uuid FK→case_suites ON DELETE RESTRICT, title text, preconditions text,
                  steps jsonb, priority text CHECK,
                  automated_test_id uuid NULL FK→test_cases ON DELETE SET NULL,
                  archived_at timestamptz NULL, created_by uuid FK→users, updated_by uuid FK→users,
                  version integer NOT NULL DEFAULT 1, created_at, updated_at timestamptz,
                  UNIQUE (project_id, number), INDEX (project_id, suite_id, number),
                  INDEX (automated_test_id) WHERE automated_test_id IS NOT NULL
manual_case_labels case_id uuid FK→manual_cases ON DELETE CASCADE, label text, PK (case_id, label)
manual_runs       id uuid PK, project_id uuid FK→projects ON DELETE CASCADE, number integer, name text,
                  app_version text NULL, status text CHECK, created_by uuid FK→users,
                  completed_by uuid NULL FK→users, completed_at timestamptz NULL,
                  version integer NOT NULL DEFAULT 1, created_at, updated_at timestamptz,
                  UNIQUE (project_id, number), INDEX (project_id, created_at DESC),
                  INDEX (project_id, app_version)
manual_run_cases  id uuid PK, run_id uuid FK→manual_runs ON DELETE CASCADE,
                  case_id uuid NULL FK→manual_cases ON DELETE SET NULL, position integer,
                  case_number integer, suite_name text, suite_position integer, title text,
                  preconditions text, steps jsonb, priority text,
                  status text CHECK, step_results jsonb, note text,
                  assignee_id uuid NULL FK→users ON DELETE SET NULL,
                  executed_by uuid NULL FK→users ON DELETE SET NULL, executed_at timestamptz NULL,
                  version integer NOT NULL DEFAULT 1, updated_at timestamptz,
                  INDEX (run_id, position), INDEX (run_id, status), INDEX (case_id)
bugs              + manual_run_case_id uuid NULL FK→manual_run_cases ON DELETE SET NULL,
                  INDEX (manual_run_case_id) WHERE status <> 'closed'
```

- Nomor `TC-`/`TR-` memakai pola Tahap 3: `UPDATE projects SET case_seq = case_seq + 1 … RETURNING` di dalam transaksi pembuatan.
- Isi JSONB selalu divalidasi schema shared sebelum ditulis dan setelah dibaca.
- Mengeluarkan anggota project mengosongkan `assignee_id` run case miliknya di project itu (sama seperti assignee bug).

## 7. API

Semua di bawah `/api/v1/projects/:slug`, autentikasi cookie sesi. Token CI **tidak** berlaku (diperlakukan anonim). Bentuk error tetap `{ error: { code, message, fields? } }`. Cursor buram; cursor rusak → `400`.

| Endpoint | Hak | Keterangan |
|---|---|---|
| `GET /suites` | baca | Semua suite urut `position`, masing-masing `{ id, name, description, position, activeCount, archivedCount }`. Maks 200 suite per project (`400` saat membuat yang ke-201). |
| `POST /suites` | tester+ | `201` + suite. |
| `PATCH /suites/:id` | tester+ | `{ name?, description?, position? }`. `404 SUITE_NOT_FOUND`. |
| `DELETE /suites/:id` | admin | `204`; `409 SUITE_NOT_EMPTY`. |
| `GET /cases?suite=&q=&priority=&label=&automated=&archived=&cursor=` | baca | 50 per halaman, urut posisi suite lalu nomor. `automated` = `yes` · `no`. `archived` = `false` (default) · `true`. `q` cari judul (≤ 100 karakter, `%`/`_` di-escape, tidak peka huruf besar/kecil). Respons `{ items: ManualCaseListItem[], nextCursor, coverage: { active, automated } }`; `coverage` untuk seluruh project, bukan hasil filter. Item: nomor, judul, suite, prioritas, label, jumlah langkah, `automated: boolean`, `archived: boolean`, `updatedAt`. |
| `POST /cases` | tester+ | `201` + case. |
| `GET /cases/labels` | baca | Label yang dipakai case di project ini (urut abjad, maks 200). |
| `GET /cases/:number` | baca | Detail + `automatedTest` (§5.3) + `recentResults` (maks 10 hasil run case terbaru: nomor & nama run, `appVersion`, status, `executedAt`). `404 CASE_NOT_FOUND`. |
| `PATCH /cases/:number` | tester+ | `{ version, suiteId?, title?, preconditions?, steps?, priority?, labels?, automatedTestId?, archived? }` (minimal satu field selain `version`). `steps`/`labels` mengganti seluruh daftar. |
| `DELETE /cases/:number` | admin | `204`. |
| `GET /tests?q=` | baca | Cari automated test Tahap 2 project ini berdasarkan nama atau suite (≤ 100 karakter, wajib ≥ 2 karakter), maks 20 `{ id, suite, name }`. |
| `GET /manual-runs?status=&appVersion=&cursor=` | baca | 20 per halaman, terbaru dulu. `status` = `open` · `completed` · `all` (default). Item = `ManualRunSummaryDto` (`number, name, appVersion, status, total, counts, progress, createdBy, createdAt, completedAt`). |
| `POST /manual-runs` | tester+ | `{ name, appVersion?, suiteIds, caseNumbers }` → `201` + run (§4.2). |
| `GET /manual-runs/:number` | baca | Detail run + ringkasan. `404 MANUAL_RUN_NOT_FOUND`. |
| `PATCH /manual-runs/:number` | tester+ | `{ version, name?, appVersion?, status? }`. Saat `completed`, hanya `{ status: "open" }` yang diterima. |
| `DELETE /manual-runs/:number` | admin | `204`. |
| `GET /manual-runs/:number/cases?status=&assignee=&suite=&cursor=` | baca | 100 per halaman, urut `position`. `assignee` = uuid · `me` · `none`. `suite` = nama suite snapshot. Item: id, nomor case, judul, nama suite, prioritas, status, assignee, `executedAt`, `bugs`. |
| `GET /manual-runs/:number/cases/:id` | baca | Run case lengkap (snapshot + hasil) + `nextUntestedId` (run case `untested` berikutnya setelah posisi ini, berputar ke awal; `null` bila tidak ada) + `caseId` (atau `null` bila case sudah dihapus). `404 RUN_CASE_NOT_FOUND`. |
| `PATCH /manual-runs/:number/cases/:id` | tester+ | `{ version, status?, stepResults?, note?, assigneeId? }`. |
| `GET /manual/summary` | baca | §5.2. |

Perluasan endpoint lama (field baru, tidak merusak klien lama selain yang disebut):

- `VersionDto` + `manual: ManualRunRef | null`; `run` menjadi `RunSummaryDto | null` (§5.1). Web dan Pact diperbarui bersamaan.
- `POST /bugs` + `manualRunCaseId`; `BugDto` + `manualOrigin`.

Kode error baru: `SUITE_NOT_FOUND`, `SUITE_NOT_EMPTY`, `CASE_NOT_FOUND`, `CASE_CONFLICT`, `MANUAL_RUN_NOT_FOUND`, `RUN_CASE_NOT_FOUND`, `MANUAL_RUN_CONFLICT`, `RUN_COMPLETED`. Aksi izin baru: `"manual:write"` (tester, admin) dan `"manual:delete"` (admin).

### 7.1 Matriks otorisasi tambahan

| Endpoint | Anonim (privat / publik) | Non-anggota (privat / publik) | Viewer | Tester | Admin |
|---|---|---|---|---|---|
| Semua `GET` baru | 404 / 200 | 404 / 200 | 200 | 200 | 200 |
| POST/PATCH suite, case, run, run case | 401 | 404 / 403 | 403 | 2xx | 2xx |
| DELETE suite, case, run | 401 | 404 / 403 | 403 | 403 | 204 |

## 8. Tampilan

Semua halaman: bahasa Indonesia, dua tema, 375 px tanpa scroll horizontal, lolos axe, gate CSP. Komponen shadcn yang diizinkan saja; tanpa dialog (konfirmasi inline); `<select>` dan radio native. Halaman baru di-lazy-load. `<select>` ditempatkan di luar subtree Suspense yang baru dimuat, sesuai pola Tahap 3.

### 8.1 Navigasi

Tab project baru **Test manual** di antara Versi dan Bug: Ringkasan · Run · Versi · **Test manual** · Bug · Flaky · Pengaturan. Di dalamnya sub-tab **Test case** (`/p/:slug/cases`) dan **Run manual** (`/p/:slug/manual-runs`). Tab ini tidak membawa `?branch=`.

### 8.2 Test case (`/p/:slug/cases`)

- **Desktop:** sidebar suite di kiri ("Semua suite" + daftar suite dengan jumlah case aktif); **HP:** `<select>` suite di atas daftar.
- Tester+ bisa menambah suite inline, mengganti nama inline, dan memindah urutan dengan tombol ▲/▼ (berlabel aksesibel "Pindah ke atas/bawah"). Admin bisa menghapus suite kosong dengan konfirmasi inline.
- **Meter cakupan otomasi:** "12 dari 40 case aktif sudah diotomasi (30%)" dengan bar dan teks.
- Filter: cari judul, prioritas, label, otomasi (Semua/Sudah/Belum), arsip; tersimpan di URL.
- Baris: `TC-12`, judul, prioritas, label, jumlah langkah, ikon + teks "Otomatis" bila tertaut, "diubah 2 jam lalu". Tombol **Buat case** (tester+). "Muat lagi" dengan cursor.

### 8.3 Form case (`/cases/new?suite=`, `/cases/:number/edit`)

Suite (`<select>`), judul, prasyarat (editor Markdown Tulis/Pratinjau Tahap 3), prioritas, label, **editor langkah**:

- Tiap langkah bernomor, berisi "Aksi" dan "Hasil yang diharapkan" (textarea), tombol ▲/▼ dan hapus. Tombol "Tambah langkah", nonaktif setelah 50.
- Pratinjau Markdown per langkah lewat tab Tulis/Pratinjau yang sama.

**Tautan otomasi:** kolom cari inline (`GET /tests?q=`), hasil berupa daftar tombol "suite › nama"; tautan bisa dilepas. `409 CASE_CONFLICT` → banner "Case ini baru saja diubah orang lain" + tombol muat ulang, isian tidak dibuang.

### 8.4 Detail case (`/cases/:number`)

- Isi: judul, `TC-12`, suite, prioritas, label, prasyarat, dan tabel langkah (Markdown dirender aman).
- **Kartu otomasi:** test tertaut + status terakhir ("✓ Lulus di main · 3 jam lalu"), atau "Belum diotomasi".
- **Riwayat eksekusi:** 10 hasil terakhir ("TR-3 · Regresi 0.4.0 · ✗ Gagal · 2 hari lalu"), dengan link.
- Tombol Edit, Arsipkan/Pulihkan (tester+), dan Hapus permanen (admin, konfirmasi inline yang menjelaskan bahwa run lama tetap tersimpan).

### 8.5 Daftar run manual (`/p/:slug/manual-runs`)

- Filter status dan versi. Baris: `TR-3`, nama, versi, status, bar progres dengan legenda teks ("18/25 dieksekusi · 15 lulus · 2 gagal · 1 diblokir"), pembuat, tanggal.
- Tombol **Buat run** (tester+).

### 8.6 Buat run (`/manual-runs/new`)

- Nama, versi (`<input list>` + `<datalist>` berisi saran dari `GET /versions` branch default).
- Daftar suite berupa checkbox dengan jumlah case aktif.
- Pencarian case untuk menambah case satuan, dengan daftar case terpilih yang bisa dilepas.
- Ringkasan langsung: "**27 case** akan disalin ke run ini". Tombol "Buat run" nonaktif bila 0 atau > 500.

### 8.7 Detail run (`/manual-runs/:number`)

- **Header:** nama, `TR-3`, versi, status, pembuat, tanggal; progres + hitungan per status.
- **Filter:** status, assignee (termasuk "Case saya", "Belum di-assign"), suite.
- **Daftar case:** dikelompokkan per suite. Baris: `TC-12`, judul, prioritas, status (ikon + teks + warna), assignee, badge bug. Tombol "Mulai eksekusi" membuka case `untested` pertama.
- **Selesaikan run:** "Selesaikan run" dengan konfirmasi inline ("Masih ada 4 case belum dites. Selesaikan tetap?"). Setelah selesai, halaman hanya-baca dengan tombol "Buka ulang". Rename dan hapus (admin) inline.

### 8.8 Eksekusi case (`/manual-runs/:number/cases/:id`)

1. Breadcrumb run, `TC-12`, judul, suite, prioritas, prasyarat.
2. Tiap langkah: aksi, hasil yang diharapkan, grup **radio native** (Lulus / Gagal / Diblokir / Dilewati) dalam `<fieldset>` + `<legend>` "Langkah 2", dan catatan langkah.
3. **Status case:** grup radio (Belum dites / Lulus / Gagal / Diblokir / Dilewati). Saran (§4.3) ditampilkan sebagai teks + tombol "Pakai saran: Gagal". Status tidak berubah sendiri.
4. Catatan case (Markdown), assignee.
5. Tombol **Simpan** dan **Simpan & lanjut**. "Simpan & lanjut" berpindah ke `nextUntestedId`. Bila tidak ada lagi, kembali ke detail run dengan pesan "Semua case sudah dieksekusi".
6. Case `failed`: tombol **Laporkan bug** (isian awal §5.4), atau badge "Bug #12 · Open" bila sudah ada.
7. `409 MANUAL_RUN_CONFLICT` → banner bentrok + muat ulang, isian tetap. `409 RUN_COMPLETED` → banner "Run ini sudah diselesaikan" dan form menjadi hanya-baca.
8. Case asal sudah dihapus: catatan kecil "Case asli sudah dihapus; ini salinan saat run dibuat."

### 8.9 Perluasan halaman lain

- **Versi:** kolom **Manual** berisi "TR-3 · 15/25 lulus · 2 gagal" (link) atau "–". Baris manual-saja menampilkan "–" di kolom automated.
- **Dashboard:** kartu "Test manual" (§5.2).
- **Detail bug:** asal "Dari test run manual TR-3 · TC-12".

### 8.10 Testid minimal

`tab-manual`, `manual-subtabs`, `suite-list`, `suite-<id>`, `suite-add`, `suite-rename-<id>`, `suite-up-<id>`, `suite-down-<id>`, `suite-delete-<id>`, `suite-select`, `coverage-meter`, `cases-list`, `case-row-<number>`, `case-create`, `case-title`, `case-preconditions`, `step-<i>-action`, `step-<i>-expected`, `step-<i>-up`, `step-<i>-down`, `step-<i>-remove`, `step-add`, `automation-search`, `automation-option-<id>`, `automation-unlink`, `case-automation`, `case-history`, `case-archive`, `case-delete`, `case-delete-confirm`, `case-conflict`, `manual-runs-list`, `manual-run-row-<number>`, `manual-run-create`, `run-suite-<id>`, `run-case-search`, `run-selection-summary`, `run-header`, `run-progress`, `run-case-row-<id>`, `run-complete`, `run-complete-confirm`, `run-reopen`, `exec-step-<i>`, `exec-status`, `exec-suggestion`, `exec-note`, `exec-save`, `exec-save-next`, `exec-report-bug`, `exec-conflict`, `exec-completed`, `manual-card`, `version-manual-<versi>`, `bug-manual-origin`.

## 9. Mutation testing

- **Alat:** StrykerJS (`@stryker-mutator/core`) dengan runner Vitest (`@stryker-mutator/vitest-runner`) dan `@stryker-mutator/typescript-checker` untuk membuang mutan yang tidak lolos kompilasi. Bila runner Vitest belum mendukung versi Vitest di repo, pakai runner `command` (`vitest run --project unit`) dan catat sebagai ruling.
- **Target mutasi:**
  - `apps/api/src/modules/**/domain/**/*.ts`, tanpa file test: parser JUnit, flaky, transisi bug, versi, perbandingan, pemilihan pembanding, dan domain manual baru.
  - `packages/shared/src/*.ts` yang berisi logika (`slug.ts`, `roles.ts`).
  - Setiap paket punya `stryker.config.mjs` sendiri.
- **Gate:** `thresholds: { high: 90, low: 80, break: 80 }`. Bila skor awal di bawah 80, test ditambah di tahap ini sampai lulus.
- **Mutan yang selamat:**
  - Setiap mutan selamat dianalisis. Kalau ia menunjukkan test yang lemah, test-nya diperkuat.
  - Mutan yang benar-benar setara dengan kode asli diberi komentar `// Stryker disable next-line <mutator>: <alasan>`.
  - Daftar mutan yang dikecualikan beserta alasannya dicatat di `TEST_STRATEGY.md`.
- **Workflow `mutation.yml`:**
  - Jalan setiap Senin 02.00 UTC dan lewat `workflow_dispatch`.
  - Mode `incremental`: file incremental disimpan dengan `actions/cache`.
  - Menghasilkan laporan HTML + JSON sebagai artifact `mutation-report`. Ringkasan skor per paket ditulis ke job summary.
- **Publikasi:**
  - Job Pages di `ci.yml` (main) mengambil artifact `mutation-report` dari run `mutation.yml` sukses terakhir (`gh run download`, izin `actions: read`) dan menaruhnya di `/mutation/` di samping laporan Allure. `deploy-pages` mengganti seluruh situs, jadi kedua laporan harus ikut di setiap deploy.
  - Bila belum ada artifact, halaman `/mutation/` berisi keterangan singkat.
  - Laporan ditautkan dari README dan landing.

## 10. Visual regression

Baseline baru, dengan pola Tahap 3 (container Playwright, data tetap, jam dibekukan, waktu relatif dan id di-mask, terang & gelap × 1280 × 800 & 375 × 812):

- Daftar case (dengan sidebar suite & meter cakupan).
- Detail run (dengan progres dan pengelompokan suite).
- Halaman eksekusi case (dengan saran status).

## 11. Performa (k6)

Skenario baca ditambah `GET /cases` (halaman pertama), `GET /manual-runs/:number`, `GET /manual-runs/:number/cases`, dan `GET /versions` dengan data manual. Data disiapkan `setup.mjs`: project dengan ≥ 10 suite, ≥ 200 case, dan satu run 200 case yang sebagian sudah dieksekusi. Threshold tetap: `http_req_duration{scenario:read}` p(95) < 300 ms, `http_req_failed` < 1%.

## 12. Testing

| Lapisan | Cakupan |
|---|---|
| Unit (domain, coverage ≥ 80%) | Validasi suite/case/langkah/run (batas tepat 1/50 langkah, 1/500 case, panjang teks); pemindahan posisi suite dan langkah (batas awal/akhir); pembuat snapshot; seleksi run (gabungan, tanpa duplikat, buang arsip, urutan); panjang `stepResults`; semua cabang saran status; ringkasan & progres; pembulatan cakupan termasuk 0 case; pencocokan versi run manual ↔ CI dan penempatan versi manual-saja (§5.1 semua kasus); escape isian awal bug dari run case. |
| Integration (Testcontainers) | 20 case dibuat paralel → `TC-1…20` unik; 10 run paralel → `TR-1…10`; `409 CASE_CONFLICT`; dua run case berbeda di-PATCH paralel → keduanya sukses, run case sama → satu `409 MANUAL_RUN_CONFLICT`; menyelesaikan run sementara PATCH run case berjalan tidak meninggalkan hasil setelah `completed`; `409 RUN_COMPLETED` lalu buka ulang; `409 SUITE_NOT_EMPTY` termasuk case arsip; edit/arsip/hapus case tidak mengubah snapshot; anggota dikeluarkan → assignee run case `null`; `GET /versions` dengan `manual` dan versi manual-saja; bug dari run case + badge satu query; hapus run → tautan bug `null`; `nextUntestedId` berputar; cursor rusak → 400; migrasi `0005` di atas DB berisi data Tahap 3. |
| API (Playwright) | Matriks §7.1 untuk 6 aktor + anonim publik; Bearer token di endpoint baru = anonim; semua respons di-parse schema shared. |
| Kontrak (Pact) | Web: satu interaksi sukses per endpoint baru + `404 CASE_NOT_FOUND`, `409 CASE_CONFLICT`, `409 MANUAL_RUN_CONFLICT`, `409 RUN_COMPLETED`, `409 SUITE_NOT_EMPTY`; `GET /versions` dengan `manual` dan `run: null`. |
| E2E (3 browser, gate CSP) | (1) Buat suite → case 3 langkah → ubah urutan langkah → tautkan automated test → meter cakupan naik. (2) Buat run dari suite → eksekusi beruntun dengan "Simpan & lanjut": Lulus; Gagal di langkah 2 → saran Gagal → Laporkan bug dengan isian awal benar → badge muncul di eksekusi & detail run. (3) Dua tab, case sama → banner bentrok; case berbeda → keduanya tersimpan. (4) Selesaikan run → hanya-baca → buka ulang. (5) Edit case setelah run dibuat → run tetap menampilkan langkah lama. (6) Halaman Versi kolom Manual & versi manual-saja; kartu dashboard. (7) Viewer & anonim publik hanya baca. (8) Markdown berbahaya di langkah tampil inert. (9) a11y dua tema; 375 px termasuk halaman eksekusi. |
| Mutation | §9. |
| Visual | §10. |
| Performa | §11. |

## 13. Dogfooding

- Skrip `scripts/seed-dogfood-manual.mjs` membuat suite dan ±12 test case manual milik TestPulse sendiri di project `testpulse`. Contohnya:
  - **Autentikasi:** "Login dengan password salah", "Logout menghapus sesi".
  - **Upload hasil:** "Upload JUnit via curl", "Token dicabut ditolak".
  - **Bug:** "Buat bug dari test gagal", "Buka ulang bug".
  - **Perbandingan:** "Regresi tampil di halaman perbandingan".
  - **Test manual:** "Selesaikan run lalu buka ulang".
- Beberapa case ditautkan ke automated test yang setara agar meter cakupan terisi nyata.
- Skrip login lewat API production dengan email/password yang **Anda isi sendiri** di environment shell lokal (`TP_EMAIL`, `TP_PASSWORD`; tidak pernah ditulis di repo atau chat). Skrip idempoten: suite/case dengan judul yang sudah ada dilewati.
- Setelah deploy `0.4.0`, Anda membuat run "Regresi 0.4.0" dan **mengeksekusinya sendiri** lewat UI, sehingga hasilnya adalah test manual sungguhan, bukan data karangan.
- `package.json` root → `"version": "0.4.0"`; `deploy.yml` sudah mengirim nilai itu sebagai `--app-version`.

## 14. Dokumentasi

- `docs/test-plans/tahap-4.md`.
- ADR `0006-run-manual-snapshot-dan-mutation-testing.md`: snapshot vs referensi, langkah dalam JSONB, saran status yang tidak otomatis, aturan versi manual-saja, dan pilihan mutation testing beserta gate-nya.
- `docs/TEST_STRATEGY.md`:
  - Baris "Mutation testing" dipindah dari "ditunda" ke lapisan aktif.
  - Skor awal per paket dan daftar mutan yang dikecualikan.
  - Risiko baru dan snapshot jumlah test.
- README: fitur Tahap 4, link laporan mutation, screenshot halaman eksekusi & Versi dengan kolom Manual, roadmap Tahap 4 ✅.
- Landing:
  - Kartu "Test case manual" → Tersedia.
  - Roadmap Tahap 4 Live / Tahap 5 Berikutnya.
  - Teks hero menyebut test manual; bagian Quality menautkan laporan mutation.
  - `landing.spec.ts` kini menghitung 1 badge "Segera".

## 15. Tidak termasuk

- Suite bertingkat, langkah bersama (shared steps), case berparameter/data-driven, dan riwayat versi case.
- Impor/ekspor (CSV, TestRail), lampiran/upload screenshot hasil, kloning run, run terjadwal, dan test plan/milestone.
- Pembuatan run manual otomatis dari CI, tautan otomasi otomatis berdasarkan nama, dan perubahan status otomatis dari hasil CI.
- Mutation testing untuk kode web dan reporter.
- Notifikasi.

## 16. Definisi selesai

- **Fitur:** suite dan case bisa disusun, diedit, diarsipkan, dan ditautkan ke automated test; run manual bisa dibuat dari suite/case, dieksekusi per langkah sampai selesai, dan dibuka ulang; bug bisa dilaporkan dari case gagal dengan isian awal yang lengkap; halaman Versi, dashboard, dan detail bug menampilkan data manual.
- **Kualitas:** semua halaman lolos a11y dua tema, 375 px, dan gate CSP; semua lapisan termasuk visual regression dan k6 hijau di CI; mutation score domain ≥ 80% dengan laporan di GitHub Pages.
- **Production:** `/p/testpulse` berisi test case manual TestPulse dan run berversi `0.4.0`.
- **Dokumen:** diperbarui.
