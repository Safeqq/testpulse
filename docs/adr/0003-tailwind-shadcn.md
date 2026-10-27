# ADR 0003: Tailwind CSS v4 + shadcn/ui untuk tampilan, dengan gate CSP sebagai pengaman

- **Status:** Diterima
- **Tanggal:** 2026-10-27

## Konteks

Tahap 1 sengaja memakai tampilan fungsional yang polos: satu berkas `styles.css` tulisan tangan tanpa sistem desain. Untuk portfolio, kesan pertama penting, sehingga sebelum Tahap 2 tampilan perlu naik kelas: dua tema (terang bergaya dashboard Cloudflare, gelap bergaya Neon), landing page, dan tampilan yang rapi di ukuran HP. Rinciannya ada di [spec](../superpowers/specs/2026-10-26-ui-tema-landing-design.md).

Batas yang tidak boleh dilanggar: **CSP production tidak boleh dilonggarkan** (`default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`). Tidak ada `'unsafe-inline'`, nonce, atau hash. Artinya tidak boleh ada `<style>` inline, atribut `style`, atau skrip inline.

Alternatif yang dipertimbangkan:

1. **CSS tulisan tangan dengan token desain murni** (variabel CSS, tanpa framework): paling sedikit dependensi dan paling mudah dijamin aman untuk CSP, tetapi komponen interaktif (menu dropdown, fokus, keyboard, ARIA) harus ditulis dan diuji sendiri.
2. **Tailwind CSS v4 + shadcn/ui** (komponen disalin ke repo, berbasis Radix).
3. Pustaka komponen terpasang penuh (mis. MUI, Chakra): tidak dipilih karena umumnya menyuntikkan gaya lewat runtime CSS-in-JS yang bertabrakan dengan `style-src 'self'`.

## Keputusan

Memakai **Tailwind CSS v4 (lewat `@tailwindcss/vite`) dan shadcn/ui** (opsi 2). Pemilik proyek memilih opsi ini dibanding CSS token murni (opsi 1).

- Tailwind menghasilkan **berkas CSS statis** saat build, sehingga cocok dengan `style-src 'self'`.
- Komponen shadcn **disalin ke `apps/web/src/components/ui/`** sehingga kodenya milik repo, bisa diaudit dan diubah; ikon dari `lucide-react` (SVG lewat React). Utilitas standar: `clsx`, `tailwind-merge`, `class-variance-authority`.
- Tema memakai variabel CSS dan kelas `.dark` di `<html>`; pilihan pengguna (`"system" | "light" | "dark"`) disimpan di `localStorage` (`tp-theme`). Penerapan awal dilakukan oleh `public/theme-init.js`, **berkas script eksternal** yang dimuat sinkron di `<head>` (bukan inline) supaya tidak ada kedip dan tidak butuh pelonggaran CSP.
- **Komponen shadcn yang dipakai dibatasi:** `button`, `card`, `input`, `label`, `badge`, `separator`, dan `dropdown-menu` (selalu `modal={false}`).
- **Komponen yang dilarang** karena menyuntikkan `<style>` atau atribut gaya inline (mis. mekanisme scroll-lock Radix) yang diblokir CSP: `dialog`, `sheet`, `alert-dialog`, `select` (versi Radix), `scroll-area`, dan `popover`. Penggantinya: elemen `<select>` native yang distyle (test memakai `selectOption`) dan menu mobile berupa disclosure sederhana (tombol dan daftar link), bukan sheet.
- Selain itu, zod di web dikonfigurasi `config({ jitless: true })` (`apps/web/src/lib/zod-config.ts`, dimuat paling awal): zod menguji dukungan `new Function` untuk JIT, dan di bawah CSP tanpa `unsafe-eval` probe itu dicatat sebagai pelanggaran `script-src` walau errornya ditelan.

Pembuktian bahwa CSP tetap utuh tidak mengandalkan disiplin manual, tetapi **gate CSP** di E2E ([TEST_STRATEGY.md bagian 2.1](../TEST_STRATEGY.md#21-tema-gate-csp-dan-landing-page)): setiap test E2E gagal bila terjadi pelanggaran CSP (event `securitypolicyviolation` maupun pesan console), dan gate itu gagal tertutup bila ia sendiri tidak terpasang. Gate dijalankan terhadap stack Docker/nginx yang membawa header CSP production, termasuk di CI.

## Konsekuensi

**Positif**

- Tampilan modern, konsisten, dan responsif dengan dua tema tanpa melonggarkan CSP; hasilnya CSS statis yang dapat di-cache.
- Kode komponen ada di repo (bukan dependensi buram), mudah diaudit dan disesuaikan.
- Aksesibilitas dijaga otomatis di kedua tema (axe), dan CSP dijaga otomatis oleh gate; keduanya mencegah kemunduran saat UI berubah.

**Negatif dan risiko**

- **Perubahan besar:** seluruh tampilan Tahap 1 ditulis ulang (CSS lama dihapus), sehingga diff-nya luas dan berisiko regresi visual. Mitigasi: fungsi, `data-testid`, label, dan peran ARIA dipertahankan, seluruh suite lama tetap hijau, dan ditambah test tema, landing, serta aksesibilitas dua tema. Visual regression otomatis tetap ditunda ke Tahap 3.
- **Ketergantungan Radix** (lewat shadcn) dan rantai dependensi Tailwind/lucide bertambah, dengan biaya pembaruan dan audit (`pnpm audit`, Dependabot) yang ikut membesar. Radix juga membuat sebagian komponen tidak bisa dipakai apa adanya karena CSP.
- **Daftar komponen terlarang harus ditaati.** Menambah komponen baru dari shadcn berisiko menyuntikkan gaya inline. Mitigasi: gate CSP menggagalkan test E2E yang menyentuhnya, tetapi gate hanya bermakna bila E2E dijalankan terhadap stack nginx dan hanya menangkap pelanggaran yang benar-benar terjadi pada alur yang diuji.
- **Gate CSP punya batas.** WebKit melaporkan `style-src-attr` palsu untuk `<select>` yang dibuat lewat script, sehingga dikecualikan secara sempit; pelanggaran di dalam worker hanya terlihat di WebKit. Gate juga tidak menguji header Cloudflare Pages secara langsung, melainkan mengandalkan test paritas header nginx dan `_headers`.
- **`jitless` zod** sedikit mengurangi kecepatan parsing (tanpa JIT); dapat diterima untuk ukuran payload di aplikasi ini, dan harus dipertahankan selama CSP tanpa `unsafe-eval`.
- Palet warna mengikuti spec; penyesuaian demi kontras WCAG AA (diverifikasi axe) terbatas pada teks gelap di atas tombol aksen, warna cincin fokus, dan garis kolom input. Token ada di `apps/web/src/index.css`.
