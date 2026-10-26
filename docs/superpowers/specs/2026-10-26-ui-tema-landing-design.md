# TestPulse — Spec: UI baru (Tailwind + shadcn/ui), tema gelap/terang, dan landing page

- **Tanggal:** 2026-10-26
- **Status:** Draft, menunggu review
- **Ruang lingkup:** hanya `apps/web` dan test-nya (`tests/`), plus dokumentasi. API, database, deploy, dan header keamanan tidak berubah.
- **Prasyarat:** Tahap 1 selesai dan live (https://testpulse-d2p.pages.dev).

## 1. Konteks & tujuan

Tahap 1 sengaja memakai tampilan fungsional yang polos. Untuk portfolio, kesan pertama penting, sehingga tahap kecil ini dikerjakan sebelum Tahap 2. Tujuannya:

1. **Tampilan modern** dengan dua tema: **gelap** terinspirasi gaya dashboard Neon (hampir hitam, aksen hijau mint) dan **terang** terinspirasi gaya dashboard Cloudflare (putih/abu muda, aksen oranye dan biru). Ini inspirasi gaya, bukan penyalinan logo, nama, atau aset merek mereka.
2. **Landing page** untuk pengunjung yang belum login, seimbang antara penjelasan produk dan bukti kualitas QA (untuk recruiter).
3. **Kualitas tidak turun:** semua gate CI yang ada tetap hijau, ditambah test baru untuk tema, aksesibilitas di dua tema, CSP, dan landing page.

**Kriteria sukses:** landing page dan seluruh halaman tampil rapi di kedua tema dan di ukuran HP, semua test lama dan baru hijau di CI, tidak ada pelanggaran CSP, dan production tetap lolos smoke test.

## 2. Keputusan teknis

| Keputusan | Pilihan | Alasan / konsekuensi |
|---|---|---|
| Styling | **Tailwind CSS v4** via `@tailwindcss/vite` | Dipilih pemilik proyek (opsi B). CSS dihasilkan sebagai file statis, sehingga cocok dengan CSP `style-src 'self'`. |
| Komponen | **shadcn/ui** (disalin ke `apps/web/src/components/ui/`, berbasis Radix) | Kode milik repo sendiri, bisa diaudit dan disesuaikan. |
| Ikon | **lucide-react** | SVG inline lewat React, aman untuk CSP. |
| Util | `clsx`, `tailwind-merge`, `class-variance-authority` | Standar shadcn. |
| CSS lama | `styles.css` diganti seluruhnya oleh Tailwind | Semua halaman ditulis ulang tampilannya tanpa mengubah fungsi. |

**Batas yang tidak boleh dilanggar:**
- CSP production (`apps/web/security-headers.conf`, `apps/web/public/_headers`) **tidak boleh dilonggarkan** (tidak ada `'unsafe-inline'`, nonce, atau hash baru).
- Komponen yang menyuntikkan `<style>` atau atribut yang diblokir CSP (risiko diketahui: mekanisme scroll-lock Radix Dialog dan sejenisnya) harus dihindari, diganti, atau dikonfigurasi agar tidak melakukannya. Pembuktiannya lewat gate CSP di §7.
- Semua `data-testid`, teks yang di-assert test, label form, `role="alert"`/`role="status"`, dan urutan fokus yang sudah ada tetap dipertahankan.

## 3. Tema

### 3.1 Token warna

Didefinisikan sebagai variabel CSS (format warna bebas, mis. OKLCH, asal setara) dan dipetakan ke token shadcn (`background`, `foreground`, `card`, `muted`, `border`, `primary`, `secondary`, `accent`, `destructive`, `ring`, dll.).

| Peran | Terang (ala Cloudflare) | Gelap (ala Neon) |
|---|---|---|
| Latar halaman | `#f4f5f7` | `#0b0d0f` |
| Kartu / permukaan | `#ffffff` | `#14171a` |
| Garis / border | `#e1e4e8` | `#24292e` |
| Teks utama | `#1d1f20` | `#f2f4f5` |
| Teks sekunder | `#4b5563` | `#a3adb5` |
| Aksen utama (tombol utama, sorotan) | oranye `#f38020` | mint `#34d59a` |
| Aksen sekunder (link, elemen interaktif) | biru `#0051c3` | mint lebih terang `#6ee7b7` |
| Bahaya (hapus, error) | `#c4122f` | `#f87171` |

Nilai boleh disesuaikan seperlunya **hanya untuk memenuhi kontras WCAG AA** (diverifikasi oleh axe, §7). Contoh: teks di atas tombol oranye memakai warna gelap atau tombol memakai oranye yang lebih tua; perubahan dicatat di laporan implementasi.

### 3.2 Mekanisme

- Mode gelap memakai kelas `.dark` pada `<html>` (varian `dark:` Tailwind dikonfigurasi ke kelas ini).
- Pilihan pengguna: `"system" | "light" | "dark"`, disimpan di `localStorage` dengan kunci `tp-theme`. Default `"system"`.
- **`apps/web/public/theme-init.js`**: file script kecil (bukan inline, karena CSP `script-src 'self'`) yang dimuat **sinkron** di `<head>` `index.html` sebelum bundle aplikasi. Ia membaca `tp-theme`; untuk `"system"`/kosong memakai `matchMedia("(prefers-color-scheme: dark)")`; lalu memasang atau melepas `.dark` dan mengisi `color-scheme` di `<html>`. Akses `localStorage` dibungkus `try/catch` (mode privat atau diblokir → perlakukan sebagai `"system"`).
- **`ThemeProvider` + `useTheme()`** di React: state pilihan, menyimpan ke `localStorage`, menerapkan kelas, dan (untuk `"system"`) mendengarkan perubahan `prefers-color-scheme` secara langsung.
- **`ThemeToggle`** di header: tombol yang membuka menu tiga pilihan **Sistem / Terang / Gelap** dengan ikon dan status terpilih; bisa dioperasikan dengan keyboard; `aria-label` "Pilih tema".
- `<meta name="theme-color">` diperbarui mengikuti tema aktif.

## 4. Routing & perilaku

| Path | Anonim (401) | Status auth "loading" | Status auth "error" (API tidak terjangkau) | Login |
|---|---|---|---|---|
| `/` | **Landing page** (baru) | kerangka netral (tanpa landing dan tanpa redirect) | banner galat sesi yang sudah ada + coba lagi | "Project saya" (tetap) |
| Halaman lain | Tidak berubah dari Tahap 1 | Tidak berubah | Tidak berubah | Tidak berubah |

- **Perubahan perilaku yang disengaja:** sebelumnya anonim yang membuka `/` dialihkan ke `/login`. Sekarang ia melihat landing page. `/projects/new`, `/p/:slug/settings`, dll. tetap mengalihkan anonim ke `/login?next=...`.
- Logout tetap berakhir di `/login` (tanpa `next`), seperti Tahap 1.
- `<title>` landing: "TestPulse — Pantau kesehatan testing tim Anda". Ditambah `<meta name="description">` serta tag Open Graph dasar (`og:title`, `og:description`, `og:type`). Gambar OG tidak termasuk.

## 5. Komponen & halaman

### 5.1 Struktur
```
apps/web/src/
  components/ui/          komponen shadcn yang dipakai (button, card, input, label, badge, select,
                          dropdown-menu, separator, sheet/menu mobile, dll. — hanya yang dipakai)
  components/theme/       ThemeProvider.tsx, ThemeToggle.tsx
  components/Layout.tsx   header baru: logo, navigasi, ThemeToggle, menu pengguna; menu mobile < 768px
  pages/LandingPage.tsx   + pages/landing/*.tsx (satu file per bagian)
  lib/utils.ts            cn() dari shadcn
  index.css               Tailwind + token tema (menggantikan styles.css)
apps/web/public/theme-init.js
```

### 5.2 Halaman yang ditata ulang (fungsi tidak berubah)
`LoginPage`, `RegisterPage`, `ProjectsPage`, `NewProjectPage`, `ProjectPage`, `settings/*` (ProjectSettingsPage, GeneralSection, VisibilitySection, MembersSection, InvitationsSection, DangerZone), `InvitePage`, `NotFoundPage`, serta komponen `FormField`, `FormError`, `LoadError`, `Toast`, `RequireAuth` (bagian tampilan).

## 6. Isi landing page

Semua teks berbahasa Indonesia.

1. **Hero**
   - Judul: "Pantau kesehatan testing tim Anda di satu tempat."
   - Subjudul: hasil automated test dari CI, deteksi test flaky, bug report, test case manual, dan crowdtesting.
   - Tombol utama **Daftar gratis** → `/register`. Tombol kedua **Lihat demo project publik** → `/p/testpulse`.
   - Ilustrasi: mockup dashboard statis yang dibangun dari komponen (kartu angka lulus/gagal, grafik batang statis), berlabel **"Pratinjau"**. Data di dalamnya contoh, bukan data nyata.
2. **Fitur** (kartu berikon)
   - Tersedia: Project & visibilitas publik/privat · Tim & role (admin/tester/viewer) · Undangan lewat link.
   - Segera (badge **"Segera"** + tahapnya): Dashboard hasil test & deteksi flaky (Tahap 2) · Bug tracker (Tahap 3) · Test case manual (Tahap 4) · Crowdtesting (Tahap 5).
3. **Cara kerja** (3 langkah): buat project & undang tim → hubungkan CI dengan reporter (Tahap 2) → pantau tren & perbaiki test flaky.
4. **Dibangun dengan standar QA**
   - Visual piramida test: unit, integration (Postgres asli), API + matriks otorisasi, contract (Pact), E2E 3 browser + aksesibilitas, OWASP ZAP, smoke test production.
   - Angka jumlah test, jika ditampilkan, diberi label snapshot bertanggal dan merujuk `docs/TEST_STRATEGY.md`. Untuk angka terkini diarahkan ke laporan Allure.
   - Tombol: **Laporan test live** (https://safeqq.github.io/testpulse/), **CI** (https://github.com/Safeqq/testpulse/actions/workflows/ci.yml), **Source code** (https://github.com/Safeqq/testpulse), **Strategi test** (link GitHub ke `docs/TEST_STRATEGY.md`).
5. **Roadmap singkat:** Tahap 1 ✅ live; Tahap 2–6 dengan status "Berikutnya" / "Direncanakan" / "Opsional" sesuai spec Tahap 1 §2.
6. **Footer:** nama **TestPulse**, link GitHub, Dokumentasi (README di GitHub), Laporan test, dan tahun. **Tanpa** kalimat atribusi pembuat.

Link eksternal dibuka di tab baru dengan `rel="noopener noreferrer"`.

`data-testid` baru (minimal): `landing-hero`, `landing-cta-register`, `landing-cta-demo`, `landing-features`, `feature-<slug>` + `feature-soon-badge`, `landing-how-it-works`, `landing-quality`, `quality-link-allure|ci|source|strategy`, `landing-roadmap`, `landing-footer`, `theme-toggle`, `theme-option-system|light|dark`, `mobile-menu-toggle`.

## 7. Testing

### 7.1 Tetap hijau
Semua suite yang ada (unit, integration, API, contract, E2E 3 browser, ZAP, smoke). Satu test diubah karena perubahan perilaku yang disengaja di §4: `tests/e2e/projects.spec.ts` "`/` dan `/projects/new` mengarahkan user anonim ke login" menjadi "anonim di `/` melihat landing page; `/projects/new` tetap ke login".

### 7.2 Test baru (Playwright, `tests/e2e/`)
1. **Aksesibilitas dua tema:** helper `expectNoA11yViolations` dijalankan di mode terang **dan** gelap (`page.emulateMedia({ colorScheme })` dengan pilihan `"system"`) untuk landing, login, daftar, daftar project, buat project, ringkasan project (anggota & anonim publik), pengaturan, dan undangan. Kriteria sama seperti Tahap 1: 0 pelanggaran `serious`/`critical`.
2. **Tema:**
   - `"system"` mengikuti `colorScheme` yang diemulasikan (gelap → `<html class="dark">`, terang → tanpa kelas).
   - Memilih Terang/Gelap lewat `ThemeToggle` tersimpan setelah reload.
   - Kembali ke Sistem mengikuti emulasi lagi, termasuk saat emulasi berubah tanpa reload.
   - Tanpa kedip: kelas `dark` sudah ada pada respons pertama (cek atribut `<html>` sebelum bundle React selesai, mis. dengan memblokir sementara request bundle JS).
   - `localStorage` diblokir/throw → aplikasi tetap tampil dengan tema sistem.
3. **Gate CSP:** fixture global yang memasang listener `securitypolicyviolation` (lewat `addInitScript`) dan memantau console error "Content Security Policy"; setiap test E2E gagal jika ada pelanggaran. Gate ini berlaku di stack Docker (nginx dengan CSP production) di CI.
4. **Landing page:**
   - Semua bagian tampil.
   - Tombol Daftar → `/register`; Lihat demo → `/p/testpulse`.
   - Link Allure/CI/Source/Strategi memiliki `href` yang benar dan `target="_blank"` + `rel` aman.
   - Badge "Segera" ada tepat pada fitur Tahap 2–5.
   - Pengguna login yang membuka `/` melihat "Project saya", bukan landing.
5. **Responsif:** di viewport 375×812, landing dan header tidak menimbulkan scroll horizontal (`document.documentElement.scrollWidth <= innerWidth`); menu mobile bisa dibuka dan berisi navigasi utama.

### 7.3 Tidak termasuk
Visual regression otomatis (tetap Tahap 3), animasi berat, gambar OG, lighthouse/performance budget (Tahap 2 bersama k6).

## 8. Dokumentasi
- README: screenshot landing dan halaman project di tema terang & gelap (file di `docs/images/`), dan bagian "Tampilan" singkat.
- `docs/TEST_STRATEGY.md`: tambahkan a11y dua tema, gate CSP, dan test tema.
- ADR baru `docs/adr/0003-tailwind-shadcn.md`: konteks, keputusan (Tailwind + shadcn dipilih alih-alih CSS token murni), konsekuensi (perubahan besar, ketergantungan Radix, risiko CSP dan mitigasinya).

## 9. Definisi selesai
- [ ] Landing page (§6) dan semua halaman (§5.2) memakai komponen baru di kedua tema dan di ukuran HP.
- [ ] Mekanisme tema (§3.2) bekerja tanpa kedip dan tanpa melonggarkan CSP.
- [ ] Semua test lama dan baru (§7) hijau di CI; tidak ada pelanggaran CSP.
- [ ] Deploy otomatis production berhasil dan smoke test 4/4 hijau.
- [ ] Dokumentasi §8 diperbarui.
