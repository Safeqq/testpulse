# ADR 0005: Perbandingan antar versi (urutan, regresi, pembanding default), mode ringkasan, dan Markdown aman

- **Status:** Diterima
- **Tanggal:** 2026-11-06

## Konteks

Tahap 3 menambahkan dua hal di atas data Tahap 2: **deteksi regresi antar versi** (setiap run boleh membawa `version`, lalu TestPulse membandingkan versi terbaru dengan versi sebelumnya dan menulis kesimpulannya dalam satu kalimat) dan **bug tracker** yang deskripsi dan komentarnya ditulis pengguna dalam Markdown. Rinciannya ada di [spec Tahap 3](../superpowers/specs/2026-11-04-testpulse-tahap3-design.md). Empat keputusan memengaruhi hampir semua bagian lain (API, tampilan, strategi test), jadi dicatat di sini.

Batasan yang berlaku:

- Versi yang dikirim CI tidak selalu semver: ada tag seperti `2026.11`, `build-42`, atau `release-candidate`. Pipeline yang sama juga bisa mengirim `1.0.1` dan `v1.0.1`.
- Satu versi bisa punya beberapa run (CI diulang), dan branch berbeda punya riwayatnya sendiri.
- Test yang dilewati, test baru, dan test yang dihapus adalah hal biasa antar rilis; perbandingan yang menandainya semua sebagai "regresi" akan diabaikan pengguna.
- Production memakai CSP ketat (`style-src 'self'`, `img-src 'self' data:`, tanpa `unsafe-inline`) yang tidak boleh dilonggarkan ([ADR 0003](./0003-tailwind-shadcn.md)). Teks bug dan komentar berasal dari pengguna, dan project publik dibaca anonim.
- Dashboard memerlukan ringkasan perbandingan di setiap tampilan, sedangkan daftar test per kelompok bisa ribuan baris.

## Keputusan

### 1. Urutan versi: semver bila semua semver, selain itu menurut waktu

Urutan dihitung **per branch** dari versi yang dipakai run di branch itu (fungsi murni di `apps/api/src/modules/results/domain/versions.ts`).

- Sebuah versi adalah **semver** bila cocok `^[vV]?MAJOR.MINOR.PATCH(-prerelease)?(+build)?$`. Prefiks `v` dan `+build` diabaikan dalam perbandingan (`v1.0.1`, `1.0.1`, dan `1.0.1+sha.abc` satu versi); pre-release mengikuti aturan semver 2.0 (`1.0.0-beta < 1.0.0`, `1.0.0-alpha.2 < 1.0.0-alpha.10`, identifier numerik di bawah alfanumerik). Bagian numerik dibandingkan secara numerik dan eksak untuk bilangan sebesar apa pun (panjang digit, lalu isi), bukan sebagai teks (`1.0.10 > 1.0.9`) atau `Number`.
- Bila **semua** versi di branch itu semver, urutannya semver. Bila **satu saja** bukan semver, **semua** versi branch itu diurutkan menurut waktu run terakhirnya (terlama ke terbaru), dan hanya string yang identik yang dianggap versi sama. Satu aturan untuk seluruh branch memberi urutan total yang konsisten; mencampur dua cara urut tidak punya jawaban benar untuk pasangan seperti `1.2.0` dan `nightly`.
- "Run sebuah versi" adalah run **terakhir** dengan versi itu di branch itu.

### 2. Definisi regresi dan kelompok perbandingan

Test dicocokkan lewat `test_case_id` (identitas `suite` + `name`, [ADR 0004](./0004-ingest-sinkron-dan-definisi-flaky.md)). "Lulus" termasuk lulus-setelah-retry; flaky tetap ditandai di barisnya.

| Kelompok | Kondisi |
|---|---|
| Regresi baru | base lulus, target gagal |
| Diperbaiki | base gagal, target lulus |
| Masih gagal | gagal di keduanya |
| Lebih lambat | lulus di keduanya, durasi target > 1,5 x base **dan** selisih > 1000 ms |
| Test baru / Test hilang | hanya ada di target / hanya ada di base |

- **Dilewati (`skipped`) di salah satu sisi** tidak pernah menjadi regresi, perbaikan, masih gagal, atau lebih lambat. Test yang dilewati tidak membuktikan apa pun tentang benar atau rusaknya.
- **Lebih lambat memakai dua ambang sekaligus.** Rasio saja menandai test 5 ms yang jadi 9 ms; selisih saja menandai test 60 detik yang naik 1,01 detik. Batas dibuat tegas dan diuji tepat di batas (`2000 -> 3000 ms` bukan lebih lambat karena rasio persis 1,5; `100 -> 1100 ms` bukan lebih lambat karena selisih persis 1000 ms).
- Base dan target boleh dari branch berbeda bila dipilih manual.

### 3. Pembanding default

Untuk run **target** di branch B:

1. Bila target punya versi V dan ada versi lebih rendah dari V di B: **base** = run terakhir versi tepat di bawah V.
2. Selain itu, **base** = run tepat sebelum target di B (urut `created_at`, `id`).
3. Tidak ada keduanya: tidak ada pembanding (`base: null`).

Tanpa target eksplisit, target = run terakhir dari **versi tertinggi** di branch bila ada run berversi, selain itu run terakhir branch. Branch default = branch run terbaru project.

Aturan satu: membandingkan `1.0.1` dengan `1.0.0` (bukan dengan run `1.0.1` sebelumnya) menjawab pertanyaan rilis "apa yang berubah dari versi lalu", dan CI yang diulang tidak membuat perbandingan membandingkan versi dengan dirinya sendiri. Aturan dua menjaga project tanpa versi tetap berguna (run vs run sebelumnya). Akibatnya (diterima): run lama dari versi V bisa mendapat pembanding yang secara waktu lebih baru darinya (run terakhir V-1); UI menampilkan tanggal kedua run.

### 4. Mode ringkasan (`GET /compare?groups=none`)

Dashboard dan panel detail run hanya perlu angka dan kalimat, bukan baris per test. `groups=none` menjawab dengan bentuk respons yang sama (`base`, `target`, `summary`) dan **semua kelompok kosong**, dan melewati query pesan galat serta badge bug (hemat query dan ukuran respons). Yang tidak dihemat: kedua run tetap dimuat hasilnya untuk menghitung angka ringkasan, jadi biaya utamanya tetap ada. Tidak dapat digabung dengan `group` (400). Halaman perbandingan tetap memakai mode penuh: 200 item pertama per kelompok, lalu 100 per halaman dengan cursor yang terikat pada pasangan run (cursor basi setelah upload baru: 400, UI menawarkan muat ulang). Biayanya satu mode tambahan di API dan kontrak; manfaatnya kartu dashboard tidak membayar query pesan dan badge serta payload ribuan baris, dan latensinya dijaga gate k6 (skenario `read` memanggil keduanya). Ringkasan `groups=none` disimpan di cache LRU memori proses per (project, base, target) (Ruling F-b): hasil run tidak berubah setelah upload, sehingga hanya otorisasi dan pemilihan pasangan run yang berjalan ulang; badge bug tidak pernah di-cache.

### 5. Kalimat kesimpulan (disusun di klien, fungsi murni)

Kalimat dibuat dari angka ringkasan oleh `compareSentence` di web ([`apps/web/src/lib/compareSummary.ts`](../../apps/web/src/lib/compareSummary.ts)), bukan oleh API; API mengembalikan angka mentah. Label berupa versi dengan prefiks `v` hanya bila versi diawali angka (`v1.0.1`, tetapi `nightly` apa adanya), selain itu "run #… · tanggal"; label yang sama untuk base dan target dibedakan dengan id run.

- Ada regresi: "⚠ {target} punya **N regresi baru** dibanding {base}. Periksa sebelum rilis."
- Ada regresi dan perbaikan: "⚠ {target} punya **N regresi baru** dibanding {base}, sementara M test yang dulu gagal kini lulus. Periksa sebelum rilis."
- Tanpa regresi, ada perbaikan: "✓ Tidak ada regresi. M test yang dulu gagal kini lulus."
- Tanpa regresi dan perbaikan: "✓ Tidak ada regresi dibanding {base}."
- Tanpa pembanding: "Belum ada run pembanding untuk {target}."

**Kalimat yang diubah dari spec (Ruling T10-a).** Spec §4.5 menyambung bagian perbaikan dengan koma di ujung kalimat peringatan ("... Periksa sebelum rilis., M test kini lulus."), yang terbaca janggal dan memisahkan peringatan dari rinciannya. Dipilih kalimat satu napas di atas: peringatan, lalu kabar baik, lalu ajakan memeriksa. Maknanya sama dan setiap kasus tetap diuji di unit. Bila tidak ada regresi tetapi ada test yang masih gagal, nada tetap sukses (spec §7.2): "masih gagal" tampil di ringkasan, bukan di kalimat.

### 6. Markdown aman di klien

Deskripsi bug dan komentar adalah Markdown yang dirender menjadi elemen React oleh `react-markdown` + `remark-gfm` (komponen [`Markdown`](../../apps/web/src/components/Markdown.tsx), dimuat lazy karena berat). Aturannya:

- **HTML mentah tidak pernah dirender.** Tanpa `rehype-raw`; `<script>` atau `<img onerror>` tampil sebagai teks (Ruling T7-a: spec §3.5 mengikat, bukan `skipHtml`).
- **Tautan hanya `http:`, `https:`, `mailto:`.** URL dinilai oleh parser `URL` yang sama dengan browser (`safeMarkdownUrl`), sehingga `JaVaScRiPt:`, spasi atau tab di depan, dan entity tidak lolos; protokol lain dibuang dan teksnya tetap tampil. Semua tautan `target="_blank" rel="noopener noreferrer"`.
- **Gambar dirender sebagai tautan**, bukan `<img>`, karena `img-src 'self' data:` tidak boleh dilonggarkan; gambar di dalam tautan (lencana) hanya menyisakan teks agar tidak ada tautan bersarang.
- **Tanpa atribut `style`**; perataan kolom tabel diganti kelas, tipografi lewat kelas Tailwind. Blok kode dan tabel yang bisa digulir difokuskan dan diberi nama (aksesibilitas).
- **Catatan kaki (`[^1]`) dirender sebagai teks biasa** (Ruling T9-a): hasil bawaannya rusak di bawah aturan di atas (tautan `#...` dibuang, label berbahasa Inggris, id bentrok antar blok).
- Didukung: paragraf, heading, tebal/miring, daftar (termasuk tugas), kutipan, kode inline dan blok, tabel, garis.

Pembuktian: unit test sanitasi URL dan render, E2E dengan `<script>`, `<img onerror>`, tautan `javascript:`, gambar eksternal, dan HTML blok sebagai pemilik, viewer, dan anonim, di bawah gate CSP (nol pelanggaran), serta pratinjau saat mengedit.

## Alternatif yang dipertimbangkan

**Untuk urutan versi:**

1. **Selalu menurut waktu run:** sederhana, tetapi mengunggah ulang `1.0.0` setelah `1.0.1` (hotfix di branch lama) membuat `1.0.0` tampak yang terbaru. Dipakai hanya sebagai cadangan bila ada versi non-semver.
2. **Selalu semver, versi lain disembunyikan atau ditolak:** memaksa konvensi pada pengguna dan membuang data. Server hanya memvalidasi karakter (1 sampai 50 `A-Za-z0-9._+-`).
3. **Campuran (semver dulu, sisanya menurut waktu):** tidak punya urutan total yang masuk akal untuk pasangan semver dan non-semver; ditolak demi aturan semua-atau-tidak-sama-sekali.

**Untuk pembanding default:**

1. **Selalu run sebelumnya:** CI yang diulang membandingkan versi dengan dirinya sendiri, dan hotfix tidak pernah dibandingkan dengan rilis yang diperbaikinya. Tetap dipakai sebagai cadangan bila tidak ada versi.
2. **Selalu run terakhir di branch `main`:** mengabaikan versi dan membuat perbandingan antar-branch tidak sengaja. Pembanding lintas branch tetap tersedia, tetapi hanya bila dipilih manual.

**Untuk Markdown:**

1. **Mengizinkan HTML dengan sanitizer (DOMPurify, `rehype-sanitize`):** lebih ekspresif, tetapi permukaan serangan jauh lebih besar dan setiap kebocoran sanitizer langsung menjadi XSS pada project publik. Ditolak; kebutuhan bug tracker terpenuhi tanpa HTML.
2. **Menampilkan gambar eksternal:** butuh melonggarkan `img-src` (CSP) dan membuka pelacakan pembaca lewat URL gambar. Ditolak; gambar menjadi tautan.
3. **Teks polos tanpa Markdown:** aman, tetapi langkah reproduksi, kode, dan tabel menjadi sulit dibaca.

## Konsekuensi

**Positif**

- Kesimpulan perbandingan muncul otomatis di dashboard, detail run, halaman perbandingan, dan halaman versi tanpa memilih run; project publik `testpulse` menunjukkan rilis `0.3.0` dibanding versi sebelumnya.
- Semua aturan penentu (urutan, klasifikasi, pembanding, ambang lambat, kalimat) adalah fungsi murni dengan unit test di batas tepat, di dalam gate coverage domain.
- CSP tidak berubah; Markdown tidak menambah jalur eksekusi atau pemuatan sumber luar, dan itu dibuktikan E2E di bawah gate CSP.

**Negatif dan risiko**

- **Beralih ke mode waktu karena satu versi non-semver** mengubah urutan seluruh branch itu (mis. run `nightly` sekali membuat `1.2.0` dan `1.10.0` diurutkan menurut kapan dijalankan). Mitigasi: aturannya tertulis dan tampil konsisten di halaman versi; pembanding manual selalu bisa dipilih.
- **Pembanding "versi tepat di bawah" bisa mengabaikan run versi sendiri yang lebih lama** dan, untuk run lama, memilih base yang lebih baru darinya (Ruling T2-b). Diterima; tanggal ditampilkan.
- **Perbandingan dihitung per permintaan** di atas semua run branch (maks 200 run per project, retensi Tahap 2) dan semua hasil dua run; berat pada skala maksimum. Mitigasi: `statement_timeout` 5 detik (503 bila terlampaui), mode ringkasan, halaman 200/100 per kelompok, dan gate k6 pada project dengan 55 run berversi dan 120 bug.
- **Markdown tanpa HTML dan tanpa gambar** membatasi ekspresi (tidak ada `<details>`, lebar gambar, atau lampiran). Disengaja; lampiran sudah di luar lingkup Tahap 3 (link saja).
- **Kalimat kesimpulan hidup di klien**; klien lain (misalnya CLI) harus menyalin aturannya. Diterima: hanya web yang memakainya, dan API mengembalikan angka mentah.
