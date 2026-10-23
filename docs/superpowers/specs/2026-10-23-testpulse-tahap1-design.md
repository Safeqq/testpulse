# TestPulse — Spec Tahap 1: Fondasi (Akun, Project & Tim)

- **Tanggal:** 2026-10-23
- **Status:** Draft, menunggu review
- **Bahasa kode:** TypeScript (seluruh stack)

## 1. Konteks & tujuan

Pemilik proyek adalah fresh graduate yang menargetkan posisi QA/SDET. Proyek ini punya **dua tujuan sekaligus**:

1. **Produk yang berguna:** TestPulse adalah aplikasi web untuk tim QA/dev, yaitu satu tempat untuk memantau kesehatan testing: hasil automated test dari CI, deteksi test flaky, bug report, dan test case manual. Kategori produk sejenis: TestRail, Qase, ReportPortal, Allure TestOps.
2. **Portfolio QA:** TestPulse sendiri diuji dengan test pyramid lengkap yang berjalan otomatis di CI. Mulai tahap 2, **hasil test TestPulse dilaporkan ke TestPulse itu sendiri** (dogfooding), sehingga recruiter bisa melihat dashboard kualitas yang nyata lewat link live.

**Kriteria sukses keseluruhan:** aplikasi online dan bisa dicoba lewat link, setiap fitur dilindungi test otomatis yang relevan, dan pipeline CI/CD dengan quality gate dapat ditunjukkan di repo publik.

## 2. Roadmap produk

| Tahap | Isi | Spec |
|---|---|---|
| **1** | **Fondasi: akun, project, tim & role, undangan + seluruh pipeline QA** | **dokumen ini** |
| 2 | Dashboard hasil test, deteksi flaky, reporter CLI, project token, k6 | terpisah |
| 3 | Bug tracker (bug dari test yang gagal), visual regression | terpisah |
| 4 | Test case management & test run manual, mutation testing | terpisah |
| 5 (opsional) | Aplikasi desktop Electron (notifikasi build gagal, tray), diuji Playwright | terpisah |

Setiap tahap melewati siklus spec → rencana implementasi → implementasi sendiri.

## 3. Arsitektur

**Modular monolith + SPA + (tahap 2) reporter CLI.**

```
apps/api           Fastify + TypeScript + PostgreSQL (Drizzle ORM + migrasi)
  src/modules/       auth/, projects/  (tahap berikut: results/, bugs/, testcases/)
  src/plugins/       db, session, error handler, security (helmet, rate limit)
apps/web           React + Vite SPA (React Router)
  functions/api/     Cloudflare Pages Function: proxy /api/* → API di Render
packages/shared    Schema Zod + tipe bersama (request/response, enum role, kode error)
tests/
  api/               Playwright request: alur auth + matriks otorisasi
  e2e/               Playwright: pages/ (POM), fixtures/, specs/
  contract/          Pact: web (consumer) ↔ api (provider)
docs/              TEST_STRATEGY.md, test-plans/, adr/
```

Batas modul: modul hanya saling memanggil lewat fungsi service yang diekspor (`projects` memanggil `auth` lewat `getSessionUser`), tidak lewat tabel modul lain secara langsung.

**Hosting (gratis):**

| Bagian | Layanan | Catatan |
|---|---|---|
| API | Render (Docker, free web service) | Cold start ±30–60 detik setelah idle; ditulis jujur di README |
| Web | Cloudflare Pages | Pages Function meneruskan `/api/*` ke Render, sehingga browser melihat satu origin |
| Database | Neon Postgres (free) | Migrasi dijalankan otomatis saat API start |

Lokal: `docker compose up` menjalankan Postgres + API + web (nginx dengan proxy `/api` yang setara).

**Persiapan desktop (tahap 5):** base URL API di web dapat dikonfigurasi (`VITE_API_BASE_URL`, default `/api`). Lookup sesi di API ditulis sebagai satu fungsi yang nanti juga menerima header `Authorization: Bearer` (token ditambahkan di tahap 2).

## 4. Lingkup tahap 1

### Termasuk
- Daftar, masuk, keluar; melihat profil sendiri (`/me`).
- Membuat project, daftar project saya, ganti nama, hapus (admin, dengan konfirmasi slug).
- Anggota & role: lihat anggota, ubah role, keluarkan anggota, keluar dari project.
- Undangan lewat link: buat, lihat yang aktif, cabut, pratinjau, terima.
- Seluruh lapisan testing & CI/CD di §9 dan §10, termasuk deploy production + smoke test.

### Tidak termasuk (sengaja)
- Reset password & verifikasi email (butuh layanan email).
- Login sosial/OAuth, 2FA.
- Pagination (daftar tahap 1 kecil; ditambahkan di tahap 2).
- Mengganti slug project (slug tetap agar URL stabil).
- Mengubah email/password akun.

## 5. Aturan domain

### Role

| Role | Arti |
|---|---|
| `admin` | Kelola project, anggota & undangan, plus semua hak `tester` |
| `tester` | Membuat/mengubah data kerja (bug, test case, run) mulai tahap 2–4, plus semua hak `viewer` |
| `viewer` | Hanya melihat |

Urutan hak: `admin > tester > viewer`. Pembuat project otomatis menjadi `admin`.

### Aturan
1. **Minimal satu admin.** Operasi yang membuat project tanpa admin ditolak dengan `409 LAST_ADMIN`: menurunkan role admin terakhir, mengeluarkan admin terakhir, atau admin terakhir keluar sendiri. Admin terakhir yang ingin pergi harus menghapus project atau mengangkat admin lain lebih dulu.
2. **Slug project:** 3–40 karakter, `a-z`, `0-9`, dan `-`, tidak diawali/diakhiri `-`, tanpa `--`. Jika tidak diisi, dibuat otomatis dari nama (huruf kecil, karakter lain jadi `-`, dipotong 40). Kata cadangan ditolak: `api`, `new`, `settings`, `invite`, `login`, `register`. Slug unik secara global (`409 SLUG_TAKEN`).
3. **Nama project:** 1–80 karakter setelah di-trim.
4. **Undangan:**
   - Role yang diberikan `tester` atau `viewer` (admin diangkat lewat ubah role setelah bergabung).
   - Berlaku 7 hari dan sekali pakai.
   - Token acak 32 byte ditampilkan sekali saat dibuat; yang disimpan hanya hash SHA-256.
   - Status: aktif, terpakai (`410 INVITATION_USED`), kedaluwarsa (`410 INVITATION_EXPIRED`), dicabut (`404`).
   - Menerima saat sudah menjadi anggota menghasilkan `409 ALREADY_MEMBER`, dan undangan tidak terpakai.
5. **Akun:** email unik tanpa peka huruf besar/kecil (disimpan lowercase, di-trim). Nama 1–80 karakter. Password 8–128 karakter.
6. **Hapus project:** wajib mengirim `confirmSlug` yang sama dengan slug (`400 CONFIRMATION_MISMATCH`). Menghapus project juga menghapus membership dan undangan.

## 6. Model data

```
users        id uuid PK, email text UNIQUE (lowercase), name text, password_hash text, created_at timestamptz
sessions     id text PK (SHA-256 dari token), user_id uuid FK→users ON DELETE CASCADE,
             expires_at timestamptz, created_at timestamptz
projects     id uuid PK, name text, slug text UNIQUE, created_by uuid FK→users, created_at timestamptz
memberships  project_id uuid FK→projects ON DELETE CASCADE, user_id uuid FK→users ON DELETE CASCADE,
             role text CHECK IN ('admin','tester','viewer'), created_at timestamptz,
             PK (project_id, user_id)
invitations  id uuid PK, project_id uuid FK→projects ON DELETE CASCADE, token_hash text UNIQUE,
             role text CHECK IN ('tester','viewer'), created_by uuid FK→users,
             expires_at timestamptz, accepted_at timestamptz NULL, accepted_by uuid NULL FK→users,
             revoked_at timestamptz NULL, created_at timestamptz
```

Operasi yang menyangkut aturan "minimal satu admin" dijalankan dalam transaksi dengan `SELECT ... FOR UPDATE` pada membership admin project tersebut, agar dua request paralel tidak bisa sama-sama lolos.

## 7. API (`/api/v1`)

Semua request & response berformat JSON. Error berbentuk:

```json
{ "error": { "code": "PROJECT_NOT_FOUND", "message": "Project tidak ditemukan", "fields": { "slug": "..." } } }
```

`fields` hanya ada pada `VALIDATION_ERROR`. `GET /api/health` (di luar `/v1`) mengembalikan `200 {status:"ok"}` jika database terjangkau, atau `503` jika tidak.

| Method & path | Akses | Sukses | Error khusus |
|---|---|---|---|
| `POST /auth/register` `{name,email,password}` | publik | `201` user + cookie | `409 EMAIL_TAKEN` |
| `POST /auth/login` `{email,password}` | publik | `200` user + cookie | `401 INVALID_CREDENTIALS` |
| `POST /auth/logout` | login | `204` | – |
| `GET /auth/me` | login | `200` user | `401 UNAUTHENTICATED` |
| `GET /projects` | login | `200` daftar project + role saya | – |
| `POST /projects` `{name, slug?}` | login | `201` project (saya admin) | `409 SLUG_TAKEN` |
| `GET /projects/:slug` | viewer+ | `200` project + role saya | `404` |
| `PATCH /projects/:slug` `{name}` | admin | `200` | – |
| `DELETE /projects/:slug` `{confirmSlug}` | admin | `204` | `400 CONFIRMATION_MISMATCH` |
| `GET /projects/:slug/members` | viewer+ | `200` | – |
| `PATCH /projects/:slug/members/:userId` `{role}` | admin | `200` | `409 LAST_ADMIN`, `404 MEMBER_NOT_FOUND` |
| `DELETE /projects/:slug/members/:userId` | admin, atau diri sendiri | `204` | `409 LAST_ADMIN` |
| `GET /projects/:slug/invitations` | admin | `200` undangan aktif | – |
| `POST /projects/:slug/invitations` `{role}` | admin | `201` `{id, url, role, expiresAt}` | – |
| `DELETE /projects/:slug/invitations/:id` | admin | `204` | `404` |
| `GET /invitations/:token` | publik | `200` `{projectName, role, expiresAt}` | `404`, `410` |
| `POST /invitations/:token/accept` | login | `200` membership | `404`, `410`, `409 ALREADY_MEMBER` |

**Kode error umum:** `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `PROJECT_NOT_FOUND` (404, juga untuk bukan anggota), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500).

### Matriks otorisasi (dasar API test otomatis)

| Endpoint (project) | anonim | bukan anggota | viewer | tester | admin |
|---|---|---|---|---|---|
| GET project / members | 401 | 404 | 200 | 200 | 200 |
| PATCH / DELETE project | 401 | 404 | 403 | 403 | 2xx |
| PATCH member role | 401 | 404 | 403 | 403 | 200 |
| DELETE member (orang lain) | 401 | 404 | 403 | 403 | 204 |
| DELETE member (diri sendiri) | 401 | 404 | 204 | 204 | 204 / 409 jika admin terakhir |
| GET / POST / DELETE invitations | 401 | 404 | 403 | 403 | 2xx |

## 8. Keamanan

- **Sesi:**
  - Token acak 32 byte di cookie `tp_session` dengan atribut `HttpOnly`, `SameSite=Lax`, `Path=/`, dan `Secure` di production. Masa berlaku 14 hari.
  - Di DB hanya disimpan hash SHA-256 dari token.
  - Logout menghapus baris sesi. Sesi yang kedaluwarsa ditolak dan dibersihkan saat lookup.
- **Password:** scrypt (`node:crypto`) dengan salt acak per user, dibandingkan dengan `timingSafeEqual`.
- **Login:**
  - Pesan gagal identik untuk email tak terdaftar dan password salah.
  - Saat email tidak ditemukan, server tetap menjalankan scrypt terhadap hash dummy agar waktu respons setara.
- **Rate limit:** `POST /auth/login` dan `/auth/register` maksimal 10 per menit per IP → `429 RATE_LIMITED`.
- **CSRF:**
  - Utamanya dicegah oleh `SameSite=Lax`.
  - Setiap request yang mengubah data wajib `Content-Type: application/json`.
  - Header `Origin` (jika ada) harus termasuk `APP_ORIGIN`; jika tidak → `403 FORBIDDEN`.
- **Header keamanan:** `@fastify/helmet` di API; `_headers` Cloudflare untuk web (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`).
- **Logging:** pino terstruktur. Header `cookie`, `authorization`, serta field `password` dan `token` disensor (redact).
- **Konfigurasi (env):** `DATABASE_URL`, `APP_ORIGIN`, `COOKIE_SECURE`, `PORT`. Tidak ada secret di repo; `.env.example` berisi nilai lokal.

## 9. Strategi testing tahap 1

| Lapisan | Tool | Cakupan tahap 1 |
|---|---|---|
| Unit | Vitest | Aturan role/izin, aturan admin terakhir, validasi & pembuatan slug, kedaluwarsa undangan, hashing password & token. Coverage ≥ 80% untuk `src/modules/**/domain` |
| Integration | Vitest + Testcontainers (Postgres asli) | Repository & migrasi; rute API lewat `fastify.inject` dengan DB asli, termasuk uji paralel aturan admin terakhir |
| API | Playwright `request` + schema dari `packages/shared` | Alur auth, validasi negatif & boundary, **matriks otorisasi §7 dibangkitkan dari tabel data** |
| Contract | Pact JS | Web (consumer) ↔ API (provider) untuk semua endpoint tahap 1 |
| E2E | Playwright (POM, custom fixtures, Chromium/Firefox/WebKit) | Daftar → buat project → buat undangan → user kedua (context terpisah) menerima → viewer tidak melihat tombol admin → admin terakhir tidak bisa keluar. Data awal dibuat lewat API |
| Accessibility | `@axe-core/playwright` | Setiap halaman: 0 pelanggaran `serious`/`critical` |
| Security | OWASP ZAP baseline, `pnpm audit`, Dependabot | 0 temuan high; ZAP dijalankan ke stack lokal di CI |
| Smoke production | Playwright tag `@smoke` | Health, halaman masuk tampil, login akun smoke berhasil |

Ditunda: k6 (tahap 2), visual regression (tahap 3), mutation testing (tahap 4).

Test data dibuat lewat factory (`@faker-js/faker`) dengan email unik per test, sehingga test bisa berjalan paralel tanpa saling bergantung.

## 10. CI/CD (GitHub Actions)

**`ci.yml` (setiap PR & push):**
1. install → lint (ESLint) + typecheck
2. unit + coverage gate
3. integration (Testcontainers)
4. contract (consumer → pact file → verifikasi provider)
5. build image → `docker compose up` → tunggu health
6. API test → E2E (sharding 3 job) → axe
7. ZAP baseline
8. gabung hasil ke laporan Allure → publish ke GitHub Pages (hanya di `main`)

**`deploy.yml` (push ke `main` setelah `ci.yml` hijau):** trigger deploy hook Render → tunggu health production → deploy web ke Cloudflare Pages → smoke test `@smoke` ke URL production.

Smoke test production memakai satu akun khusus yang didaftarkan sekali secara manual di production. Email & password-nya disimpan sebagai GitHub Secrets (`SMOKE_EMAIL`, `SMOKE_PASSWORD`). Smoke test hanya membaca; tidak membuat atau menghapus data production.

Penanganan flaky: `retries: 2` di CI; test yang lulus setelah retry ditandai flaky di laporan.

## 11. Halaman web tahap 1

| Path | Isi |
|---|---|
| `/register`, `/login` | Form dengan validasi schema bersama; error per field dan error umum (`role="alert"`) |
| `/` | Daftar project saya + tombol buat project; tampilan kosong untuk user baru |
| `/projects/new` | Form nama + slug (pratinjau slug otomatis) |
| `/p/:slug` | Ringkasan project; sementara berisi tampilan kosong "Belum ada hasil test" + petunjuk tahap 2 |
| `/p/:slug/settings` | Ganti nama, anggota (ubah role/keluarkan), undangan (buat/salin link/cabut), zona bahaya (hapus project) — bagian admin disembunyikan untuk non-admin |
| `/invite/:token` | Pratinjau undangan → terima (arahkan ke login/daftar dulu jika belum masuk, lalu kembali) |

Elemen yang dipakai test diberi `data-testid`. Semua form punya label yang terhubung dan bisa dioperasikan dengan keyboard.

## 12. Dokumen pendukung

- `docs/TEST_STRATEGY.md`: lapisan test, risiko yang dicakup, apa yang sengaja tidak diuji.
- `docs/test-plans/tahap-1.md`: daftar skenario utama per fitur, kriteria masuk/keluar.
- `docs/adr/0001-modular-monolith.md`, `docs/adr/0002-cookie-session.md`.
- README: deskripsi produk, link live, link laporan Allure, badge CI, arsitektur, cara menjalankan.

## 13. Transisi repo

Kode toko ShopQA dihapus dalam commit tersendiri (riwayatnya tetap ada di git). Konfigurasi monorepo, TypeScript, dan Docker dipertahankan dan disesuaikan. Penggantian nama folder/repo menjadi `testpulse` dilakukan sebelum push pertama ke GitHub.

## 14. Definisi selesai tahap 1

- [ ] Semua endpoint & halaman di §7 dan §11 berfungsi sesuai aturan §5.
- [ ] Semua lapisan di §9 berjalan hijau di CI, termasuk coverage gate & ZAP.
- [ ] Aplikasi live di URL publik; smoke test production hijau setelah deploy.
- [ ] Laporan Allure terpublikasi di GitHub Pages.
- [ ] Dokumen §12 tersedia.
