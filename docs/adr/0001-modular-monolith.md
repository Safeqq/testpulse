# ADR 0001: Modular monolith (Fastify + React SPA) di satu monorepo

- **Status:** Diterima
- **Tanggal:** 2026-10-23

## Konteks

TestPulse dibangun oleh satu orang sebagai produk sekaligus portfolio QA/SDET. Tahap 1 hanya mencakup akun, project, tim, dan undangan, tetapi roadmap berlanjut ke dashboard hasil test, bug tracker, test case management, dan crowdtesting (tahap 2 sampai 6).

Batasan dan tujuan yang memengaruhi keputusan:

- **Biaya hosting nol.** Target hosting adalah layanan gratis (Render free web service, Neon free Postgres, Cloudflare Pages). Setiap layanan tambahan berarti cold start, batas kuota, dan konfigurasi tambahan.
- **Fokus ke pengujian.** Nilai utama portfolio ada pada strategi dan otomasi test, bukan pada kerumitan infrastruktur. Waktu yang dihabiskan untuk orkestrasi service adalah waktu yang tidak dipakai untuk menguji.
- **Batas yang bermakna untuk contract test.** Contract test (Pact) paling berguna di batas yang nyata antara dua pihak yang berevolusi terpisah. Di sini batas itu adalah web (consumer) dan API (provider).
- **Satu bahasa.** TypeScript di seluruh stack agar schema, tipe, dan kode error bisa dipakai bersama.
- **Persiapan ke depan.** Tahap 2 menambahkan reporter CLI dan tahap 6 aplikasi desktop; keduanya akan memanggil API yang sama.

Alternatif yang dipertimbangkan:

1. **Microservices** (misalnya service terpisah untuk auth, project, hasil test).
2. **Next.js full-stack** (UI dan API dalam satu framework).
3. **Modular monolith**: satu API Fastify dengan modul yang dibatasi tegas, ditambah SPA React/Vite terpisah.

## Keputusan

Memakai **modular monolith**:

- `apps/api`: satu proses Fastify + PostgreSQL (Drizzle ORM dan migrasi). Kode dibagi per modul (`auth`, `projects`, `invitations`; modul tahap berikut menyusul). Tiap modul punya lapisan `domain` murni (tanpa I/O), `repository`, dan `routes`. Konvensinya: modul memanggil modul lain lewat fungsi service/akses yang diekspor, bukan dengan membaca tabel modul lain secara langsung. Ini niat desain yang dijaga lewat review, belum ditegakkan tooling, dan ada pengecualian yang diketahui, dari dua jenis. (1) Transaksi atomik: repository `invitations` membaca `projects` dan `memberships` serta menambah baris `memberships` agar penerimaan undangan (cek status, tambah anggota, tandai terpakai) berjalan dalam satu transaksi. (2) Tampilan gabungan: `projects/repository.ts` (`listMembers`, `findMember`) dan `invitations/repository.ts` (`listActiveInvitations`) membaca tabel `users` milik modul `auth` langsung (join) untuk menampilkan id, nama, dan email anggota serta id dan nama pembuat undangan. Pola ini sengaja dipilih daripada memanggil `auth` per baris; yang dibaca hanya kolom tampilan, tidak pernah `password_hash`.
- `apps/web`: React + Vite SPA, dilayani sebagai berkas statis. Browser hanya melihat satu origin; `/api/*` diteruskan ke API (nginx secara lokal, Cloudflare Pages Function di production).
- `packages/shared`: schema Zod, tipe, enum role, dan kode error yang dipakai bersama oleh API, web, dan test.
- Semua dalam satu monorepo pnpm.

Microservices ditolak karena menambah jaringan, deployment, dan observability yang tidak dibutuhkan pada skala ini, dan melampaui kuota hosting gratis. Next.js ditolak karena menyatukan UI dan API dalam satu runtime sehingga batas web dan API (tempat contract test bekerja) menjadi kabur, dan karena API perlu dipakai klien lain (CLI di tahap 2, desktop di tahap 6) tanpa bergantung pada framework web.

## Konsekuensi

**Positif**

- Satu unit deploy untuk API dan satu untuk web; mudah dijalankan lokal (`docker compose up`) dan di CI.
- Batas web-API tetap nyata, sehingga contract test bermakna dan E2E tidak perlu menjadi satu-satunya penjaga integrasi.
- Transaksi database lintas modul tetap sederhana. Aturan seperti "minimal satu admin" bisa dijaga dengan satu transaksi dan `SELECT ... FOR UPDATE`, yang akan jauh lebih sulit di arsitektur terdistribusi.
- Lapisan `domain` yang murni mudah diuji sebagai unit dan menjadi sasaran gate coverage >= 80%.
- Kode bersama di `packages/shared` mencegah drift tipe antar-aplikasi.

**Negatif dan risiko**

- Semua modul diskalakan dan di-deploy bersama; satu modul yang berat memengaruhi yang lain. Dapat diterima pada skala portfolio.
- Disiplin batas modul hanya dijaga konvensi dan review, belum oleh tooling, dan sudah ada beberapa pengecualian yang disengaja dan terdokumentasi di atas (transaksi penerimaan undangan, serta join ke `users` untuk tampilan anggota dan undangan). Jika pelanggaran bertambah, dapat ditambahkan aturan lint.
- Render free tier tidur saat idle (cold start sekitar 30 sampai 60 detik); ini keterbatasan hosting, bukan arsitektur, dan didokumentasikan di [deploy.md](../deploy.md).
- Jika suatu modul kelak perlu dipisah, batas modul dan kontrak HTTP yang sudah ada memudahkan ekstraksi.
