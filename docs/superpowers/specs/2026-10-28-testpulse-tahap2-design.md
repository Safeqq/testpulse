# TestPulse — Spec Tahap 2: Dashboard hasil test & deteksi flaky

- **Tanggal:** 2026-10-28
- **Status:** Draft, menunggu review
- **Prasyarat:** Tahap 1 + UI baru (tema, landing) live di https://testpulse-d2p.pages.dev.
- **Ruang lingkup:** `apps/api` (modul baru), `apps/web` (halaman baru), `packages/shared` (schema), `packages/reporter` (baru), `tests/` (semua lapisan), `tests/perf` (k6, baru), workflow CI/deploy, dokumentasi.

## 1. Konteks & tujuan

Tahap 1 menyediakan akun, project, tim, dan project publik, tetapi halaman project masih berisi "Belum ada hasil test". Tahap 2 menghadirkan fitur inti produk:

1. **CI mengunggah hasil test** (JUnit XML) ke sebuah project memakai **token CI**.
2. **Dashboard** menampilkan riwayat run, test yang gagal, tren pass rate, dan **test flaky** beserta skornya.
3. **Dogfooding:** setelah setiap deploy, CI TestPulse mengunggah hasil test-nya sendiri ke project publik `testpulse` di production, sehingga recruiter melihat data kualitas nyata tanpa login.

**Kriteria sukses:** upload JUnit dari curl dan dari reporter CLI berfungsi; dashboard, detail run, daftar flaky, dan riwayat test tampil benar di kedua tema dan di HP; project publik `testpulse` di production menampilkan run nyata dari CI TestPulse; semua lapisan test (termasuk k6 baru) hijau di CI.

## 2. Keputusan

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Format input | **JUnit XML saja** | Universal (Playwright, Vitest, Jest, pytest, Maven, Go, dll.); satu parser. |
| Cara kirim | **Endpoint HTTP + CLI di repo** (`packages/reporter`); curl juga bisa | Tanpa akun npm/versioning; CLI bisa dipublikasikan kelak. |
| Definisi flaky | **Gabungan:** lulus-setelah-retry dalam satu run **atau** berganti lulus/gagal di 20 run terakhir per branch | Langsung terdeteksi untuk framework dengan retry, tetap menangkap flaky lintas run. |
| Arsitektur ingest | **Sinkron + tabel ternormalisasi** | Sederhana, langsung terlihat, mudah diuji, cocok dengan Render free (tanpa worker gratis). |
| Grafik | **SVG buatan sendiri**, tanpa library chart | Ringan, aman CSP, tanpa dependency besar. |
| Bundle | Halaman dashboard di-**lazy-load** (code-splitting per route) | Bundle utama (±539 KB) tidak bertambah; menuntaskan catatan review UI. |

## 3. Token CI

- Dikelola admin di **Pengaturan project → Token CI**: buat (nama 1–60 karakter), daftar (nama, dibuat oleh, `created_at`, `last_used_at`), cabut.
- Format: `tp_` + 32 byte acak (base64url). Ditampilkan **sekali** saat dibuat; DB hanya menyimpan SHA-256.
- Maksimal **10 token aktif** per project (`409 TOKEN_LIMIT`).
- Token hanya mengotorisasi **upload ke project pemiliknya**. Token tidak berlaku untuk endpoint lain (selain upload, semua endpoint tetap memakai sesi cookie). Sebaliknya, cookie sesi **tidak** berlaku untuk endpoint upload.
- `last_used_at` diperbarui pada setiap upload yang berhasil.
- Mencabut token tidak menghapus run yang pernah diunggah dengannya (`runs.token_id` → `NULL` saat token dihapus; pencabutan hanya mengisi `revoked_at`).

## 4. Endpoint upload

`POST /api/v1/projects/:slug/runs`

- **Header:** `Authorization: Bearer tp_...`, `Content-Type: application/xml` atau `text/xml` (charset boleh).
- **Body:** dokumen JUnit XML mentah.
- **Query:**

  | Parameter | Wajib | Aturan |
  |---|---|---|
  | `branch` | ya | 1–200 karakter, `[A-Za-z0-9._/-]` |
  | `commit` | tidak | hex 7–40 karakter |
  | `ciUrl` | tidak | URL `http`/`https`, ≤ 500 karakter |
  | `name` | tidak | ≤ 120 karakter |

- **Sukses:** `201 { runId, url, totals: { total, passed, failed, skipped, flaky } }`. `url` = `${APP_ORIGIN}/p/:slug/runs/:runId`.
- **Error:**

  | Status | Kode | Kapan |
  |---|---|---|
  | 401 | `UNAUTHENTICATED` | token tidak ada, salah format, tidak dikenal, atau dicabut (pesan identik untuk semua kasus) |
  | 404 | `PROJECT_NOT_FOUND` | token valid tetapi milik project lain (tidak membocorkan keberadaan project) |
  | 400 | `VALIDATION_ERROR` | query tidak valid (`fields` per parameter) atau Content-Type bukan XML |
  | 413 | `PAYLOAD_TOO_LARGE` | body > 5 MB |
  | 422 | `INVALID_REPORT` | XML rusak, memuat `<!DOCTYPE>`, bukan JUnit, tanpa testcase, atau > 20.000 testcase |
  | 429 | `RATE_LIMITED` | > 60 upload per jam per token (dapat diatur lewat env `INGEST_RATE_LIMIT_MAX`, hanya dilonggarkan di stack test) |

- **Keamanan:**
  - Endpoint ini dikecualikan dari aturan "body wajib JSON" di `http/security.ts` **hanya** untuk path ini dan **hanya** dengan Content-Type XML. Aman dari CSRF karena otorisasinya hanya Bearer token (bukan kredensial yang dikirim otomatis oleh browser). Pemeriksaan header `Origin` tetap berlaku.
  - Parser XML **menolak** dokumen yang memuat `<!DOCTYPE` (mencegah XXE dan entity expansion) dan tidak pernah me-resolve entity eksternal.
  - Batas body diterapkan per route (5 MB) sebelum parsing.
  - Token tidak pernah tercatat di log (header `authorization` sudah di-redact).
- **Retensi:** dalam transaksi yang sama setelah insert, run di luar **200 terbaru** per project dihapus (cascade ke `test_results`). `test_cases` yang tidak lagi punya hasil boleh dibiarkan.

### 4.1 Aturan parsing JUnit

- Root: `<testsuites>` (berisi satu atau lebih `<testsuite>`, boleh bersarang) atau satu `<testsuite>`.
- **Identitas test:** `suite` = atribut `classname` testcase bila ada, jika tidak nama `<testsuite>` terdekat; `name` = atribut `name` testcase. Keduanya di-trim; dipotong ke 500 karakter.
- **Status per kemunculan:** ada `<failure>` atau `<error>` → `failed`; ada `<skipped>` → `skipped`; selain itu → `passed`.
- **Durasi:** atribut `time` (detik, desimal) → milidetik bulat; tidak ada/invalid → 0. Durasi run = atribut `time` root bila ada, jika tidak jumlah durasi test.
- **Pesan:** dari atribut `message` atau isi teks `<failure>`/`<error>`, dipotong ke 4 KB.
- **Penggabungan kemunculan ganda** (test yang sama muncul beberapa kali dalam satu laporan):
  - ada yang lulus dan ada yang gagal → status `passed`, `flaky_in_run = true`;
  - semua gagal → `failed`; semua skip → `skipped`;
  - `retries` = jumlah kemunculan − 1; `duration_ms` = jumlah durasi semua kemunculan; `message` = dari kemunculan gagal terakhir.
- **Konvensi Surefire:** testcase lulus yang memuat `<flakyFailure>` atau `<rerunFailure>` → `flaky_in_run = true`, `retries` = jumlah elemen tersebut.
- **Total run:** dihitung dari hasil **setelah** penggabungan (satu hasil per test per run). `flaky` = jumlah hasil dengan `flaky_in_run`.

## 5. Model data

```
project_tokens  id uuid PK, project_id uuid FK→projects ON DELETE CASCADE, name text, token_hash text UNIQUE,
                created_by uuid FK→users, created_at timestamptz, last_used_at timestamptz NULL,
                revoked_at timestamptz NULL
runs            id uuid PK, project_id uuid FK→projects ON DELETE CASCADE, branch text, commit_sha text NULL,
                ci_url text NULL, name text NULL, created_at timestamptz, duration_ms integer,
                total integer, passed integer, failed integer, skipped integer, flaky integer,
                token_id uuid NULL FK→project_tokens ON DELETE SET NULL
                INDEX (project_id, branch, created_at DESC), INDEX (project_id, created_at DESC)
test_cases      id uuid PK, project_id uuid FK→projects ON DELETE CASCADE, suite text, name text,
                first_seen_at timestamptz, UNIQUE (project_id, suite, name)
test_results    id bigserial PK, run_id uuid FK→runs ON DELETE CASCADE,
                test_case_id uuid FK→test_cases ON DELETE CASCADE,
                status text CHECK IN ('passed','failed','skipped'), flaky_in_run boolean,
                retries integer, duration_ms integer, message text NULL,
                UNIQUE (run_id, test_case_id), INDEX (test_case_id, run_id)
```

Insert `test_cases` memakai upsert (`ON CONFLICT DO NOTHING` + select) dalam satu transaksi bersama run dan hasilnya, sehingga upload paralel untuk project yang sama tidak menghasilkan duplikat atau 500.

## 6. Perhitungan flaky

Untuk satu test pada satu branch, ambil hasilnya dari **20 run terakhir branch itu yang memuat test tersebut**, urut waktu; abaikan `skipped`. Misalkan `n` = jumlah hasil tersisa.

- `flip` = jumlah pasangan hasil berurutan yang statusnya berbeda (lulus↔gagal).
- `flakyRuns` = jumlah hasil dengan `flaky_in_run = true`.
- **Skor** = `n = 0 ? 0 : min(100, round(100 × (flip + flakyRuns) / n))`. Test **flaky** bila skor > 0.

| Urutan hasil (lama → baru) | Skor |
|---|---|
| L L L L | 0 |
| G G G G (rusak konsisten, bukan flaky) | 0 |
| L G L G | 75 |
| 9× L + 1× L-dengan-retry | 10 |
| hanya skip | 0 |

Rumus diimplementasikan sebagai fungsi murni (`flakyScore(results)`) **dan** sebagai query SQL untuk daftar flaky; test integrasi memastikan keduanya memberi hasil sama.

## 7. API

Akses baca mengikuti aturan Tahap 1: project publik → siapa saja; project privat → minimal `viewer`, non-anggota/tidak ada → `404 PROJECT_NOT_FOUND`.

| Method & path | Akses | Isi |
|---|---|---|
| `GET /projects/:slug/branches` | baca | daftar branch + run terakhir tiap branch, urut terbaru |
| `GET /projects/:slug/runs?branch=&cursor=` | baca | 20 run per halaman, cursor buram (base64 dari `created_at`,`id`), `nextCursor` atau `null` |
| `GET /projects/:slug/runs/:runId?status=failed\|flaky\|all&cursor=` | baca | ringkasan run + hasil test 100 per halaman (default `status=failed`); `404 RUN_NOT_FOUND` |
| `DELETE /projects/:slug/runs/:runId` | **tester+** | `204`; `404 RUN_NOT_FOUND` |
| `GET /projects/:slug/stats?branch=` | baca | 30 titik tren `{ runId, createdAt, passRate, durationMs }` + ringkasan run terakhir (`passRate` = passed/(passed+failed)×100, dibulatkan 1 desimal; `null` bila keduanya 0) |
| `GET /projects/:slug/flaky?branch=` | baca | maks. 50 test dengan skor > 0, urut skor turun lalu nama: `{ testCaseId, suite, name, score, lastStatus }` |
| `GET /projects/:slug/tests/:testCaseId/history?branch=` | baca | test + 20 hasil terakhir `{ runId, createdAt, status, flakyInRun, retries, durationMs }`; `404 TEST_NOT_FOUND` |
| `GET /projects/:slug/tokens` | admin | token aktif (tanpa nilai token) |
| `POST /projects/:slug/tokens` `{name}` | admin | `201 { id, name, token, createdAt }`; `409 TOKEN_LIMIT` |
| `DELETE /projects/:slug/tokens/:id` | admin | `204`; `404 TOKEN_NOT_FOUND` |

`branch` di query bersifat opsional; tanpa `branch`, endpoint memakai semua branch (`runs`) atau branch dari run terbaru (`stats`, `flaky`, `history`). Kode error baru di `@testpulse/shared`: `RUN_NOT_FOUND`, `TEST_NOT_FOUND`, `TOKEN_NOT_FOUND`, `TOKEN_LIMIT`, `PAYLOAD_TOO_LARGE`, `INVALID_REPORT`.

### 7.1 Matriks otorisasi tambahan

| Endpoint | anonim | non-anggota privat | non-anggota publik | viewer | tester | admin |
|---|---|---|---|---|---|---|
| GET branches/runs/run/stats/flaky/history | 200 publik, 404 privat | 404 | 200 | 200 | 200 | 200 |
| DELETE run | 401 | 404 | 403 | 403 | 204 | 204 |
| GET/POST/DELETE tokens | 401 | 404 | 403 | 403 | 403 | 2xx |
| POST runs dengan cookie sesi (tanpa token) | 401 | 401 | 401 | 401 | 401 | 401 |

Token CI yang valid **tidak** diterima di endpoint mana pun selain `POST runs` (diperlakukan seperti tidak login).

## 8. Tampilan

- **`/p/:slug`** (ringkasan) menggantikan empty state:
  - pemilih branch (`<select>` native; default `main` bila ada, jika tidak branch run terbaru);
  - kartu angka: status run terakhir, pass rate, jumlah test, jumlah flaky;
  - grafik tren pass rate 30 run terakhir (SVG);
  - 5 run terbaru dan 5 test paling flaky, masing-masing dengan link "Lihat semua".
  - Tanpa run: **anggota** melihat panduan setup (contoh curl dengan URL & slug terisi, link ke Token CI bagi admin); **pengunjung** project publik melihat "Belum ada hasil test".
- **`/p/:slug/runs`**: daftar run (filter branch, tombol "Muat lebih banyak").
- **`/p/:slug/runs/:runId`**: header (branch, commit mono, link CI eksternal, durasi, total), filter **Gagal / Flaky / Semua**, pesan error dalam blok monospace yang bisa dibuka-tutup (`<details>`), tombol **Hapus run** (tester+) dengan konfirmasi inline (bukan dialog).
- **`/p/:slug/flaky`**: daftar test flaky dengan bar skor + link riwayat.
- **`/p/:slug/tests/:testCaseId`**: riwayat 20 hasil (kotak berwarna + ikon/teks status), durasi.
- **Pengaturan → Token CI** (admin): form buat token, kotak "token baru" (sekali tampil, tombol salin, contoh curl terisi), daftar + cabut.
- Halaman dashboard di-lazy-load (`React.lazy` + `Suspense` dengan kerangka netral).
- Grafik punya alternatif teks (ringkasan + tabel `sr-only`); status tidak hanya warna.
- Semua halaman baca bisa diakses anonim untuk project publik. Semua komponen mengikuti batas CSP dan daftar komponen yang diizinkan dari spec UI (2026-10-26).

`data-testid` minimal: `dashboard-branch`, `stat-last-status`, `stat-pass-rate`, `stat-total`, `stat-flaky`, `trend-chart`, `recent-runs`, `run-item-<id>`, `top-flaky`, `flaky-item-<testCaseId>`, `setup-instructions`, `runs-list`, `runs-load-more`, `run-header`, `run-filter-failed|flaky|all`, `result-row-<testCaseId>`, `run-delete`, `run-delete-confirm`, `flaky-list`, `test-history`, `history-cell-<runId>`, `token-name`, `token-create`, `token-value`, `token-copy`, `token-row-<id>`, `token-revoke-<id>`.

## 9. Reporter CLI (`packages/reporter`)

- `testpulse-report --url <baseUrl> --project <slug> --branch <branch> [--commit <sha>] [--ci-url <url>] [--name <name>] <file|glob>...`
- Token dari env **`TESTPULSE_TOKEN`** (tidak ada flag token).
- Menggabungkan beberapa file JUnit menjadi satu dokumen `<testsuites>` (mengambil semua `<testsuite>` dari tiap file), menolak `<!DOCTYPE>` lebih dulu, memeriksa ukuran ≤ 5 MB sebelum upload.
- Keluaran sukses mencetak total dan URL run. Exit code: `0` berhasil, `1` upload gagal (HTTP/jaringan), `2` argumen/berkas salah.
- Tanpa dependency runtime selain Node ≥ 24 (`fetch` bawaan) dan parser XML yang sama dengan API bila diperlukan.

## 10. Dogfooding

- Di CI, Playwright juga menulis JUnit ke `allure-results/junit-e2e-<shard>.xml` (dan `junit-api.xml`); Vitest sudah menulis JUnit.
- `deploy.yml`, setelah smoke test lulus: unduh artifact `allure-results-*` dari run CI pemicu (`actions/download-artifact` dengan `run-id` + `github-token`, permission `actions: read`), lalu jalankan reporter ke `PRODUCTION_URL`, project `testpulse`, branch `main`, commit = SHA deploy, `ciUrl` = URL run CI.
- Secret baru **`TESTPULSE_TOKEN`** (dibuat admin dari Pengaturan → Token CI di production). Jika kosong: langkah dilewati dengan `::warning::`, deploy tetap hijau. Kegagalan upload juga tidak menggagalkan deploy (`continue-on-error`), tetapi tercatat sebagai warning.
- Smoke test production ditambah: halaman `/p/testpulse` menampilkan minimal satu run (dilewati dengan pesan bila belum ada run, misalnya sebelum dogfooding pertama).

## 11. Performa (k6)

- `tests/perf/` dengan k6 (image `grafana/k6`), dijalankan di job CI baru terhadap stack Docker (bukan production).
- Skenario `ingest`: upload laporan ±500 test berulang; skenario `read`: `stats`, `runs`, `flaky` pada project berisi ≥ 50 run.
- **Threshold (gate):** p95 upload < 1500 ms, p95 baca < 300 ms, `http_req_failed` < 1%.
- Stack test memakai `INGEST_RATE_LIMIT_MAX` tinggi; production memakai default 60/jam/token.

## 12. Testing

| Lapisan | Cakupan Tahap 2 |
|---|---|
| Unit | parser JUnit (status, identitas, kemunculan ganda, Surefire flaky, durasi, pemotongan, `<!DOCTYPE>` ditolak, XML rusak, bukan JUnit, kosong, > 20.000); `flakyScore` (semua contoh §6 + kasus tepi); reporter (argumen, glob, penggabungan, batas ukuran, exit code) |
| Integration (Postgres asli) | upload (token valid/dicabut/salah project/cookie ditolak, 400/413/422/429, total, reuse `test_cases`, upload paralel tanpa duplikat, retensi 200, `last_used_at`); API baca (pagination cursor, filter status, branch default); CRUD token & limit 10; hapus run per role + cascade; paritas SQL flaky vs `flakyScore` |
| API (Playwright `request`) | alur upload end-to-end lewat proxy; matriks §7.1 dibangkitkan dari data; token tidak berlaku di endpoint lain; schema respons memakai `@testpulse/shared` |
| Contract (Pact) | web (consumer) untuk semua endpoint baru; **reporter sebagai consumer kedua** untuk `POST runs` |
| E2E (Playwright, 3 browser) | buat token → upload via `TestApi` → dashboard (angka, tren, flaky) → detail run + filter → riwayat test → tester hapus run → viewer tidak melihat Token CI → anonim melihat dashboard project publik → panduan setup tanpa run; a11y dua tema; 375 px; gate CSP |
| Performa | k6 §11 sebagai gate CI |
| Security | ZAP baseline tetap; kasus XXE/`<!DOCTYPE>` di unit & integration |
| Smoke production | dashboard `/p/testpulse` menampilkan run (§10) |

## 13. Dokumentasi

- `docs/test-plans/tahap-2.md` (skenario per fitur + kriteria masuk/keluar).
- `docs/TEST_STRATEGY.md`: lapisan k6, risiko baru (XXE, kebocoran token, retensi, paritas flaky), snapshot jumlah test diperbarui (beserta `Quality.tsx`).
- `docs/adr/0004-ingest-sinkron-dan-definisi-flaky.md`.
- README: fitur Tahap 2, contoh curl/reporter, screenshot dashboard; roadmap Tahap 2 ✅; landing page: kartu fitur "Dashboard hasil test & deteksi flaky" menjadi "Tersedia".
- `docs/deploy.md`: langkah membuat `TESTPULSE_TOKEN`.

## 14. Tidak termasuk

Notifikasi (email/Slack), lampiran/screenshot test, perbandingan dua run, anotasi atau mute test flaky, format selain JUnit, publikasi reporter ke npm, GitHub Action siap pakai, ekspor data.

## 15. Definisi selesai

- [ ] Upload lewat curl dan reporter berfungsi sesuai §4–§5, dengan keamanan §4.
- [ ] Dashboard dan halaman §8 berfungsi di dua tema dan 375 px, publik anonim untuk project publik.
- [ ] Semua lapisan §12 hijau di CI, termasuk gate k6 dan gate CSP.
- [ ] Dogfooding aktif: `/p/testpulse` di production menampilkan run nyata dari CI TestPulse; smoke test hijau.
- [ ] Dokumentasi §13 diperbarui.
