# UI Baru, Tema Gelap/Terang & Landing Page — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengganti tampilan `apps/web` dengan Tailwind CSS v4 + shadcn/ui, menambah tema terang (ala Cloudflare) dan gelap (ala Neon) yang mengikuti sistem dan bisa diganti, serta landing page untuk pengunjung anonim — tanpa melonggarkan CSP dan tanpa memecahkan test yang ada.

**Architecture:** Tailwind v4 lewat plugin Vite, token tema sebagai variabel CSS dengan kelas `.dark` di `<html>`, `public/theme-init.js` (file, bukan inline) mencegah kedip, `ThemeProvider`/`ThemeToggle` di React, komponen shadcn disalin ke `src/components/ui/`. Halaman lama ditata ulang satu kelompok per task dengan `data-testid` tetap. Gate CSP ditambahkan ke fixture Playwright lebih dulu supaya setiap task berikutnya diawasi.

**Tech Stack:** React 19, React Router 7, Vite 7, Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/vite`), shadcn/ui (Radix), `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, Vitest 5, Playwright + `@axe-core/playwright`.

**Spec:** [docs/superpowers/specs/2026-10-26-ui-tema-landing-design.md](../specs/2026-10-26-ui-tema-landing-design.md)

## Global Constraints

- Ruang lingkup: `apps/web`, `tests/`, dokumentasi. **Jangan** ubah `apps/api`, `packages/shared`, workflow deploy, `security-headers.conf`, atau `public/_headers`.
- **CSP tidak boleh dilonggarkan** (tidak ada `'unsafe-inline'`, nonce, hash). CSP production: `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`.
- **Komponen shadcn yang boleh dipakai:** button, card, input, label, badge, separator, dropdown-menu (**selalu `modal={false}`**). **Dilarang:** dialog, sheet, alert-dialog, select (Radix), scroll-area, popover — semuanya menyuntikkan `<style>`/scroll-lock yang diblokir CSP. Select memakai `<select>` native yang distyle (test memakai `selectOption`). Menu mobile memakai disclosure sederhana (tombol + daftar link), bukan sheet.
- Semua `data-testid`, teks yang di-assert test, label form, `role="alert"`/`role="status"` yang ada **tetap**. Header tetap punya link bernama "Masuk" dan "Daftar" di dalam `role="banner"` untuk pengunjung anonim.
- Teks UI berbahasa Indonesia. Pesan commit bahasa Inggris (conventional). Implementer **commit saja, tidak push**.
- Token warna (spec §3.1) — terang: latar `#f4f5f7`, kartu `#ffffff`, border `#e1e4e8`, teks `#1d1f20`, teks sekunder `#4b5563`, aksen oranye `#f38020`, link biru `#0051c3`, bahaya `#c4122f`; gelap: latar `#0b0d0f`, kartu `#14171a`, border `#24292e`, teks `#f2f4f5`, teks sekunder `#a3adb5`, aksen mint `#34d59a`, link `#6ee7b7`, bahaya `#f87171`. Boleh disesuaikan **hanya** demi kontras WCAG AA; catat perubahan di laporan.
- Tema: kunci `localStorage` **`tp-theme`**, nilai `"system" | "light" | "dark"`, default `"system"`; kelas `.dark` di `<html>`; `color-scheme` diisi.
- Lingkungan lokal: Postgres `tp-pg` di host port 5433 (`.env` lokal sudah benar), `PLAYWRIGHT_BROWSERS_PATH=C:\pw-browsers`, worker ≤ 4, Docker di Git Bash butuh `export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"`. TypeScript tetap `^6.0.3`. Heredoc bash panjang gagal di lingkungan ini — tulis file dengan tool penulis file.
- CSP hanya aktif di stack Docker (nginx). Setiap task yang mengubah UI wajib menjalankan E2E sekali terhadap stack Docker (`docker compose up -d --build --wait`, `BASE_URL=http://localhost:8080`) agar gate CSP benar-benar teruji.

## Review Focus

1. **`localStorage` melempar error** (Safari privat, cookie diblokir) → app tetap tampil dengan tema sistem, tombol tema tetap berfungsi selama sesi. Test di Task 2.
2. **Nilai `tp-theme` tidak valid** (mis. `"blue"`, `""`, JSON) → diperlakukan sebagai `"system"`, baik di `theme-init.js` maupun `ThemeProvider`. Test di Task 2.
3. **Nama pengguna atau project sepanjang 80 karakter** di header/kartu pada viewport 375 px → tidak ada scroll horizontal, teks dipotong rapi. Test di Task 2 (header) dan Task 4 (kartu project).
4. **Pengguna keyboard saja** → `ThemeToggle` dan menu mobile bisa dibuka dengan Enter/Space, ditutup dengan Escape, dan fokus kembali ke tombol pemicunya. Test di Task 2.
5. **Status auth "error" di `/`** (API tidak terjangkau saat pengguna punya sesi) → banner galat sesi tampil, **bukan** landing page dan bukan redirect. Test di Task 6.

---

## Struktur file

```
apps/web/
  index.html                      + <script src="/theme-init.js">, meta OG, theme-color
  vite.config.ts                  + @tailwindcss/vite, alias "@" → src
  tsconfig.json                   + paths "@/*"
  components.json                 konfigurasi shadcn
  public/theme-init.js            pencegah kedip (plain JS)
  src/index.css                   Tailwind + token tema (menggantikan styles.css)
  src/lib/utils.ts                cn()
  src/lib/theme.ts                logika tema murni (+ theme.test.ts)
  src/components/ui/*.tsx         button, card, input, label, badge, separator, dropdown-menu
  src/components/theme/ThemeProvider.tsx, ThemeToggle.tsx
  src/components/Layout.tsx       header baru + menu mobile
  src/pages/LandingPage.tsx, src/pages/landing/{Hero,Features,HowItWorks,Quality,Roadmap,Footer}.tsx
  test/unit/theme-init.test.ts    menguji public/theme-init.js
tests/
  support/csp.ts                  gate CSP
  support/fixtures.ts             + context/page dengan gate CSP, fixture newContext
  support/a11y.ts                 + expectNoA11yViolationsInBothThemes
  pages/AppShell.ts               + tema & menu mobile; pages/LandingPage.ts (baru)
  e2e/csp-guard.spec.ts, e2e/theme.spec.ts, e2e/landing.spec.ts
docs/adr/0003-tailwind-shadcn.md, docs/images/*.png, README.md, docs/TEST_STRATEGY.md
```

---

### Task 1: Gate CSP di fixture Playwright

**Files:**
- Create: `tests/support/csp.ts`, `tests/e2e/csp-guard.spec.ts`
- Modify: `tests/support/fixtures.ts`, `tests/e2e/projects.spec.ts`, `tests/e2e/team.spec.ts` (ganti `browser.newContext(...)` dengan fixture `newContext`)

**Interfaces:**
- Produces:
  - `attachCspGuard(context: BrowserContext): Promise<CspGuard>` dengan `interface CspGuard { violations(): CspViolation[] }` dan `interface CspViolation { directive: string; blockedURI: string; sample: string; url: string }`. Memasang `context.addInitScript` yang mendengarkan event `securitypolicyviolation` di setiap dokumen dan meneruskannya lewat `context.exposeBinding("__tpReportCsp", ...)`.
  - Fixture `test` di `fixtures.ts`: override fixture `context` (bawaan Playwright) agar memasang guard; fixture baru `newContext(options?: BrowserContextOptions): Promise<BrowserContext>` (dengan `baseURL` default dari config, guard terpasang, ditutup otomatis); `signedInPage` memakai jalur yang sama. Pada teardown setiap test, fixture melakukan `expect(violations, "pelanggaran CSP").toEqual([])` untuk semua context yang dibuat test itu.

- [ ] **Step 1: Tulis test yang gagal** — `csp-guard.spec.ts`:
  - memakai `page.route("**/__csp-probe", ...)` untuk menyajikan HTML dengan header `Content-Security-Policy: style-src 'self'` dan sebuah `<div style="color:red">`; memakai `attachCspGuard` langsung pada context baru (bukan fixture `test`, agar test tidak gagal karena gate) dan meng-assert `violations().length >= 1` dengan `directive` berawalan `style-src`.
  - halaman probe tanpa pelanggaran → `violations()` kosong.
- [ ] **Step 2: Jalankan — gagal.** `pnpm --filter @testpulse/tests exec playwright test --project e2e-chromium csp-guard` → FAIL (modul belum ada).
- [ ] **Step 3: Implementasi** `csp.ts` dan perubahan `fixtures.ts`; ganti keenam `browser.newContext(...)` di spec dengan fixture `newContext`.
- [ ] **Step 4: Jalankan — lulus**, lalu seluruh E2E di chromium terhadap stack Docker (`BASE_URL=http://localhost:8080`) → PASS dan 0 pelanggaran CSP (membuktikan baseline Tahap 1 bersih). Pastikan `grep -rn "browser.newContext(" tests/e2e` kosong.
- [ ] **Step 5: Commit** — `test(e2e): fail any test that triggers a CSP violation`

---

### Task 2: Fondasi Tailwind + shadcn, sistem tema, dan header baru

**Files:**
- Create: `apps/web/components.json`, `apps/web/public/theme-init.js`, `apps/web/src/index.css`, `apps/web/src/lib/utils.ts`, `apps/web/src/lib/theme.ts`, `apps/web/src/lib/theme.test.ts`, `apps/web/test/unit/theme-init.test.ts`, `apps/web/src/components/ui/{button,card,input,label,badge,separator,dropdown-menu}.tsx`, `apps/web/src/components/theme/{ThemeProvider,ThemeToggle}.tsx`, `tests/e2e/theme.spec.ts`
- Modify: `apps/web/package.json` (deps + script `test:unit` menjalankan project `unit` dan `functions`), `apps/web/vitest.config.ts` (project `unit`: `src/**/*.test.ts` + `test/unit/**/*.test.ts`, environment node), `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`, `apps/web/src/main.tsx` (impor `index.css`, bungkus `ThemeProvider`), `apps/web/src/components/Layout.tsx`, `tests/pages/AppShell.ts`
- `styles.css` **tetap ada** sampai Task 5 (halaman lama masih memakainya); `index.css` diimpor setelahnya.

**Interfaces:**
- Produces (`apps/web/src/lib/theme.ts`):
  - `type ThemePreference = "system" | "light" | "dark"`, `type ResolvedTheme = "light" | "dark"`, `const THEME_STORAGE_KEY = "tp-theme"`
  - `parsePreference(raw: string | null | undefined): ThemePreference` (selain tiga nilai sah → `"system"`)
  - `readStoredPreference(storage: Pick<Storage, "getItem"> | null): ThemePreference` (error saat akses → `"system"`)
  - `writeStoredPreference(storage: Pick<Storage, "setItem"> | null, pref: ThemePreference): void` (error ditelan)
  - `resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme`
  - `applyTheme(root: { classList: DOMTokenList; style: CSSStyleDeclaration }, theme: ResolvedTheme): void` (toggle kelas `dark`, set `style.colorScheme`)
- `ThemeProvider` / `useTheme(): { preference: ThemePreference; resolved: ResolvedTheme; setPreference(p: ThemePreference): void }`; untuk `"system"` mendengarkan `matchMedia("(prefers-color-scheme: dark)")` `change`; memperbarui `<meta name="theme-color">` (terang `#f4f5f7`, gelap `#0b0d0f`).
- `ThemeToggle`: tombol `data-testid="theme-toggle"`, `aria-label="Pilih tema"`, membuka `DropdownMenu modal={false}` berisi item radio `theme-option-system|light|dark` (label "Sistem", "Terang", "Gelap").
- Layout: header dengan logo TestPulse, navigasi, `ThemeToggle`, menu pengguna (tetap `current-user` & `logout`) atau link "Masuk"/"Daftar"; di < 768 px navigasi pindah ke disclosure `data-testid="mobile-menu-toggle"` (`aria-expanded`, `aria-controls`), Escape menutup dan mengembalikan fokus.
- `public/theme-init.js`: IIFE plain JS yang mereplikasi `parsePreference` + `resolveTheme` + `applyTheme` (tidak bisa mengimpor TS). Dimuat sinkron di `<head>` sebelum script modul.
- AppShell POM: `themeToggle`, `chooseTheme(p: ThemePreference)`, `mobileMenuToggle`.

- [ ] **Step 1: Tulis unit test yang gagal** — `theme.test.ts`:
```ts
it.each([["light","light"],["dark","dark"],["system","system"],["blue","system"],["","system"],[null,"system"],['{"a":1}',"system"]])
  ("parsePreference(%j) = %s", (raw, exp) => expect(parsePreference(raw as string | null)).toBe(exp));
it("readStoredPreference: storage melempar error → system", () =>
  expect(readStoredPreference({ getItem() { throw new Error("blocked"); } })).toBe("system"));
it("readStoredPreference: storage null → system", () => expect(readStoredPreference(null)).toBe("system"));
it("writeStoredPreference menelan error", () =>
  expect(() => writeStoredPreference({ setItem() { throw new Error("quota"); } }, "dark")).not.toThrow());
it.each([["system",true,"dark"],["system",false,"light"],["light",true,"light"],["dark",false,"dark"]])
  ("resolveTheme(%s, %s) = %s", (p, sys, exp) => expect(resolveTheme(p as ThemePreference, sys as boolean)).toBe(exp));
```
  `test/unit/theme-init.test.ts`: jalankan `public/theme-init.js` dengan `node:vm` dalam objek `window`/`document` palsu untuk kombinasi (`tp-theme` = `dark`|`light`|`system`|`blue`|tidak ada|getItem melempar) × (sistem gelap/terang) dan assert kelas `dark` + `colorScheme` sama dengan `resolveTheme(parsePreference(...))`.
- [ ] **Step 2: Jalankan — gagal.** `pnpm --filter @testpulse/web exec vitest run --project unit` → FAIL.
- [ ] **Step 3: Pasang fondasi** — `tailwindcss`, `@tailwindcss/vite`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, komponen Radix yang dibutuhkan dropdown-menu; alias `@` di Vite + tsconfig; `components.json`; tambahkan komponen shadcn yang diizinkan (lewat `npx shadcn@latest add ...` atau salin manual) lalu sesuaikan agar `DropdownMenu` default `modal={false}`. `index.css`: `@import "tailwindcss";`, `@custom-variant dark (&:where(.dark, .dark *));`, token `:root` dan `.dark` sesuai Global Constraints dipetakan ke nama token shadcn.
- [ ] **Step 4: Implementasi** `theme.ts`, `theme-init.js`, `ThemeProvider`, `ThemeToggle`, header baru di `Layout.tsx` (fungsi & testid lama tetap). Unit test → PASS.
- [ ] **Step 5: Tulis E2E** — `theme.spec.ts`:
  - `emulateMedia({ colorScheme: "dark" })` → `<html>` punya kelas `dark`; `"light"` → tidak.
  - pilih "Gelap" lewat toggle saat sistem terang → `dark`; reload → tetap `dark`; pilih "Sistem" → mengikuti emulasi; ubah emulasi tanpa reload → kelas ikut berubah.
  - tanpa kedip: `page.route` menahan semua request script modul (selain `/theme-init.js`) lalu `goto("/login")` dengan sistem gelap → `document.documentElement.classList.contains("dark")` sudah `true` sebelum app dimuat.
  - **Review Focus 1:** `addInitScript` membuat `localStorage.getItem/setItem` melempar → halaman `/login` tetap tampil, toggle ke "Gelap" mengubah kelas.
  - **Review Focus 2:** `localStorage["tp-theme"]="blue"` + sistem gelap → `dark`.
  - **Review Focus 4:** buka toggle dengan keyboard (Tab ke tombol, Enter), pilih dengan panah + Enter; Escape menutup dan fokus kembali ke `theme-toggle`; sama untuk `mobile-menu-toggle` di viewport 375×812.
  - **Review Focus 3:** user dengan nama 80 karakter, viewport 375×812 → `scrollWidth <= innerWidth`, menu mobile berisi navigasi + `logout`.
- [ ] **Step 6: Jalankan** — `theme.spec.ts` di tiga browser, lalu seluruh E2E chromium terhadap stack Docker (gate CSP) → PASS. Juga `pnpm lint`, `pnpm typecheck`, `pnpm --filter @testpulse/web build`.
- [ ] **Step 7: Commit** — `feat(web): Tailwind and shadcn foundation with system-aware light/dark theme`

---

### Task 3: Halaman auth & komponen bersama

**Files:**
- Modify: `apps/web/src/pages/{LoginPage,RegisterPage,NotFoundPage}.tsx`, `apps/web/src/components/{FormField,FormError,LoadError,Toast,RequireAuth}.tsx`, `tests/support/a11y.ts`, `tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: komponen `ui/*`, token tema (Task 2).
- Produces: `expectNoA11yViolationsInBothThemes(page: Page): Promise<void>` di `tests/support/a11y.ts` — untuk `colorScheme` `light` lalu `dark`: `emulateMedia`, tunggu kelas `<html>` sesuai, jalankan `expectNoA11yViolations`; juga diekspor lewat fixture `test`. `FormField` tetap menghasilkan `data-testid` `<prefix>-<field>` dan `field-error-<field>` seperti sekarang.

- [ ] **Step 1: Ubah test dulu** — di `auth.spec.ts`, ganti pemanggilan a11y untuk `/login` dan `/register` menjadi `expectNoA11yViolationsInBothThemes`; jalankan → kemungkinan FAIL di tema gelap (kontras halaman lama).
- [ ] **Step 2: Implementasi** — tata ulang halaman & komponen memakai `Card`, `Input`, `Label`, `Button`, `Badge`; `Toast` tetap `role="status"` dan `data-testid="toast"`; error tetap `role="alert"`.
- [ ] **Step 3: Jalankan** — `auth.spec.ts` di tiga browser + E2E chromium terhadap stack Docker → PASS, 0 pelanggaran CSP & a11y di kedua tema.
- [ ] **Step 4: Commit** — `feat(web): restyle auth pages and shared form components`

---

### Task 4: Halaman project (daftar, buat, ringkasan)

**Files:**
- Modify: `apps/web/src/pages/{ProjectsPage,NewProjectPage,ProjectPage}.tsx`, `tests/e2e/projects.spec.ts`

**Interfaces:**
- Consumes: `expectNoA11yViolationsInBothThemes` (Task 3), komponen `ui/*`.

- [ ] **Step 1: Ubah test dulu** — semua pemeriksaan a11y di `projects.spec.ts` memakai versi dua tema; tambah **Review Focus 3**: project bernama 80 karakter di `/` pada 375×812 → tidak ada scroll horizontal, judul terpotong (`text-overflow`) namun tetap utuh di atribut `title`. Jalankan → FAIL.
- [ ] **Step 2: Implementasi** — kartu project, empty state berikon, form buat project dengan pratinjau slug, halaman ringkasan dengan `public-badge` ("Project publik · hanya-baca") dan empty state "Belum ada hasil test" yang lebih informatif. Semua testid tetap.
- [ ] **Step 3: Jalankan** — `projects.spec.ts` tiga browser + E2E chromium vs stack Docker → PASS.
- [ ] **Step 4: Commit** — `feat(web): restyle project list, creation, and overview pages`

---

### Task 5: Pengaturan & undangan, hapus CSS lama

**Files:**
- Modify: `apps/web/src/pages/settings/*.tsx`, `apps/web/src/pages/InvitePage.tsx`, `apps/web/src/main.tsx`, `tests/e2e/team.spec.ts`
- Delete: `apps/web/src/styles.css`

- [ ] **Step 1: Ubah test dulu** — a11y di `team.spec.ts` (settings & invite) memakai versi dua tema → jalankan → FAIL.
- [ ] **Step 2: Implementasi** — section pengaturan sebagai `Card`; `member-role-<id>` tetap `<select>` native yang distyle; zona bahaya dengan warna `destructive`; hapus `styles.css` dan impornya; pastikan tidak ada kelas CSS lama yang tersisa (`grep` nama kelas lama di `src/`).
- [ ] **Step 3: Jalankan** — seluruh E2E tiga browser + seluruh E2E chromium vs stack Docker → PASS; `pnpm --filter @testpulse/web build` → ukuran CSS dilaporkan di laporan.
- [ ] **Step 4: Commit** — `feat(web): restyle settings and invite pages; remove legacy stylesheet`

---

### Task 6: Landing page & perubahan routing `/`

**Files:**
- Create: `apps/web/src/pages/LandingPage.tsx`, `apps/web/src/pages/landing/{Hero,Features,HowItWorks,Quality,Roadmap,Footer}.tsx`, `apps/web/src/pages/HomeRoute.tsx`, `tests/pages/LandingPage.ts`, `tests/e2e/landing.spec.ts`
- Modify: `apps/web/src/App.tsx`, `apps/web/index.html` (title & meta OG), `tests/e2e/projects.spec.ts` (test "`/` dan `/projects/new` mengarahkan user anonim ke login")

**Interfaces:**
- Produces: `HomeRoute` di `/` (di luar `RequireAuth`): `status === "authenticated"` → `ProjectsPage`; `"anonymous"` → `LandingPage`; `"loading"` → kerangka netral (`data-testid="home-loading"`); `"error"` → tidak merender landing (banner galat sesi dari Layout yang tampil).
- Teks persis (spec §6): judul hero "Pantau kesehatan testing tim Anda di satu tempat."; tombol "Daftar gratis" → `/register`; "Lihat demo project publik" → `/p/testpulse`; label mockup "Pratinjau"; badge "Segera" + tahap untuk Dashboard hasil test & deteksi flaky (Tahap 2), Bug tracker (Tahap 3), Test case manual (Tahap 4), Crowdtesting (Tahap 5); link kualitas: `https://safeqq.github.io/testpulse/`, `https://github.com/Safeqq/testpulse/actions/workflows/ci.yml`, `https://github.com/Safeqq/testpulse`, `https://github.com/Safeqq/testpulse/blob/main/docs/TEST_STRATEGY.md`. Footer: "TestPulse", link GitHub, Dokumentasi (`https://github.com/Safeqq/testpulse#readme`), Laporan test, tahun — **tanpa** kalimat atribusi pembuat. `<title>` landing "TestPulse — Pantau kesehatan testing tim Anda" (di-set saat LandingPage aktif); meta description + `og:title`, `og:description`, `og:type=website` di `index.html`.
- testid sesuai spec §6: `landing-hero`, `landing-cta-register`, `landing-cta-demo`, `landing-features`, `feature-<slug>`, `feature-soon-badge`, `landing-how-it-works`, `landing-quality`, `quality-link-allure|ci|source|strategy`, `landing-roadmap`, `landing-footer`.

- [ ] **Step 1: Tulis test yang gagal** — `landing.spec.ts`:
  - anonim `goto("/")` → semua section tampil; URL tetap `/`.
  - `landing-cta-register` → `/register`; `landing-cta-demo` → `/p/testpulse`.
  - keempat `quality-link-*` punya `href` persis di atas, `target="_blank"`, `rel` memuat `noopener` dan `noreferrer`.
  - `feature-soon-badge` tepat 4, masing-masing di kartu Tahap 2–5; kartu fitur yang tersedia tidak punya badge.
  - footer tidak memuat kata "Dibuat oleh".
  - login → `goto("/")` → `project-list` atau `empty-projects`, bukan `landing-hero`.
  - **Review Focus 5:** user dengan sesi + `/api/v1/auth/me` 503 (helper `simulateMeOutage` yang sudah ada) → `auth-error` tampil, `landing-hero` tidak ada, URL tetap `/`.
  - a11y dua tema untuk landing; viewport 375×812 → tanpa scroll horizontal.
  - Ubah test di `projects.spec.ts`: anonim `/` → `landing-hero` tampil; `/projects/new` → tetap `/login?next=%2Fprojects%2Fnew`.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi** `HomeRoute`, `LandingPage` + section-nya (mockup statis dari komponen, ikon Lucide), perubahan `App.tsx`, meta di `index.html`.
- [ ] **Step 4: Jalankan** — `landing.spec.ts` + seluruh E2E tiga browser + seluruh E2E chromium vs stack Docker → PASS.
- [ ] **Step 5: Commit** — `feat(web): landing page for visitors and home routing by auth status`

---

### Task 7: Dokumentasi & screenshot

**Files:**
- Create: `docs/adr/0003-tailwind-shadcn.md`, `docs/images/{landing-light,landing-dark,project-light,project-dark}.png`, `tests/scripts/screenshots.ts` (opsional: skrip Playwright yang menghasilkan screenshot dari stack lokal)
- Modify: `README.md` (bagian "Tampilan" + screenshot), `docs/TEST_STRATEGY.md` (a11y dua tema, gate CSP, test tema), `docs/test-plans/tahap-1.md` (perubahan perilaku `/`)

- [ ] **Step 1: Buat screenshot** dari stack lokal (Docker) dengan Playwright di viewport 1280×800 untuk landing dan halaman project publik, terang & gelap; simpan PNG (< 400 KB per file).
- [ ] **Step 2: Tulis dokumen** — ADR 0003 (konteks: tampilan Tahap 1 polos; keputusan: Tailwind v4 + shadcn/ui dipilih pemilik proyek alih-alih CSS token murni; konsekuensi: perubahan besar, ketergantungan Radix, daftar komponen terlarang karena CSP, gate CSP sebagai mitigasi). README & TEST_STRATEGY sesuai Files.
- [ ] **Step 3: Verifikasi** semua link relatif README/docs mengarah ke file yang ada; gambar terlihat di Markdown.
- [ ] **Step 4: Commit** — `docs: theme screenshots, ADR 0003, and test strategy updates`

---

## Definisi selesai

Sama dengan spec §9: landing & semua halaman di dua tema dan ukuran HP; tema tanpa kedip dan tanpa melonggarkan CSP; semua test lama & baru hijau di CI tanpa pelanggaran CSP; deploy otomatis production berhasil dengan smoke 4/4; dokumentasi diperbarui.
