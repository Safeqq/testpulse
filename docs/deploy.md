# Deploy production TestPulse

Panduan berurutan untuk menayangkan TestPulse di internet memakai layanan gratis:

| Bagian | Layanan | Peran |
| --- | --- | --- |
| Database | Neon (Postgres) | Menyimpan data. Migrasi berjalan otomatis saat API menyala. |
| API | Render (Docker, free web service) | Menjalankan `apps/api`. Tidur setelah ±15 menit tanpa trafik; bangun lagi dalam ±30-60 detik. |
| Web | Cloudflare Pages | Menyajikan `apps/web` dan **Pages Function** yang meneruskan `/api/*` ke Render, sehingga browser hanya melihat satu origin (cookie sesi aman dan first-party). |
| Otomatisasi | GitHub Actions (`deploy.yml`) | Setelah CI hijau di `main`: picu deploy API, tunggu sampai API **revisi baru** melayani trafik, deploy web, verifikasi lewat Pages Function, jalankan smoke test. |

```
Browser -> https://testpulse.pages.dev  (Cloudflare Pages)
             |- /            -> file statis (index.html, assets)
             |- /api/*       -> Pages Function -> https://testpulse-api.onrender.com/api/*  (Render) -> Neon
```

Jangan pernah menempelkan password, token, atau connection string ke file di repo, ke issue, atau ke chat. Semua nilai rahasia hanya dimasukkan ke dashboard layanan terkait atau ke GitHub Secrets.

Nama yang dipakai di panduan ini (boleh diganti, tetapi catat penggantinya):

- Project Neon: `testpulse`. Nama database mengikuti bawaan Neon (`neondb`, seperti di connection string Langkah 1); tidak perlu diganti.
- Project Cloudflare Pages: `testpulse` (jangan ganti: nama ini tertulis di `deploy.yml`)
- Service Render: `testpulse-api` (dari `render.yaml`)

Urutan di bawah sengaja membuat project Pages lebih dulu supaya URL web sudah diketahui ketika mengisi `APP_ORIGIN` di Render.

---

## Langkah 0. Prasyarat

- Repo sudah ada di GitHub dan branch `main` sudah berisi `render.yaml`, `apps/web/functions`, dan `.github/workflows/deploy.yml`.
- Akun gratis di: [Neon](https://neon.tech), [Render](https://render.com), [Cloudflare](https://dash.cloudflare.com), dan GitHub. Daftar sendiri di situs masing-masing.
- Node.js 24 di komputer Anda (untuk menjalankan `npx wrangler` pada Langkah 2).

Cek: `node -v` menampilkan `v24.x`.

---

## Langkah 1. Neon: buat database

1. Masuk ke Neon, klik **New Project**.
2. Isi **Name** `testpulse`, **Postgres version** 17, dan **Region** `AWS Asia Pacific 1 (Singapore)` (dekat dengan region Render di `render.yaml`, yaitu `singapore`). Klik **Create**.
3. Di halaman **Connection Details** (tombol **Connect** pada dashboard project):
   - **Matikan** opsi **Connection pooling** (host tidak boleh berakhiran `-pooler`). Migrasi Drizzle memakai transaksi; koneksi langsung lebih aman.
   - Salin **connection string**. Bentuknya:
     `postgresql://NAMA_USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
4. Rapikan string tersebut di editor teks (jangan dibagikan ke siapa pun):
   - Hapus bagian `&channel_binding=require` (driver Node `pg` tidak memakainya).
   - Ganti `sslmode=require` menjadi `sslmode=verify-full`.
   - Hasil akhir: `postgresql://NAMA_USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full`

Catatan SSL: Neon mewajibkan TLS. Driver `pg` yang dipakai API otomatis mengaktifkan TLS dan memverifikasi sertifikat ketika URL memuat `sslmode=require` atau `verify-full`; tidak ada kode tambahan (dikunci oleh test `apps/api/src/db/client.test.ts`). `require` bekerja sama persis, tetapi `pg` menulis peringatan ke log pada setiap koneksi, jadi `verify-full` lebih bersih.

**Cek:** di dashboard Neon buka **SQL Editor**, jalankan `select 1;` dan pastikan hasilnya `1`. Jika `psql` terpasang: `psql "CONNECTION_STRING_ANDA" -c "select 1"`.

Simpan connection string tadi untuk Langkah 3.

---

## Langkah 2. Cloudflare Pages: buat project `testpulse`

Project harus ada sebelum workflow bisa men-deploy ke dalamnya.

1. Di komputer Anda jalankan (akan membuka browser untuk login ke Cloudflare):
   ```
   npx wrangler@4 login
   npx wrangler@4 pages project create testpulse --production-branch main
   ```
   Alternatif lewat dashboard: **Workers & Pages** -> **Create**. Di halaman "Create an app", **jangan** pilih opsi di kotak tengah (opsi itu membuat *Worker*, bukan *Pages project*); klik link kecil **Continue to Pages** di bawahnya -> pilih upload langsung (**Upload assets** / Direct Upload, bukan "Connect to Git") -> nama `testpulse` -> unggah file **.zip** berisi satu file `index.html` apa saja -> **Deploy**. Pastikan **production branch** adalah `main`.
2. Catat URL project. Biasanya `https://testpulse.pages.dev`. Jika nama sudah dipakai orang lain, Cloudflare menambahkan akhiran acak; pakai URL yang tertulis di dashboard.

**Cek:** **Workers & Pages** menampilkan project `testpulse`. (Membuka URL-nya sekarang boleh masih menampilkan 404; web baru dipasang pada Langkah 8.)

---

## Langkah 3. Render: buat service API dari `render.yaml`

1. Buat dulu `PROXY_SECRET`: string acak panjang yang akan sama persis di Render (langkah ini) dan di Cloudflare Pages (Langkah 4). Cara membuatnya:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   (berjalan di PowerShell, CMD, maupun Git Bash; `openssl rand -hex 32` juga bisa jika `openssl` tersedia, atau buat 64 karakter acak dengan password manager). Simpan sementara di tempat aman; jangan dikirim lewat chat atau dimasukkan ke repo. Fungsinya dijelaskan di Langkah 10.
2. Masuk ke Render, **New** -> **Blueprint**. Hubungkan akun GitHub dan beri akses ke repo `testpulse`.
   - **Kartu pembayaran:** Render dapat meminta kartu (kredit/debit/virtual) untuk verifikasi anti-penipuan, juga untuk plan **Free** dan juga lewat **New -> Web Service** manual. Masukkan sendiri di dashboard Render; pastikan instance type tetap **Free**.
   - **Alternatif tanpa Blueprint:** **New** -> **Web Service** -> repo `testpulse`, branch `main`, runtime **Docker**, Dockerfile path `./apps/api/Dockerfile`, build context `.`, region **Singapore**, instance **Free**, health check path `/api/health`, auto-deploy **Off**, lalu isi env `DATABASE_URL`, `APP_ORIGIN`, `PROXY_SECRET`, dan `COOKIE_SECURE=true`. Hasilnya setara dengan `render.yaml`.
3. Pilih repo dan branch `main`. Render membaca `render.yaml` dan menampilkan service `testpulse-api` (plan **Free**, runtime Docker).
4. Render meminta nilai variabel yang bertanda `sync: false`:
   - `DATABASE_URL`: connection string Neon dari Langkah 1.
   - `APP_ORIGIN`: URL web dari Langkah 2, mis. `https://testpulse.pages.dev`. Nilai ini harus **persis** sama dengan origin yang dilihat browser, karena API menolak (403) request ubah-data dari origin lain. API memvalidasinya saat menyala: satu garis miring di akhir dibuang otomatis, tetapi path (`/app`), query, hash, atau skema selain `http(s)` membuat API gagal start dengan pesan jelas di Logs.
   - `PROXY_SECRET`: nilai acak dari langkah 1.
5. Klik **Apply** / **Deploy Blueprint**. Build pertama memakan beberapa menit.

Variabel lain sudah terisi dari `render.yaml`: `COOKIE_SECURE=true`, dan `RATE_LIMIT_MAX` sengaja tidak diisi (default 10 percobaan login/daftar per menit per IP).

**Cek:**
- Tab **Logs** berakhir dengan baris seperti `Server listening at http://0.0.0.0:10000` dan status service **Live**. Port di baris itu diisi Render lewat variabel `PORT` (biasanya `10000`; default `3000` hanya berlaku di lokal), jadi angkanya tidak harus `3000`.
- Salin URL service (mis. `https://testpulse-api.onrender.com`; bisa berbeda jika nama sudah terpakai). URL ini juga dipakai sebagai `API_ORIGIN` (Langkah 4) dan secret `RENDER_API_URL` (Langkah 7). Lalu:
  ```
  curl https://testpulse-api.onrender.com/api/health
  ```
  Hasil yang benar: `{"status":"ok","commit":"<SHA commit yang sedang berjalan>"}`. Field `commit` (dari `RENDER_GIT_COMMIT`) dipakai workflow deploy untuk memastikan revisi baru benar-benar aktif. Request pertama setelah service tidur bisa lambat (±1 menit). Jika `{"status":"error"}` (503), `DATABASE_URL` salah: perbaiki di **Environment** lalu deploy ulang.

---

## Langkah 4. Cloudflare Pages: isi `API_ORIGIN` dan `PROXY_SECRET`

1. **Workers & Pages** -> project `testpulse` -> **Settings** -> **Variables and Secrets** -> **Add** (lingkungan **Production**).
2. Tipe **Text**, **Variable name** `API_ORIGIN`, **Value** URL Render dari Langkah 3 (mis. `https://testpulse-api.onrender.com`, tanpa garis miring di akhir dan tanpa `/api`). Simpan.
3. **Add** lagi: tipe **Secret** (terenkripsi), **Variable name** `PROXY_SECRET`, **Value** string yang **persis sama** dengan `PROXY_SECRET` di Render. Simpan.

Variabel baru berlaku mulai deploy berikutnya (Langkah 8). Jika `API_ORIGIN` kosong, Pages Function membalas `502` dengan pesan "Layanan API belum dikonfigurasi".

---

## Langkah 5. Render: buat Deploy Hook

1. Service `testpulse-api` -> **Settings** -> bagian **Deploy Hook** -> salin URL-nya. Bentuk: `https://api.render.com/deploy/srv-xxxx?key=yyyy`.
2. URL ini bersifat rahasia (siapa pun yang memilikinya bisa memicu deploy). Simpan untuk Langkah 7.

`deploy.yml` menambahkan `&ref=<SHA commit>` sehingga Render membangun commit yang persis lulus CI. Auto-deploy sengaja dimatikan di `render.yaml` supaya satu-satunya jalur deploy adalah workflow ini.

---

## Langkah 6. Cloudflare: buat API token dan catat Account ID

1. Buka [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) -> **Create Token** -> **Create Custom Token**.
2. **Token name** `testpulse-github-deploy`. **Permissions**: `Account` -> `Cloudflare Pages` -> `Edit`. **Account Resources**: `Include` -> akun Anda. Jangan tambahkan izin lain.
3. **Continue to summary** -> **Create Token** -> salin token. Token hanya ditampilkan sekali.
4. **Account ID**: **Workers & Pages** (halaman utama) -> kolom kanan **Account ID** -> salin.

---

## Langkah 7. GitHub: isi Secrets

Repo -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**. Buat kedelapan secret ini (nama harus persis):

| Nama | Isi |
| --- | --- |
| `RENDER_DEPLOY_HOOK_URL` | URL Deploy Hook (Langkah 5) |
| `RENDER_API_URL` | URL service Render dari Langkah 3, tanpa garis miring di akhir dan tanpa `/api`, mis. `https://testpulse-api.onrender.com`. Dipakai workflow untuk menunggu revisi API baru langsung ke Render, sebelum web di-deploy |
| `CLOUDFLARE_API_TOKEN` | Token Pages:Edit (Langkah 6) |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID (Langkah 6) |
| `PRODUCTION_URL` | URL web, tanpa garis miring di akhir, mis. `https://testpulse.pages.dev` |
| `SMOKE_EMAIL` | Email khusus akun smoke, mis. `smoke@contoh-anda.com` (tidak harus email sungguhan, tetapi pilih yang tidak dipakai orang lain dan **berbeda dari email akun pribadi Anda**, karena satu email hanya untuk satu akun; trik Gmail `nama+smoke@gmail.com` juga bisa) |
| `SMOKE_PASSWORD` | Password kuat untuk akun smoke (8-128 karakter; buat acak, jangan pakai ulang password lain) |
| `SMOKE_PUBLIC_SLUG` | `testpulse` |

Alternatif dengan GitHub CLI (nilai diketik di prompt, tidak masuk riwayat shell): `gh secret set NAMA_SECRET`.

**Cek:** halaman Secrets menampilkan delapan nama di atas.

Akun smoke belum ada di production; akan dibuat pada Langkah 9 memakai email dan password yang sama dengan secret di atas.

---

## Langkah 8. Deploy pertama

Rilis pertama tidak bisa hijau penuh karena akun smoke belum ada. Itu normal; tujuan putaran ini adalah memasang web dan memastikan API sehat.

1. Repo -> **Actions** -> workflow **Deploy** -> **Run workflow** (branch `main`). (Setelah ini, workflow berjalan otomatis setiap CI di `main` hijau.)
2. Pantau. Urutan langkahnya: memicu Render, build web, **Wait for the new API revision** (menunggu `/api/health` di URL Render melaporkan commit yang sedang di-deploy; Render tetap melayani instance lama sampai yang baru sehat, jadi 200 saja tidak cukup), deploy ke Cloudflare Pages, **Verify production through the Pages Function** (health lewat `PRODUCTION_URL`, commit harus sama), lalu smoke test. Dengan GitHub CLI: `gh run watch`.

Hasil yang diharapkan pada putaran ini: semua langkah hijau sampai **Verify production through the Pages Function**; smoke test **health** dan **halaman masuk** lulus, sedangkan **akun smoke berhasil masuk** dan **project publik terbuka** gagal (akun dan project belum ada).

**Cek manual:**
```
curl https://testpulse.pages.dev/api/health          # {"status":"ok","commit":"<SHA>"} lewat Pages Function
curl -I https://testpulse.pages.dev/                 # memuat 4 header: Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
```
Buka `https://testpulse.pages.dev` di browser: halaman masuk TestPulse tampil.

Jika **Wait for the new API revision** habis waktu (10 menit): cek Logs dan status deploy di Render (build gagal? service masih menjalankan commit lama?), `RENDER_API_URL` (Langkah 7), dan `DATABASE_URL` (Langkah 3). Jika **Verify production through the Pages Function** yang habis waktu: cek `API_ORIGIN` dan `PROXY_SECRET` di Pages (Langkah 4). Lihat tabel masalah umum di bawah.

---

## Langkah 9. Daftarkan akun smoke dan buat project publik

Dilakukan satu kali, lewat web production (bukan lewat script). Pemilik project showcase dan akun smoke sengaja dua akun berbeda: kredensial akun smoke tersimpan di GitHub Secrets, jadi jangan sampai ia memiliki (admin) project yang tampil di portfolio.

1. Pakai akun **pribadi** Anda (daftar di `https://testpulse.pages.dev/register` jika belum punya). Ini bukan akun smoke.
2. Dengan akun pribadi itu buat project baru bernama `TestPulse`. Slug otomatis menjadi `testpulse` (harus sama dengan `SMOKE_PUBLIC_SLUG`).
3. Project baru berstatus **privat**. Buka pengaturan project (**Settings**) dan ubah visibilitas menjadi **Publik**.
4. Keluar, lalu daftar akun smoke di `https://testpulse.pages.dev/register` dengan **email dan password yang sama persis** dengan `SMOKE_EMAIL` / `SMOKE_PASSWORD`. Nama bebas (mis. `Smoke`).
5. Akun smoke **tidak perlu menjadi anggota** project mana pun, jadi jangan diundang: smoke hanya login, lalu membuka project publik sebagai pengunjung anonim (konteks browser baru tanpa cookie). Jika Anda tetap ingin akun smoke menjadi anggota, beri role `viewer`, bukan `admin` atau `tester`.
6. **Cek:** buka `https://testpulse.pages.dev/p/testpulse` di jendela incognito (tanpa login). Lencana "publik" tampil.

Smoke test hanya membaca: ia tidak membuat atau menghapus data. Satu-satunya efek sampingnya adalah baris sesi yang dibuat setiap kali login (kedaluwarsa dalam 14 hari).

---

## Langkah 10. Rate limit per IP dan `PROXY_SECRET`

Batas 10 percobaan login/daftar per menit dihitung per IP klien. Di belakang proxy API tidak bisa langsung mempercayai header IP, karena siapa pun yang menembak URL Render (`*.onrender.com`) langsung bisa menulis header itu sesuka hati dan mengganti "IP"-nya setiap request. Karena itu:

1. Pages Function mengirim IP klien (dari `CF-Connecting-IP`) di header khusus `x-tp-client-ip` dan menambahkan header `x-proxy-secret` berisi `PROXY_SECRET`. Kedua header kiriman klien selalu dibuang. (`X-Forwarded-For` tetap ditimpa dengan IP yang sama untuk log, tetapi API tidak membacanya untuk rate limit, karena perantara seperti Render bisa menambah atau mengubahnya.)
2. API (tanpa kepercayaan proxy) memakai `x-tp-client-ip` **hanya** jika `x-proxy-secret` cocok dengan `PROXY_SECRET` miliknya dan nilainya tepat satu IP tidak kosong. Selain itu kunci rate limit adalah peer langsung (Render), sehingga pemanggil langsung dengan header palsu semuanya berbagi satu hitungan. API tidak menolak request tanpa secret (mis. `/api/health`), hanya tidak mempercayai header IP-nya.

Verifikasi setelah deploy (Langkah 8 atau 11 selesai):

1. **Secret terpasang di kedua sisi.** Buka `https://testpulse.pages.dev/login` dan kirim 11 login salah berturut-turut dalam semenit dari browser Anda. Percobaan ke-11 harus menampilkan pesan terlalu banyak permintaan (HTTP 429). Tidak perlu akun asli.
2. **Per IP, bukan global.** Segera setelah itu, dari jaringan lain (mis. hotspot HP) coba login salah sekali: harus 401 (pesan email/password salah), bukan 429. Jika jaringan lain juga kena 429, `PROXY_SECRET` di Pages tidak sama dengan di Render (atau belum terisi / belum di-deploy ulang) sehingga semua orang berbagi bucket peer.
3. **Pemalsuan header tidak berguna.** Panggil Render langsung dengan IP palsu yang berganti-ganti (ganti URL dengan URL Render Anda):
   ```
   for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" -X POST \
     -H "content-type: application/json" -H "x-tp-client-ip: 198.51.100.$i" -H "x-forwarded-for: 198.51.100.$i" \
     -d '{"email":"x@example.test","password":"salah-salah"}' \
     https://testpulse-api.onrender.com/api/v1/auth/login; done
   ```
   Hasil yang benar: `401` sepuluh kali lalu `429` (semua berbagi satu bucket walau IP palsunya berbeda). Jika semua `401`, API masih mempercayai header IP tanpa secret dan ada yang salah (periksa versi yang ter-deploy).
   Catatan: bucket ini milik peer langsung (proxy Render), jadi tunggu satu menit sebelum menguji lagi dan jangan jalankan saat pengguna lain sedang masuk.

Memutar rahasia: buat nilai baru, ubah di Render (**Environment**) dan di Cloudflare Pages (**Variables and Secrets**), lalu deploy ulang keduanya (Run workflow). Selama nilai berbeda, rate limit terkunci pada satu bucket bersama (gagal aman) tetapi aplikasi tetap berjalan.

---

## Langkah 11. Deploy ulang dan pastikan smoke hijau

1. **Actions** -> **Deploy** -> **Run workflow** lagi.
2. **Cek:** seluruh langkah hijau, termasuk **Smoke test** (5 test: 4 lulus dan 1 dilewati dengan pesan "belum punya run" sampai Langkah 12 selesai; itu normal).
3. Cek manual alur utama di production: daftar akun baru -> buat project -> project tampil di daftar. (Gunakan akun lain, bukan akun smoke.)

Mulai sekarang, setiap push ke `main` yang membuat CI hijau men-deploy otomatis.

---

## Langkah 12. Dogfooding: kirim hasil test CI ke project `testpulse` (opsional, dilakukan pemilik repo)

Mulai Tahap 2, `deploy.yml` mengunggah hasil test CI TestPulse **ke TestPulse sendiri**, sehingga `/p/testpulse` di production menampilkan run nyata. Setelah smoke test lulus, workflow mengunduh artifact `allure-results-*` dari run CI yang memicu deploy, lalu menjalankan reporter CLI ([`packages/reporter`](../packages/reporter)) ke `PRODUCTION_URL`, project `testpulse`, branch `main`, dengan commit dan link run CI yang sesuai. Langkah ini butuh satu secret tambahan, `TESTPULSE_TOKEN`, yang **Anda sendiri** buat dan pasang. Jangan membagikan nilainya kepada siapa pun (termasuk asisten AI) dan jangan menempelkannya ke file, issue, atau chat.

1. Masuk ke production sebagai **admin** project `testpulse` (akun pribadi pemilik project dari Langkah 9, bukan akun smoke). Hanya admin yang melihat bagian ini.
2. Buka `https://testpulse.pages.dev/p/testpulse/settings`, bagian **Token CI**. Isi nama, misalnya `GitHub Actions deploy`, lalu klik **Buat token**.
3. Salin nilai token yang tampil (diawali `tp_`). Nilai itu **hanya tampil sekali**; server menyimpan hash-nya saja. Bila terlewat, cabut token itu dan buat yang baru.
4. Di GitHub: repo -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**, nama `TESTPULSE_TOKEN`, tempelkan nilainya, simpan. (Dengan GitHub CLI: `gh secret set TESTPULSE_TOKEN`, nilai diketik di prompt.) Secret ini **tidak** termasuk daftar wajib pada `Check required secrets`: bila kosong, langkah dogfooding dilewati dengan `::warning::` dan deploy tetap hijau.
5. Picu deploy dari run CI, bukan dari **Run workflow**: **Actions** -> **CI** -> run terakhir di `main` -> **Re-run all jobs** (atau push commit baru ke `main`). Deploy yang dijalankan manual tidak punya run CI pemicu, sehingga dogfooding dilewati dengan `::warning::`. Artifact CI disimpan 7 hari; run yang lebih tua tidak bisa diunggah.
6. **Cek:** pada run **Deploy**, langkah **Upload CI test results to TestPulse** mencetak `Laporan terkirim (N berkas): ... test, ... lulus, ...` dan URL run. Buka `https://testpulse.pages.dev/p/testpulse` di jendela incognito: dashboard menampilkan run itu. Pada deploy berikutnya smoke test **dashboard project testpulse menampilkan hasil run dari CI** berubah dari dilewati menjadi lulus.

Catatan:

- Kegagalan unggah (token dicabut, jaringan, laporan ditolak) **tidak menggagalkan deploy**: langkahnya `continue-on-error` dan menulis `::warning::` beserta exit code reporter (1 = unggah gagal, 2 = berkas atau argumen salah).
- Token hanya berlaku untuk mengunggah ke project `testpulse`. Batasnya 60 unggahan per jam per token, jauh di atas satu unggahan per deploy.
- Memutar token: buat token baru di **Token CI**, perbarui secret `TESTPULSE_TOKEN`, lalu cabut token lama. Run yang sudah diunggah tetap ada.
- Reporter bisa dicoba dari komputer sendiri tanpa GitHub: `pnpm --filter @testpulse/reporter build`, lalu `node packages/reporter/dist/cli.js --url <URL> --project <slug> --branch main <berkas.xml>` dengan `TESTPULSE_TOKEN` di environment. Terhadap production itu menambah run sungguhan di project publik, jadi lakukan dengan sengaja.

---

## Masalah umum

| Gejala | Penyebab dan solusi |
| --- | --- |
| `Check required secrets` gagal | Ada secret yang belum diisi atau salah ketik namanya (Langkah 7). |
| `Wait for the new API revision` habis waktu | Render gagal build/jalan (lihat Logs dan status deploy), masih menjalankan commit lama, `DATABASE_URL` salah (503 `{"status":"error"}`), atau `RENDER_API_URL` salah. Pesan error menyebut commit yang terakhir terlihat. Perbaiki lalu **Run workflow**. |
| `Verify production through the Pages Function` habis waktu | `API_ORIGIN` kosong/salah di Pages (502), `API_ORIGIN` menunjuk service lain (commit tidak sama), atau Pages belum selesai propagasi. Perbaiki lalu **Run workflow**. |
| API tidak mau start; Logs Render menyebut `APP_ORIGIN harus berupa origin saja` | `APP_ORIGIN` memuat path, query, hash, atau skema selain `http(s)` (Langkah 3). Isi hanya origin, mis. `https://testpulse.pages.dev`. |
| `/api/health` 502 dengan "Layanan API belum dikonfigurasi" | `API_ORIGIN` belum diisi pada lingkungan **Production** project Pages; isi lalu deploy ulang. |
| `/api/health` 502 "API tidak dapat dihubungi" | Render sedang tidur/bangun atau mati. Tunggu ±1 menit dan coba lagi. |
| Daftar/masuk dari web menghasilkan 403 `FORBIDDEN` | `APP_ORIGIN` di Render tidak sama persis dengan URL web (perhatikan `https` dan nama host; garis miring di akhir sudah ditoleransi). |
| Login berhasil tetapi langsung dianggap keluar | `COOKIE_SECURE=true` butuh HTTPS; pastikan memakai URL `https://` dan `API_ORIGIN` mengarah ke Render. |
| Semua orang kena 429 bersamaan | `PROXY_SECRET` di Pages dan Render tidak sama, atau belum terisi / belum di-deploy ulang (Langkah 10). |
| Request pertama setelah lama sepi lambat atau 503 sekali | Cold start Render (±30-60 detik) dan Neon yang tidur (beberapa detik). Normal pada paket gratis; ulangi. |
| Deploy Cloudflare gagal `Authentication error` | Token salah/kedaluwarsa atau tanpa izin Pages:Edit, atau `CLOUDFLARE_ACCOUNT_ID` salah (Langkah 6). |
| Smoke `akun smoke berhasil masuk` gagal | Email/password akun di production tidak sama dengan `SMOKE_EMAIL`/`SMOKE_PASSWORD` (Langkah 9). |
| Smoke `project publik terbuka` gagal | Project belum publik atau slug-nya bukan `SMOKE_PUBLIC_SLUG` (Langkah 9). Akun smoke tidak perlu menjadi anggota. |
| Smoke `dashboard project testpulse ...` dilewati | Project `testpulse` belum punya run: `TESTPULSE_TOKEN` belum diisi atau belum ada deploy dari run CI sesudahnya (Langkah 12). Bukan kegagalan. |
| Smoke `dashboard project testpulse ...` gagal | Project `testpulse` tidak ada atau tidak publik (Langkah 9), atau dashboard tidak memuat hasil. Buka `/p/testpulse` di jendela incognito dan periksa. |
| Deploy hijau, tetapi ada `::warning::` dari langkah dogfooding | `TESTPULSE_TOKEN` kosong atau dicabut (401), artifact CI sudah kedaluwarsa (7 hari), atau deploy dipicu manual tanpa run CI (Langkah 12). Deploy tidak terpengaruh. |

## Daftar rahasia (ringkasan)

Tersimpan di: Render (`DATABASE_URL`, `PROXY_SECRET`), Cloudflare Pages (`PROXY_SECRET`), GitHub Secrets (kedelapan nama di Langkah 7, ditambah `TESTPULSE_TOKEN` yang opsional di Langkah 12). Tidak ada rahasia di repo. Jika sebuah rahasia bocor: putar ulang di layanan asal (reset password database di Neon, buat Deploy Hook/token baru, ganti password akun smoke) lalu perbarui nilainya.
