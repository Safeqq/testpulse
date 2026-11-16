# TestPulse — Spec Tahap 5: Crowdtesting

- **Tanggal:** 2026-11-16
- **Status:** Draft, menunggu review
- **Prasyarat:** Tahap 4 live (test case & run manual, mutation testing, dogfooding `0.4.0`).
- **Ruang lingkup:** `apps/api` (modul baru `crowd`, perluasan `bugs`, `projects`), `apps/web` (area publik `/crowd`, tab project "Crowd", halaman triase, perluasan dashboard & detail bug, landing), `packages/shared` (schema, helper Markdown aman dipindah dari web), `tests/` (semua lapisan + baseline visual baru + ZAP), `tests/perf`, dokumentasi. Juga mengikat: spec Tahap 1 (otorisasi, keamanan), spec UI 2026-10-26 (CSP, komponen, tema), spec Tahap 2–4.

## 1. Konteks & tujuan

Tahap 1–4 hanya melibatkan anggota tim. Tahap 5 membuka TestPulse untuk **penguji dari luar tim** (crowd tester):

1. Tim membuka **test cycle publik**: aplikasi yang diuji diberikan sebagai **link** (tanpa upload file), lengkap dengan instruksi, cakupan, dan lingkungan target.
2. Siapa pun yang punya akun TestPulse bisa **bergabung** dan **mengirim laporan bug** terstruktur.
3. Tim **mentriase** laporan: diterima (otomatis menjadi bug di tracker Tahap 3), ditolak (dengan alasan), atau duplikat.
4. Crowd tester mendapat **poin reputasi** dari laporan yang diterima; ada **leaderboard** per cycle dan global.

**Tidak ada pembayaran.**

Karena pihak luar kini bisa mengirim konten, fokus kualitas tahap ini adalah **keamanan, privasi, dan anti-spam**.

**Kriteria sukses:**
- **Siklus penuh:** tim bisa membuat dan membuka cycle. Crowd tester bisa menemukannya di direktori publik, bergabung, dan mengirim laporan. Tim bisa mentriase laporan sampai menjadi bug.
- **Reputasi:** poin dan leaderboard terhitung benar.
- **Privasi:** email crowd tester tidak pernah terlihat siapa pun, dan laporan orang lain tidak pernah bisa dibaca.
- **Kualitas:** semua lapisan test hijau, termasuk mutation testing ≥ 80% untuk domain `crowd`.
- **Dogfooding:** `/crowd` di production menampilkan cycle publik milik TestPulse sendiri.

## 2. Keputusan

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Bergabung | **Terbuka**: siapa pun yang login bisa bergabung ke cycle publik dengan sekali klik | Paling sederhana dan mirip uTest. Spam diredam dengan batas & tombol keluarkan. |
| Laporan | **Submission terpisah lalu triase**; diterima → bug Tahap 3 dengan tautan dua arah | Tracker internal tetap privat; reputasi dihitung dari keputusan triase. |
| Reputasi | **Poin dari severity final**: minor 1 · major 3 · critical 5 · blocker 8; ditolak/duplikat 0; tingkat penerimaan ditampilkan | Adil tanpa penalti yang membuat tester kapok. |
| Visibilitas | **Cycle punya visibilitas sendiri**: cycle yang dipublikasikan tampil di `/crowd` walau project-nya privat; hanya isi cycle yang publik | Tim dengan project privat tetap bisa memakai crowdtesting. |
| Duplikat | **Daftar "Masalah yang sudah diketahui"** per cycle (judul + severity laporan diterima), bisa disembunyikan per laporan | Mengurangi duplikat tanpa membuka detail sensitif. |
| Arsitektur | **Modul `crowd` relasional; poin disalin ke laporan saat diterima; leaderboard = agregasi** | Satu sumber kebenaran, konsisten dengan modul lain, mudah diuji. |

## 3. Model cycle

### 3.1 Field

| Field | Aturan |
|---|---|
| `number` | `CY-<n>` per project, mulai 1, tidak dipakai ulang. |
| `title` | Di-trim, 3–120 karakter. |
| `summary` | Di-trim, 0–280 karakter (tampil di direktori). |
| `links` | 1–5. `url` http/https ≤ 2000 tanpa username/password; `label` di-trim 1–60. Urutan bermakna. |
| `instructions` | Markdown 0–10.000. |
| `inScope`, `outOfScope` | Markdown, masing-masing 0–2000. |
| `environments` | Lingkungan target, 0–10 label unik (tanpa membedakan huruf besar/kecil), masing-masing di-trim 1–40. |
| `appVersion` | Opsional, format sama dengan versi run (1–50 `[A-Za-z0-9._+-]`). |
| `endsAt` | Opsional, waktu UTC. Saat diisi atau diubah harus di masa depan (`400 fields.endsAt`). |
| `status` | `draft` · `open` · `closed`. Cycle baru selalu `draft`. |
| `openedAt`, `closedAt`, `createdBy`, `createdAt`, `updatedAt`, `version` | Diisi server. `version` → `409 CYCLE_CONFLICT`. |

### 3.2 Status

- **Transisi:**
  - `draft → open` (mengisi `openedAt` pertama kali).
  - `open → closed`.
  - `closed → open`. Bila `endsAt` sudah lewat, harus diganti dulu (`400 fields.endsAt`).
  - Cycle yang sudah pernah dibuka tidak bisa kembali ke `draft`. Transisi lain → `409 INVALID_TRANSITION`.
- **Status efektif** (fungsi murni): `open` dengan `endsAt ≤ sekarang` dianggap **selesai**. Bergabung dan mengirim laporan ditolak `409 CYCLE_NOT_OPEN`, dan di direktori cycle ini masuk tab *Selesai*.
- **Edit isi:** instruksi, link, dan field lain boleh diubah di status apa pun.
- **Hapus:** hanya admin, dan hanya bila cycle **belum punya laporan** (`409 CYCLE_HAS_REPORTS`). Aturan ini melindungi poin yang sudah diperoleh tester. Cycle yang sudah dipakai cukup ditutup.

### 3.3 Visibilitas

| Siapa | Draft | Open / closed |
|---|---|---|
| Anggota project | lihat & kelola sesuai role | lihat & kelola sesuai role |
| Selain anggota (termasuk anonim) | `404 CYCLE_NOT_FOUND` | Isi cycle, masalah yang sudah diketahui, leaderboard |

Isi cycle yang publik menyertakan `project: { name, slug | null }`. `slug` bernilai `null` untuk project privat, agar halaman project tidak tertaut. Hasil CI, bug internal, test case, dan daftar anggota tidak pernah ikut terbuka.

## 4. Peserta

- **Bergabung:** siapa pun yang login bisa bergabung ke cycle berstatus efektif `open`, dengan `{ acceptRules: true }` (waktu persetujuan disimpan). Bergabung ulang tidak menambah data; peserta yang pernah keluar menjadi aktif lagi.
- **Anggota project tidak bisa bergabung** ke cycle project-nya sendiri (`403 MEMBER_CANNOT_JOIN`). Peserta yang kemudian menjadi anggota project juga tidak bisa lagi mengirim laporan di cycle project itu (kode yang sama).
- **Keluar:** peserta boleh keluar kapan saja (`status = left`). Laporannya tetap ada dan tetap ditriase.
- **Dikeluarkan:** tester ke atas bisa mengeluarkan peserta, dengan alasan opsional ≤ 500 karakter.
  - Peserta yang dikeluarkan tidak bisa bergabung lagi atau mengirim laporan (`403 PARTICIPANT_REMOVED`).
  - Laporan yang sudah ada tetap bisa ditriase, dan poin yang sudah diperoleh tetap dihitung.
- **Syarat kirim laporan:** peserta aktif, cycle berstatus efektif `open`, bukan anggota project, dan batas anti-spam (§5.5) belum tercapai. Bukan peserta → `403 NOT_PARTICIPANT`.

## 5. Laporan

### 5.1 Field

| Field | Aturan |
|---|---|
| `number` | `CR-<n>` per project, tidak dipakai ulang. Di API publik laporan dirujuk dengan `id` (uuid). |
| `title` | Di-trim, 5–200 karakter. |
| `steps` | Markdown, di-trim 10–10.000 karakter, wajib. |
| `expected`, `actual` | Markdown, masing-masing di-trim 1–2000, wajib. |
| `environment` | Di-trim 3–200 karakter, wajib (mis. "Chrome 130 / Windows 11"). |
| `suggestedSeverity` | `minor` · `major` · `critical` · `blocker`. |
| `links` | Bukti, 0–5, aturan sama dengan link bug Tahap 3. |
| `status` | `submitted` · `accepted` · `rejected` · `duplicate` · `withdrawn`. |
| `finalSeverity`, `points`, `rejectReason`, `triageNote`, `duplicateOfId`, `bugId`, `hideFromKnownIssues`, `triagedBy`, `triagedAt` | Diisi saat triase (§5.3). |
| `submittedAt`, `updatedAt`, `version` | Diisi server. `version` → `409 REPORT_CONFLICT`. |

Karakter kontrol ditolak di semua field teks, mengikuti aturan bug.

### 5.2 Transisi

| Dari | Ke | Oleh |
|---|---|---|
| `submitted` | `accepted`, `rejected`, `duplicate` | tim (tester+) |
| `submitted` | `withdrawn` | pelapor |
| `rejected`, `duplicate` | `submitted` (dikembalikan) | tim |
| `accepted`, `withdrawn` | — (final) | — |

Transisi lain → `409 INVALID_TRIAGE`. Selama `submitted`, pelapor boleh mengedit laporannya. Di status lain, edit ditolak dengan `409 INVALID_TRIAGE`.

### 5.3 Triase

- **Terima:** `{ severity?, priority? }`. Severity default = usulan pelapor; prioritas default `medium`. Dalam **satu transaksi**:
  1. `finalSeverity` dan `points` (1/3/5/8) dikunci di laporan.
  2. **Bug Tahap 3 dibuat**: judul = judul laporan, label `crowd`, severity dan prioritas sesuai pilihan, reporter = anggota tim yang menerima, deskripsi dibuat server (§5.4).
  3. `bugs.crowd_report_id` dan `crowd_reports.bug_id` saling menaut.

  Dua anggota tim yang menerima bersamaan menghasilkan **tepat satu** bug; pihak lain mendapat `409 REPORT_CONFLICT`.
- **Tolak:** `{ reason, note? }`. `reason` ∈ `not_reproducible` · `out_of_scope` · `not_a_bug` · `insufficient_info` · `other`; `note` ≤ 1000, wajib bila `other`.
- **Duplikat:** `{ duplicateOf }`, yaitu nomor laporan lain di **cycle yang sama**, dikirim **lebih dulu**, bukan dirinya sendiri, dan berstatus `submitted` atau `accepted` (`400 fields.duplicateOf`). Poin hanya diberikan ke laporan asli bila laporan itu diterima.
- **Kembalikan:** dari `rejected`/`duplicate` ke `submitted`; alasan, catatan, dan target duplikat dikosongkan.
- **Sembunyikan:** `hideFromKnownIssues` bisa diatur tim untuk laporan `accepted`, misalnya untuk masalah keamanan.
- **Riwayat:** setiap keputusan tercatat sebagai event (`from`, `to`, pelaku, detail, waktu) dan terlihat oleh tim serta pelapor.

### 5.4 Deskripsi bug dari laporan

Dibuat di server dengan helper Markdown aman yang dipindah dari `apps/web/src/lib/bugReport.ts` ke `packages/shared`:

- **Baris metadata.** "Laporan crowdtesting **CR-14** di cycle **CY-2**", nama pelapor, dan lingkungan. Teks dari crowd pada baris ini ditulis sebagai **code span**, sehingga tidak bisa membentuk link atau heading.
- **Isi laporan.** Bagian *Langkah*, *Hasil yang diharapkan*, dan *Yang terjadi* disalin sebagai Markdown. Renderer aman Tahap 3 membuatnya inert: HTML mentah di-escape, link hanya http/https/mailto, gambar tampil sebagai link.
- **Link bukti** ditulis sebagai autolink, hanya bila berupa http(s) tanpa spasi atau `<` `>`.
- Dipotong ke 20.000 karakter di batas code point.

### 5.5 Anti-spam

Pengecekan dilakukan dalam transaksi yang mengunci baris peserta, supaya kiriman bersamaan tidak lolos batas. Pelanggaran → `429 RATE_LIMITED` dengan pesan yang menyebut batasnya:

- Maksimal **10 laporan `submitted`** sekaligus per tester per cycle.
- Maksimal **50 laporan** per tester per cycle, termasuk yang ditarik.
- Maksimal **30 laporan per 24 jam** (rolling) per tester di semua cycle.
- Ditambah rate limit per IP pada `POST` laporan, `POST` komentar, dan join, memakai plugin yang sudah dipakai login.

### 5.6 Komentar

Satu thread per laporan untuk pelapor dan tim:

- Menulis: pelapor dan tester ke atas. Membaca: pelapor dan semua anggota.
- Isi: Markdown, 1–5000 karakter.
- Penulis bisa menghapus komentarnya sendiri (soft delete). Tidak ada edit.
- Komentar tetap bisa ditambahkan setelah laporan ditriase.

## 6. Reputasi

- **Poin tester** = jumlah `points` dari laporannya yang `accepted`.
- **Tingkat penerimaan** = diterima / (diterima + ditolak + duplikat). Laporan yang ditarik dan yang masih `submitted` tidak dihitung. Nilainya `null` bila belum ada keputusan.
- **Leaderboard per cycle** dan **global** (semua cycle non-draft):
  - Top 50, ditambah posisi saya bila saya login dan punya poin.
  - Urutan: poin ↓, jumlah diterima ↓, lalu waktu saat poin terakhir dicapai ↑ (yang lebih dulu menang).
  - Hanya tester dengan poin > 0 yang tampil.
- **Profil publik** `/crowd/testers/:userId`:
  - Nama tampilan, total poin, tingkat penerimaan, dan jumlah cycle yang diikuti.
  - 10 laporan diterima terbaru, berisi judul + severity + cycle, tanpa yang disembunyikan.
- **Email tidak pernah ditampilkan** di respons publik maupun tim untuk data crowd. Yang ditampilkan hanya `name`.
- Leaderboard global di-cache LRU 30 detik, dengan pola cache ringkasan perbandingan Tahap 3.

## 7. Model data

Migrasi `0007`, hanya menambah.

```
projects               + cycle_seq integer NOT NULL DEFAULT 0, + crowd_report_seq integer NOT NULL DEFAULT 0
crowd_cycles           id uuid PK, project_id uuid FK→projects ON DELETE CASCADE, number integer,
                       title text, summary text, instructions text, in_scope text, out_of_scope text,
                       app_version text NULL, status text CHECK, ends_at timestamptz NULL,
                       opened_at timestamptz NULL, closed_at timestamptz NULL, created_by uuid FK→users,
                       version integer NOT NULL DEFAULT 1, created_at, updated_at timestamptz,
                       UNIQUE (project_id, number), INDEX (status, opened_at DESC), INDEX (project_id, created_at DESC)
crowd_cycle_links      id uuid PK, cycle_id uuid FK→crowd_cycles ON DELETE CASCADE, position integer, url text, label text
crowd_cycle_environments cycle_id uuid FK→crowd_cycles ON DELETE CASCADE, position integer, label text,
                       PK (cycle_id, position), UNIQUE INDEX (cycle_id, lower(label))
crowd_participants     cycle_id uuid FK→crowd_cycles ON DELETE CASCADE, user_id uuid FK→users,
                       status text CHECK (active|left|removed), joined_at, rules_accepted_at timestamptz,
                       left_at, removed_at timestamptz NULL, removed_by uuid NULL FK→users ON DELETE SET NULL,
                       removal_reason text NULL, PK (cycle_id, user_id), INDEX (user_id)
crowd_reports          id uuid PK, project_id uuid FK→projects ON DELETE CASCADE,
                       cycle_id uuid FK→crowd_cycles ON DELETE CASCADE, number integer, reporter_id uuid FK→users,
                       title, steps, expected, actual, environment text, suggested_severity text CHECK,
                       status text CHECK, final_severity text NULL CHECK, points integer NOT NULL DEFAULT 0,
                       reject_reason text NULL CHECK, triage_note text NULL,
                       duplicate_of_id uuid NULL FK→crowd_reports ON DELETE SET NULL,
                       bug_id uuid NULL FK→bugs ON DELETE SET NULL, hide_from_known_issues boolean NOT NULL DEFAULT false,
                       triaged_by uuid NULL FK→users ON DELETE SET NULL, triaged_at timestamptz NULL,
                       version integer NOT NULL DEFAULT 1, submitted_at, updated_at timestamptz,
                       UNIQUE (project_id, number), INDEX (cycle_id, status, submitted_at),
                       INDEX (reporter_id, submitted_at DESC), INDEX (cycle_id, reporter_id, status),
                       INDEX (reporter_id) WHERE status = 'accepted', INDEX (duplicate_of_id), INDEX (bug_id)
crowd_report_links     id uuid PK, report_id uuid FK→crowd_reports ON DELETE CASCADE, position integer, url text, title text NULL
crowd_report_events    id bigserial PK, report_id uuid FK→crowd_reports ON DELETE CASCADE, actor_id uuid FK→users,
                       from_status text, to_status text, detail text NULL, created_at timestamptz,
                       INDEX (report_id, created_at)
crowd_report_comments  id uuid PK, report_id uuid FK→crowd_reports ON DELETE CASCADE, author_id uuid FK→users,
                       body text, created_at timestamptz, deleted_at timestamptz NULL, INDEX (report_id, created_at)
bugs                   + crowd_report_id uuid NULL FK→crowd_reports ON DELETE SET NULL, INDEX (crowd_report_id)
```

- **Nomor `CY-`/`CR-`:** pola Tahap 3–4, yaitu `UPDATE projects SET … = … + 1 RETURNING` di dalam transaksi pembuatan.
- **Index FK:** setiap FK dengan `ON DELETE SET NULL` atau `CASCADE` punya index penuh, pelajaran dari Tahap 4.
- **Urutan kunci** didokumentasikan di repository dan harus konsisten: project → cycle → peserta → laporan.

## 8. API

Semua endpoint memakai cookie sesi. Token CI **tidak** berlaku (diperlakukan anonim). Bentuk error tetap `{ error: { code, message, fields? } }`, dan cursor rusak → `400`.

### 8.1 API tim (`/api/v1/projects/:slug`)

| Endpoint | Hak | Keterangan |
|---|---|---|
| `GET /cycles?status=&cursor=` | baca | 20 per halaman, terbaru dulu. Anggota melihat semua; bukan anggota hanya open/closed. Item: nomor, judul, status efektif, periode, peserta aktif, hitungan laporan per status. |
| `POST /cycles` | admin | `201` + cycle (draft). |
| `GET /cycles/:number` | baca | Detail + hitungan. Bukan anggota: draft → `404 CYCLE_NOT_FOUND`. |
| `PATCH /cycles/:number` | admin | `{ version, …field, status? }` (§3.2). |
| `DELETE /cycles/:number` | admin | `204`; `409 CYCLE_HAS_REPORTS`. |
| `GET /cycles/:number/participants?status=&cursor=` | anggota | 50 per halaman: `{ user: {id, name}, status, joinedAt, reportCounts }`. |
| `POST /cycles/:number/participants/:userId/remove` | tester+ | `{ reason? }` → `204`. |
| `GET /cycles/:number/reports?status=&severity=&q=&cursor=` | anggota | 50 per halaman. Default `status=submitted`, terlama dulu; status lain terbaru dulu. |
| `GET /cycles/:number/leaderboard` | baca | Sama dengan versi publik. |
| `GET /crowd-reports/:number` | anggota | Detail + pelapor `{id, name}` + event + `bug: BugRef \| null` + `duplicateOf: {number, title} \| null` + `nextSubmittedNumber` (laporan `submitted` berikutnya di cycle yang sama, terlama dulu, berputar; `null` bila tidak ada). |
| `POST /crowd-reports/:number/triage` | tester+ | `{ version, decision: "accept"\|"reject"\|"duplicate"\|"reopen", severity?, priority?, reason?, note?, duplicateOf? }`. |
| `PATCH /crowd-reports/:number` | tester+ | `{ version, hideFromKnownIssues }` (hanya `accepted`). |
| `GET /crowd-reports/:number/comments?cursor=` | anggota | 50 per halaman, lama → baru. |
| `POST /crowd-reports/:number/comments` | tester+ | `201`. |
| `DELETE /crowd-reports/:number/comments/:id` | penulis | `204`. |
| `GET /crowd/summary` | anggota | `{ openCycles, awaitingTriage, accepted30d } \| null` (`null` bila belum ada cycle) untuk kartu dashboard. |

Aksi izin baru:

| Aksi | Siapa | Keterangan |
|---|---|---|
| `crowd:read` | viewer, tester, admin | Data laporan dan peserta hanya untuk anggota, juga di project publik. |
| `crowd:triage` | tester, admin | Triase, komentar tim, keluarkan peserta. |
| `crowd:manage` | admin | Buat, ubah, dan hapus cycle. |

### 8.2 API publik (`/api/v1/crowd`)

| Endpoint | Hak | Keterangan |
|---|---|---|
| `GET /cycles?status=open\|closed&q=&cursor=` | publik | Direktori, 20 per halaman. `open` (default) = status efektif open, berakhir terdekat dulu, lalu dibuka terbaru. `closed` = selesai, terbaru dulu. `q` cari judul/ringkasan (≤ 100). |
| `GET /cycles/:id` | publik | Isi cycle (§3.3) + `stats {participants, accepted}` + `me: { state: "anonymous"\|"can_join"\|"joined"\|"left"\|"removed"\|"member"\|"closed" }`. |
| `POST /cycles/:id/join` | login | `{ acceptRules: true }` → `200` + `me`. |
| `DELETE /cycles/:id/join` | peserta | `204`. |
| `GET /cycles/:id/known-issues?cursor=` | publik | Laporan `accepted` yang tidak disembunyikan: `{ title, severity, acceptedAt }`, 100 per halaman, terbaru dulu. |
| `GET /cycles/:id/leaderboard` | publik | `{ entries: [{ rank, user: {id, name}, points, accepted }], me: {...} \| null }`. |
| `GET /cycles/:id/reports` | peserta (aktif/keluar/dikeluarkan) | Laporan saya di cycle ini. |
| `POST /cycles/:id/reports` | peserta aktif | `201` + laporan (§4, §5.5). |
| `GET /reports/:id` | pelapor | Detail + event + hasil triase. Milik orang lain → `404 REPORT_NOT_FOUND`. |
| `PATCH /reports/:id` | pelapor | `{ version, …field }`, hanya `submitted`. |
| `DELETE /reports/:id` | pelapor | Tarik laporan (`withdrawn`), hanya `submitted`. |
| `GET /reports/:id/comments?cursor=` · `POST` · `DELETE /reports/:id/comments/:commentId` | pelapor | Thread yang sama dengan §8.1. |
| `GET /leaderboard` | publik | Leaderboard global. |
| `GET /testers/:userId` | publik | Profil (§6). Pengguna tanpa satu pun laporan diterima → profil kosong (bukan 404). |
| `GET /me` | login | `{ cycles: [{ cycle, status, reportCounts, points }], points, acceptanceRate }`. |

### 8.3 Perluasan endpoint lama

- `POST /bugs` tidak berubah. Bug dari crowd **hanya** dibuat lewat triase.
- `BugDto` + `crowdOrigin: { cycleNumber, cycleTitle, reportNumber, reporterName } | null`.
- `BugSummaryDto` tidak berubah. Label `crowd` sudah terlihat lewat daftar label yang ada.

Kode error baru: `CYCLE_NOT_FOUND`, `CYCLE_NOT_OPEN`, `CYCLE_HAS_REPORTS`, `CYCLE_CONFLICT`, `MEMBER_CANNOT_JOIN`, `NOT_PARTICIPANT`, `PARTICIPANT_REMOVED`, `REPORT_NOT_FOUND`, `REPORT_CONFLICT`, `INVALID_TRIAGE`. `RATE_LIMITED` dan `INVALID_TRANSITION` dipakai ulang.

### 8.4 Matriks otorisasi

**API tim** (pola Tahap 3–4):

| Endpoint | Anonim (privat / publik) | Non-anggota (privat / publik) | Viewer | Tester | Admin |
|---|---|---|---|---|---|
| GET cycles, cycle (non-draft), leaderboard cycle | 404 / 200 | 404 / 200 | 200 | 200 | 200 |
| GET participants, reports, crowd-report, comments, summary | 404 / 401 | 404 / 403 | 200 | 200 | 200 |
| POST triage, PATCH report, POST comment, remove participant | 401 | 404 / 403 | 403 | 2xx | 2xx |
| POST/PATCH/DELETE cycle | 401 | 404 / 403 | 403 | 403 | 2xx |

**API publik:**

| Aksi | Anonim | Login, bukan peserta | Peserta aktif | Peserta keluar | Dikeluarkan | Anggota project |
|---|---|---|---|---|---|---|
| GET direktori, cycle, known-issues, leaderboard, profil | 200 | 200 | 200 | 200 | 200 | 200 |
| POST join | 401 | 200 | 200 | 200 | 403 | 403 |
| GET/POST laporan cycle | 401 | 403 | 200/201 | 200/403 | 200/403 | 403 |
| GET/PATCH/DELETE laporan sendiri | 401 | — | 2xx | 2xx | 2xx (GET) / 403 | — |
| Laporan orang lain | 401 | 404 | 404 | 404 | 404 | 404 |

## 9. Tampilan

Aturan untuk semua halaman:
- Bahasa Indonesia, dua tema, 375 px tanpa scroll horizontal, lolos axe, dan gate CSP.
- Komponen shadcn yang diizinkan saja; tanpa dialog (konfirmasi inline); input native (`<select>`, radio, checkbox, `datetime-local`).
- Waktu ditampilkan dalam zona waktu browser dan disimpan dalam UTC. Halaman baru di-lazy-load.
- `<select>` tidak dibuat di dalam subtree Suspense yang baru muncul (artefak guard CSP WebKit).

### 9.1 Navigasi

- Header utama mendapat menu **"Crowdtesting"** (`/crowd`) untuk semua pengunjung.
- Tab project baru **Crowd** (`/p/:slug/cycles`) setelah Test manual. Tab ini tidak membawa `?branch=`.

### 9.2 Area publik

- **Direktori `/crowd`**
  - Tab *Berlangsung* / *Selesai* dan kotak cari, keduanya tersimpan di URL.
  - Kartu cycle: judul, nama project, ringkasan, periode ("berakhir 3 hari lagi" / "tanpa batas akhir"), jumlah peserta, dan jumlah laporan diterima. "Muat lagi" dengan cursor.
  - Cuplikan leaderboard global (top 5) dengan link "Lihat semua".
- **Cycle `/crowd/c/:id`**
  - **Header:** judul, project (tertaut hanya bila project publik), status, periode, dan versi aplikasi.
  - **Blok aksi** sesuai `me.state`:
    - `anonymous`: "Masuk untuk ikut", yang kembali ke halaman ini setelah login.
    - `can_join`: centang aturan + "Ikut cycle ini".
    - `joined`: "Kirim laporan" + "Keluar dari cycle".
    - `left`: "Ikut lagi".
    - `removed`, `member`, `closed`: pesan penjelasan.
  - **Link aplikasi:** label, domain, dan keterangan "membuka situs luar"; `target="_blank" rel="noopener noreferrer"`.
  - **Tab:** *Instruksi* (instruksi, cakupan, lingkungan target), *Masalah diketahui*, *Leaderboard*, *Laporan saya* (bila pernah bergabung).
- **Kirim laporan `/crowd/c/:id/report`**
  - Field §5.1, dengan Markdown Tulis/Pratinjau.
  - Lingkungan: chip dari lingkungan target, yang mengisi kolom teks dan tetap bisa diedit.
  - Severity: radio dengan penjelasan per tingkat.
  - Editor link bukti.
  - Panel **"Cek dulu masalah yang sudah diketahui"**: daftar yang bisa dicari, di samping form di desktop dan di atas form di HP.
  - Pesan anti-spam menyebut batas yang tercapai. Bila cycle ditutup saat form dibuka, isian tidak hilang.
- **Laporan saya `/crowd/r/:id`**
  - Status dan timeline event.
  - Hasil triase: poin ("+5 poin · Critical"), alasan penolakan beserta catatan, atau judul laporan asli bila duplikat.
  - Thread komentar.
  - Edit dan tarik laporan selama `submitted`; bentrok → banner muat ulang tanpa membuang isian.
- **Leaderboard global `/crowd/leaderboard`**, **profil `/crowd/testers/:userId`**, dan **ringkasan saya `/crowd/me`**.

### 9.3 Area tim

- **Daftar cycle `/p/:slug/cycles`**
  - Status efektif, periode, peserta, dan jumlah laporan **menunggu triase** (ditonjolkan).
  - "Buat cycle" untuk admin.
- **Form cycle** (`/p/:slug/cycles/new` dan `/p/:slug/cycles/:number/edit`)
  - Judul dan ringkasan (dengan penghitung karakter).
  - Editor link aplikasi (tambah, hapus, ▲/▼).
  - Instruksi dan cakupan dalam Markdown Tulis/Pratinjau.
  - Chip lingkungan target, versi aplikasi (dengan saran dari `GET /versions`), dan `endsAt`.
  - Konflik `version` → banner muat ulang tanpa membuang isian.
- **Detail cycle `/p/:slug/cycles/:number`**
  - **Header:** status dengan tombol Buka / Tutup / Buka ulang (konfirmasi inline), link publik dengan tombol "Salin", dan "Lihat sebagai crowd tester".
  - **Tab *Antrian triase*:** filter status / severity / cari; baris berisi `CR-n`, judul, pelapor, severity usulan, umur laporan.
  - **Tab *Peserta*:** tombol keluarkan dengan alasan inline.
  - **Tab *Leaderboard*.**
  - Hapus cycle (admin, hanya bila belum ada laporan).
- **Triase `/p/:slug/crowd-reports/:number`**
  - **Kiri:** isi laporan (Markdown aman), lingkungan, link bukti, pelapor, timeline.
  - **Kanan:** panel keputusan.
    - **Terima:** severity (terisi usulan) + prioritas → "Bug #45 dibuat" dengan link.
    - **Tolak:** radio alasan + catatan.
    - **Duplikat:** cari laporan di cycle yang sama (nomor/judul), hanya kandidat yang sah.
    - **Kembalikan**, dan saklar "sembunyikan dari daftar masalah diketahui".
  - Tombol **"Simpan & berikutnya"** ke `nextSubmittedNumber`.
  - Banner `409 REPORT_CONFLICT`, dan thread komentar.

### 9.4 Perluasan

- **Detail bug:** asal "Dari crowdtesting **CY-2 · CR-14** oleh *nama*", dengan link ke halaman triase.
- **Dashboard project:** kartu "Crowdtesting" (cycle terbuka, menunggu triase, diterima 30 hari terakhir); tidak tampil bila belum ada cycle.
- **Landing:**
  - Kartu "Crowdtesting" menjadi Tersedia.
  - Roadmap: Tahap 5 Live, Tahap 6 Berikutnya.
  - Hero menyebut crowdtesting.
  - Tidak ada lagi badge "Segera" (`landing.spec.ts` menghitung 0).

### 9.5 Testid minimal

**Area publik:**
- Navigasi & direktori: `nav-crowd`, `crowd-directory`, `crowd-tab-open`, `crowd-tab-closed`, `crowd-search`, `crowd-cycle-card-<id>`, `crowd-leaderboard-teaser`.
- Halaman cycle: `cycle-public-header`, `cycle-action`, `cycle-rules-checkbox`, `cycle-join`, `cycle-leave`, `cycle-app-link-<i>`, `cycle-tab-<nama>`, `known-issues`, `known-issue-<i>`, `leaderboard`, `leaderboard-row-<rank>`, `leaderboard-me`.
- Form laporan: `report-form`, `report-title`, `report-steps`, `report-expected`, `report-actual`, `report-environment`, `report-env-chip-<i>`, `report-severity`, `report-links`, `report-submit`, `report-limit`, `report-known-issues`.
- Laporan saya: `my-report-status`, `my-report-points`, `my-report-triage`, `report-withdraw`, `report-conflict`.
- Profil & ringkasan: `tester-profile`, `crowd-me`.

**Area tim:**
- Daftar & form cycle: `cycles-list`, `cycle-row-<number>`, `cycle-create`, `cycle-form`, `cycle-link-<i>-url`, `cycle-link-<i>-label`, `cycle-link-add`, `cycle-env-input`, `cycle-ends-at`, `cycle-conflict`.
- Detail cycle: `cycle-status`, `cycle-open`, `cycle-close`, `cycle-reopen`, `cycle-copy-link`, `cycle-delete`, `cycle-delete-confirm`, `triage-queue`, `triage-row-<number>`, `participant-row-<userId>`, `participant-remove-<userId>`.
- Halaman triase: `triage-panel`, `triage-accept`, `triage-severity`, `triage-priority`, `triage-reject`, `triage-reason`, `triage-note`, `triage-duplicate`, `triage-duplicate-search`, `triage-reopen`, `triage-hide`, `triage-save-next`, `triage-bug-link`, `triage-conflict`, `crowd-comment-input`, `crowd-comment-submit`.

**Perluasan:** `bug-crowd-origin`, `crowd-card`.

## 10. Visual regression

Baseline baru dengan pola Tahap 3–4: container Playwright, data tetap di project terpisah agar baseline lama tidak berubah, jam dibekukan, dan waktu relatif serta id di-mask. Masing-masing dalam tema terang & gelap × 1280 × 800 & 375 × 812:

- Direktori `/crowd`
- Halaman cycle publik (tab Instruksi)
- Form laporan
- Halaman triase

Baseline lama yang berubah karena menu header baru dibuat ulang dalam task yang mengubahnya.

## 11. Performa (k6)

Skenario baca ditambah endpoint berikut:
- `GET /crowd/cycles` (direktori)
- `GET /crowd/cycles/:id`
- `GET /crowd/cycles/:id/known-issues`
- `GET /crowd/leaderboard` (global)

Data disiapkan oleh `setup.mjs`: ≥ 20 cycle, ≥ 200 tester, dan ≥ 1000 laporan diterima yang tersebar. Threshold tetap: `http_req_duration{scenario:read}` p(95) < 300 ms dan `http_req_failed` < 1%.

## 12. Keamanan (ZAP)

Baseline scan ZAP yang sudah ada ditambah halaman `/crowd`, `/crowd/c/:id`, dan `/crowd/leaderboard`. Aturan pass/fail tidak berubah (`tests/security/check-zap-report.mjs`).

## 13. Testing

| Lapisan | Cakupan |
|---|---|
| Unit (domain, coverage ≥ 80%, mutation ≥ 80%) | Tabel transisi laporan & cycle lengkap; poin per severity; tingkat penerimaan termasuk `null`; urutan leaderboard + tie-break; status efektif cycle (batas tepat `endsAt`); keputusan `me.state` untuk semua kasus; validasi duplikat (cycle lain, lebih baru, diri sendiri, ditarik); batas anti-spam (tepat 10/50/30); pembuat deskripsi bug (code span untuk metadata, autolink aman, pemotongan di code point). |
| Integration (Testcontainers) | Dua penerimaan bersamaan → tepat satu bug + satu `409`; anti-spam di bawah konkurensi (9 `submitted` + 5 kiriman paralel → 1 lolos); nomor `CY-`/`CR-` unik paralel; join paralel idempoten; peserta yang menjadi anggota → `403 MEMBER_CANNOT_JOIN`; dikeluarkan → tidak bisa join/kirim, laporan tetap ditriase, poin tetap; transisi cycle & `endsAt`; `409 CYCLE_HAS_REPORTS`; hapus project dengan data crowd → semua terhapus bersih; **privasi**: pindai seluruh JSON respons publik & tim untuk pola email → tidak ada; laporan orang lain/cycle draft → 404; project privat → `slug: null`; leaderboard & profil; cache leaderboard global; migrasi `0007` di atas data Tahap 4. |
| API (Playwright) | Matriks §8.4 (tim: 6 aktor + anonim publik; publik: semua aktor baru); Bearer token = anonim; semua respons di-parse schema shared; rate limit per IP. |
| Kontrak (Pact) | Web: satu interaksi sukses per endpoint baru + `404 CYCLE_NOT_FOUND`, `404 REPORT_NOT_FOUND`, `409 REPORT_CONFLICT`, `409 INVALID_TRIAGE`, `409 CYCLE_NOT_OPEN`, `403 MEMBER_CANNOT_JOIN`, `429 RATE_LIMITED`; `BugDto.crowdOrigin`. |
| E2E (3 browser, gate CSP, dua konteks) | (1) Admin membuat cycle (link, instruksi, lingkungan) → buka → tester luar menemukannya di direktori → bergabung → membaca masalah diketahui → kirim laporan → admin menerima (severity diubah) → bug berlabel `crowd` dengan asal yang benar → tester melihat "+5 poin" → leaderboard cycle & global berubah. (2) Alur ditolak (alasan terlihat tester) dan duplikat. (3) Komentar dua arah. (4) Edit & tarik laporan; bentrok dua tab. (5) Pesan anti-spam (data disiapkan lewat API). (6) Dikeluarkan; anggota project mencoba bergabung. (7) Anonim menjelajahi direktori, cycle, leaderboard, profil; cycle di project privat tampil, halaman project 404. (8) **Stored XSS crowd → tim**: laporan berisi `<script>`, `<img onerror>`, link `javascript:`, gambar eksternal → inert di halaman triase, bug yang dibuat, dan halaman publik; gate CSP bersih. (9) Atribut link aplikasi & bukti. (10) Cycle ditutup saat form laporan terbuka → isian tidak hilang. (11) a11y dua tema; 375 px. |
| Mutation | Domain `crowd` otomatis ikut glob `src/modules/**/domain/**`; skor tetap ≥ 80%; pengecualian hanya untuk mutan yang benar-benar setara, dicatat di `TEST_STRATEGY.md`. |
| Visual | §10. |
| Performa | §11. |
| Keamanan | §12. |

## 14. Dogfooding

- Project `testpulse` di production membuka cycle publik **"Uji TestPulse 0.5.0"**:
  - Link ke web production.
  - Instruksi alur yang perlu dicoba: daftar, buat project, upload JUnit via curl, bug, dan test manual.
  - Cakupan; di luar cakupan: serangan DoS dan social engineering.
  - Lingkungan target: Chrome, Firefox, Safari, dan HP.
- Cycle dibuat lewat skrip `scripts/seed-dogfood-crowd.mjs`, dengan pola dan pengamanan yang sama dengan skrip seed Tahap 4: kredensial dari environment, https saja kecuali localhost, tanpa redirect, idempoten, dan tujuan dicetak sebelum login. Skrip dijalankan **oleh Anda** setelah deploy `0.5.0`.
- Laporan dari pengunjung ditriase oleh Anda.
- `package.json` root → `"version": "0.5.0"`.

## 15. Dokumentasi

- `docs/test-plans/tahap-5.md`.
- ADR `0007-crowdtesting-visibilitas-privasi-dan-anti-spam.md`: visibilitas cycle terhadap project privat, privasi tester (tanpa email, 404 untuk laporan orang lain), model poin, anti-spam, dan deskripsi bug dibuat di server.
- `docs/TEST_STRATEGY.md`:
  - Risiko baru: konten dari pihak luar, privasi, spam.
  - Lapisan keamanan yang diperluas.
  - Snapshot jumlah test.
- README: fitur Tahap 5, screenshot direktori & triase, roadmap Tahap 5 ✅, dan cara menjalankan seed.
- Landing: §9.4.

## 16. Tidak termasuk

- Pembayaran, hadiah, atau badge.
- Upload file atau screenshot; bukti hanya berupa link.
- Undangan privat ke cycle, dan persetujuan peserta sebelum bergabung.
- Notifikasi email.
- Penilaian kualitas laporan selain triase.
- Banding atas keputusan triase, kecuali lewat komentar.
- Moderasi otomatis atau deteksi spam berbasis konten.
- Leaderboard per periode (mingguan/bulanan).
- Profil tester yang bisa diedit (bio, avatar).
- Aplikasi desktop (Tahap 6).

## 17. Definisi selesai

- **Siklus cycle:** cycle bisa dibuat, dibuka, ditutup, dan dibuka ulang. Cycle yang dipublikasikan tampil di direktori `/crowd`, termasuk dari project privat, tanpa membocorkan isi project.
- **Laporan & triase:** crowd tester bisa bergabung, mengirim, mengedit, dan menarik laporan, serta berkomentar. Tim bisa menerima (menjadi bug berlabel `crowd` dengan asal yang tercatat), menolak, menandai duplikat, dan mengembalikan laporan.
- **Reputasi & anti-spam:** poin, leaderboard, dan profil terhitung benar; batas anti-spam berlaku.
- **Privasi:** email tidak pernah muncul di respons mana pun, dan laporan orang lain tidak pernah terbaca.
- **Kualitas:** semua halaman lolos a11y dua tema, 375 px, dan gate CSP. Semua lapisan hijau di CI, termasuk visual regression, k6, ZAP, dan mutation ≥ 80%.
- **Production:** `/crowd` menampilkan cycle "Uji TestPulse 0.5.0".
- **Dokumen:** diperbarui.
