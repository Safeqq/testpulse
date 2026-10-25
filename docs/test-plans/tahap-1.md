# Test Plan Tahap 1: Akun, Project & Tim

Rencana pengujian untuk lingkup tahap 1 (lihat [spec](../superpowers/specs/2026-10-23-testpulse-tahap1-design.md), bagian 4 dan 5). Strategi umum dan alasan tiap lapisan ada di [TEST_STRATEGY.md](../TEST_STRATEGY.md). Setiap skenario di bawah merujuk berkas test yang mengotomatiskannya.

Singkatan lapisan: **U** unit, **I** integration, **A** API (Playwright request), **C** contract (Pact), **E** E2E, **S** smoke production.

## 1. Lingkup

**Diuji:** daftar/masuk/keluar/profil, project (buat, daftar, ubah, hapus, visibilitas), anggota dan role (termasuk aturan admin terakhir), undangan lewat link, keamanan terkait (sesi, CSRF, rate limit, kebocoran informasi), aksesibilitas halaman utama, dan deploy production.

**Tidak diuji (sengaja):** lihat [TEST_STRATEGY.md bagian 6](../TEST_STRATEGY.md#6-sengaja-tidak-diuji-dan-alasannya).

## 2. Kriteria masuk

- Kode ter-merge ke branch kerja dan `pnpm install` berhasil.
- Docker tersedia (Testcontainers dan Docker Compose).
- Migrasi database berjalan tanpa error.
- Untuk smoke production: API, web, dan database sudah ter-deploy, akun smoke dan project publik sudah didaftarkan ([deploy.md](../deploy.md)).

## 3. Kriteria keluar

- Lint, typecheck, dan `pnpm audit --audit-level high` bersih.
- Semua test unit, integration, contract, API, dan E2E (3 browser) lulus di CI. Test yang lulus hanya setelah retry dicatat sebagai flaky dan diselidiki, bukan diabaikan.
- Coverage `src/modules/**/domain` >= 80%.
- ZAP baseline: 0 temuan High.
- Laporan Allure terpublikasi.
- Smoke production lulus setelah deploy.
- Tidak ada cacat severity tinggi yang terbuka untuk fitur tahap 1.

## 4. Skenario per fitur

### 4.1 Autentikasi

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| AUTH-01 | Daftar dengan data valid | 201, user tanpa password, cookie sesi `HttpOnly`/`SameSite=Lax` | I, A, E | [auth.int.test.ts](../../apps/api/test/integration/auth.int.test.ts), [auth.spec.ts](../../tests/api/auth.spec.ts), [auth.spec.ts (E2E)](../../tests/e2e/auth.spec.ts) |
| AUTH-02 | Email didaftarkan dua kali (beda huruf besar/kecil) | 409 `EMAIL_TAKEN`; email disimpan lowercase dan di-trim | I, A | auth.int.test.ts, auth.spec.ts |
| AUTH-03 | Boundary nama (1, 80, 81 karakter, spasi di tepi) dan password (7, 8, 128, 129 karakter) | Sisi valid 201; sisi tidak valid 400 dengan `fields` yang tepat | U, A | [schemas.test.ts](../../packages/shared/src/schemas/schemas.test.ts), auth.spec.ts |
| AUTH-04 | Email tidak valid atau body kosong | 400 `VALIDATION_ERROR` | I, A | auth.int.test.ts, auth.spec.ts |
| AUTH-05 | Login dengan email berhuruf besar dan spasi | 200 dan sesi yang dapat dipakai untuk `/me` | I, A, E | auth.int.test.ts, auth.spec.ts, auth.spec.ts (E2E) |
| AUTH-06 | Password salah vs email tidak terdaftar | 401 `INVALID_CREDENTIALS` dengan pesan identik | I, A, E | auth.int.test.ts, auth.spec.ts, auth.spec.ts (E2E) |
| AUTH-07 | `/me` tanpa cookie, dengan token tidak dikenal, dan dengan sesi kedaluwarsa | 401 `UNAUTHENTICATED`; sesi kedaluwarsa dibersihkan dari DB | I, A | auth.int.test.ts, auth.spec.ts |
| AUTH-08 | DB hanya menyimpan hash token sesi | Token mentah tidak ada di tabel `sessions` | I, U | auth.int.test.ts, [tokens.test.ts](../../apps/api/src/modules/auth/domain/tokens.test.ts) |
| AUTH-09 | Logout | 204, cookie dihapus, sesi lama ditolak; sesi lain milik user yang sama tetap berlaku | I, A, E | auth.int.test.ts, auth.spec.ts, auth.spec.ts (E2E) |
| AUTH-10 | Hashing password | Salt acak per user, verifikasi benar/salah, input rusak tidak melempar | U | [passwords.test.ts](../../apps/api/src/modules/auth/domain/passwords.test.ts) |
| AUTH-11 | Form: password 7 karakter ditolak di klien; email terdaftar dipetakan ke error umum; `next` valid diikuti dan `next` ke luar situs diabaikan | Perilaku UI sesuai, tanpa request yang tidak perlu | E | auth.spec.ts (E2E) |
| AUTH-12 | Halaman `/login` dan `/register` | 0 pelanggaran axe serious/critical | E | auth.spec.ts (E2E) |

### 4.2 Project dan visibilitas

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| PRJ-01 | Buat project dengan nama saja | 201, slug otomatis, privat, pembuat menjadi admin | I, A, E | [projects.int.test.ts](../../apps/api/test/integration/projects.int.test.ts), [projects.spec.ts](../../tests/api/projects.spec.ts), [projects.spec.ts (E2E)](../../tests/e2e/projects.spec.ts) |
| PRJ-02 | Slug: boundary 3 dan 40, pola salah, kata cadangan, slug otomatis tidak valid ("测试", "!!", "ab") | Valid 201; tidak valid 400 `fields.slug` | U, I, A | [slug.test.ts](../../packages/shared/src/slug.test.ts), projects.int.test.ts, projects.spec.ts |
| PRJ-03 | Boundary nama project (1, 80, 81, kosong, spasi saja) | Sesuai aturan, trim dulu | U, A | schemas.test.ts, projects.spec.ts |
| PRJ-04 | Slug sudah dipakai, termasuk pembuatan serentak dengan slug sama | 409 `SLUG_TAKEN`; tepat satu 201, tanpa 500 | I, A, E | projects.int.test.ts, projects.spec.ts, projects.spec.ts (E2E) |
| PRJ-05 | Daftar "project saya" | Hanya project tempat user menjadi anggota; project publik milik orang lain tidak muncul; 401 untuk anonim | I, A, E | projects.int.test.ts, projects.spec.ts, projects.spec.ts (E2E) |
| PRJ-06 | Baca project: anggota, bukan anggota privat, bukan anggota publik, anonim privat, anonim publik, slug tidak ada | 200 + `myRole`; 404 `PROJECT_NOT_FOUND` untuk privat dan tidak ada (badan respons identik); publik dapat dibaca dengan `myRole: null` | I, A, C, E | projects.int.test.ts, [authorization.spec.ts](../../tests/api/authorization.spec.ts), [projects.pact.test.ts](../../apps/web/test/contract/projects.pact.test.ts), projects.spec.ts (E2E) |
| PRJ-07 | Ubah nama dan visibilitas (admin); slug tidak bisa diubah | 200; non-admin 403 (anggota atau bukan anggota publik), 404 (bukan anggota privat), 401 (anonim) | U, I, A | [permissions.test.ts](../../apps/api/src/modules/projects/domain/permissions.test.ts), projects.int.test.ts, projects.spec.ts |
| PRJ-08 | Project publik dijadikan privat lagi | Pengunjung anonim mendapat "tidak ditemukan" | A, E | projects.spec.ts, [team.spec.ts (E2E)](../../tests/e2e/team.spec.ts) |
| PRJ-09 | Hapus project dengan `confirmSlug` salah/benar/hilang | 400 `CONFIRMATION_MISMATCH`/204 dan data terkait (anggota, undangan) ikut terhapus/400 `VALIDATION_ERROR` | I, A, E | projects.int.test.ts, projects.spec.ts, team.spec.ts (E2E) |
| PRJ-10 | UI project publik | Anonim melihat ringkasan dengan penanda "hanya-baca", tanpa tautan pengaturan; project privat dan yang tidak ada tampil sama | E | projects.spec.ts (E2E) |
| PRJ-11 | Rute terlindungi | `/` dan `/projects/new` mengarahkan anonim ke login | E | projects.spec.ts (E2E) |
| PRJ-12 | Halaman daftar, buat, dan ringkasan | 0 pelanggaran axe serious/critical | E | projects.spec.ts (E2E) |
| PRJ-15 | Halaman pengaturan project (admin) dan pratinjau undangan | 0 pelanggaran axe serious/critical | E | team.spec.ts (E2E) |
| PRJ-13 | Matriks otorisasi project (6 aktor x semua endpoint) | Status dan kode error sesuai tabel spec bagian 7; urutan pengecekan: anonim selalu 401 di endpoint wajib login | A | [authorization-matrix.ts](../../tests/api/authorization-matrix.ts), authorization.spec.ts |
| PRJ-14 | Keputusan akses (aksi x role x visibilitas) | Sesuai urutan hak admin > tester > viewer; anggota di project publik memakai izin rolenya | U | permissions.test.ts |

### 4.3 Anggota, role, dan admin terakhir

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| MEM-01 | Lihat anggota | Viewer ke atas 200 sesuai schema; bukan anggota publik 403; bukan anggota privat 404; anonim 401 | I, A, C | [members.int.test.ts](../../apps/api/test/integration/members.int.test.ts), authorization.spec.ts, [members.pact.test.ts](../../apps/web/test/contract/members.pact.test.ts) |
| MEM-02 | Ubah role | Admin 200; tester/viewer 403; userId bukan anggota/tidak dikenal/bukan UUID 404 `MEMBER_NOT_FOUND`; role tidak valid 400 | I, A, E | members.int.test.ts, projects.spec.ts, team.spec.ts (E2E) |
| MEM-03 | Akses dicek sebelum body divalidasi | Bukan anggota tidak mendapat 400 meski body salah (tidak membocorkan keberadaan) | I | members.int.test.ts |
| MEM-04 | Admin terakhir diturunkan role | 409 `LAST_ADMIN`; setelah ada admin lain boleh | U, I, A, C, E | [admins.test.ts](../../apps/api/src/modules/projects/domain/admins.test.ts), members.int.test.ts, projects.spec.ts, members.pact.test.ts, team.spec.ts (E2E) |
| MEM-05 | Admin terakhir keluar sendiri atau dikeluarkan | 409 `LAST_ADMIN`; jika masih ada admin lain boleh keluar, dan admin yang tersisa lalu terlindungi | I, A, E | members.int.test.ts, projects.spec.ts, team.spec.ts (E2E) |
| MEM-06 | **Race:** dua admin saling menurunkan/mengeluarkan secara bersamaan | Tepat satu sukses dan satu 409 `LAST_ADMIN`; selalu tersisa satu admin. Test "paralel terkunci" memastikan kedua request lolos pengecekan akses lebih dulu dan baru diserialkan oleh `SELECT ... FOR UPDATE` | I | members.int.test.ts |
| MEM-07 | Keluar sendiri (viewer, tester) | 204 dan akses hilang; bukan anggota publik 404 `MEMBER_NOT_FOUND`, privat 404 `PROJECT_NOT_FOUND` | I, A, E | members.int.test.ts, projects.spec.ts, team.spec.ts (E2E) |
| MEM-08 | Admin mengeluarkan anggota lain | 204; mengeluarkan lagi 404 `MEMBER_NOT_FOUND`; tester 403 | I, A | members.int.test.ts, projects.spec.ts |
| MEM-09 | Bagian admin di UI | Tersembunyi untuk non-admin; bukan anggota melihat penjelasan tanpa kontrol | E | team.spec.ts (E2E) |

### 4.4 Undangan

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| INV-01 | Admin membuat undangan `tester`/`viewer` | 201, berlaku 7 hari, token tidak tersimpan mentah; role `admin` atau tidak dikenal 400 | U, I, A, C, E | [invitations.test.ts](../../apps/api/src/modules/invitations/domain/invitations.test.ts), [invitations.int.test.ts](../../apps/api/test/integration/invitations.int.test.ts), [invitations.spec.ts](../../tests/api/invitations.spec.ts), [invitations.pact.test.ts](../../apps/web/test/contract/invitations.pact.test.ts), team.spec.ts (E2E) |
| INV-02 | Non-admin mengakses undangan | 403 (anggota dan bukan anggota publik), 404 (bukan anggota privat), 401 (anonim) | I, A | invitations.int.test.ts, authorization.spec.ts |
| INV-03 | Daftar undangan | Hanya yang aktif; dicabut, terpakai, kedaluwarsa tidak ikut; token tidak bocor | I, A | invitations.int.test.ts, invitations.spec.ts |
| INV-04 | Pratinjau publik | 200 tanpa login berisi nama project, role, kedaluwarsa; pratinjau tidak memakai undangan; token tak dikenal 404 | I, A, C, E | invitations.int.test.ts, invitations.spec.ts, invitations.pact.test.ts, team.spec.ts (E2E) |
| INV-05 | Terima undangan | 200, menjadi anggota dengan role undangan, undangan terpakai | I, A, E | invitations.int.test.ts, invitations.spec.ts, team.spec.ts (E2E) |
| INV-06 | Undangan terpakai atau kedaluwarsa | 410 `INVITATION_USED` / `INVITATION_EXPIRED`; user tidak menjadi anggota; pesan server tampil di UI | U, I, C, E | invitations.test.ts, invitations.int.test.ts, invitations.pact.test.ts, team.spec.ts (E2E) |
| INV-07 | Sudah menjadi anggota menerima undangan | 409 `ALREADY_MEMBER`, undangan tidak terpakai, role lama utuh | I, A | invitations.int.test.ts, invitations.spec.ts |
| INV-08 | Terima tanpa login | 401, undangan tidak terpakai; di UI anonim diarahkan masuk lalu kembali untuk menerima | I, A, E | invitations.int.test.ts, invitations.spec.ts, team.spec.ts (E2E) |
| INV-09 | Cabut undangan | 204; setelah itu pratinjau dan accept 404; mencabut dua kali, ID rusak, atau undangan project lain 404 `INVITATION_NOT_FOUND` | I, A, E | invitations.int.test.ts, invitations.spec.ts, team.spec.ts (E2E) |
| INV-10 | **Race:** dua user menerima undangan yang sama; cabut dan terima bersamaan | Tepat satu 200 dan satu 410; cabut vs terima konsisten | I | invitations.int.test.ts |
| INV-11 | Salin link undangan | Menulis ke clipboard dan memberi tahu berhasil/gagal sesuai hasil di semua browser | E | team.spec.ts (E2E) |

### 4.5 Keamanan dan platform

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| SEC-01 | Rate limit login dan register | 10 percobaan pertama diproses, ke-11 429 `RATE_LIMITED`; hitungan login dan register terpisah | I | [security.int.test.ts](../../apps/api/test/integration/security.int.test.ts) |
| SEC-02 | `X-Forwarded-For` palsu | Hanya dipercaya jika `x-proxy-secret` cocok; tanpa `PROXY_SECRET` diabaikan; bucket pemanggil langsung dan lewat proxy terpisah | U, I | [client-ip.test.ts](../../apps/api/src/http/client-ip.test.ts), security.int.test.ts |
| SEC-03 | CSRF | `Origin` asing pada metode yang mengubah data 403; `Origin` sama atau tanpa `Origin` diproses; `text/plain` dan form-urlencoded dengan body 400 | I, A | security.int.test.ts, auth.spec.ts |
| SEC-04 | Header keamanan API | Helmet aktif pada respons | I, A | security.int.test.ts, auth.spec.ts |
| SEC-05 | Log tidak membocorkan rahasia | Token undangan pada URL dan nilai `x-proxy-secret` tidak masuk log | U, I | [logging.test.ts](../../apps/api/src/http/logging.test.ts), [logging.int.test.ts](../../apps/api/test/integration/logging.int.test.ts) |
| SEC-06 | Bentuk error standar | Kode dan pesan sesuai; error tak terduga 500 tanpa detail internal; rute tak dikenal 404 | U, I | [errors.test.ts](../../apps/api/src/http/errors.test.ts), [health.int.test.ts](../../apps/api/test/integration/health.int.test.ts) |
| SEC-07 | Paritas header nginx dan Cloudflare Pages | Empat header sama dengan nilai sama persis | U | [headers.test.ts](../../apps/web/test/functions/headers.test.ts) |
| SEC-08 | Pages Function proxy | Meneruskan method/path/body/cookie; POST dan DELETE tanpa body diteruskan dengan body null; `X-Forwarded-For` klien ditimpa; secret klien diganti; header `cf-*` tidak diteruskan; upstream gagal ditangani | U | [proxy.test.ts](../../apps/web/test/functions/proxy.test.ts) |
| SEC-09 | ZAP baseline | 0 temuan High; logika gate sendiri diuji | CI | [check-zap-report.mjs](../../tests/security/check-zap-report.mjs), [check-zap-report.test.mjs](../../tests/security/check-zap-report.test.mjs), [ci.yml](../../.github/workflows/ci.yml) |
| SEC-10 | Kesehatan layanan | `/api/health` 200 saat DB terjangkau, 503 saat tidak; migrasi membuat semua tabel | I, A, S | health.int.test.ts, auth.spec.ts, [smoke.spec.ts](../../tests/smoke/smoke.spec.ts) |
| SEC-11 | Konfigurasi | Default env, validasi `DATABASE_URL`/`APP_ORIGIN`/`PORT`, `PROXY_SECRET` opsional | U | [config.test.ts](../../apps/api/src/config.test.ts) |

### 4.6 Kontrak dan smoke production

| ID | Skenario | Hasil yang diharapkan | Lapisan | Test |
|---|---|---|---|---|
| CON-01 | Web (consumer) mendefinisikan interaksi untuk auth, projects, members, invitations, termasuk jalur error utama | Pact tertulis | C | [auth.pact.test.ts](../../apps/web/test/contract/auth.pact.test.ts), projects.pact.test.ts, members.pact.test.ts, invitations.pact.test.ts |
| CON-02 | API (provider) memverifikasi pact dengan state yang disiapkan di DB asli | Semua interaksi terpenuhi | C | [provider.pact.test.ts](../../apps/api/test/contract/provider.pact.test.ts), [states.ts](../../apps/api/test/contract/states.ts) |
| SMK-01 | Setelah deploy: health, halaman masuk, login akun smoke, project publik terbuka tanpa login | Semua hijau; hanya membaca | S | smoke.spec.ts |

## 5. Cara menjalankan

Perintah lengkap per lapisan ada di [README](../../README.md#menjalankan-test-per-lapisan). Pipeline otomatis ada di [`ci.yml`](../../.github/workflows/ci.yml); hasil terbaru dilaporkan di <https://safeqq.github.io/testpulse/>.

## 6. Risiko pengujian dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Test E2E flaky karena 3 browser dan paralelisme | Data independen per test, `retries: 2` di CI dengan penandaan flaky, trace disimpan saat gagal, worker dibatasi |
| Rate limit mengganggu suite paralel | Stack test memakai `RATE_LIMIT_MAX=1000`; perilaku 429 dibuktikan terpisah di integration test |
| Perbedaan perilaku Cloudflare vs nginx | Logika proxy dan paritas header diuji sebagai unit; smoke test production sebagai jaring terakhir |
| Cold start Render membuat smoke test lambat atau gagal | Deploy menunggu health production sebelum smoke test dijalankan |
