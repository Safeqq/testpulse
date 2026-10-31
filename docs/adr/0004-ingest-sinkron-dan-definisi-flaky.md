# ADR 0004: Ingest hasil test secara sinkron ke tabel ternormalisasi, dan definisi "flaky" gabungan

- **Status:** Diterima
- **Tanggal:** 2026-10-31

## Konteks

Tahap 2 menghadirkan fitur inti produk: CI mengunggah hasil test (JUnit XML) lewat token CI, lalu dashboard menampilkan riwayat run, tren, dan **test flaky**. Rinciannya ada di [spec Tahap 2](../superpowers/specs/2026-10-28-testpulse-tahap2-design.md). Dua keputusan arsitektur memengaruhi hampir semua bagian lain (skema data, API, strategi test, performa), jadi dicatat di sini.

Batasan yang berlaku:

- Production memakai layanan gratis: API di Render free tier (satu proses, tidur saat idle) dan Neon free. **Tidak ada worker atau antrean gratis** yang layak untuk pemrosesan di latar belakang.
- Upload datang dari CI dan harus memberi jawaban yang bisa dipakai langsung: pipeline ingin tahu apakah laporan diterima, berapa total test, dan di mana run-nya bisa dilihat.
- Data hasil test tumbuh cepat (satu run bisa ribuan test), tetapi pembacaan dominan berupa agregat: tren per branch, daftar flaky, riwayat satu test.
- Tidak ada format standar tunggal untuk "flaky"; framework berbeda melaporkan percobaan ulang dengan cara berbeda (atau tidak sama sekali).

## Keputusan

### 1. Ingest sinkron, ke tabel ternormalisasi

`POST /api/v1/projects/:slug/runs` mem-parse laporan **di dalam request**, menyimpan run dan semua hasilnya dalam **satu transaksi**, lalu menjawab `201` dengan total dan URL run. Tidak ada antrean, worker, atau status "sedang diproses".

- Data disimpan ternormalisasi: `runs` (ringkasan dan total), `test_cases` (identitas test per project: `suite` + `name`, unik), dan `test_results` (satu baris per test per run). `test_cases` diisi dengan upsert (`ON CONFLICT DO NOTHING` lalu select) dalam transaksi yang sama, sehingga upload paralel untuk project yang sama tidak menghasilkan duplikat atau 500.
- Batas tegas menjaga request tetap murah: body maksimal **5 MB** (diterapkan per route sebelum parsing), maksimal **20.000 testcase**, nama dipotong 500 karakter, pesan dipotong 4 KB (tanpa memecah karakter), **retensi 200 run** per project (run lebih lama dihapus dalam transaksi yang sama), dan **60 upload per jam per token**.
- Parser menolak `<!DOCTYPE` (XXE dan entity expansion) dan tidak pernah me-resolve entity eksternal. Endpoint upload hanya menerima token CI (Bearer); cookie sesi tidak berlaku di sana, dan token tidak berlaku di endpoint lain.
- Kinerja dijaga sebagai gate, bukan harapan: job CI `perf` (k6) mensyaratkan p95 upload 500 test < 1500 ms dan p95 baca < 300 ms terhadap stack Docker.

### 2. Definisi flaky gabungan, dihitung dari 20 run terakhir per branch

Sebuah test **flaky** bila skornya > 0, dengan skor untuk satu test di satu branch:

- Ambil hasilnya dari **20 run terakhir branch itu yang memuat test tersebut**, urut waktu; abaikan `skipped`. `n` = jumlah hasil tersisa.
- `flip` = jumlah pasangan hasil berurutan yang statusnya berbeda (lulus dan gagal bergantian). `flakyRuns` = jumlah hasil yang lulus **setelah percobaan ulang di dalam run yang sama** (`flaky_in_run`).
- `skor = n = 0 ? 0 : min(100, round(100 x (flip + flakyRuns) / n))`.

Sinyal "lulus setelah retry dalam satu run" datang dari laporan itu sendiri: kemunculan ganda test yang sama (lulus dan gagal) digabung menjadi `passed` dengan `flaky_in_run = true`, dan konvensi Surefire (`flakyFailure`, `rerunFailure`) diakui. Playwright diatur menulisnya lewat `includeRetries` di JUnit reporter.

Test yang **gagal konsisten** (G G G G) bernilai 0: itu rusak, bukan flaky, dan sudah terlihat sebagai run gagal.

Rumus diimplementasikan **dua kali** dengan sengaja: sebagai fungsi murni `flakyScore(results)` (untuk unit test dan dokumentasi) dan sebagai query SQL (untuk daftar flaky, agar tidak menarik ribuan baris ke aplikasi). Test integrasi dengan Postgres asli membandingkan keduanya pada pola hasil acak-terkendali dan menuntut skor identik.

## Alternatif yang dipertimbangkan

**Untuk ingest:**

1. **Antrean + worker (ingest asinkron):** upload menjawab `202`, worker mem-parse di latar belakang. Memisahkan beban parsing dari request dan tahan terhadap laporan sangat besar, tetapi butuh komponen tambahan (Redis/antrean atau tabel job plus worker), proses kedua di Render (tidak ada yang gratis), status "diproses" di UI dan API, serta penanganan kegagalan di tengah jalan. Berlebihan untuk batas 5 MB yang diparse dalam ratusan milidetik.
2. **Simpan XML mentah (atau JSONB) per run dan hitung saat dibaca:** upload paling sederhana, tetapi setiap pembacaan agregat (tren, flaky, riwayat satu test) harus memindai dan mem-parse dokumen besar. Tidak ada indeks yang bisa membantu, dan riwayat satu test menjadi mahal.
3. **Ternormalisasi tetapi tanpa `test_cases` (nama test disalin di tiap hasil):** lebih sedikit tabel, tetapi riwayat satu test dan identitas lintas run bergantung pada perbandingan teks, ukuran data membengkak, dan tidak ada kunci stabil untuk URL riwayat test.

**Untuk definisi flaky:**

1. **Hanya lulus-setelah-retry dalam satu run:** langsung terdeteksi dan tanpa ambiguitas, tetapi buta untuk framework tanpa retry dan untuk test yang berganti hasil antar-run.
2. **Hanya berganti hasil lintas run:** bekerja untuk semua framework, tetapi baru terdeteksi setelah beberapa run, dan tidak membedakan perubahan kode yang sah (rusak lalu diperbaiki) dari ketidakstabilan. Tanpa sinyal retry, satu perbaikan terlihat sama dengan satu kedipan.
3. **Gabungan (dipilih):** sinyal retry memberi deteksi langsung, riwayat lintas run menangkap sisanya. Biayanya: rumus lebih kompleks dan diimplementasikan dua kali.

## Konsekuensi

**Positif**

- Sederhana dioperasikan: satu proses, satu transaksi, tidak ada status antara. Pipeline CI mendapat jawaban lengkap (total dan URL run) dan galat langsung (`401`, `413`, `422`, `429`).
- Pembacaan agregat cepat dan terindeks (`runs` per branch dan waktu, `test_results` per test); daftar flaky dihitung di database.
- Mudah diuji: seluruh perilaku ingest dapat dibuktikan lewat `fastify.inject` dengan Postgres asli, termasuk upload paralel dan retensi serentak.
- Definisi flaky transparan dan tertulis: skor yang tampil di dashboard bisa dihitung ulang dengan tangan dari 20 hasil terakhir.

**Negatif dan risiko**

- **Upload memblokir request.** Laporan besar (mendekati 5 MB atau 20.000 testcase) membuat request lebih lama dan memegang koneksi database selama transaksi. Pada Render free tier, upload pertama setelah idle juga menanggung cold start. Mitigasi: batas ukuran dan jumlah testcase, insert dipecah di bawah batas parameter Postgres, reporter CLI memeriksa ukuran sebelum mengirim, dan gate k6 menjaga p95. Bila beban membesar, antrean (alternatif 1) tetap bisa ditambahkan di balik kontrak `201` yang sama dengan mengubahnya menjadi `202`.
- **Retensi 200 run** berarti riwayat lama hilang dan skor flaky hanya melihat 20 run terakhir; ini disengaja untuk membatasi pertumbuhan data di Neon free, tetapi bukan arsip jangka panjang.
- **Dua implementasi rumus** bisa menyimpang. Mitigasi: test paritas di integration test; perubahan rumus harus mengubah keduanya sekaligus.
- **Identitas test = (`suite`, `name`) per project.** Mengganti nama test atau suite dianggap test baru (riwayat lama terputus). Test dengan pasangan sama di satu laporan digabung sebagai percobaan ulang, jadi laporan gabungan dari beberapa browser harus memberi nama yang berbeda per browser (CI memakai `includeProjectInTestName` di JUnit Playwright untuk itu).
- **Skor bukan kebenaran mutlak:** satu kegagalan sungguhan yang diperbaiki berikutnya tampil sebagai satu `flip` dan memberi skor kecil sementara. Ini bagian dari kompromi definisi gabungan; hasil lulus berikutnya mengencerkannya dalam 20 run.
