# ADR 0002: Sesi berbasis cookie `HttpOnly` dengan token ter-hash (bukan JWT di localStorage)

- **Status:** Diterima
- **Tanggal:** 2026-10-23

## Konteks

Aplikasi web (SPA) perlu mengenali pengguna yang sudah masuk. Beberapa hal membatasi pilihan:

- Token autentikasi adalah target utama serangan XSS. Token yang bisa dibaca JavaScript (misalnya di `localStorage`) dicuri begitu ada satu celah XSS.
- Sesi harus bisa **dicabut** (logout sungguhan) dan **kedaluwarsa** di sisi server. Tahap 1 hanya punya satu API dan satu basis data, jadi pencarian sesi per request murah.
- Production berjalan di dua host (web di Cloudflare Pages, API di Render). Bila browser berbicara langsung ke dua origin, cookie menjadi pihak ketiga, butuh `SameSite=None`, CORS dengan kredensial, dan lebih rentan CSRF serta pemblokiran cookie pihak ketiga.
- Rencana ke depan: reporter CLI (tahap 2) dan aplikasi desktop (tahap 6) tidak memakai cookie dan akan memakai token bearer.

Alternatif yang dipertimbangkan:

1. **JWT di `localStorage`** dikirim lewat header `Authorization`.
2. **JWT di cookie** tanpa penyimpanan sesi di server.
3. **Token sesi acak di cookie `HttpOnly`**, dengan baris sesi di database.

## Keputusan

Memakai **token sesi acak di cookie `HttpOnly`** (opsi 3):

- Token acak 32 byte dibuat saat daftar/masuk dan dikirim sebagai cookie `tp_session` dengan atribut `HttpOnly`, `SameSite=Lax`, `Path=/`, dan `Secure` jika `COOKIE_SECURE=true` (production). Masa berlaku 14 hari.
- **Database hanya menyimpan hash SHA-256 dari token** (tabel `sessions`, kunci utamanya adalah hash). Kebocoran basis data tidak langsung memberikan sesi yang bisa dipakai.
- **Logout menghapus baris sesi**, sehingga token lama langsung tidak berlaku (pencabutan). Logout hanya mengakhiri sesi yang dipakai; sesi lain milik user yang sama tetap berlaku. Sesi yang kedaluwarsa ditolak dan dibersihkan saat lookup.
- **Browser hanya melihat satu origin.** Di production, Cloudflare Pages Function meneruskan `/api/*` ke API di Render; secara lokal nginx melakukan hal yang sama. Cookie menjadi first-party, tanpa CORS kredensial dan tanpa `SameSite=None`.
- **Perlindungan CSRF berlapis:** `SameSite=Lax`, request yang mengubah data dan membawa body wajib ber-`Content-Type: application/json` (request tanpa body diizinkan), dan header `Origin` (jika ada) harus sama dengan `APP_ORIGIN`.
- Lookup sesi ditulis sebagai satu fungsi (`authenticate`) sehingga header `Authorization: Bearer` bisa ditambahkan di tahap 2 tanpa mengubah modul lain.

Opsi 1 ditolak karena token terbaca JavaScript sehingga XSS berarti pengambilalihan akun. Opsi 2 ditolak karena JWT yang stateless sulit dicabut sebelum kedaluwarsa, sementara kebutuhan pencabutan di sini nyata dan biayanya (satu lookup per request) kecil.

## Konsekuensi

**Positif**

- Token tidak terjangkau JavaScript; dampak XSS terhadap pencurian sesi berkurang.
- Pencabutan dan kedaluwarsa sepenuhnya dikendalikan server.
- Penyimpanan hash membatasi dampak kebocoran database.
- Perilaku mudah diuji secara deterministik: cookie dan atribut, kedaluwarsa, hash di DB, logout, CSRF (lihat `apps/api/test/integration/auth.int.test.ts`, `security.int.test.ts`, dan [TEST_STRATEGY.md](../TEST_STRATEGY.md)).

**Negatif dan risiko**

- Setiap request terautentikasi membaca database; dapat diterima pada skala ini, dan dapat di-cache bila perlu.
- Arsitektur satu-origin bergantung pada proxy. Proxy harus meneruskan cookie dan IP klien dengan benar; karena IP klien dipakai untuk rate limit, API hanya memercayai header `x-tp-client-ip` (diisi Function dari `CF-Connecting-IP`) bila header rahasia bersama `x-proxy-secret` cocok. Proxy diuji sebagai unit (`apps/web/test/functions`) dan header keamanannya dijaga paritasnya dengan nginx.
- Cookie tidak cocok untuk klien non-browser. Tahap 2 dan 6 perlu mekanisme token tambahan (project token, bearer).
- Tidak ada pembatasan jumlah sesi per user dan tidak ada "keluar dari semua perangkat" di tahap 1; ditunda sampai ada kebutuhan.
