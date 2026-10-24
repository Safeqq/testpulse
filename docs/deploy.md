# Deploy production TestPulse

Panduan berurutan untuk menayangkan TestPulse di internet memakai layanan gratis:

| Bagian | Layanan | Peran |
| --- | --- | --- |
| Database | Neon (Postgres) | Menyimpan data. Migrasi berjalan otomatis saat API menyala. |
| API | Render (Docker, free web service) | Menjalankan `apps/api`. Tidur setelah ±15 menit tanpa trafik; bangun lagi dalam ±30-60 detik. |
| Web | Cloudflare Pages | Menyajikan `apps/web` dan **Pages Function** yang meneruskan `/api/*` ke Render, sehingga browser hanya melihat satu origin (cookie sesi aman dan first-party). |
| Otomatisasi | GitHub Actions (`deploy.yml`) | Setelah CI hijau di `main`: deploy API, deploy web, tunggu sehat, jalankan smoke test. |

```
Browser -> https://testpulse.pages.dev  (Cloudflare Pages)
             |- /            -> file statis (index.html, assets)
             |- /api/*       -> Pages Function -> https://testpulse-api.onrender.com/api/*  (Render) -> Neon
```

Jangan pernah menempelkan password, token, atau connection string ke file di repo, ke issue, atau ke chat. Semua nilai rahasia hanya dimasukkan ke dashboard layanan terkait atau ke GitHub Secrets.

Nama yang dipakai di panduan ini (boleh diganti, tetapi catat penggantinya):

- Project Neon dan database: `testpulse`
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
   Alternatif lewat dashboard: **Workers & Pages** -> **Create** -> tab **Pages** -> **Upload assets** -> nama `testpulse` -> unggah folder berisi satu file `index.html` apa saja -> **Deploy**. Pastikan **production branch** adalah `main`.
2. Catat URL project. Biasanya `https://testpulse.pages.dev`. Jika nama sudah dipakai orang lain, Cloudflare menambahkan akhiran acak; pakai URL yang tertulis di dashboard.

**Cek:** **Workers & Pages** menampilkan project `testpulse`. (Membuka URL-nya sekarang boleh masih menampilkan 404; web baru dipasang pada Langkah 8.)

---

## Langkah 3. Render: buat service API dari `render.yaml`

1. Masuk ke Render, **New** -> **Blueprint**. Hubungkan akun GitHub dan beri akses ke repo `testpulse`.
2. Pilih repo dan branch `main`. Render membaca `render.yaml` dan menampilkan service `testpulse-api` (plan **Free**, runtime Docker).
3. Render meminta nilai variabel yang bertanda `sync: false`:
   - `DATABASE_URL`: connection string Neon dari Langkah 1.
   - `APP_ORIGIN`: URL web dari Langkah 2, tanpa garis miring di akhir, mis. `https://testpulse.pages.dev`. Nilai ini harus **persis** sama dengan origin yang dilihat browser, karena API menolak (403) request ubah-data dari origin lain.
4. Klik **Apply** / **Deploy Blueprint**. Build pertama memakan beberapa menit.

Variabel lain sudah terisi dari `render.yaml`: `COOKIE_SECURE=true`, `TRUST_PROXY=3` (lihat Langkah 10), dan `RATE_LIMIT_MAX` sengaja tidak diisi (default 10 percobaan login/daftar per menit per IP).

**Cek:**
- Tab **Logs** berakhir dengan baris seperti `Server listening at http://0.0.0.0:3000` dan status service **Live**.
- Salin URL service (mis. `https://testpulse-api.onrender.com`; bisa berbeda jika nama sudah terpakai), lalu:
  ```
  curl https://testpulse-api.onrender.com/api/health
  ```
  Hasil yang benar: `{"status":"ok"}`. Request pertama setelah service tidur bisa lambat (±1 menit). Jika `{"status":"error"}` (503), `DATABASE_URL` salah: perbaiki di **Environment** lalu deploy ulang.

---

## Langkah 4. Cloudflare Pages: isi `API_ORIGIN`

1. **Workers & Pages** -> project `testpulse` -> **Settings** -> **Variables and Secrets** -> **Add** (lingkungan **Production**).
2. Tipe **Text**, **Variable name** `API_ORIGIN`, **Value** URL Render dari Langkah 3 (mis. `https://testpulse-api.onrender.com`, tanpa garis miring di akhir dan tanpa `/api`). Simpan.

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

Repo -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**. Buat ketujuh secret ini (nama harus persis):

| Nama | Isi |
| --- | --- |
| `RENDER_DEPLOY_HOOK_URL` | URL Deploy Hook (Langkah 5) |
| `CLOUDFLARE_API_TOKEN` | Token Pages:Edit (Langkah 6) |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID (Langkah 6) |
| `PRODUCTION_URL` | URL web, tanpa garis miring di akhir, mis. `https://testpulse.pages.dev` |
| `SMOKE_EMAIL` | Email khusus akun smoke, mis. `smoke@contoh-anda.com` (tidak harus email sungguhan, tetapi pilih yang tidak dipakai orang lain) |
| `SMOKE_PASSWORD` | Password kuat untuk akun smoke (8-128 karakter; buat acak, jangan pakai ulang password lain) |
| `SMOKE_PUBLIC_SLUG` | `testpulse` |

Alternatif dengan GitHub CLI (nilai diketik di prompt, tidak masuk riwayat shell): `gh secret set NAMA_SECRET`.

**Cek:** halaman Secrets menampilkan tujuh nama di atas.

Akun smoke belum ada di production; akan dibuat pada Langkah 9 memakai email dan password yang sama dengan secret di atas.

---

## Langkah 8. Deploy pertama

Rilis pertama tidak bisa hijau penuh karena akun smoke belum ada. Itu normal; tujuan putaran ini adalah memasang web dan memastikan API sehat.

1. Repo -> **Actions** -> workflow **Deploy** -> **Run workflow** (branch `main`). (Setelah ini, workflow berjalan otomatis setiap CI di `main` hijau.)
2. Pantau: langkah yang berurutan adalah memicu Render, build web, deploy ke Cloudflare Pages, menunggu `/api/health`, lalu smoke test. Dengan GitHub CLI: `gh run watch`.

Hasil yang diharapkan pada putaran ini: semua langkah hijau sampai **Wait for production health**; smoke test **health** dan **halaman masuk** lulus, sedangkan **akun smoke berhasil masuk** dan **project publik terbuka** gagal (akun dan project belum ada).

**Cek manual:**
```
curl https://testpulse.pages.dev/api/health          # {"status":"ok"} lewat Pages Function
curl -I https://testpulse.pages.dev/                 # memuat 4 header: Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
```
Buka `https://testpulse.pages.dev` di browser: halaman masuk TestPulse tampil.

Jika langkah **Wait for production health** habis waktu (10 menit): cek Logs di Render, nilai `API_ORIGIN` (Langkah 4), dan `DATABASE_URL` (Langkah 3). Lihat tabel masalah umum di bawah.

---

## Langkah 9. Daftarkan akun smoke dan buat project publik

Dilakukan satu kali, lewat web production (bukan lewat script):

1. Buka `https://testpulse.pages.dev/register`. Daftar dengan **email dan password yang sama persis** dengan `SMOKE_EMAIL` / `SMOKE_PASSWORD`. Nama bebas (mis. `Smoke`).
2. Buat project baru bernama `TestPulse`. Slug otomatis menjadi `testpulse` (harus sama dengan `SMOKE_PUBLIC_SLUG`).
3. Project baru berstatus **privat**. Buka pengaturan project (**Settings**) dan ubah visibilitas menjadi **Publik**.
4. **Cek:** buka `https://testpulse.pages.dev/p/testpulse` di jendela incognito (tanpa login). Lencana "publik" tampil.

Smoke test hanya membaca: ia tidak membuat atau menghapus data. Satu-satunya efek sampingnya adalah baris sesi yang dibuat setiap kali login (kedaluwarsa dalam 14 hari).

---

## Langkah 10. Verifikasi IP klien dan rate limit (TRUST_PROXY)

Batas 10 percobaan login/daftar per menit dihitung per IP. Di belakang proxy, API harus tahu proxy mana yang boleh dipercaya; kalau salah hitung, seluruh pengunjung terlihat berasal dari satu IP (semua kena 429 bersama) atau IP bisa dipalsukan.

**Rantai request:**

1. Browser menembak Cloudflare Pages. Pages Function **menimpa** `X-Forwarded-For` dengan IP klien dari `CF-Connecting-IP` (header `X-Forwarded-For` kiriman klien dibuang), dan menambah `X-Forwarded-Proto: https`.
2. Function memanggil Render. Cloudflare di depan Render menambahkan IP penghubungnya (alamat keluar Cloudflare Workers) ke daftar, dan load balancer Render menambahkan lagi satu entri.
3. API menerima `X-Forwarded-For: <IP klien>, <proxy 1>, <proxy 2>`, dengan koneksi socket dari load balancer Render.

`TRUST_PROXY=N` berarti: percayai N hop terdekat dari API; `req.ip` adalah entri ke-N dari kanan pada daftar `X-Forwarded-For`. Dengan perkiraan rantai di atas, IP klien berada pada posisi ke-3 dari kanan, jadi nilai di `render.yaml` adalah **3**.

Mengapa nilai 3 aman walau jumlah hop sebenarnya ternyata lebih kecil: karena Function menimpa `X-Forwarded-For` hanya dengan satu IP klien, entri paling kiri selalu IP klien sungguhan. Jika N melebihi panjang daftar, API memakai entri paling kiri itu, yaitu tetap IP klien. Yang berbahaya adalah N yang **terlalu kecil**: `req.ip` menjadi alamat proxy sehingga semua pengunjung berbagi satu hitungan rate limit.

Hop yang tepat tidak didokumentasikan oleh Render dan tidak bisa dipastikan dari repo, jadi **verifikasi setelah deploy**:

1. Cari IP publik Anda: `curl https://ifconfig.me` (atau buka situs "what is my IP").
2. Buka `https://testpulse.pages.dev/login` dan coba masuk dengan akun apa saja (boleh salah).
3. Di Render -> service -> **Logs**, cari baris request `POST /api/v1/auth/login`. Bagian `req` memuat `"remoteAddress":"..."`; itulah `req.ip` menurut API.
4. Bandingkan:
   - `remoteAddress` **sama dengan IP publik Anda**: konfigurasi benar. Selesai.
   - `remoteAddress` berupa IP lain (mis. `10.x`, `172.x`, atau rentang Cloudflare): N terlalu kecil. Di Render -> **Environment**, naikkan `TRUST_PROXY` (coba `4`), simpan, tunggu deploy ulang, dan ulangi sampai sama. Setelah itu perbarui juga nilai di `render.yaml` supaya sinkron.
5. Uji rate limit (opsional, hanya 11 request): kirim 11 login salah berturut-turut dalam semenit; yang ke-11 harus `429`. Lalu dari jaringan lain (mis. hotspot HP) login masih harus bisa dicoba (bukan 429). Jika jaringan lain juga 429, N terlalu kecil.

Batasan yang perlu diketahui: karena kepercayaan berdasarkan jumlah hop, siapa pun yang menembak URL Render (`*.onrender.com`) **langsung**, melewati Pages, bisa menyisipkan entri `X-Forwarded-For` palsu dan menghindari rate limit per IP. Menutup celah ini membutuhkan rahasia bersama antara Function dan API (header khusus); belum diterapkan di Tahap 1.

---

## Langkah 11. Deploy ulang dan pastikan smoke hijau

1. **Actions** -> **Deploy** -> **Run workflow** lagi.
2. **Cek:** seluruh langkah hijau, termasuk **Smoke test** (4 test lulus).
3. Cek manual alur utama di production: daftar akun baru -> buat project -> project tampil di daftar. (Gunakan akun lain, bukan akun smoke.)

Mulai sekarang, setiap push ke `main` yang membuat CI hijau men-deploy otomatis.

---

## Masalah umum

| Gejala | Penyebab dan solusi |
| --- | --- |
| `Check required secrets` gagal | Ada secret yang belum diisi atau salah ketik namanya (Langkah 7). |
| `Wait for production health` habis waktu | Render gagal build/jalan (lihat Logs), `DATABASE_URL` salah (503 `{"status":"error"}`), atau `API_ORIGIN` kosong/salah di Pages (502). Perbaiki lalu **Run workflow**. |
| `/api/health` 502 dengan "Layanan API belum dikonfigurasi" | `API_ORIGIN` belum diisi pada lingkungan **Production** project Pages; isi lalu deploy ulang. |
| `/api/health` 502 "API tidak dapat dihubungi" | Render sedang tidur/bangun atau mati. Tunggu ±1 menit dan coba lagi. |
| Daftar/masuk dari web menghasilkan 403 `FORBIDDEN` | `APP_ORIGIN` di Render tidak sama persis dengan URL web (perhatikan `https`, tanpa garis miring di akhir). |
| Login berhasil tetapi langsung dianggap keluar | `COOKIE_SECURE=true` butuh HTTPS; pastikan memakai URL `https://` dan `API_ORIGIN` mengarah ke Render. |
| Semua orang kena 429 bersamaan | `TRUST_PROXY` terlalu kecil (Langkah 10). |
| Request pertama setelah lama sepi lambat atau 503 sekali | Cold start Render (±30-60 detik) dan Neon yang tidur (beberapa detik). Normal pada paket gratis; ulangi. |
| Deploy Cloudflare gagal `Authentication error` | Token salah/kedaluwarsa atau tanpa izin Pages:Edit, atau `CLOUDFLARE_ACCOUNT_ID` salah (Langkah 6). |
| Smoke `akun smoke berhasil masuk` gagal | Email/password akun di production tidak sama dengan `SMOKE_EMAIL`/`SMOKE_PASSWORD` (Langkah 9). |
| Smoke `project publik terbuka` gagal | Project belum publik atau slug-nya bukan `SMOKE_PUBLIC_SLUG` (Langkah 9). |

## Daftar rahasia (ringkasan)

Tersimpan di: Render (`DATABASE_URL`), GitHub Secrets (ketujuh nama di Langkah 7). Tidak ada rahasia di repo. Jika sebuah rahasia bocor: putar ulang di layanan asal (reset password database di Neon, buat Deploy Hook/token baru, ganti password akun smoke) lalu perbarui nilainya.
