# TestPulse — Spec Tahap 3: Bug tracker & deteksi regresi antar versi

- **Tanggal:** 2026-11-04
- **Status:** Draft, menunggu review
- **Prasyarat:** Tahap 2 live (upload JUnit, dashboard, flaky, dogfooding ke `/p/testpulse`).
- **Ruang lingkup:** `apps/api` (modul `bugs`, perluasan `results`), `apps/web` (navigasi project, halaman bug, versi, perbandingan), `packages/shared` (schema), `packages/reporter` (opsi versi), `tests/` (semua lapisan + visual regression baru), `tests/perf`, workflow CI/deploy, dokumentasi. Juga mengikat: spec Tahap 1 (otorisasi, keamanan), spec UI 2026-10-26 (CSP, komponen, tema), spec Tahap 2 (hasil test).

## 1. Konteks & tujuan

TestPulse adalah **platform pelaporan dan analisis hasil test**: test dijalankan di CI milik pengguna, hasilnya dikirim ke TestPulse. Tahap 3 menambahkan dua hal yang memanfaatkan data itu:

1. **Bug tracker** — tim mencatat bug secara manual atau langsung dari test yang gagal, mengelolanya dengan status tetap, prioritas, severity, assignee, label, komentar, dan riwayat perubahan.
2. **Deteksi regresi antar versi** — setiap run boleh membawa **versi** (mis. `1.0.1`). TestPulse otomatis membandingkan versi terbaru dengan versi sebelumnya dan menampilkan hasil yang **mudah dibaca**: regresi baru, yang sudah diperbaiki, yang masih gagal, test baru/hilang, dan test yang jadi lebih lambat.

Lapisan QA baru untuk TestPulse sendiri: **visual regression** dengan Playwright.

**Kriteria sukses:** bug bisa dibuat dari test gagal dan dikelola sampai ditutup; perbandingan versi muncul otomatis di dashboard, detail run, dan halaman perbandingan dengan kalimat kesimpulan yang jelas; project publik `testpulse` menampilkan versi dan perbandingannya dari CI TestPulse; semua lapisan test termasuk visual regression hijau di CI.

## 2. Keputusan

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Sumber bug | **Manual + dari test gagal** (tombol "Laporkan bug") | Memanfaatkan data Tahap 2 tanpa risiko banjir bug otomatis. |
| Workflow | **Status tetap** `open → in_progress → resolved → closed` (+ buka ulang), komentar, riwayat | Cukup untuk tim kecil, bisa diuji tuntas. |
| Lampiran | **Link saja**, tanpa upload file | Tanpa storage, tanpa risiko file berbahaya, CSP tetap ketat. |
| Tautan bug ↔ test | **Dua arah + petunjuk**, status bug tidak pernah diubah otomatis | Mencegah laporan ganda; tidak menutup bug yang belum benar-benar beres. |
| Arsitektur | **Modul `bugs` relasional** (tabel bug, komentar, event, label, link) | Konsisten dengan modul lain; bebas race condition; mudah diuji. |
| Perbandingan | **Otomatis** versi terbaru vs sebelumnya, bisa dipilih manual | Pengguna langsung melihat perubahan tanpa memilih run. |
| Visual regression | **Playwright `toHaveScreenshot()` di container Playwright resmi** | Gratis, tanpa layanan luar, render identik lokal/CI. |

## 3. Model bug

### 3.1 Field

| Field | Aturan |
|---|---|
| `number` | Urut per project mulai 1; tidak dipakai ulang walau bug dihapus. |
| `title` | Di-trim, 3–200 karakter. |
| `description` | Markdown, 0–20.000 karakter. |
| `status` | `open` · `in_progress` · `resolved` · `closed`. Bug baru selalu `open`. |
| `resolution` | `fixed` · `wont_fix` · `duplicate` · `cannot_reproduce`; `null` saat `open`/`in_progress`. |
| `priority` | `low` · `medium` · `high` · `urgent` (default `medium`). |
| `severity` | `minor` · `major` · `critical` · `blocker` (default `major`). |
| `assigneeId` | Anggota project (role apa pun) atau `null`. |
| `labels` | Maks 10, unik, masing-masing 1–30 karakter `[a-z0-9-]` (input di-lowercase). |
| `links` | Maks 10; `url` http/https ≤ 2000 karakter tanpa username/password; `title` opsional ≤ 100. |
| `testCaseId`, `runId` | Opsional; harus milik project ini, dan run itu harus memuat hasil test tersebut. |
| `reporterId`, `createdAt`, `updatedAt`, `resolvedAt`, `closedAt`, `version` | Diisi server. `version` (integer, mulai 1) untuk optimistic concurrency. |

### 3.2 Transisi status

| Dari | Ke yang diizinkan |
|---|---|
| `open` | `in_progress`, `resolved`, `closed` |
| `in_progress` | `open`, `resolved`, `closed` |
| `resolved` | `closed`, `open` (buka ulang) |
| `closed` | `open` (buka ulang) |

- Transisi lain → `409 INVALID_TRANSITION`.
- Masuk `resolved` atau `closed` dari `open`/`in_progress` **wajib** `resolution` (`400 VALIDATION_ERROR`, `fields.resolution`). `resolved → closed` boleh tanpa `resolution` (memakai yang ada) atau menggantinya.
- Masuk `resolved` mengisi `resolvedAt`; masuk `closed` mengisi `closedAt`; buka ulang mengosongkan `resolution`, `resolvedAt`, `closedAt`.

### 3.3 Edit bersamaan & riwayat

- Setiap `PATCH` membawa `version` yang terakhir dilihat klien. Berbeda dengan server → `409 BUG_CONFLICT` (tanpa perubahan apa pun).
- Field yang nilainya sama dengan nilai sekarang diabaikan. Bila tidak ada yang berubah: `200` dengan bug apa adanya, `version` tidak naik, tanpa event.
- Setiap field yang berubah menulis satu baris `bug_events` (`actor`, `field`, nilai lama, nilai baru) **dalam transaksi yang sama** dengan update; `version` naik 1, `updatedAt` diperbarui. Untuk `description` event hanya mencatat "deskripsi diubah" (nilai tidak disalin).
- Anggota dikeluarkan atau keluar sendiri dari project → semua bug project itu dengan assignee orang tersebut dikosongkan assignee-nya, masing-masing dengan event `assignee` (actor = yang mengeluarkan, atau orang itu sendiri), dalam transaksi yang sama dengan penghapusan membership.

### 3.4 Komentar

- Markdown 1–10.000 karakter (setelah trim).
- Penulis boleh mengubah/menghapus komentarnya sendiri selama masih tester atau admin; admin boleh menghapus komentar siapa pun.
- Hapus = *soft delete*: `body` dikosongkan, `deletedAt` diisi, ditampilkan "Komentar dihapus". Edit mengisi `editedAt` ("diedit").

### 3.5 Markdown aman

- Dirender di klien menjadi elemen React; **HTML mentah tidak pernah dirender** (ditampilkan sebagai teks).
- Link hanya `http:`, `https:`, `mailto:`; protokol lain dibuang (teks tetap tampil). Semua link `target="_blank" rel="noopener noreferrer"`.
- Sintaks gambar `![alt](url)` dirender sebagai **link** (bukan `<img>`), karena CSP `img-src 'self' data:` tidak boleh dilonggarkan.
- Tidak ada atribut `style` di hasil render (CSP `style-src 'self'`).
- Didukung: paragraf, heading, tebal/miring, daftar, kutipan, kode inline & blok, tabel, garis.

## 4. Versi & perbandingan

### 4.1 Versi pada run

- Upload menerima query `version` (opsional): 1–50 karakter `[A-Za-z0-9._+-]`. Disimpan di `runs.version`.
- Reporter: opsi `--app-version <v>` (bukan `--version`, yang lazim berarti versi tool).

### 4.2 Urutan versi (per branch)

- Versi **semver** bila cocok `^[vV]?MAJOR.MINOR.PATCH(-prerelease)?(+build)?$`; prefiks `v` diabaikan; `+build` diabaikan dalam perbandingan; pre-release diurutkan menurut aturan semver 2.0 (`1.0.0-beta < 1.0.0`, `1.0.0-alpha.2 < 1.0.0-alpha.10`).
- Bila **semua** versi di branch itu semver → urut semver. Bila ada satu saja yang bukan semver → **semua** versi branch itu diurutkan menurut waktu run terakhirnya (terlama → terbaru). Aturan ini memberi urutan total yang konsisten.
- "Run sebuah versi" = run **terakhir** dengan versi itu di branch itu.

### 4.3 Pembanding default

Untuk sebuah run **target** di branch B:

1. Bila target punya versi V dan ada versi lebih rendah dari V di branch B → **base** = run terakhir dari versi tepat di bawah V.
2. Selain itu → **base** = run tepat sebelum target di branch B (urut `created_at`, `id`).
3. Tidak ada keduanya → tidak ada pembanding (`base: null`).

Tanpa target eksplisit (dashboard, `GET /compare` tanpa parameter): target = run dari **versi tertinggi** di branch (bila ada versi), selain itu run terakhir branch. Branch default = branch run terbaru project (sama dengan `stats`).

### 4.4 Pengelompokan

Test dicocokkan lewat `test_case_id`. Status "lulus" termasuk lulus-setelah-retry (ditandai flaky).

| Kelompok | Kondisi |
|---|---|
| **Regresi baru** | base `passed` → target `failed` |
| **Diperbaiki** | base `failed` → target `passed` |
| **Masih gagal** | `failed` di keduanya |
| **Lebih lambat** | `passed` di keduanya, durasi target > 1,5 × base **dan** selisih > 1000 ms |
| **Test baru** | hanya ada di target |
| **Test hilang** | hanya ada di base |

`skipped` di salah satu sisi tidak masuk regresi/diperbaiki/masih gagal/lebih lambat. Base dan target boleh dari branch berbeda (dipilih manual).

### 4.5 Kalimat kesimpulan

Dibuat dari ringkasan angka (fungsi murni, diuji unit):

- Ada regresi: "⚠ {target} punya **N regresi baru** dibanding {base}. Periksa sebelum rilis." (+ ", M test kini lulus." bila ada yang diperbaiki)
- Tanpa regresi, ada perbaikan: "✓ Tidak ada regresi. M test yang dulu gagal kini lulus."
- Tanpa regresi & perbaikan: "✓ Tidak ada regresi dibanding {base}."
- Tanpa pembanding: "Belum ada run pembanding untuk {target}."

`{target}`/`{base}` = versi (mis. `v1.0.1`) bila ada, selain itu "run #… · {tanggal}".

## 5. Model data

```
projects        + bug_seq integer NOT NULL DEFAULT 0
runs            + version text NULL, INDEX (project_id, branch, version)
bugs            id uuid PK, project_id uuid FK→projects ON DELETE CASCADE, number integer,
                title text, description text, status text CHECK, resolution text NULL CHECK,
                priority text CHECK, severity text CHECK,
                assignee_id uuid NULL FK→users, reporter_id uuid FK→users,
                test_case_id uuid NULL FK→test_cases ON DELETE SET NULL,
                run_id uuid NULL FK→runs ON DELETE SET NULL,
                version integer NOT NULL DEFAULT 1, created_at, updated_at timestamptz,
                resolved_at timestamptz NULL, closed_at timestamptz NULL,
                UNIQUE (project_id, number), INDEX (project_id, status, updated_at DESC),
                INDEX (project_id, assignee_id), INDEX (test_case_id) WHERE status <> 'closed'
bug_labels      bug_id uuid FK→bugs ON DELETE CASCADE, label text, PK (bug_id, label)
bug_links       id uuid PK, bug_id uuid FK→bugs ON DELETE CASCADE, position integer, url text, title text NULL
bug_comments    id uuid PK, bug_id uuid FK→bugs ON DELETE CASCADE, author_id uuid FK→users,
                body text, created_at timestamptz, edited_at timestamptz NULL, deleted_at timestamptz NULL,
                INDEX (bug_id, created_at)
bug_events      id bigserial PK, bug_id uuid FK→bugs ON DELETE CASCADE, actor_id uuid FK→users,
                field text, old_value text NULL, new_value text NULL, created_at timestamptz,
                INDEX (bug_id, created_at)
```

- Nomor bug: `UPDATE projects SET bug_seq = bug_seq + 1 WHERE id = $1 RETURNING bug_seq` di dalam transaksi pembuatan bug (kunci baris project; pembuatan paralel tetap unik dan berurutan).
- Migrasi hanya menambah tabel/kolom/index (aman untuk DB production yang sudah berisi data).

## 6. API

Semua di bawah `/api/v1/projects/:slug`, autentikasi cookie sesi. Token CI **tidak** berlaku (diperlakukan anonim). Bentuk error tetap `{ error: { code, message, fields? } }`.

| Endpoint | Hak | Keterangan |
|---|---|---|
| `GET /bugs?status=&assignee=&priority=&severity=&label=&q=&sort=&cursor=` | baca | 25 per halaman, cursor buram. `status` = `active` (default: open+in_progress) · `done` (resolved+closed) · `all` · satu status. `assignee` = uuid · `me` · `none`. `q` cari judul (≤ 100 karakter, `%`/`_` di-escape, tidak peka huruf). `sort` = `updated` (default) · `created` · `priority` (urgent dulu). |
| `POST /bugs` | tester+ | `201` + bug. |
| `GET /bugs/labels` | baca | Label yang dipakai bug di project ini (urut abjad, maks 200). |
| `GET /bugs/:number` | baca | Detail + `testHint` (§6.2). `404 BUG_NOT_FOUND`. |
| `PATCH /bugs/:number` | tester+ | Body `{ version, title?, description?, priority?, severity?, assigneeId?, labels?, links?, status?, resolution? }` (minimal satu field selain `version`). `labels`/`links` mengganti seluruh daftar. |
| `DELETE /bugs/:number` | admin | `204`. |
| `GET /bugs/:number/activity?cursor=` | baca | Komentar + event digabung, urut lama → baru, 50 per halaman. |
| `POST /bugs/:number/comments` | tester+ | `201` + komentar. |
| `PATCH /bugs/:number/comments/:id` | penulis (tester+) | `404 COMMENT_NOT_FOUND`; komentar terhapus tidak bisa diedit. |
| `DELETE /bugs/:number/comments/:id` | penulis (tester+) atau admin | `204` (soft delete). |
| `GET /versions?branch=` | baca | Maks 100 versi, terbaru dulu: `{ version, run: RunSummaryDto, runCount, passRate, passRateDelta }` (`passRateDelta` vs versi tepat di bawahnya, `null` bila tidak ada). |
| `GET /compare?base=&target=&branch=` | baca | §4.3–4.4. Respons: `{ base: RunSummaryDto\|null, target: RunSummaryDto\|null, summary: { regressions, fixed, stillFailing, slower, added, removed }, groups: { <kelompok>: { items: CompareItem[], nextCursor } } }`; tiap kelompok maks 200 item urut suite lalu nama. `?group=<kelompok>&cursor=` mengambil 100 item berikutnya satu kelompok. `CompareItem = { testCaseId, suite, name, base: {status, durationMs, message, flakyInRun}\|null, target: {...}\|null, bugs: BugRef[] }`. Run milik project lain → `404 RUN_NOT_FOUND`. |

Perluasan endpoint Tahap 2 (field baru, tidak merusak klien lama):

- `RunSummaryDto` + `version: string | null`; `GET /runs` + filter `?version=`.
- `TestResultDto`, `FlakyTestDto`, dan `TestHistoryDto.testCase` + `bugs: BugRef[]` (`BugRef = { number, title, status }`, bug non-`closed` yang tertaut ke test itu, maks 5, terbaru dulu), diambil dengan **satu** query untuk semua test di respons.

Kode error baru: `BUG_NOT_FOUND`, `COMMENT_NOT_FOUND`, `BUG_CONFLICT`, `INVALID_TRANSITION`. Aksi izin baru: `"bugs:write"` (tester, admin) dan `"bugs:delete"` (admin).

### 6.1 Validasi khusus

- `assigneeId` bukan anggota project → `400`, `fields.assigneeId`.
- `testCaseId`/`runId` bukan milik project, atau run tidak memuat hasil test itu → `400`, `fields.testCaseId`/`fields.runId`. `runId` tanpa `testCaseId` ditolak.

### 6.2 Petunjuk status test (`testHint`)

Bila bug tertaut ke test: `{ branch, results: [{ runId, createdAt, status }] (maks 20, lama → baru), consecutivePasses, lastStatus }`. `branch` = branch run asal; bila run asal sudah dihapus, branch dari hasil terbaru test itu. Hanya informasi — status bug tidak pernah diubah otomatis.

### 6.3 Matriks otorisasi tambahan

| Endpoint | Anonim (privat / publik) | Non-anggota (privat / publik) | Viewer | Tester | Admin |
|---|---|---|---|---|---|
| GET bug, label, activity, versions, compare | 404 / 200 | 404 / 200 | 200 | 200 | 200 |
| POST bug, PATCH bug, POST komentar | 401 | 404 / 403 | 403 | 2xx | 2xx |
| DELETE bug | 401 | 404 / 403 | 403 | 403 | 204 |
| PATCH komentar orang lain | 401 | 404 / 403 | 403 | 403 | 403 |
| DELETE komentar orang lain | 401 | 404 / 403 | 403 | 403 | 204 |

## 7. Tampilan

Semua halaman: bahasa Indonesia, dua tema, 375 px tanpa scroll horizontal, lolos axe, gate CSP. Komponen shadcn yang diizinkan saja; tanpa dialog (konfirmasi & pilihan resolusi tampil inline); `<select>` native. Halaman baru di-lazy-load.

### 7.1 Navigasi project

Di bawah judul project: tab **Ringkasan · Run · Versi · Bug · Flaky** dan **Pengaturan** (hanya anggota). Tab aktif ditandai `aria-current="page"`; di HP tab bisa digeser horizontal di dalam wadahnya sendiri.

### 7.2 Perbandingan (`/p/:slug/compare?base=&target=&branch=`)

1. Judul "**{target}** dibanding **{base}**" + tanggal, commit (mono), link CI masing-masing; dua `<select>` untuk mengganti target/base (versi tersedia + 50 run terakhir branch).
2. **Kalimat kesimpulan** (§4.5) di kotak menonjol (warna peringatan bila ada regresi, sukses bila tidak).
3. **Baris ringkasan** urut: Regresi baru · Diperbaiki · Masih gagal · Lebih lambat · Test baru · Test hilang; tiap angka adalah link ke kelompoknya.
4. Kelompok berupa `<details>`; Regresi & Diperbaiki terbuka default; kelompok kosong satu baris ("Tidak ada regresi baru ✓").
5. Baris: nama test (besar) + suite (kecil); "**{base}** ✓ Lulus → **{target}** ✗ Gagal"; perubahan durasi "1,2 dtk → 3,4 dtk (+183%)"; pesan error dalam `<details>`; di kanan **Laporkan bug** (tester/admin) atau badge **Bug #12 · Open**.
6. Status selalu ikon + teks + warna; di HP kolom sebelum/sesudah bertumpuk.
7. "Muat lagi" per kelompok bila `nextCursor`.

### 7.3 Kartu dashboard & panel detail run

- Dashboard (branch terpilih): kartu "**{target} vs {base}**" berisi kalimat kesimpulan singkat + ringkasan angka + "Lihat perbandingan". Tidak tampil bila belum ada pembanding.
- Detail run: panel "Dibanding {base}" dengan ringkasan yang sama untuk run itu sebagai target.

### 7.4 Versi (`/p/:slug/versions?branch=`)

Tabel: versi · tanggal run terakhir · jumlah run · pass rate · perubahan ("▲ naik 2,1 poin" / "▼ turun 4,0 poin" / "–") · link "Bandingkan dengan versi sebelumnya". Pemilih branch sama dengan dashboard.

### 7.5 Bug

- **Daftar** (`/p/:slug/bugs`): tab Aktif / Selesai / Semua; filter prioritas, severity, assignee (termasuk "Bug saya", "Belum di-assign"), label, cari judul; filter tersimpan di URL. Baris: `#12`, judul, status, prioritas, severity, assignee, label, "diubah 2 jam lalu". Tombol **Buat bug** (tester/admin). "Muat lagi" dengan cursor.
- **Buat** (`/p/:slug/bugs/new?testCaseId=&runId=`): judul, deskripsi (tab Tulis/Pratinjau), prioritas, severity, assignee, label, link. Dari test gagal terisi: judul = nama test; deskripsi = suite, branch, commit, link CI, pesan error dalam blok kode; severity `major`; tautan test & run.
- **Detail** (`/p/:slug/bugs/:number`): judul + status + tombol transisi yang diizinkan ("Mulai kerjakan", "Tandai selesai", "Tutup", "Buka ulang"; resolusi dipilih inline); edit judul/deskripsi inline; panel samping assignee, prioritas, severity, label, link, kartu **test asal** dengan petunjuk ("Lulus 5 run terakhir berturut-turut di main" / "Masih gagal di run terakhir") atau "Run asal tidak tersedia" (Ruling F-a: DTO tidak membedakan run terhapus dan bug tanpa run); timeline aktivitas ("Budi mengubah status Open → In progress · 2 jam lalu") + kotak komentar. `409 BUG_CONFLICT` → banner "Bug ini baru saja diubah orang lain" + tombol muat ulang. Hapus bug (admin) dengan konfirmasi inline.
- **Badge bug** di detail run, daftar flaky, dan riwayat test (link ke bug).

### 7.6 Testid minimal

`project-tabs`, `tab-<nama>`, `compare-summary`, `compare-sentence`, `compare-group-<kelompok>`, `compare-row-<testCaseId>`, `compare-base`, `compare-target`, `version-card`, `run-compare-panel`, `versions-table`, `version-row-<versi>`, `bugs-list`, `bug-row-<number>`, `bug-create`, `bug-title`, `bug-description`, `bug-status`, `bug-transition-<status>`, `bug-resolution`, `bug-assignee`, `bug-labels`, `bug-links`, `bug-test-hint`, `bug-activity`, `comment-input`, `comment-submit`, `comment-<id>`, `bug-conflict`, `bug-delete`, `bug-delete-confirm`, `report-bug-<testCaseId>`, `bug-badge-<number>`.

## 8. Reporter & dogfooding

- Reporter: opsi `--app-version`, divalidasi sama dengan server (exit 2 bila salah); Pact reporter diperbarui.
- `package.json` root mendapat `"version": "0.3.0"` (dinaikkan setiap rilis tahap berikutnya). `deploy.yml` mengirim `--app-version` dari nilai itu. Run lama tanpa versi tetap ada; perbandingan pertama memakai run sebelumnya.

## 9. Visual regression

- Project Playwright baru `visual` (Chromium), `toHaveScreenshot()` untuk: landing, dashboard, perbandingan, daftar bug, detail bug — tema terang & gelap, viewport 1280 × 800 dan 375 × 812.
- Dijalankan di container `mcr.microsoft.com/playwright:v<versi @playwright/test di repo>-noble` terhadap stack Docker, agar render font identik di lokal dan CI. Skrip `pnpm test:visual` dan `pnpm test:visual:update` (keduanya lewat Docker).
- Deterministik: data uji dibuat lewat API dengan nilai tetap, jam dibekukan (`page.clock`), elemen waktu relatif & id di-mask, animasi dimatikan, font self-hosted sudah dimuat (`document.fonts.ready`). `maxDiffPixelRatio: 0.01`.
- Baseline PNG di-commit di `tests/visual/__screenshots__/`. Job CI `visual` setelah `stack-tests`; bila gagal, artifact berisi expected/actual/diff.

## 10. Performa (k6)

Skenario baca ditambah `GET /bugs`, `GET /compare` (default), dan `GET /versions` pada project dengan ≥ 50 run berversi dan ≥ 100 bug (disiapkan `setup.mjs`). Threshold tetap: `http_req_duration{scenario:read}` p(95) < 300 ms, `http_req_failed` < 1%.

## 11. Testing

| Lapisan | Cakupan |
|---|---|
| Unit (domain, coverage ≥ 80%) | Tabel transisi lengkap & aturan resolusi; validasi label/link/versi; sanitasi URL Markdown; urutan versi (semver, pre-release, prefiks `v`, campuran non-semver); `classify(base, target)` semua kelompok termasuk skipped & flaky; ambang lebih lambat (batas tepat 1,5× dan 1000 ms); kalimat kesimpulan semua kasus; pemilihan pembanding default (fungsi murni atas daftar run). |
| Integration (Testcontainers) | 20 bug dibuat paralel → nomor 1–20 unik; `409 BUG_CONFLICT`; event tidak tertulis bila update gagal; transisi & resolusi; keluarkan anggota → assignee kosong + event; run asal terhapus → `runId` null; `compare` benar pada data berpola termasuk pembanding default dan paginasi kelompok; `versions` + `passRateDelta`; badge satu query; pencarian `%`/`_`; cursor rusak → 400; migrasi berjalan di atas DB berisi data Tahap 2. |
| API (Playwright) | Matriks §6.3 untuk 6 aktor + anonim publik; Bearer token di endpoint bug = anonim; semua respons di-parse schema shared; upload dengan `version` lewat proxy. |
| Kontrak (Pact) | Web: satu interaksi sukses per endpoint baru + `404 BUG_NOT_FOUND`, `409 BUG_CONFLICT`, `409 INVALID_TRANSITION`; reporter: upload dengan `version`. |
| E2E (3 browser, gate CSP) | Laporkan bug dari test gagal → isian awal benar → badge di run/flaky/riwayat; alur lengkap assign → kerjakan → komentar → selesai (resolusi) → buka ulang dengan riwayat; konflik dua tab; viewer & anonim publik hanya baca; upload v1.0.0 lalu v1.0.1 berpola → kartu dashboard, panel run, halaman perbandingan & versi menampilkan angka/kelompok/kalimat yang tepat, "Laporkan bug" dari baris regresi; Markdown berisi `<script>`, `<img onerror>`, link `javascript:`, gambar eksternal → tampil inert, tanpa pelanggaran CSP; navigasi tab; a11y dua tema; 375 px. |
| Visual | §9. |
| Performa | §10. |

## 12. Dokumentasi

`docs/test-plans/tahap-3.md`; ADR `0005-perbandingan-versi-dan-markdown-aman.md` (urutan versi, definisi regresi, pembanding default, aturan Markdown); `docs/TEST_STRATEGY.md` (visual regression, risiko baru, snapshot jumlah test); README (fitur Tahap 3, contoh `version`, screenshot perbandingan & bug, roadmap Tahap 3 ✅); landing: kartu "Bug tracker" → Tersedia, deskripsi kartu dashboard menyebut perbandingan versi, Roadmap Tahap 3 Live / Tahap 4 Berikutnya, snapshot Quality disinkronkan.

## 13. Tidak termasuk

Notifikasi email, mention `@nama`, satu bug ke banyak test, impor/ekspor, integrasi GitHub Issues, workflow kustom, upload lampiran, perubahan status bug otomatis, pemantauan URL/synthetic check, menjalankan test di server TestPulse.

## 14. Definisi selesai

Bug bisa dibuat (manual & dari test gagal), dikelola sampai ditutup, dan dikomentari dengan riwayat lengkap; badge bug tampil di halaman hasil test; perbandingan versi tampil otomatis di dashboard, detail run, halaman perbandingan, dan halaman versi dengan kalimat kesimpulan yang jelas; navigasi tab project tersedia; semua halaman lolos a11y dua tema, 375 px, dan gate CSP; semua lapisan termasuk visual regression dan k6 hijau di CI; `/p/testpulse` di production menampilkan run berversi `0.3.0`; dokumentasi diperbarui.
