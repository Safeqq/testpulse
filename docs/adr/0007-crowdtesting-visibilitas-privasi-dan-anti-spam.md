# ADR 0007: Crowdtesting dengan visibilitas cycle sendiri, privasi tester, poin dari severity final, anti-spam terkunci, dan deskripsi bug dari server

- **Status:** Diterima
- **Tanggal:** 2026-11-24

## Konteks

Tahap 5 menambahkan **crowdtesting**: tim membuka *test cycle* publik, penguji dari luar tim (crowd tester) bergabung dan mengirim laporan bug, tim mentriase laporan itu (terima, tolak, duplikat, kembalikan), dan laporan yang diterima menjadi bug Tahap 3. Penguji mengumpulkan poin di leaderboard. Rinciannya ada di [spec Tahap 5](../superpowers/specs/2026-11-16-testpulse-tahap5-design.md). Untuk pertama kalinya **orang di luar project menulis data ke dalam project**, jadi lima keputusan di bawah menentukan batas keamanan, privasi, dan konsistensi modul `crowd`.

Batasan yang berlaku:

- Project boleh privat. Hasil CI, bug internal, test case, dan daftar anggota tidak boleh terbuka hanya karena tim membuka crowdtesting.
- Laporan ditulis orang yang tidak dikenal tim, lalu dibaca tim di halaman triase dan di bug yang dibuat darinya. Teks itu harus diperlakukan sebagai masukan berbahaya, termasuk Markdown yang meniru UI tim ("## Status: Diterima").
- Crowd tester tidak saling mengenal dan tidak mengenal tim; nama tampilan boleh terlihat, email tidak.
- Siapa pun bisa mendaftar dan bergabung dengan sekali klik, sehingga spam harus diredam di server, termasuk terhadap kiriman bersamaan.
- Production tetap memakai CSP ketat dan Markdown aman ([ADR 0003](./0003-tailwind-shadcn.md), [ADR 0005](./0005-perbandingan-versi-dan-markdown-aman.md)); tidak ada yang boleh dilonggarkan.

## Keputusan

### 1. Cycle punya visibilitas sendiri; isi project tidak ikut terbuka

Cycle berstatus `open` atau `closed` tampil di direktori publik `/crowd` **walau project-nya privat**; cycle `draft` hanya untuk anggota (`404 CYCLE_NOT_FOUND` bagi selain anggota).

- Yang publik hanya **isi cycle**: judul, ringkasan, link aplikasi, instruksi, cakupan, lingkungan, versi, statistik, daftar masalah yang sudah diketahui, dan leaderboard. DTO publik membawa `project: { name, slug | null }`; `slug` bernilai `null` untuk project privat sehingga halaman project tidak tertaut. `GET /projects/:slug` untuk anonim tetap 404.
- Data laporan dan peserta di API tim hanya untuk anggota, **juga di project publik**: aksi izin baru `crowd:read` (viewer ke atas) dipisah dari `project:read`. Matriks otorisasi menguji bahwa menjadikan `crowd:read` aksi baca publik langsung menggagalkan sel (diverifikasi sengaja di Task 13).
- **Anonim mendapat 401, bukan 404, di endpoint data crowd tim untuk project privat (Ruling Task 1).** Spec §8.4 menulis 404; implementasinya mengikuti urutan pengecekan `members:read` yang sudah ada (sesi dicek sebelum visibilitas). 401 juga tidak membocorkan keberadaan project, karena project yang tidak ada pun memberi 401 bagi anonim.

### 2. Privasi tester: tanpa email, laporan orang lain 404

- Tidak ada DTO crowd yang memuat email, di API publik maupun tim; yang tampil hanya `{ id, name }`. Schema shared memakai `strip` bawaan Zod, jadi field tak dikenal terbuang (Ruling Task 1), dan test integration, API, E2E, serta Pact memindai respons untuk pola email.
- Laporan hanya terbaca oleh pelapornya di API publik. Laporan orang lain, termasuk bagi anggota project yang membuka URL publiknya, dijawab `404 REPORT_NOT_FOUND`, sama dengan laporan yang tidak ada.
- Peserta yang dikeluarkan tetap bisa **membaca** laporan dan komentarnya sendiri, tetapi tidak bisa mengubah, menarik, atau berkomentar (`403 PARTICIPANT_REMOVED`, Ruling Task 6).

### 3. Poin dari severity final, disalin ke laporan; leaderboard adalah agregasi

- Saat laporan diterima, tim menetapkan **severity final** (default: usulan pelapor) dan poin dikunci di laporan: minor 1, major 3, critical 5, blocker 8. Ditolak, duplikat, dan ditarik bernilai 0; tidak ada penalti.
- **Tingkat penerimaan** = diterima / (diterima + ditolak + duplikat), `null` bila belum ada keputusan.
- Leaderboard per cycle dan global adalah agregasi SQL atas laporan `accepted` (poin ↓, jumlah diterima ↓, waktu poin terakhir dicapai ↑), top 50 ditambah posisi saya. Tidak ada tabel skor terpisah yang bisa menyimpang.
- **Leaderboard global di-cache** selama TTL (`crowdLeaderboardTtlMs`, default 30 detik), sedangkan baris "saya" dihitung segar per permintaan (Ruling Task 5). Akibatnya baris saya bisa tampil walau daftar teratas masih dari cache; tabel menampilkannya juga saat daftar kosong (Ruling Task 8).
- **Cycle yang sudah punya laporan tidak bisa dihapus** (`409 CYCLE_HAS_REPORTS`), supaya poin yang sudah diperoleh tidak hilang; cycle cukup ditutup.

### 4. Anti-spam di server, di bawah kunci

Batas per tester: maksimal **10 laporan `submitted`** sekaligus per cycle, **50 laporan** per cycle (termasuk yang ditarik), dan **30 laporan per 24 jam** di semua cycle. Pelanggaran → `429 RATE_LIMITED` dengan pesan yang menyebut batasnya; ditambah rate limit per IP pada kirim laporan, komentar, dan join.

- **Urutan kunci:** project → cycle → peserta → laporan, sama di semua jalur tulis.
- **Batas harian lintas cycle** tidak bisa dijaga kunci baris peserta (beda cycle, beda baris), jadi kiriman pengguna yang sama diserialkan lebih dulu dengan `pg_advisory_xact_lock` per pengguna (Ruling Task 6). Integration menguji 9 laporan `submitted` + 5 kiriman paralel → tepat 1 lolos.
- **Duplikat** diredam dengan daftar "masalah yang sudah diketahui" per cycle (judul, severity, waktu diterima), tanpa membuka detail laporan; tim bisa menyembunyikan laporan tertentu (mis. masalah keamanan).

### 5. Bug dibuat server dalam transaksi triase, dengan deskripsi Markdown aman

- Menerima laporan **membuat bug Tahap 3 dalam transaksi yang sama**: `insertBug(tx, …)` dipisah dari `createBug` agar dipanggil di dalam transaksi triase; triase mengunci project `FOR NO KEY UPDATE` lalu laporan `FOR UPDATE` (Ruling Task 7). Dua anggota yang menerima bersamaan menghasilkan **tepat satu** bug; pihak lain mendapat `409 REPORT_CONFLICT`. `bugs.crowd_report_id` dan `crowd_reports.bug_id` saling menaut, bug berlabel `crowd`, dan `BugDto.crowdOrigin` menampilkan asalnya.
- **Deskripsi bug disusun di server** dengan helper Markdown aman yang dipindah dari web ke `packages/shared` (`codeSpan`, `fenceFor`, `safeAutolink`, `clipCodePoints`). Metadata (nomor laporan, cycle, nama pelapor, lingkungan) ditulis sebagai **code span**, sehingga teks crowd di dalamnya tidak bisa membentuk link, heading, atau "status" palsu. Isi laporan disalin sebagai Markdown dan dirender oleh renderer aman Tahap 3 (HTML mentah di-escape, link hanya http/https/mailto, gambar menjadi link). Link bukti ditulis sebagai autolink hanya bila http(s) tanpa spasi atau `<` `>`. Hasilnya dipotong ke 20.000 karakter di batas code point.
- **Kembalikan** (dari ditolak/duplikat) mengosongkan alasan, catatan, target duplikat, dan juga pelaku serta waktu triase (Ruling Task 7): laporan yang dikembalikan benar-benar belum ditriase.

### 6. Keputusan kecil lain

- Status `noop` di transisi cycle untuk PATCH dengan status yang sama; membuka draf dengan `endsAt` yang sudah lewat juga ditolak (Ruling Task 2).
- `me.participantStatus` di DTO cycle publik, karena `me.state` merangkum peserta aktif dan keluar menjadi `closed` setelah cycle selesai, sedangkan tab "Laporan saya" tetap perlu tahu (Ruling Task 2).
- Keluar saat sudah dikeluarkan memberi 204 tanpa perubahan; status `removed` tidak bisa "dicuci" dengan keluar lalu bergabung lagi (Review Focus 2, Ruling Task 5).
- Cursor keyset memakai waktu dalam mikrodetik (bigint): presisi milidetik mengulang baris antar halaman (Ruling Task 4).
- Menarik laporan (`DELETE /crowd/reports/:id`) mengembalikan 200 dengan laporan terbaru, bukan 204, agar UI menampilkan status dan riwayat baru tanpa memuat ulang (Ruling Task 6).
- Kartu "Crowdtesting" di dashboard hanya untuk anggota dan tampil juga di project tanpa run CI (pola Ruling R10 Tahap 4); asal bug crowd bertaut ke halaman triase hanya untuk anggota (Ruling Task 12).

## Alternatif yang ditolak

**Untuk visibilitas:**

1. **Cycle mengikuti visibilitas project:** sederhana, tetapi tim dengan project privat, justru yang paling umum, tidak bisa memakai crowdtesting sama sekali.
2. **Undangan privat ke cycle:** menutup spam, tetapi menghilangkan sifat "crowd"; di luar lingkup Tahap 5.

**Untuk laporan:**

1. **Crowd tester menulis langsung ke bug tracker:** satu model lebih sedikit, tetapi tracker internal menjadi publik-tulis dan reputasi tidak punya dasar keputusan.

**Untuk reputasi:**

1. **Tabel skor yang diperbarui saat triase:** baca lebih cepat, tetapi bisa menyimpang dari laporan (kembalikan, hapus project); agregasi atas poin yang disalin cukup cepat (k6: p95 global leaderboard di bawah gate) dan selalu benar.
2. **Penalti untuk laporan ditolak:** membuat tester baru kapok; tingkat penerimaan sudah memberi sinyal kualitas.

**Untuk anti-spam:**

1. **Batas dihitung tanpa kunci:** dua kiriman paralel sama-sama melihat hitungan lama dan lolos melewati batas; test integration paralel menjaga agar itu tidak terjadi.
2. **Moderasi otomatis berbasis konten:** di luar lingkup; batas jumlah, rate limit IP, dan tombol keluarkan cukup untuk tahap ini.

**Untuk deskripsi bug:**

1. **Klien menyusun deskripsi:** server tidak bisa menjamin metadata tidak dipalsukan.
2. **Menyalin teks crowd sebagai teks polos tanpa Markdown:** aman, tetapi langkah bernomor dan blok kode yang ditulis pelapor hilang; renderer aman Tahap 3 sudah membuat Markdown itu inert.

## Konsekuensi

**Positif**

- Tim dengan project privat bisa membuka cycle publik tanpa membuka hasil CI, bug, case, atau anggota; matriks otorisasi tim (6 aktor + anonim publik) dan publik (anonim, login bukan peserta, aktif, keluar, dikeluarkan, anggota) menjaga batas itu.
- Laporan yang diterima langsung menjadi bug biasa dengan asal yang tercatat, sehingga alur Tahap 3 (status, komentar, tautan test) berlaku tanpa kode khusus.
- Konten berbahaya dari luar diuji inert di halaman triase, bug yang dibuat, dan laporan saya, di bawah gate CSP, pada tiga browser.

**Negatif dan risiko**

- **Direktori publik membocorkan nama project privat** yang membuka cycle. Disengaja: nama dibutuhkan agar tester tahu aplikasi siapa yang diuji; slug, isi, dan anggota tetap tertutup.
- **Leaderboard global bisa tertinggal sampai 30 detik.** Baris "saya" segar, jadi tester langsung melihat poinnya sendiri.
- **Batas anti-spam per akun bisa dielakkan dengan banyak akun.** Rate limit per IP dan tombol keluarkan meredamnya; deteksi spam berbasis konten sengaja tidak ada.
- **Kunci advisory per pengguna** menyerialkan semua kiriman laporan satu pengguna di semua cycle; untuk satu orang itu tidak terasa, tetapi menambah satu lapisan kunci yang harus dijaga urutannya.
- **Deskripsi bug adalah salinan** saat diterima: mengubah laporan setelah itu tidak mungkin (laporan diterima final), dan mengubah bug tidak mengubah laporan.
