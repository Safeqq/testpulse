# ADR 0006: Run manual dengan snapshot, langkah dalam JSONB, saran status, versi manual-saja, dan mutation testing

- **Status:** Diterima
- **Tanggal:** 2026-11-14

## Konteks

Tahap 4 menambahkan **test case manual** (suite, case dengan langkah terstruktur, tautan ke automated test) dan **run manual** (tester mengeksekusi case satu per satu dengan hasil per langkah, lalu melaporkan bug dari case yang gagal), dan menampilkannya berdampingan dengan hasil CI di halaman Versi dan dashboard. Tahap ini juga menambahkan lapisan QA baru untuk TestPulse sendiri: **mutation testing** pada kode domain. Rinciannya ada di [spec Tahap 4](../superpowers/specs/2026-11-08-testpulse-tahap4-design.md). Lima keputusan memengaruhi hampir semua bagian lain (skema, API, tampilan, strategi test), jadi dicatat di sini.

Batasan yang berlaku:

- Case diedit, dipindah suite, diarsipkan, dan dihapus selama hidup project, sedangkan run yang sudah dijalankan adalah **catatan pengujian**: orang yang membaca "TR-3 lulus" bertahun-tahun kemudian harus melihat langkah yang benar-benar dijalankan.
- Langkah selalu dibaca dan ditulis bersama case-nya (maks 50 langkah per case, maks 500 case per run); tidak pernah dicari, diurutkan, atau digabung per langkah di SQL.
- Seorang tester bisa mengisi hasil, lalu status yang mereka pilih menjadi bahan keputusan rilis. Hasil yang keliru tertulis diam-diam lebih buruk daripada hasil yang belum diisi.
- Versi pada run CI dan run manual diisi orang atau pipeline yang berbeda, jadi bentuknya bisa berbeda (`0.4.0` dan `v0.4.0`) atau bukan semver sama sekali (`build-7`).
- Production memakai CSP ketat dan Markdown aman ([ADR 0003](./0003-tailwind-shadcn.md), [ADR 0005](./0005-perbandingan-versi-dan-markdown-aman.md)); tidak ada yang boleh dilonggarkan.
- Mutation testing butuh banyak proses test; CI utama sudah memakai belasan menit untuk E2E tiga browser, ZAP, visual, dan k6.

## Keputusan

### 1. Run menyalin case (snapshot), bukan merujuknya

Saat run dibuat, setiap case terpilih disalin menjadi **run case**: nomor case, judul, nama dan posisi suite, prasyarat, langkah, dan prioritas. Run case tidak pernah ikut berubah ketika case diedit, dipindah, diarsipkan, atau dihapus. `manual_run_cases.case_id` hanya tautan navigasi dan menjadi `NULL` (`ON DELETE SET NULL`) bila case dihapus; halaman eksekusi lalu menampilkan catatan bahwa itu salinan.

- Seleksi = semua case **aktif** di suite terpilih ∪ case satuan, tanpa duplikat, diurut posisi suite lalu nomor case; hasilnya harus 1 sampai 500 case.
- Run dan semua run case dibuat dalam satu transaksi, dengan nomor `TR-<n>` dari `UPDATE projects SET manual_run_seq = manual_run_seq + 1 ... RETURNING` (kunci baris project, pola yang sama dengan nomor bug). Nomor tidak dipakai ulang.

### 2. Langkah dan hasil langkah disimpan sebagai JSONB

Case (`steps`), run case (`steps` salinan dan `step_results`) menyimpan langkah sebagai kolom JSONB; suite, case, run, dan run case tetap tabel relasional dengan kunci asing, `CHECK` enum, dan indeks.

- `step_results` selalu sepanjang `steps` snapshot (panjang lain ditolak `400 fields.stepResults`), dengan elemen `{ status: passed | failed | blocked | skipped | null, note }`.
- Validasi bentuk dilakukan di lapisan API dengan schema Zod bersama (`packages/shared`), bukan di database; batas (1 sampai 50 langkah, panjang teks) diuji tepat di batas.

### 3. Saran status dihitung, tidak pernah disimpan otomatis

`suggestStatus` (fungsi murni di `packages/shared/src/manual-logic.ts`, dipakai web dan API) menghitung saran dari hasil per langkah: ada langkah gagal → `failed`; ada yang diblokir → `blocked`; semua terisi, minimal satu lulus, sisanya lulus atau dilewati → `passed`; semua dilewati → `skipped`; selain itu tidak ada saran. UI menampilkannya sebagai tombol "Pakai saran"; **status run case selalu dipilih tester secara eksplisit** lewat `PATCH`.

### 4. Versi manual dicocokkan berpasangan, dan versi manual-saja tetap tampil

Halaman Versi (`GET /versions`) memberi tiap baris versi automated `manual: ManualRunRef | null`, dan menampilkan versi yang hanya punya run manual dengan `run: null`.

- **Pencocokan berpasangan (Ruling R3).** Dua versi dianggap sama bila **keduanya** semver dan sama menurut semver (prefiks `v` dan `+build` diabaikan, jadi `v0.4.0` manual dan `0.4.0` CI satu baris); selain itu string harus identik. Bukan sebuah keputusan per branch: satu versi `nightly` di CI tidak boleh membuat `v0.4.0` manual gagal menempel ke `0.4.0`.
- **"Run manual terbaru" = nomor TR tertinggi (Ruling R5).** Nomor dialokasikan di bawah kunci baris project sehingga mengikuti urutan pembuatan, sedangkan `created_at` bisa terbalik bila dua run dibuat paralel. Aturan yang sama dipakai untuk daftar run, `latestRun` di `GET /manual/summary`, dan `manual` di baris versi.
- **Penempatan versi manual-saja.** Urutan versi automated per branch tetap persis aturan Tahap 3 ([ADR 0005](./0005-perbandingan-versi-dan-markdown-aman.md)). Bila semua versi (automated dan manual-saja) semver, versi manual-saja disisipkan di posisi semver-nya; selain itu ditaruh di bawah semua versi automated, menurut waktu run manual terbarunya. Run manual tidak punya branch, jadi versi manual-saja tampil di setiap pilihan branch. `passRateDelta` hanya dihitung antarversi automated, dan "Bandingkan dengan versi sebelumnya" melewati baris manual-saja.

### 5. Mutation testing dengan StrykerJS pada kode domain, di workflow terjadwal

Kode yang berisi aturan (bukan SQL, bukan UI) dimutasi: `apps/api/src/modules/**/domain/**/*.ts` (parser JUnit, flaky, transisi bug, versi, perbandingan, pemilihan pembanding, dan domain manual) serta `packages/shared/src/{slug,roles,manual-logic}.ts`. Setiap paket punya `stryker.config.mjs` sendiri, dengan `@stryker-mutator/typescript-checker` untuk membuang mutan yang tidak lolos kompilasi.

- **Gate:** `thresholds: { high: 90, low: 80, break: 80 }`; skor di bawah 80 membuat `pnpm test:mutation` keluar dengan kode bukan nol.
- **Runner (Ruling R11).** `packages/shared` memakai runner Vitest (`perTest` coverage). `apps/api` memakai **runner `command`** (`pnpm exec vitest run --project unit`): runner Vitest menerima Vitest 5 tetapi di `apps/api` tidak pernah mengaktifkan mutan statis (tabel transisi, himpunan izin, opsi parser, regex), sehingga 54 mutan dilaporkan "selamat" padahal menjalankan sandbox yang sama dengan `__STRYKER_ACTIVE_MUTANT__=1` memberi 8 test gagal. Ini jalur cadangan yang sudah diperbolehkan spec. Dengan `timeoutMS: 30000` dan `concurrency: 4`, supaya beban paralel tidak membuat semua mutan "timeout" (dihitung terbunuh, skor palsu 100%).
- **Jadwal dan publikasi.** Workflow `mutation.yml` berjalan setiap Senin 02.00 UTC dan lewat `workflow_dispatch`, bukan di setiap push: satu run penuh `apps/api` sekitar 22 menit. Hasilnya artifact `mutation-report` (HTML dan JSON, ringkasan skor di job summary); job Pages di `ci.yml` mengambil artifact run sukses terakhir dan menaruhnya di `/mutation/` di samping laporan Allure ([safeqq.github.io/testpulse/mutation](https://safeqq.github.io/testpulse/mutation/)), atau halaman keterangan bila belum ada.
- **Incremental (Ruling R12).** Mode `incremental` dengan file yang disimpan lewat `actions/cache`. Runner `command` hanya melihat satu "test", jadi ia tidak bisa mendeteksi test yang berubah atau dihapus; kunci cache memuat hash semua berkas test dan konfigurasi Vitest, sehingga perubahan test memulai run penuh.
- **Mutan yang selamat.** Setiap mutan dianalisis: yang menunjukkan test lemah diperkuat; yang benar-benar setara dengan kode asli diberi `// Stryker disable next-line <mutator>: <alasan>`. Daftar lengkap (25 di api, 4 di shared, tiap alasannya) ada di [TEST_STRATEGY.md](../TEST_STRATEGY.md#mutation-testing-tahap-4).

### 6. Keputusan kecil lain

- **Riwayat hasil di detail case (Ruling R6)** memuat 10 run case terakhir case itu **termasuk yang masih `untested`**, terbaru dulu (nomor TR tertinggi). Ini memperlihatkan run terbuka yang memuat case tersebut; `executedAt` pada DTO memang nullable.
- **Kartu "Test manual" tampil walau project belum punya run CI (Ruling R10).** Spec menyembunyikannya hanya bila project belum punya case; tim yang baru memulai dengan test manual tetap melihat kartu itu di ringkasan, di bawah panduan setup CI.
- **Token CI bukan kredensial di endpoint manual**: diperlakukan sebagai anonim, sama dengan endpoint bug dan versi. Izin baru `manual:write` (tester, admin) dan `manual:delete` (admin).

## Alternatif yang ditolak

**Untuk run:**

1. **Run menyimpan rujukan ke case (tanpa salinan):** hemat ruang, tetapi mengedit langkah mengubah hasil yang sudah tercatat, dan menghapus case menghilangkan riwayat run. Bagi catatan pengujian itu cacat, bukan konsekuensi.
2. **Versi case (setiap edit membuat versi baru, run merujuk versi itu):** sama benarnya dengan snapshot tetapi menambah model dan UI riwayat versi case, yang sengaja di luar lingkup Tahap 4.

**Untuk langkah:**

1. **Tabel `case_steps` dan `run_case_step_results`:** relasional murni, tetapi satu run 500 case x 50 langkah berarti puluhan ribu baris yang selalu dibaca dan ditulis bersama induknya, dan setiap penyimpanan harus menyinkronkan urutan, tanpa kueri yang mendapat untung dari baris terpisah.

**Untuk saran status:**

1. **Status run case diturunkan otomatis dari hasil langkah:** membuat status tidak bisa berbeda dari langkah, tetapi tester sering sengaja memilih lain (mis. langkah opsional gagal tetapi case dinilai lulus bersyarat) dan hasil yang tertulis tanpa disadari lebih berbahaya daripada yang belum diisi.

**Untuk mutation testing:**

1. **Setiap push/PR:** umpan balik tercepat, tetapi menambah puluhan menit ke jalur CI utama; skor domain berubah lambat, jadi jadwal mingguan sudah cukup menangkap regresi test.
2. **Mutasi seluruh kode (web, reporter, rute, repository):** banyak mutan yang hanya dapat dibunuh oleh E2E atau database asli, sehingga lambat dan berisik. Aturan murni di `domain/` adalah tempat unit test memang bertanggung jawab. Web dan reporter di luar lingkup.
3. **Menurunkan gate atau mengecualikan mutan yang tidak enak:** ditolak; pengecualian hanya untuk mutan yang setara dengan kode asli, tiap-tiapnya dengan alasan tertulis.

## Konsekuensi

**Positif**

- Run adalah catatan yang tahan waktu: edit, arsip, dan hapus case tidak mengubah apa pun yang sudah dieksekusi, dan itu diuji di integration dan E2E.
- Halaman Versi menjawab "apakah versi ini siap rilis?" dari dua sisi dengan satu aturan pencocokan yang tertulis dan diuji untuk semua kasus (`v` vs polos, non-semver, manual-saja).
- Semua aturan penentu (seleksi run, snapshot, saran status, ringkasan, pembulatan cakupan, pencocokan versi) adalah fungsi murni di dalam gate coverage domain **dan** gate mutation.
- Mutation score domain 100% di kedua paket dengan laporan publik; skor awal 80,31% (api) dan 90,63% (shared) menunjukkan gate itu menangkap test yang lemah (mis. pesan galat yang tidak dicek, batas "lebih lambat" tepat, parser JUnit, `scrypt`).

**Negatif dan risiko**

- **Salinan memakai ruang:** satu run 500 case x 50 langkah menyalin sampai puluhan ribu langkah. Batas 500 case per run dan 50 langkah per case menjaganya kecil untuk free tier; tidak ada pembersihan run lama.
- **Run lama menampilkan langkah lama walau case sudah diperbaiki.** Disengaja; halaman eksekusi menandainya sebagai salinan bila case aslinya terhapus.
- **JSONB tidak dijaga database:** bentuk langkah hanya dijamin schema Zod dan test. Data lewat jalur lain (SQL langsung) bisa menyimpang; tidak ada jalur seperti itu di aplikasi.
- **Status yang harus dipilih tester** berarti run case dengan semua langkah lulus bisa tetap `untested` bila tester lupa menyimpan; progres run menghitungnya belum dites, dan "Simpan & lanjut" membuat memilih status menjadi langkah satu klik.
- **Runner `command` lambat dan kasar:** satu proses Vitest per mutan (sekitar 22 menit untuk api), skor dihitung dari semua test tanpa cakupan per test, dan mutan di satu berkas tidak memicu ulang mutan berkas lain yang bergantung padanya di mode incremental. Mutan yang kena timeout dihitung terbunuh; hasil run menampilkan jumlahnya (4, semuanya sah: loop tak berujung `i -= 1` dan callback `scrypt` yang tidak pernah selesai), dan runner CI yang jauh lebih lambat bisa menaikkan angka itu.
- **Pengecualian mutan sebagian melindungi saudara yang terbunuh:** Stryker tidak bisa menonaktifkan satu pengganti pada ekspresi yang sama, jadi 6 dari 29 mutan yang dikecualikan sebenarnya terbunuh. Tiap komentar menyebut saudaranya, dan daftar di TEST_STRATEGY memisahkan keduanya.
- **Laporan mutation bisa basi sampai seminggu** (jadwal Senin); Pages menampilkan laporan run sukses terakhir, bukan commit yang sedang dibuka.
