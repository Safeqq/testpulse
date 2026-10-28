# TestPulse Tahap 2 — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CI mengunggah JUnit XML ke project lewat token CI; dashboard menampilkan run, kegagalan, tren, dan test flaky; reporter CLI; uji performa k6; dogfooding ke project publik `testpulse` di production.

**Architecture:** Modul API baru `tokens` dan `results` (ingest sinkron, tabel `project_tokens`/`runs`/`test_cases`/`test_results`), logika murni di `results/domain` (parser JUnit, `flakyScore`). Web menambah halaman dashboard yang di-lazy-load dan bagian Token CI di pengaturan. `packages/reporter` menggabungkan file JUnit dan mengunggahnya. CI menghasilkan JUnit dari semua suite; `deploy.yml` mengunggahnya ke production setelah smoke test.

**Tech Stack:** Fastify 5, Drizzle + Postgres, Zod 4, `fast-xml-parser`, React 19 + Router 7 + Tailwind/shadcn (komponen yang diizinkan saja), Vitest, Testcontainers, Playwright, Pact, k6 (`grafana/k6`), GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-10-28-testpulse-tahap2-design.md](../specs/2026-10-28-testpulse-tahap2-design.md) — juga mengikat: spec Tahap 1 (otorisasi, keamanan) dan spec UI 2026-10-26 (CSP, komponen yang diizinkan, tema).

## Global Constraints

- Nilai dari spec Tahap 2: token `tp_` + 32 byte base64url, simpan SHA-256, maks **10** aktif; upload maks **5 MB**, maks **20.000** testcase, nama dipotong **500** karakter, pesan dipotong **4096 byte UTF-8** (tanpa memotong di tengah karakter); retensi **200** run per project; jendela flaky **20** run; tren **30** run; halaman run **20**, hasil test **100**, flaky maks **50**; rate limit upload **60/jam/token** (env `INGEST_RATE_LIMIT_MAX`, default 60).
- Validasi query upload: `branch` 1–200 `[A-Za-z0-9._/-]` (wajib), `commit` hex 7–40, `ciUrl` http/https ≤ 500, `name` ≤ 120.
- Kode error baru: `RUN_NOT_FOUND`, `TEST_NOT_FOUND`, `TOKEN_NOT_FOUND`, `TOKEN_LIMIT`, `PAYLOAD_TOO_LARGE`, `INVALID_REPORT`. Bentuk error tetap `{ error: { code, message, fields? } }`.
- Otorisasi baca mengikuti Tahap 1 (publik → siapa saja; privat → viewer+, selain itu 404). `DELETE run` tester+, token CRUD admin. Endpoint upload **hanya** Bearer token; token **tidak** berlaku di endpoint lain; cookie **tidak** berlaku di upload.
- Pengecualian "body wajib JSON" **hanya** untuk `POST /api/v1/projects/:slug/runs` dengan `application/xml`/`text/xml`. Parser menolak `<!DOCTYPE`. CSP **tidak** dilonggarkan; komponen shadcn yang diizinkan: button, card, input, label, badge, separator, dropdown-menu (`modal={false}`); `<select>` native.
- UI berbahasa Indonesia; semua halaman baru lolos `expectNoA11yViolationsInBothThemes`, tanpa scroll horizontal di 375 px, dan gate CSP (stack Docker).
- Pesan commit bahasa Inggris (conventional); implementer commit saja, controller yang push.
- Lingkungan lokal: Postgres `tp-pg` host port **5433**; `PLAYWRIGHT_BROWSERS_PATH=C:\pw-browsers`; worker ≤ 4; Docker di Git Bash butuh `export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"`; TypeScript `^6.0.3`; heredoc bash panjang gagal — tulis file dengan tool penulis file.

## Review Focus

1. **Laporan dengan BOM UTF-8, baris CRLF, dan nama test ber-emoji/aksen** → ter-parse benar, nama tersimpan utuh. Test di Task 2.
2. **Nama test sama di dua suite berbeda** → dua `test_cases` terpisah, bukan digabung sebagai retry. Test di Task 2 (parser) dan Task 4 (DB).
3. **Pesan error panjang berisi karakter multibyte** → dipotong ≤ 4096 byte tanpa karakter rusak (hasil tetap UTF-8 valid). Test di Task 2.
4. **Branch bernama `feature/login-v2`** → bisa diunggah, dipilih di dashboard, dan dipakai di query (`?branch=feature%2Flogin-v2`). Test di Task 5 (API) dan Task 8 (UI).
5. **Upload ke-201 tepat di batas retensi** → hanya run terlama yang terhapus (sisa tepat 200, run terbaru ada). Test di Task 4.

---

## Struktur file

```
packages/shared/src/errors.ts, src/schemas/results.ts, src/schemas/tokens.ts, index.ts
apps/api/
  drizzle/ (migrasi baru)
  src/db/schema.ts                         + 4 tabel
  src/config.ts                            + ingestRateLimitMax
  src/http/security.ts                     + pengecualian XML untuk route upload
  src/modules/projects/domain/permissions.ts + "runs:delete", "tokens:manage"
  src/modules/results/domain/junit.ts, flaky.ts (+ *.test.ts)
  src/modules/results/repository.ts, cursor.ts, ingest.routes.ts, read.routes.ts
  src/modules/tokens/repository.ts, routes.ts, auth.ts
  test/integration/tokens.int.test.ts, ingest.int.test.ts, results-read.int.test.ts
  test/contract/states.ts                  + state baru; provider memverifikasi 2 pact
packages/reporter/  package.json (bin testpulse-report), src/args.ts, merge.ts, upload.ts, cli.ts (+ tests),
                    test/contract/ingest.pact.test.ts
apps/web/src/lib/api.ts                    + results, tokens
apps/web/src/pages/project/                Dashboard.tsx, RunsPage.tsx, RunPage.tsx, FlakyPage.tsx, TestHistoryPage.tsx
apps/web/src/components/charts/            TrendChart.tsx, ScoreBar.tsx, HistoryStrip.tsx
apps/web/src/pages/settings/TokensSection.tsx
tests/support/junit.ts, api-client.ts (+ createToken, uploadRun)
tests/api/results.spec.ts, authorization-matrix.ts (+ baris baru)
tests/e2e/tokens.spec.ts, dashboard.spec.ts, runs.spec.ts
tests/perf/ingest.js, read.js, fixtures/report-500.xml
.github/workflows/ci.yml (+ job k6, JUnit Playwright), deploy.yml (+ dogfooding)
docs/test-plans/tahap-2.md, docs/adr/0004-*.md, docs/TEST_STRATEGY.md, README.md, docs/deploy.md
```

---

### Task 1: Schema bersama, kode error, dan aksi izin baru

**Files:**
- Create: `packages/shared/src/schemas/results.ts`, `packages/shared/src/schemas/tokens.ts` (+ test di `schemas.test.ts` atau file baru)
- Modify: `packages/shared/src/errors.ts`, `packages/shared/src/index.ts`, `apps/api/src/modules/projects/domain/permissions.ts` (+ `permissions.test.ts`)

**Interfaces:**
- Produces (`@testpulse/shared`):
  - `RESULT_STATUSES = ["passed","failed","skipped"] as const`, `type ResultStatus`
  - `ingestQuery` (zod, aturan Global Constraints; `commit` → `commitSha` di output), `ingestResultDto` `{ runId, url, totals: { total, passed, failed, skipped, flaky } }`
  - `runSummaryDto` `{ id, branch, commitSha: string|null, ciUrl: string|null, name: string|null, createdAt, durationMs, total, passed, failed, skipped, flaky }`, `runsPageDto` `{ runs: RunSummaryDto[], nextCursor: string|null }`
  - `testResultDto` `{ testCaseId, suite, name, status, flakyInRun, retries, durationMs, message: string|null }`, `runDetailDto` `{ run: RunSummaryDto, results: TestResultDto[], nextCursor: string|null }`
  - `branchDto` `{ branch, lastRun: RunSummaryDto }`
  - `statsDto` `{ branch: string|null, points: { runId, createdAt, passRate: number|null, durationMs }[], latest: RunSummaryDto|null }`
  - `flakyTestDto` `{ testCaseId, suite, name, score, lastStatus: ResultStatus }`
  - `testHistoryDto` `{ testCase: { id, suite, name }, branch: string|null, results: { runId, createdAt, status, flakyInRun, retries, durationMs }[] }`
  - `createTokenBody` `{ name: trim 1–60 }`, `tokenDto` `{ id, name, createdAt, lastUsedAt: string|null, createdBy: { id, name } }`, `createdTokenDto` `{ id, name, token, createdAt }`
  - `ErrorCode` + 6 kode baru.
- `ProjectAction` + `"runs:delete"` (tester & admin allow; viewer forbidden; non-anggota mengikuti aturan non-baca) dan `"tokens:manage"` (admin saja). Endpoint baca hasil memakai `"project:read"`.

- [ ] **Step 1: Test gagal** — schema: `ingestQuery` menerima `branch:"feature/login-v2"`, menolak `branch:""`, `"a b"`, 201 karakter, `commit:"xyz1234"`, `"abc12"`, `ciUrl:"javascript:alert(1)"`, `ciUrl` 501 karakter, `name` 121 karakter; `createTokenBody` menolak `"   "` dan 61 karakter. Permissions (tabel seperti matriks yang ada): `runs:delete` → viewer `forbidden`, tester/admin `allow`, anonim `unauthenticated`, non-anggota privat `not_found`, non-anggota publik `forbidden`; `tokens:manage` → tester `forbidden`, admin `allow`.
- [ ] **Step 2: Jalankan — gagal.** `pnpm --filter @testpulse/shared exec vitest run` dan `pnpm --filter @testpulse/api exec vitest run --project unit` → FAIL.
- [ ] **Step 3: Implementasi** sesuai Interfaces; build shared.
- [ ] **Step 4: Jalankan — lulus** (+ `pnpm lint`, `pnpm typecheck`).
- [ ] **Step 5: Commit** — `feat(shared): schemas and error codes for test results and CI tokens`

---

### Task 2: Domain hasil — parser JUnit & skor flaky

**Files:**
- Create: `apps/api/src/modules/results/domain/junit.ts`, `junit.test.ts`, `flaky.ts`, `flaky.test.ts`
- Modify: `apps/api/package.json` (+ `fast-xml-parser`)

**Interfaces:**
- Produces:
  - `MAX_TESTCASES = 20000`, `MAX_NAME_LENGTH = 500`, `MAX_MESSAGE_BYTES = 4096`
  - `class InvalidReportError extends Error`
  - `interface ParsedResult { suite: string; name: string; status: ResultStatus; flakyInRun: boolean; retries: number; durationMs: number; message: string | null }`
  - `interface ParsedReport { durationMs: number; results: ParsedResult[] }`
  - `parseJUnit(xml: string): ParsedReport` — aturan spec §4.1 persis; melempar `InvalidReportError` untuk XML rusak, `<!DOCTYPE` (cek sebelum parsing, tidak peka huruf besar), root bukan `testsuites`/`testsuite`, nol testcase, > `MAX_TESTCASES`.
  - `truncateUtf8(text: string, maxBytes: number): string`
  - `FLAKY_WINDOW = 20`, `flakyScore(results: ReadonlyArray<{ status: ResultStatus; flakyInRun: boolean }>): number` (urut lama → baru; rumus spec §6).

- [ ] **Step 1: Test gagal** — `junit.test.ts`:
  - root `<testsuites>` bersarang dan root `<testsuite>`; `classname` diutamakan atas nama suite; status failure/error/skipped/passed; `time="1.2345"` → 1235 ms; `time` invalid → 0; durasi run dari root atau jumlah.
  - kemunculan ganda gagal→lulus → `passed`, `flakyInRun: true`, `retries: 1`, durasi dijumlah, pesan dari kegagalan terakhir; semua gagal → `failed`, `retries` sesuai.
  - Surefire `<flakyFailure>` ×2 pada testcase lulus → `flakyInRun: true`, `retries: 2`.
  - `<!DOCTYPE x [<!ENTITY a "b">]>`, `<!doctype` → `InvalidReportError`; XML rusak; root `<html>`; `<testsuites/>` kosong; 20.001 testcase → `InvalidReportError`.
  - nama 600 karakter → 500.
  - **Review Focus 1:** BOM `\uFEFF` + CRLF + nama `"login ✅ café"` → ter-parse, nama utuh.
  - **Review Focus 2:** `name="login"` di suite `A` dan `B` → dua hasil terpisah, bukan retry.
  - **Review Focus 3:** pesan 5000 karakter `"é"` → `Buffer.byteLength(msg) <= 4096` dan `msg` tidak berakhir dengan karakter pengganti `\uFFFD`.
  - `flaky.test.ts`: semua baris tabel spec §6 (L L L L → 0; G G G G → 0; L G L G → 75; 9 L + 1 L-retry → 10; hanya skip → 0), plus `[]` → 0, satu hasil gagal → 0, `L G` → 50, skip di tengah diabaikan (`L S G` → 50).
- [ ] **Step 2: Jalankan — gagal.** `pnpm --filter @testpulse/api exec vitest run --project unit results` → FAIL.
- [ ] **Step 3: Implementasi** dengan `fast-xml-parser` (`processEntities: false`, `ignoreAttributes: false`, `isArray` untuk `testsuite`/`testcase`/`failure`/`error`/`flakyFailure`/`rerunFailure`), strip BOM sebelum parsing.
- [ ] **Step 4: Jalankan — lulus** dengan coverage domain ≥ 80%.
- [ ] **Step 5: Commit** — `feat(api): JUnit parser and flaky score domain logic`

---

### Task 3: Skema database & modul token CI

**Files:**
- Modify: `apps/api/src/db/schema.ts`, `apps/api/drizzle/*` (generate), `apps/api/src/app.ts`
- Create: `apps/api/src/modules/tokens/repository.ts`, `routes.ts`, `auth.ts`, `apps/api/test/integration/tokens.int.test.ts`

**Interfaces:**
- Consumes: `resolveProject(db, slug, user, "tokens:manage")`, `generateToken()`, `hashToken()`, `createTokenBody`, `tokenDto`, `createdTokenDto` (Task 1).
- Produces:
  - Tabel `project_tokens`, `runs`, `test_cases`, `test_results` persis spec §5 (index & unique termasuk).
  - Rute `GET|POST /api/v1/projects/:slug/tokens`, `DELETE /api/v1/projects/:slug/tokens/:id` (admin; `409 TOKEN_LIMIT` saat token aktif ke-11; `404 TOKEN_NOT_FOUND` untuk id tidak dikenal/milik project lain/sudah dicabut). Token mentah = `"tp_" + generateToken()`.
  - `authenticateIngestToken(db: Db, authorization: string | undefined): Promise<{ tokenId: string; projectId: string } | null>` (format `Bearer tp_...`, hash, aktif saja).
  - `touchToken(db: Db, tokenId: string): Promise<void>` (isi `last_used_at`).

- [ ] **Step 1: Test gagal** — `tokens.int.test.ts`: admin membuat token → 201, nilai berawalan `tp_`, DB menyimpan hash (bukan nilai mentah); `GET` tidak memuat nilai token; tester/viewer → 403; non-anggota privat → 404; anonim → 401; token ke-11 aktif → 409 `TOKEN_LIMIT`, setelah mencabut satu → bisa membuat lagi; cabut → 204, tidak tampil di daftar; cabut ulang → 404; `authenticateIngestToken`: valid → `{tokenId, projectId}`, dicabut/salah/`Bearer xyz`/tanpa header → `null`; migrasi membuat empat tabel baru dengan unique `(project_id, suite, name)` dan `(run_id, test_case_id)`.
- [ ] **Step 2: Jalankan — gagal.** (Docker PATH) `pnpm --filter @testpulse/api exec vitest run --project integration tokens` → FAIL.
- [ ] **Step 3: Implementasi** + `drizzle-kit generate`.
- [ ] **Step 4: Jalankan — lulus** + seluruh suite API.
- [ ] **Step 5: Commit** — `feat(api): CI token management and results tables`

---

### Task 4: Endpoint upload (ingest)

**Files:**
- Create: `apps/api/src/modules/results/repository.ts`, `ingest.routes.ts`, `apps/api/test/integration/ingest.int.test.ts`
- Modify: `apps/api/src/http/security.ts`, `apps/api/src/config.ts` (+ `config.test.ts`), `apps/api/src/app.ts`, `.env.example`, `docker-compose.yml` (`INGEST_RATE_LIMIT_MAX=1000`)

**Interfaces:**
- Consumes: `parseJUnit`, `InvalidReportError` (Task 2), `authenticateIngestToken`, `touchToken` (Task 3), `ingestQuery`, `ingestResultDto` (Task 1).
- Produces:
  - `AppConfig.ingestRateLimitMax: number` (env `INGEST_RATE_LIMIT_MAX`, default 60, harus bilangan bulat > 0).
  - `POST /api/v1/projects/:slug/runs` sesuai spec §4 (urutan cek: Content-Type → token (401) → project cocok (404) → query (400) → ukuran (413, `bodyLimit` 5 MB per route) → parse (422) → simpan). Rate limit per route dengan `keyGenerator` = `tokenId` dari header (hash token) dan `max: config.ingestRateLimitMax`, `timeWindow: "1 hour"`.
  - `insertRun(db: Db, input: { projectId: string; tokenId: string; query: IngestQuery; report: ParsedReport }): Promise<{ runId: string; totals: Totals }>` — satu transaksi: insert run, upsert `test_cases` (batch, `ON CONFLICT DO NOTHING` lalu select id), insert `test_results` (batch), hapus run di luar 200 terbaru project.

- [ ] **Step 1: Test gagal** — `ingest.int.test.ts` (laporan dibangun dengan helper lokal):
  - sukses 201: totals benar, `url` = `${appOrigin}/p/:slug/runs/:runId`, baris DB sesuai, `last_used_at` terisi.
  - `test_cases` dipakai ulang di upload kedua (jumlah baris tidak bertambah untuk test yang sama).
  - 401 tanpa token / token dicabut / `Bearer abc` (pesan identik); cookie sesi admin tanpa token → 401.
  - token project A ke slug project B → 404 `PROJECT_NOT_FOUND`.
  - `Content-Type: application/json` → 400; `branch` kosong → 400 dengan `fields.branch`.
  - body 5 MB + 1 byte → 413 `PAYLOAD_TOO_LARGE`; `<!DOCTYPE` → 422 `INVALID_REPORT`; XML rusak → 422.
  - app dengan `ingestRateLimitMax: 3` → upload ke-4 dalam satu jam → 429; token lain tetap 201.
  - dua upload paralel (`Promise.all`) berisi test yang sama → keduanya 201, tanpa duplikat `test_cases`.
  - **Review Focus 2:** `login` di suite A dan B → dua `test_cases`.
  - **Review Focus 5:** 200 run yang ada (insert langsung lewat DB untuk kecepatan, `created_at` berurutan) + 1 upload → tersisa tepat 200, run terlama hilang, run baru ada.
  - Origin header asing tetap → 403 (pemeriksaan Origin tidak dilewati).
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi.** Di `security.ts`, pengecualian Content-Type hanya untuk method POST dengan path yang cocok `^/api/v1/projects/[^/]+/runs$` dan media type `application/xml`/`text/xml`; daftarkan content-type parser XML (`parseAs: "string"`) yang menyerahkan string ke route.
- [ ] **Step 4: Jalankan — lulus** + seluruh suite API (unit + integration).
- [ ] **Step 5: Commit** — `feat(api): JUnit ingest endpoint authenticated by CI tokens`

---

### Task 5: API baca hasil & hapus run

**Files:**
- Create: `apps/api/src/modules/results/read.routes.ts`, `cursor.ts` (+ `cursor.test.ts`), `apps/api/test/integration/results-read.int.test.ts`
- Modify: `apps/api/src/modules/results/repository.ts`, `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `resolveProject` (actions `"project:read"`, `"runs:delete"`), `flakyScore`, `FLAKY_WINDOW` (Task 2), DTO Task 1.
- Produces: rute spec §7 (branches, runs, run detail, delete run, stats, flaky, history); `encodeCursor(createdAt: Date, id: string): string` / `decodeCursor(cursor: string): { createdAt: Date; id: string } | null` (cursor rusak → 400 `VALIDATION_ERROR`); daftar flaky dihitung dengan SQL (window function per test atas 20 hasil terakhir branch).

- [ ] **Step 1: Test gagal** — `results-read.int.test.ts` (data dimasukkan lewat endpoint upload atau `insertRun`):
  - `runs`: 25 run → halaman 1 berisi 20 terbaru + `nextCursor`, halaman 2 berisi 5 + `nextCursor: null`; filter `branch`.
  - `run detail`: default hanya `failed`; `status=flaky`; `status=all` dipaginasi 100; run project lain → 404 `RUN_NOT_FOUND`.
  - `delete run`: tester 204 (hasil ikut terhapus), viewer 403.
  - `stats`: 30 titik terbaru urut waktu; `passRate` = passed/(passed+failed)×100 dibulatkan 1 desimal; run tanpa passed/failed → `null`; tanpa `branch` memakai branch run terbaru.
  - `flaky`: urutan skor turun lalu nama; maks 50; test gagal konsisten tidak muncul; **paritas**: untuk 6 pola acak-terkendali, skor SQL = `flakyScore` dari hasil yang sama.
  - `history`: 20 terbaru; test project lain → 404 `TEST_NOT_FOUND`.
  - `branches`: urut run terbaru, setiap item dengan `lastRun`.
  - project publik: anonim 200 di semua endpoint baca; privat: anonim 404.
  - **Review Focus 4:** run di branch `feature/login-v2` muncul di `branches` dan bisa difilter dengan `?branch=feature%2Flogin-v2`.
  - cursor rusak → 400.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan — lulus** + seluruh suite API.
- [ ] **Step 5: Commit** — `feat(api): read endpoints for runs, stats, flaky tests, and history`

---

### Task 6: Reporter CLI + kontrak reporter

**Files:**
- Create: `packages/reporter/{package.json,tsconfig.json,vitest.config.ts}`, `src/args.ts`, `src/merge.ts`, `src/upload.ts`, `src/cli.ts` (+ `*.test.ts`), `packages/reporter/test/contract/ingest.pact.test.ts`
- Modify: `apps/api/test/contract/provider.pact.test.ts`, `apps/api/test/contract/states.ts` (verifikasi pact web **dan** reporter; state "project testpulse punya token aktif pact-ingest-token"), root `package.json` `test:contract`, `.github/workflows/ci.yml` (job contract menjalankan consumer reporter), `pnpm-workspace.yaml` bila perlu

**Interfaces:**
- Produces:
  - bin `testpulse-report` → `dist/cli.js`; `parseArgs(argv: string[], env: NodeJS.ProcessEnv): ReporterOptions` melempar `UsageError` (pesan Indonesia); `ReporterOptions { url; project; branch; commit?; ciUrl?; name?; files: string[]; token: string }` (token dari `TESTPULSE_TOKEN`, wajib).
  - `mergeJUnit(docs: string[]): string` — menolak `<!DOCTYPE`, mengambil semua `<testsuite>` (root `testsuites` atau `testsuite`) ke satu `<testsuites>`.
  - `uploadReport(opts: ReporterOptions, xml: string, fetchFn?: typeof fetch): Promise<IngestResultDto>` — `POST {url}/api/v1/projects/{project}/runs?…`, `Authorization: Bearer`, `Content-Type: application/xml`; error HTTP → `UploadError` dengan status & kode API.
  - `main(argv, env, io): Promise<number>` → `0` sukses (mencetak totals + URL), `1` upload gagal, `2` argumen/berkas salah (glob tanpa hasil, file > 5 MB setelah merge, XML tidak valid).

- [ ] **Step 1: Test gagal** — unit: argumen wajib & pesan; token tidak boleh muncul di output mana pun (assert pada `io` yang ditangkap); glob mencocokkan beberapa file; merge dua file (root berbeda) → satu `<testsuites>` dengan semua suite; `<!DOCTYPE` → exit 2; 5 MB + 1 → exit 2; respons 422 → exit 1 dengan pesan API; 201 → exit 0 dan mencetak URL. Pact consumer `testpulse-reporter` ↔ `testpulse-api`: interaksi sukses 201 (matcher untuk `runId`, `url`, totals) dan 401.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi** (tanpa dependency runtime kecuali `fast-xml-parser` bila dipakai untuk merge; glob dengan `node:fs` `glob`).
- [ ] **Step 4: Jalankan — lulus** + `pnpm test:contract` (provider memverifikasi kedua pact).
- [ ] **Step 5: Commit** — `feat(reporter): CLI that merges and uploads JUnit reports`

---

### Task 7: Web — klien API, halaman pengaturan Token CI, helper test

**Files:**
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/pages/settings/ProjectSettingsPage.tsx`, `tests/support/api-client.ts`
- Create: `apps/web/src/pages/settings/TokensSection.tsx`, `tests/support/junit.ts`, `tests/e2e/tokens.spec.ts`

**Interfaces:**
- Produces:
  - `createApiClient` + `results: { branches(slug), runs(slug, { branch?, cursor? }), run(slug, runId, { status?, cursor? }), deleteRun(slug, runId), stats(slug, branch?), flaky(slug, branch?), history(slug, testCaseId, branch?) }` dan `tokens: { list(slug), create(slug, name), revoke(slug, id) }` (typed dengan DTO Task 1; parameter query di-encode).
  - `TestApi.createToken(owner: TestUser, slug: string, name?: string): Promise<CreatedTokenDto>`, `TestApi.uploadRun(token: string, slug: string, xml: string, query: { branch: string; commit?: string; ciUrl?: string; name?: string }): Promise<APIResponse>`.
  - `buildJUnit(cases: Array<{ suite?: string; name: string; status?: "passed"|"failed"|"skipped"; retries?: number; message?: string; timeSec?: number }>): string` di `tests/support/junit.ts` (retries → kemunculan gagal sebelum yang lulus).
  - testid spec §8: `token-name`, `token-create`, `token-value`, `token-copy`, `token-row-<id>`, `token-revoke-<id>`.

- [ ] **Step 1: E2E gagal** — `tokens.spec.ts`: admin membuat token → `token-value` berawalan `tp_`, toast "Token dibuat…", contoh curl memuat URL production-agnostic (`window.location.origin`) dan slug; token muncul di daftar (tanpa nilai); cabut → hilang; tester/viewer tidak melihat bagian Token CI; a11y dua tema.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi.** Bagian Token CI memakai pola yang sama dengan `InvitationsSection` (kotak sekali tampil, tombol salin dengan toast hasil).
- [ ] **Step 4: Jalankan** di tiga browser + E2E chromium terhadap stack Docker (gate CSP) → PASS.
- [ ] **Step 5: Commit** — `feat(web): CI token management in project settings`

---

### Task 8: Web — dashboard ringkasan project

**Files:**
- Create: `apps/web/src/pages/project/Dashboard.tsx`, `apps/web/src/components/charts/TrendChart.tsx`, `tests/e2e/dashboard.spec.ts`
- Modify: `apps/web/src/pages/ProjectPage.tsx`, `apps/web/src/App.tsx` (lazy route), `tests/pages/ProjectPage.ts`

**Interfaces:**
- Consumes: `api.results.*` (Task 7), `TestApi.createToken/uploadRun`, `buildJUnit`.
- Produces: `TrendChart({ points: StatsDto["points"] })` (SVG, `role="img"` + `aria-label` ringkasan, tabel `sr-only`); `ProjectPage` merender `Dashboard` (lazy) saat project punya run, panduan setup (`setup-instructions`, anggota) atau "Belum ada hasil test" (`empty-results`, pengunjung) saat belum; testid spec §8 (`dashboard-branch`, `stat-*`, `trend-chart`, `recent-runs`, `run-item-<id>`, `top-flaky`, `flaky-item-<testCaseId>`).

- [ ] **Step 1: E2E gagal** — `dashboard.spec.ts` (data via API: token + 3–4 upload berpola, termasuk satu test flaky):
  - angka di `stat-*` sesuai data (status run terakhir, pass rate, total, jumlah flaky); `trend-chart` berisi satu titik per run; `recent-runs` 5 terbaru; `top-flaky` memuat test flaky dengan skor.
  - pemilih branch: default `main`; **Review Focus 4:** pilih `feature/login-v2` → angka berganti ke data branch itu.
  - anggota tanpa run → `setup-instructions` memuat slug & `/api/v1/projects/<slug>/runs`; pengunjung anonim project publik tanpa run → `empty-results` "Belum ada hasil test"; anonim project publik dengan run → dashboard tampil.
  - a11y dua tema; 375 px tanpa scroll horizontal.
  - bundle: `apps/web` build menghasilkan chunk terpisah untuk dashboard (assert di unit test kecil atas `vite build` manifest **atau** catat ukuran chunk di laporan).
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi** (lazy `React.lazy` + `Suspense` fallback netral).
- [ ] **Step 4: Jalankan** tiga browser + stack Docker → PASS.
- [ ] **Step 5: Commit** — `feat(web): project dashboard with trend, recent runs, and top flaky tests`

---

### Task 9: Web — daftar run, detail run, daftar flaky, riwayat test

**Files:**
- Create: `apps/web/src/pages/project/{RunsPage,RunPage,FlakyPage,TestHistoryPage}.tsx`, `apps/web/src/components/charts/{ScoreBar,HistoryStrip}.tsx`, `tests/e2e/runs.spec.ts`, POM baru seperlunya di `tests/pages/`
- Modify: `apps/web/src/App.tsx` (rute lazy `/p/:slug/runs`, `/p/:slug/runs/:runId`, `/p/:slug/flaky`, `/p/:slug/tests/:testCaseId`)

**Interfaces:**
- Consumes: `api.results.*`, `TestApi`, `buildJUnit`.
- Produces: testid spec §8 (`runs-list`, `runs-load-more`, `run-header`, `run-filter-failed|flaky|all`, `result-row-<testCaseId>`, `run-delete`, `run-delete-confirm`, `flaky-list`, `test-history`, `history-cell-<runId>`).

- [ ] **Step 1: E2E gagal** — `runs.spec.ts`:
  - 25 run → `runs-list` 20, `runs-load-more` memuat sisanya lalu hilang.
  - detail: `run-header` menampilkan branch, commit (mono), link CI `target="_blank"` + `rel` aman; default filter Gagal; pesan error di `<details>`; filter Flaky/Semua mengubah daftar.
  - tester: `run-delete` → `run-delete-confirm` → kembali ke daftar run, run hilang; viewer tidak melihat `run-delete`.
  - `flaky-list` urut skor; klik item → `test-history` dengan 20 `history-cell-*` terbaru berlabel status teks (bukan hanya warna).
  - anonim project publik bisa membuka keempat halaman; project privat → "Project tidak ditemukan".
  - a11y dua tema; 375 px.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan** seluruh E2E tiga browser + stack Docker → PASS.
- [ ] **Step 5: Commit** — `feat(web): runs list, run detail, flaky tests, and test history pages`

---

### Task 10: Suite API test & kontrak web untuk endpoint baru

**Files:**
- Create: `tests/api/results.spec.ts`
- Modify: `tests/api/authorization-matrix.ts`, `tests/api/authorization.spec.ts`, `apps/web/test/contract/*.pact.test.ts` (file baru `results.pact.test.ts`, `tokens.pact.test.ts`), `apps/api/test/contract/states.ts`

- [ ] **Step 1: Tulis test** — matriks spec §7.1 sebagai baris data (GET hasil, DELETE run, token CRUD, POST runs dengan cookie) untuk 6 aktor + varian anonim-publik; token CI dipakai sebagai Bearer di `GET runs`, `PATCH project`, `GET members` → diperlakukan anonim (401/404/200-publik sesuai matriks); `results.spec.ts`: alur upload lewat proxy (Content-Type, 413, 422, 429 dengan stack test, `nextCursor`, `branch` ber-slash), semua respons di-parse dengan schema shared. Pact web: satu interaksi sukses per endpoint baru + `404 RUN_NOT_FOUND`, `409 TOKEN_LIMIT`.
- [ ] **Step 2: Jalankan** — `playwright test --project api` (stack Docker) dan `pnpm test:contract` → PASS; tunjukkan satu sel matriks yang gagal bila izin `runs:delete` sengaja dilonggarkan (lalu kembalikan).
- [ ] **Step 3: Commit** — `test(api): authorization matrix and contracts for results and tokens`

---

### Task 11: Uji performa k6

**Files:**
- Create: `tests/perf/ingest.js`, `tests/perf/read.js`, `tests/perf/fixtures/report-500.xml` (dibangkitkan skrip kecil `tests/perf/make-fixture.mjs`), `tests/perf/setup.mjs` (buat user, project, token lewat API; tulis token ke env/file untuk k6)
- Modify: `.github/workflows/ci.yml` (job `perf` setelah `stack-tests`, sebelum `report`), `docs/TEST_STRATEGY.md` (bagian performa singkat)

- [ ] **Step 1: Tulis skenario** — `ingest.js`: 5 VU × 30 detik upload `report-500.xml`; `read.js`: 10 VU × 30 detik `stats`, `runs`, `flaky` pada project berisi ≥ 50 run (disiapkan `setup.mjs`). Threshold: `http_req_duration{scenario:ingest}` p(95) < 1500, `http_req_duration{scenario:read}` p(95) < 300, `http_req_failed` < 0.01.
- [ ] **Step 2: Jalankan lokal** terhadap stack Docker dengan `docker run --rm --network testpulse_default -v "$PWD/tests/perf:/scripts" grafana/k6:<versi tetap> run /scripts/ingest.js -e BASE_URL=http://web:8080 ...` → lulus; buktikan gate bisa gagal (turunkan threshold sementara ke p(95) < 1 → gagal, kembalikan).
- [ ] **Step 3: Tambah job CI** (compose up, setup, kedua skenario, upload ringkasan JSON k6 sebagai artifact; versi image k6 dipin). Validasi actionlint.
- [ ] **Step 4: Commit** — `test(perf): k6 ingest and read scenarios as a CI gate`

---

### Task 12: Dogfooding, smoke, dan dokumentasi

**Files:**
- Modify: `tests/playwright.config.ts` (reporter JUnit di CI → `allure-results/junit-<project>-<shard>.xml`), `.github/workflows/deploy.yml` (unduh artifact run CI pemicu + jalankan reporter; permission `actions: read`; dilewati dengan warning bila `TESTPULSE_TOKEN` kosong; `continue-on-error: true`), `tests/smoke/smoke.spec.ts` (dashboard `/p/testpulse` menampilkan ≥ 1 run, dilewati dengan pesan bila belum ada run), `docs/deploy.md` (langkah membuat `TESTPULSE_TOKEN`), `README.md` (fitur Tahap 2, contoh curl + reporter, roadmap Tahap 2 ✅, screenshot dashboard), `docs/TEST_STRATEGY.md` (lapisan & risiko baru, snapshot jumlah test), `apps/web/src/pages/landing/Features.tsx` (kartu "Dashboard hasil test & deteksi flaky" → Tersedia), `apps/web/src/pages/landing/Roadmap.tsx` (Tahap 2 Live, Tahap 3 Berikutnya), `apps/web/src/pages/landing/Quality.tsx` (snapshot disinkronkan), `tests/e2e/landing.spec.ts` (badge "Segera" kini 3, Tahap 3–5)
- Create: `docs/test-plans/tahap-2.md`, `docs/adr/0004-ingest-sinkron-dan-definisi-flaky.md`, `docs/images/dashboard-light.png`, `docs/images/dashboard-dark.png` (skrip screenshot diperluas)

- [ ] **Step 1: Ubah test dulu** — `landing.spec.ts` (3 badge Segera, Tahap 2 tersedia), smoke (cek dashboard dengan skip bila kosong). Jalankan → landing FAIL.
- [ ] **Step 2: Implementasi** perubahan landing, Playwright JUnit di CI, deploy.yml dogfooding, dokumen.
- [ ] **Step 3: Verifikasi** — seluruh E2E chromium di stack Docker; actionlint kedua workflow; reporter dijalankan manual terhadap stack Docker memakai file JUnit lokal (exit 0, run tampil di dashboard); link-check README/docs; angka snapshot = hasil hitung nyata.
- [ ] **Step 4: Commit** — `feat: dogfood test results to production and document Tahap 2`

---

## Definisi selesai

Sama dengan spec §15: upload curl & reporter berfungsi aman; dashboard & halaman §8 di dua tema dan 375 px; semua lapisan termasuk k6 & gate CSP hijau di CI; `/p/testpulse` di production menampilkan run nyata (setelah user membuat `TESTPULSE_TOKEN`); dokumentasi diperbarui.
