# TestPulse Tahap 3 — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bug tracker (manual & dari test gagal, workflow tetap, komentar, riwayat) dan deteksi regresi antar versi (versi pada run, perbandingan otomatis, halaman versi) di TestPulse, plus visual regression untuk TestPulse sendiri.

**Architecture:** Modul API baru `bugs` (tabel `bugs`, `bug_labels`, `bug_links`, `bug_comments`, `bug_events`, counter `projects.bug_seq`) dan perluasan modul `results` (kolom `runs.version`, endpoint `versions`/`compare`, badge bug di DTO Tahap 2). Logika murni (transisi, urutan versi, klasifikasi perbandingan, pemilihan pembanding) di folder `domain`. Web menambah tab navigasi project, halaman bug/versi/perbandingan (lazy), dan komponen Markdown aman. Project Playwright baru `visual` berjalan di container Playwright resmi.

**Tech Stack:** Fastify 5, Drizzle + Postgres, Zod 4, React 19 + Router 7 + Tailwind/shadcn (komponen yang diizinkan), `react-markdown` + `remark-gfm` (tanpa `rehype-raw`), Vitest, Testcontainers, Playwright, Pact, k6, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-11-04-testpulse-tahap3-design.md](../specs/2026-11-04-testpulse-tahap3-design.md) — juga mengikat spec Tahap 1, UI 2026-10-26, dan Tahap 2.

## Global Constraints

- Bug: judul trim 3–200; deskripsi 0–20.000; komentar trim 1–10.000; label maks 10, unik, 1–30 `[a-z0-9-]` (input di-lowercase & di-trim); link maks 10, URL http/https ≤ 2000 tanpa username/password, title ≤ 100; default `priority` `medium`, `severity` `major`.
- Enum: status `open`·`in_progress`·`resolved`·`closed`; resolution `fixed`·`wont_fix`·`duplicate`·`cannot_reproduce`; priority `low`·`medium`·`high`·`urgent`; severity `minor`·`major`·`critical`·`blocker`.
- Transisi & aturan resolusi persis spec §3.2; konflik versi `409 BUG_CONFLICT`; transisi tak sah `409 INVALID_TRANSITION`.
- Versi run: 1–50 `[A-Za-z0-9._+-]`; urutan spec §4.2; pembanding default §4.3; kelompok §4.4 (lebih lambat: > 1,5× **dan** selisih > 1000 ms); kalimat §4.5 (copy persis).
- Paginasi: bug 25/halaman; activity 50; kelompok compare 200 pertama lalu 100/halaman; versions maks 100; labels maks 200; badge `bugs` maks 5 per test, non-`closed`.
- Kode error baru: `BUG_NOT_FOUND`, `COMMENT_NOT_FOUND`, `BUG_CONFLICT`, `INVALID_TRANSITION`. Aksi izin baru `"bugs:write"` (tester, admin), `"bugs:delete"` (admin). Matriks spec §6.3.
- Token CI **tidak** berlaku di endpoint bug/versions/compare. Bentuk error tetap `{ error: { code, message, fields? } }`.
- Markdown: tanpa HTML mentah, link hanya `http:`/`https:`/`mailto:` dengan `target="_blank" rel="noopener noreferrer"`, gambar dirender sebagai link, tanpa atribut `style`.
- CSP **tidak** dilonggarkan; komponen shadcn yang diizinkan saja (button, card, input, label, badge, separator, dropdown-menu `modal={false}`); tanpa dialog; `<select>` native (catatan Ruling T8-b: `<select>` di dalam subtree Suspense memicu artefak guard CSP WebKit — letakkan di luar boundary bila muncul).
- UI bahasa Indonesia; semua halaman baru lolos `expectNoA11yViolationsInBothThemes`, tanpa scroll horizontal di 375 px, gate CSP (stack Docker); fixture `newContext`, bukan `browser.newContext`.
- Migrasi hanya menambah (aman untuk DB production berisi data); jangan mengubah migrasi lama.
- Pesan commit bahasa Inggris (conventional), tanpa trailer atribusi; implementer commit saja, controller yang push.
- Lingkungan lokal: Postgres `tp-pg` port **5433**; `PLAYWRIGHT_BROWSERS_PATH=C:\pw-browsers`; worker ≤ 4; Git Bash Docker: `export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"`; TypeScript `^6.0.3`; heredoc bash panjang gagal — tulis file dengan tool penulis file; Playwright dijalankan dari `tests/` dengan `--project=<nama>`.

## Review Focus

1. **Label dengan huruf besar, spasi, atau duplikat** (`"UI"`, `" ui "`, `"ui"`) → tersimpan satu label `ui`; filter `label=UI` menemukan bug itu. Test di Task 1 (schema) dan Task 4 (DB).
2. **Versi `v1.0.1` dan `1.0.1` di branch yang sama** → dianggap versi yang sama (satu baris di halaman Versi, label = string mentah run terbarunya; tidak saling dibandingkan). Test di Task 2 (domain) dan Task 6 (API).
3. **Perbandingan run dengan dirinya sendiri** (`base == target`) → `400 VALIDATION_ERROR` dengan pesan jelas, bukan halaman "tidak ada perubahan". Test di Task 6 (API) dan Task 10 (UI menonaktifkan pilihan yang sama).
4. **Judul/komentar/blok kode sangat panjang tanpa spasi atau ber-emoji** → tersimpan utuh; halaman tidak scroll horizontal di 375 px (blok kode scroll di dalam wadahnya sendiri). Test di Task 7 (Markdown) dan Task 9 (detail bug).
5. **Melaporkan bug dua kali dari test gagal yang sama** → baris test yang sudah punya bug non-`closed` menampilkan badge bug (bukan tombol "Laporkan bug") di detail run dan perbandingan. Test di Task 8 dan Task 10.

---

## Struktur file

```
packages/shared/src/errors.ts, schemas/bugs.ts, schemas/compare.ts, schemas/results.ts (+version, +bugs), index.ts
apps/api/
  drizzle/ (migrasi 0003 baru)
  src/db/schema.ts                               + kolom & 5 tabel
  src/modules/projects/domain/permissions.ts     + "bugs:write", "bugs:delete"
  src/modules/projects/members.routes.ts|repository.ts  + kosongkan assignee saat keluar/dikeluarkan
  src/modules/bugs/domain/transitions.ts (+test)
  src/modules/bugs/repository.ts, routes.ts, comments.routes.ts, cursor.ts (+test)
  src/modules/results/domain/versions.ts, compare.ts, baseline.ts (+tests)
  src/modules/results/compare.repository.ts, compare.routes.ts, repository.ts (+version, +bug refs)
  test/integration/bugs.int.test.ts, bug-comments.int.test.ts, compare.int.test.ts, migration-0003.int.test.ts
packages/reporter/src/args.ts, upload.ts (+ --app-version), test/contract/ingest.pact.test.ts
apps/web/src/lib/api.ts (+ bugs, comments, versions, compare), lib/compareSummary.ts (+test), lib/markdown-url.ts (+test)
apps/web/src/components/Markdown.tsx, ProjectTabs.tsx, BugBadge.tsx, BugStatus.tsx
apps/web/src/pages/project/ BugsPage.tsx, BugNewPage.tsx, BugPage.tsx, ComparePage.tsx, VersionsPage.tsx,
                            CompareSummary.tsx (dipakai dashboard, run, compare), lazyPages.ts
tests/support/api-client.ts (+ createBug, …), tests/api/bugs.spec.ts, compare.spec.ts, authorization-matrix.ts
tests/e2e/bugs.spec.ts, compare.spec.ts, markdown.spec.ts, navigation.spec.ts
tests/visual/*.spec.ts, tests/visual/__screenshots__/, tests/playwright.config.ts (+ project visual), scripts/visual.sh
tests/perf/setup.mjs, read.js
.github/workflows/ci.yml (+ job visual), deploy.yml (+ --app-version), package.json (+ "version": "0.3.0")
docs/test-plans/tahap-3.md, docs/adr/0005-perbandingan-versi-dan-markdown-aman.md, docs/TEST_STRATEGY.md, README.md
apps/web/src/pages/landing/{Features,Roadmap,Quality}.tsx, tests/e2e/landing.spec.ts
```

---

### Task 1: Schema bersama, kode error, dan aksi izin

**Files:**
- Create: `packages/shared/src/schemas/bugs.ts`, `packages/shared/src/schemas/compare.ts` (+ test)
- Modify: `packages/shared/src/schemas/results.ts`, `packages/shared/src/errors.ts`, `packages/shared/src/index.ts`, `apps/api/src/modules/projects/domain/permissions.ts` (+ test)

**Interfaces:**
- Produces (`@testpulse/shared`):
  - `BUG_STATUSES`, `BUG_RESOLUTIONS`, `BUG_PRIORITIES`, `BUG_SEVERITIES` (`as const`) + tipe.
  - `bugLabel` (trim + lowercase, lalu regex), `bugLink` `{ url, title? }`, `createBugBody` `{ title, description?, priority?, severity?, assigneeId?: uuid|null, labels?, links?, testCaseId?, runId? }` (refine: `runId` butuh `testCaseId`; label unik setelah normalisasi), `updateBugBody` `{ version: int ≥ 1, ...field opsional, status?, resolution?: enum|null }` (refine: minimal satu field selain `version`), `bugListQuery` (spec §6 baris pertama; `q` ≤ 100), `commentBody` `{ body }`.
  - DTO: `bugRefDto` `{ number, title, status }`, `bugSummaryDto` `{ number, title, status, resolution, priority, severity, assignee: {id,name}|null, labels, updatedAt, createdAt }`, `bugDto` (= summary + `description`, `reporter`, `links`, `testCase: {id,suite,name}|null`, `runId|null`, `version`, `resolvedAt`, `closedAt`, `testHint|null`), `bugsPageDto` `{ bugs, nextCursor }`, `commentDto` `{ id, author:{id,name}, body: string|null, createdAt, editedAt, deletedAt }`, `bugEventDto` `{ id, actor:{id,name}, field, oldValue, newValue, createdAt }`, `activityPageDto` `{ items: ({kind:"comment"} & CommentDto | {kind:"event"} & BugEventDto)[], nextCursor }`, `testHintDto` (spec §6.2).
  - `runVersion` (1–50 `[A-Za-z0-9._+-]`); `ingestQuery` + `version?`; `runSummaryDto` + `version: string|null`; `runsQuery`… (API lokal) + `version?`; `testResultDto`, `flakyTestDto`, `testHistoryDto.testCase` + `bugs: BugRefDto[]`.
  - `COMPARE_GROUPS = ["regressions","fixed","stillFailing","slower","added","removed"] as const`; `compareItemDto`, `compareDto`, `compareGroupPageDto` `{ items, nextCursor }`, `versionDto` `{ version, run, runCount, passRate, passRateDelta }`, `compareQuery` `{ base?, target?, branch?, group?, cursor? }` (`group` wajib bila `cursor`).
  - `ErrorCode` + 4 kode baru.
- `ProjectAction` + `"bugs:write"` (tester & admin) dan `"bugs:delete"` (admin).

- [ ] **Step 1: Test gagal** — schema: label `" UI "` → `"ui"`; label `"ui_x"`, 31 karakter → tolak; `["ui","UI"]` → tolak (duplikat setelah normalisasi; **Review Focus 1**); judul `"  ab "` tolak, 201 karakter tolak; deskripsi 20.001 tolak; 11 label / 11 link tolak; link `javascript:alert(1)`, `https://u:p@x.io`, 2001 karakter tolak; `runId` tanpa `testCaseId` tolak; `updateBugBody` `{version:1}` saja tolak; `runVersion` `"1.0.1"`, `"v2.0.0-beta.1+sha.5"`, `"build-42"` terima, `"1 0"`, `""`, 51 karakter tolak. Permissions (tabel matriks): `bugs:write` viewer `forbidden`, tester/admin `allow`, anonim `unauthenticated`, non-anggota privat `not_found`, publik `forbidden`; `bugs:delete` tester `forbidden`, admin `allow`.
- [ ] **Step 2: Jalankan — gagal.** `pnpm --filter @testpulse/shared exec vitest run`; `pnpm --filter @testpulse/api exec vitest run --project unit permissions`.
- [ ] **Step 3: Implementasi** sesuai Interfaces; build shared.
- [ ] **Step 4: Jalankan — lulus** (+ `pnpm lint`, `pnpm typecheck`).
- [ ] **Step 5: Commit** — `feat(shared): schemas for bugs, versions, and run comparison`

---

### Task 2: Domain murni — transisi bug, urutan versi, klasifikasi & pembanding

**Files:**
- Create: `apps/api/src/modules/bugs/domain/transitions.ts` (+ test), `apps/api/src/modules/results/domain/versions.ts`, `compare.ts`, `baseline.ts` (+ tests)

**Interfaces:**
- Produces:
  - `canTransition(from: BugStatus, to: BugStatus): boolean`; `applyStatusChange(current: { status; resolution }, change: { status: BugStatus; resolution?: BugResolution | null }, now: Date): { status; resolution; resolvedAt?: Date|null; closedAt?: Date|null } | { error: "INVALID_TRANSITION" } | { error: "RESOLUTION_REQUIRED" }` (spec §3.2; kolom tanggal hanya dikembalikan bila berubah).
  - `parseSemver(v: string): Semver | null`; `compareSemver(a: Semver, b: Semver): number`; `sameVersion(a: string, b: string, allSemver: boolean): boolean`; `orderVersions(entries: ReadonlyArray<{ version: string; latestRunAt: Date }>): string[]` (terendah → tertinggi; spec §4.2; versi yang sama menurut semver digabung, label = string run terbarunya — **Review Focus 2**).
  - `classify(base: ReadonlyArray<CompareSide>, target: ReadonlyArray<CompareSide>): Record<CompareGroup, CompareMatch[]>` dengan `CompareSide = { testCaseId; status; durationMs; flakyInRun }`, `SLOWER_RATIO = 1.5`, `SLOWER_MIN_DELTA_MS = 1000` (spec §4.4).
  - `pickBaseline(target: RunRef, branchRuns: ReadonlyArray<RunRef>): RunRef | null` dengan `RunRef = { id; createdAt; version: string|null }`, `branchRuns` urut lama → baru (spec §4.3 langkah 1–3); `pickDefaultTarget(branchRuns): RunRef | null`.

- [ ] **Step 1: Test gagal** —
  - transisi: seluruh 16 pasangan dari×ke (tabel spec §3.2; sama→sama = tidak sah); `open→resolved` tanpa resolusi → `RESOLUTION_REQUIRED`; `resolved→closed` tanpa resolusi mempertahankan resolusi lama dan mengisi `closedAt`; buka ulang dari `closed` mengosongkan resolusi, `resolvedAt`, `closedAt`.
  - versi: `1.0.10 > 1.0.9`; `1.0.0-beta < 1.0.0`; `1.0.0-alpha.2 < 1.0.0-alpha.10`; `1.0.0-alpha < 1.0.0-alpha.1`; `v1.2.3 == 1.2.3`; `1.0.0+a == 1.0.0+b`; campuran `["1.0.0","build-42"]` → urut menurut `latestRunAt`; **Review Focus 2**: `v1.0.1` dan `1.0.1` → satu entri berlabel string dengan `latestRunAt` terbaru.
  - klasifikasi: setiap kelompok; `skipped` di salah satu sisi tidak masuk regresi/diperbaiki/masih gagal/lebih lambat; lulus-setelah-retry = lulus (flag diteruskan); batas lebih lambat: 1000→1500 ms (rasio 1,5, selisih 500) tidak; 2000→3001 (rasio 1,5005, selisih 1001) ya; 2000→3000 (rasio tepat 1,5) tidak; 100→1200 (selisih 1100, rasio 12) ya.
  - pembanding: target berversi `1.0.1` dengan run `1.0.0` (dua run, ambil yang terakhir) → run terakhir `1.0.0`; target tanpa versi → run tepat sebelumnya; target versi terendah → run tepat sebelumnya; satu-satunya run → `null`; target default = run versi tertinggi (bukan run terbaru) bila ada versi.
- [ ] **Step 2: Jalankan — gagal.** `pnpm --filter @testpulse/api exec vitest run --project unit bugs results/domain`.
- [ ] **Step 3: Implementasi** (tanpa dependency semver eksternal; pembanding pre-release per identifier numerik/alfanumerik sesuai semver 2.0).
- [ ] **Step 4: Jalankan — lulus** dengan coverage domain ≥ 80%.
- [ ] **Step 5: Commit** — `feat(api): bug transitions, version ordering, and comparison domain logic`

---

### Task 3: Migrasi DB, versi pada upload & daftar run, opsi reporter

**Files:**
- Modify: `apps/api/src/db/schema.ts`, `apps/api/drizzle/*` (generate 0003), `apps/api/src/modules/results/ingest.routes.ts`, `repository.ts`, `read.routes.ts`, `packages/reporter/src/args.ts`, `upload.ts` (+ tests), `packages/reporter/test/contract/ingest.pact.test.ts`, `apps/api/test/contract/states.ts`
- Create: `apps/api/test/integration/migration-0003.int.test.ts`

**Interfaces:**
- Consumes: `runVersion`, `ingestQuery`, `runSummaryDto` (Task 1).
- Produces: kolom & tabel spec §5 (nama Drizzle: `bugs`, `bugLabels`, `bugLinks`, `bugComments`, `bugEvents`, `projects.bugSeq`, `runs.version`); upload menyimpan `version`; `GET /runs?version=`; `RunSummaryDto.version` di semua respons; reporter `--app-version <v>` (`ReporterOptions.appVersion?`).

- [ ] **Step 1: Test gagal** — integration: upload `?version=1.0.1` → `runs.version` terisi & tampil di `GET /runs`, `GET /runs/:id`, `branches`, `stats.latest`; `?version=1%200` → 400 `fields.version`; filter `?version=1.0.1`; migrasi 0003 diterapkan di atas DB berisi data Tahap 2 (seed run + hasil, lalu migrate) tanpa error dan data lama utuh, `version` null. Reporter unit: `--app-version 1.0.1` masuk query `version`; nilai salah → exit 2; Pact reporter: interaksi sukses membawa `version`.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi** + `drizzle-kit generate` (cek SQL: hanya `ADD COLUMN`/`CREATE TABLE`/`CREATE INDEX`; index parsial `bugs (test_case_id) WHERE status <> 'closed'`).
- [ ] **Step 4: Jalankan — lulus** + seluruh suite API, reporter, `pnpm test:contract`.
- [ ] **Step 5: Commit** — `feat(api): run versions and bug tables`

---

### Task 4: API bug — buat, daftar, detail, ubah, hapus, label

**Files:**
- Create: `apps/api/src/modules/bugs/repository.ts`, `routes.ts`, `cursor.ts` (+ test), `apps/api/test/integration/bugs.int.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/modules/projects/members.routes.ts` dan/atau `projects/repository.ts` (pengosongan assignee)

**Interfaces:**
- Consumes: Task 1 schema/DTO, `canTransition`/`applyStatusChange` (Task 2), `resolveProject` (`"project:read"`, `"bugs:write"`, `"bugs:delete"`), `isUuid`.
- Produces: rute spec §6 untuk `/bugs`, `/bugs/labels`, `/bugs/:number` (GET/PATCH/DELETE); `createBug(db, input): Promise<BugDto>` (nomor via `UPDATE projects SET bug_seq = bug_seq + 1 … RETURNING`); `updateBug(db, input): Promise<BugDto | "conflict" | "invalid_transition" | "resolution_required">` (satu transaksi: `SELECT … FOR UPDATE` bug, cek `version`, terapkan, tulis `bug_events`, naikkan `version`); `clearAssigneeOnLeave(tx, projectId, userId, actorId): Promise<void>`. `testHint` diisi `null` di task ini (diisi Task 6).

- [ ] **Step 1: Test gagal** — `bugs.int.test.ts`:
  - buat → `201`, nomor 1, default `medium`/`major`/`open`, reporter = pembuat; 20 bug paralel → nomor 1–20 unik; nomor tidak dipakai ulang setelah bug #20 dihapus (bug baru = #21).
  - validasi: assignee bukan anggota → 400 `fields.assigneeId`; `testCaseId` project lain / run tanpa hasil test itu → 400.
  - daftar: default `active`; `status=done|all|resolved`; `assignee=me|none|<uuid>`; `priority`, `severity`, `label` (**Review Focus 1**: bug berlabel `["UI "]` ditemukan dengan `label=ui` dan `label=UI`); `q` dengan `%` dan `_` dicocokkan literal; `sort=priority` (urgent dulu, lalu `updated_at desc`); 30 bug → halaman 25 + cursor → 5; cursor rusak → 400.
  - ubah: field biasa menulis event per field (deskripsi tanpa nilai); nilai sama → `200`, `version` tetap, tanpa event; `version` basi → `409 BUG_CONFLICT` tanpa perubahan; transisi tak sah → `409 INVALID_TRANSITION`; `open→resolved` tanpa resolusi → 400 `fields.resolution`; buka ulang mengosongkan resolusi & tanggal; update gagal di tengah (paksa error) → tidak ada event tertulis.
  - hapus: admin 204, tester 403; `GET` sesudahnya `404 BUG_NOT_FOUND`; nomor tak dikenal / bug project lain → `404 BUG_NOT_FOUND`.
  - `labels`: unik, urut abjad.
  - keluarkan anggota & keluar sendiri → assignee bug-nya null + event `assignee` (actor benar); run asal dihapus (`DELETE run`) → `runId` null.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi** (insert label & link dalam transaksi yang sama; urutan link = `position`).
- [ ] **Step 4: Jalankan — lulus** + seluruh suite API.
- [ ] **Step 5: Commit** — `feat(api): bug tracker endpoints with optimistic concurrency and history`

---

### Task 5: API komentar & aktivitas

**Files:**
- Create: `apps/api/src/modules/bugs/comments.routes.ts`, `apps/api/test/integration/bug-comments.int.test.ts`
- Modify: `apps/api/src/modules/bugs/repository.ts`, `apps/api/src/app.ts`

**Interfaces:**
- Consumes: Task 4 (`findBugByNumber`), Task 1 DTO.
- Produces: `POST /bugs/:number/comments`, `PATCH|DELETE /bugs/:number/comments/:id`, `GET /bugs/:number/activity?cursor=` (gabungan komentar + event urut `created_at`, lalu jenis, lalu id; 50/halaman; cursor buram).

- [ ] **Step 1: Test gagal** — tester berkomentar `201`; viewer 403; body spasi saja 400; 10.001 karakter 400; penulis edit → `editedAt` terisi; orang lain (tester) edit/hapus → 403; admin hapus komentar orang lain 204 → item tampil `body: null, deletedAt` di activity; edit komentar terhapus → `404 COMMENT_NOT_FOUND`; komentar bug lain via nomor bug ini → 404; penulis yang turun menjadi viewer → edit 403; activity 120 item → 50/50/20 dengan cursor, urutan lama → baru, campuran komentar & event; project publik: anonim membaca activity (nama penulis ada, email tidak pernah ada di respons).
- [ ] **Step 2–4:** gagal → implementasi → lulus (+ seluruh suite API).
- [ ] **Step 5: Commit** — `feat(api): bug comments and activity timeline`

---

### Task 6: API versi, perbandingan, petunjuk test, dan badge bug

**Files:**
- Create: `apps/api/src/modules/results/compare.repository.ts`, `compare.routes.ts`, `apps/api/test/integration/compare.int.test.ts`
- Modify: `apps/api/src/modules/results/repository.ts`, `read.routes.ts`, `apps/api/src/modules/bugs/repository.ts` (`testHint`), `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `orderVersions`, `classify`, `pickBaseline`, `pickDefaultTarget` (Task 2); Task 1 DTO.
- Produces: `GET /versions?branch=`, `GET /compare?base=&target=&branch=&group=&cursor=` (spec §6); `bugRefsForTests(db, projectId, testCaseIds: string[]): Promise<Map<string, BugRefDto[]>>` (satu query); field `bugs` di detail run, flaky, history; `testHint` di detail bug.

- [ ] **Step 1: Test gagal** — `compare.int.test.ts` (data via `insertRun`):
  - default: upload `1.0.0` (2 run) lalu `1.0.1` → target = run `1.0.1`, base = run terakhir `1.0.0`; tanpa versi → run terakhir vs sebelumnya; satu run → `base: null`, semua kelompok kosong.
  - kelompok benar pada data berpola (regresi, diperbaiki, masih gagal, lebih lambat, baru, hilang, skipped diabaikan); kelompok `added` 250 test → 200 item + `nextCursor`, `?group=added&cursor=` → 50 sisanya; `cursor` tanpa `group` → 400.
  - **Review Focus 3:** `base == target` → 400 `VALIDATION_ERROR`; run project lain → `404 RUN_NOT_FOUND`.
  - **Review Focus 2:** run `v1.0.1` dan `1.0.1` → satu versi di `/versions`, tidak dibandingkan satu sama lain (pembanding = versi di bawahnya).
  - `/versions`: urut terbaru dulu, `runCount`, `passRate`, `passRateDelta` (null untuk versi terendah); branch non-semver diurutkan menurut waktu.
  - badge: bug non-closed tertaut ke test muncul di detail run, flaky, history (maks 5, terbaru dulu); bug `closed` tidak muncul; jumlah query tetap untuk 1 vs 100 test (hitung query lewat logger/spy).
  - `testHint`: 20 hasil terakhir di branch run asal, `consecutivePasses`, `lastStatus`; run asal terhapus → branch dari hasil terbaru.
  - project privat: anonim 404 di `/versions` & `/compare`.
- [ ] **Step 2–4:** gagal → implementasi (query compare mengambil hasil kedua run dengan satu query per run, klasifikasi di domain; read query memakai `statement_timeout` seperti Tahap 2) → lulus (+ seluruh suite API).
- [ ] **Step 5: Commit** — `feat(api): version list, run comparison, and bug badges on test results`

---

### Task 7: Web — klien API, tab navigasi project, komponen Markdown

**Files:**
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/pages/project/ProjectFrame.tsx`, `apps/web/src/pages/ProjectPage.tsx`, `apps/web/package.json`
- Create: `apps/web/src/components/ProjectTabs.tsx`, `Markdown.tsx`, `apps/web/src/lib/markdown-url.ts` (+ test), `tests/e2e/navigation.spec.ts`

**Interfaces:**
- Produces: `api.bugs.{list, labels, get, create, update, remove}`, `api.comments.{create, update, remove}`, `api.bugs.activity(slug, number, cursor?)`, `api.results.versions(slug, branch?)`, `api.results.compare(slug, { base?, target?, branch? })`, `api.results.compareGroup(slug, params & { group, cursor })` (param kosong dihilangkan, Ruling T5-b); `<ProjectTabs slug active canSeeSettings />` (testid `project-tabs`, `tab-ringkasan|run|versi|bug|flaky|pengaturan`, `aria-current="page"`); `<Markdown source />`; `safeMarkdownUrl(url: string): string | null`.

- [ ] **Step 1: Test gagal** — unit `markdown-url.test.ts`: `javascript:`, `JaVaScRiPt:`, `data:`, `vbscript:`, ` javascript:` (spasi depan), URL relatif → `null`; `https://x.io`, `mailto:a@b.c` → sama. Unit render `Markdown` (server render ke string, `react-dom/server`): `<script>` tampil sebagai teks; `![a](https://x/y.png)` menghasilkan `<a>` bukan `<img>`; tabel GFM tanpa atribut `style`; link punya `rel="noopener noreferrer"`; blok kode dibungkus wadah `overflow-x-auto` (**Review Focus 4**). E2E `navigation.spec.ts`: tab tampil di Ringkasan/Run/Versi/Bug/Flaky, tab aktif `aria-current`, "Pengaturan" hanya untuk anggota, 375 px tanpa scroll horizontal halaman (tab scroll di wadahnya), a11y dua tema.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi** — `react-markdown` + `remark-gfm` versi stabil terkini, `skipHtml`, `urlTransform` memakai `safeMarkdownUrl`, komponen `img` diganti link; tab dirender di `ProjectFrame` dan `ProjectPage` (halaman Versi/Bug cukup tautan ke rute yang dibuat Task 8–10; rute yang belum ada boleh NotFound sementara).
- [ ] **Step 4: Jalankan** unit web + navigation E2E tiga browser + stack Docker (gate CSP) → PASS.
- [ ] **Step 5: Commit** — `feat(web): project tabs, safe markdown, and API client for bugs and comparison`

---

### Task 8: Web — daftar bug, buat bug, laporkan dari test gagal

**Files:**
- Create: `apps/web/src/pages/project/BugsPage.tsx`, `BugNewPage.tsx`, `apps/web/src/components/BugStatus.tsx`, `BugBadge.tsx`, `tests/e2e/bugs.spec.ts` (bagian daftar & buat)
- Modify: `apps/web/src/App.tsx`, `lazyPages.ts`, `apps/web/src/pages/project/RunPage.tsx`, `tests/support/api-client.ts` (+ `createBug`, `updateBug`, `addComment`)

**Interfaces:**
- Consumes: Task 7 klien & komponen; `TestApi.createToken/uploadRun`, `buildJUnit`.
- Produces: rute `/p/:slug/bugs`, `/p/:slug/bugs/new`; `<BugStatus status resolution />`, `<BugBadge bug: BugRefDto slug />` (testid `bug-badge-<number>`); tombol `report-bug-<testCaseId>` di detail run; `TestApi.createBug(user, slug, body)`, `TestApi.updateBug(user, slug, number, body)`, `TestApi.addComment(user, slug, number, body)`.

- [ ] **Step 1: E2E gagal** — daftar: tab Aktif/Selesai/Semua, filter prioritas/severity/assignee ("Bug saya", "Belum di-assign")/label/cari tersimpan di URL dan bertahan setelah reload; 30 bug → 25 + "Muat lagi"; tester melihat `bug-create`, viewer tidak. Buat: validasi judul (pesan di bawah field), pratinjau Markdown, label & link. Dari test gagal: detail run → `report-bug-<id>` → form terisi (judul nama test, deskripsi memuat branch, commit, link CI, pesan error dalam blok kode, severity major) → simpan → detail bug (sementara cukup URL `/bugs/1` termuat) dan kembali ke run: badge `bug-badge-1` menggantikan tombol (**Review Focus 5**). Anonim publik melihat daftar tanpa tombol. a11y dua tema; 375 px.
- [ ] **Step 2–4:** gagal → implementasi → tiga browser + stack Docker → PASS.
- [ ] **Step 5: Commit** — `feat(web): bug list, bug creation, and reporting bugs from failed tests`

---

### Task 9: Web — detail bug, komentar, riwayat, badge di halaman hasil test

**Files:**
- Create: `apps/web/src/pages/project/BugPage.tsx`, `tests/e2e/markdown.spec.ts`
- Modify: `apps/web/src/App.tsx`, `lazyPages.ts`, `FlakyPage.tsx`/`components/FlakyTestItem.tsx`, `TestHistoryPage.tsx`, `tests/e2e/bugs.spec.ts`

**Interfaces:**
- Consumes: Task 7–8.
- Produces: rute `/p/:slug/bugs/:number`; testid spec §7.6 untuk detail (`bug-title`, `bug-description`, `bug-status`, `bug-transition-<status>`, `bug-resolution`, `bug-assignee`, `bug-labels`, `bug-links`, `bug-test-hint`, `bug-activity`, `comment-input`, `comment-submit`, `comment-<id>`, `bug-conflict`, `bug-delete`, `bug-delete-confirm`).

- [ ] **Step 1: E2E gagal** — alur: assign ke anggota → "Mulai kerjakan" → komentar → "Tandai selesai" (pilih resolusi inline) → "Buka ulang"; timeline memuat setiap perubahan dengan teks manusiawi ("… mengubah status Open → In progress"); edit judul/deskripsi inline; edit & hapus komentar sendiri ("diedit", "Komentar dihapus"); konflik: dua konteks membuka bug yang sama, konteks A menyimpan, konteks B menyimpan → `bug-conflict` tampil, tombol muat ulang memuat versi terbaru; admin hapus bug dengan konfirmasi inline → kembali ke daftar; viewer & anonim publik tanpa kontrol edit; kartu test asal menampilkan petunjuk ("Masih gagal di run terakhir") dan link ke riwayat test; badge bug di daftar flaky & riwayat test. `markdown.spec.ts`: deskripsi/komentar berisi `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `[klik](javascript:alert(1))`, `![g](https://example.com/a.png)` → tampil inert, tanpa `<img>` eksternal, tanpa dialog alert, gate CSP bersih. **Review Focus 4:** judul & komentar 300 karakter tanpa spasi + emoji, blok kode 500 karakter satu baris → tersimpan utuh, halaman tidak scroll horizontal di 375 px. a11y dua tema.
- [ ] **Step 2–4:** gagal → implementasi → tiga browser + stack Docker → PASS.
- [ ] **Step 5: Commit** — `feat(web): bug detail with transitions, comments, and history`

---

### Task 10: Web — perbandingan, versi, kartu dashboard, panel detail run

**Files:**
- Create: `apps/web/src/pages/project/ComparePage.tsx`, `VersionsPage.tsx`, `CompareSummary.tsx`, `apps/web/src/lib/compareSummary.ts` (+ test), `tests/e2e/compare.spec.ts`
- Modify: `apps/web/src/App.tsx`, `lazyPages.ts`, `Dashboard.tsx`, `RunPage.tsx`, `RunsPage.tsx` (kolom/label versi)

**Interfaces:**
- Consumes: `api.results.versions/compare/compareGroup` (Task 7), `BugBadge` (Task 8).
- Produces: `compareSentence(input: { summary; baseLabel: string|null; targetLabel: string }): { tone: "warning"|"success"|"neutral"; text: string }` (copy persis spec §4.5); `runLabel(run: RunSummaryDto): string` (`v{version}` bila versi tidak diawali `v`/`V`, versi apa adanya bila diawali, selain itu `run #<8 char id> · <tanggal>`); `<CompareSummary data slug compact? />`; rute `/p/:slug/compare`, `/p/:slug/versions`; testid spec §7.6 (`compare-*`, `version-card`, `run-compare-panel`, `versions-table`, `version-row-<versi>`).

- [ ] **Step 1: Test gagal** — unit `compareSummary.test.ts`: keempat kalimat spec §4.5 persis (termasuk akhiran ", M test kini lulus." hanya bila M > 0), label versi `1.0.1` → `v1.0.1`, `v1.0.1` tetap, run tanpa versi. E2E `compare.spec.ts` (upload `1.0.0` lalu `1.0.1` berpola: 2 regresi, 1 diperbaiki, 1 masih gagal, 1 lebih lambat, 3 baru, 1 hilang):
  - dashboard `version-card` "v1.0.1 vs v1.0.0" + kalimat peringatan + angka; klik → halaman perbandingan.
  - halaman: judul, kalimat, ringkasan urut spec, kelompok Regresi & Diperbaiki terbuka, kelompok lain tertutup, kelompok kosong satu baris; baris menampilkan "v1.0.0 ✓ Lulus → v1.0.1 ✗ Gagal", durasi berubah, pesan error dalam `<details>`; status ikon + teks.
  - "Laporkan bug" dari baris regresi → form terisi → kembali → badge menggantikan tombol (**Review Focus 5**).
  - ganti base lewat `<select>`; opsi yang sama dengan target dinonaktifkan (**Review Focus 3**); URL bisa dibagikan (reload menghasilkan perbandingan yang sama).
  - detail run `run-compare-panel`; halaman Versi: dua baris, perubahan pass rate "▼ turun … poin", link bandingkan.
  - tanpa versi: kartu memakai run sebelumnya; satu run saja: kartu tidak tampil, halaman perbandingan menampilkan "Belum ada run pembanding untuk …".
  - anonim publik membuka keduanya; a11y dua tema; 375 px (kolom sebelum/sesudah bertumpuk).
- [ ] **Step 2–4:** gagal → implementasi → tiga browser + stack Docker → PASS.
- [ ] **Step 5: Commit** — `feat(web): version comparison page, versions list, and comparison summaries`

---

### Task 11: Matriks otorisasi API & kontrak web

**Files:**
- Create: `tests/api/bugs.spec.ts`, `tests/api/compare.spec.ts`, `apps/web/test/contract/bugs.pact.test.ts`, `compare.pact.test.ts`
- Modify: `tests/api/authorization-matrix.ts`, `tests/api/authorization.spec.ts`, `apps/api/test/contract/states.ts`

- [ ] **Step 1: Tulis test** — matriks spec §6.3 sebagai baris data untuk 6 aktor + anonim-publik (GET bug/label/activity/versions/compare; POST/PATCH bug; POST komentar; DELETE bug; PATCH/DELETE komentar orang lain) dan replay Bearer token = anonim; `bugs.spec.ts`/`compare.spec.ts`: alur lewat proxy, setiap respons di-parse schema shared, `409 BUG_CONFLICT`/`INVALID_TRANSITION` lewat proxy, upload dengan `version`. Pact web: satu interaksi sukses per endpoint baru + `404 BUG_NOT_FOUND`, `409 BUG_CONFLICT`, `409 INVALID_TRANSITION`; state provider deterministik (id/nomor tetap).
- [ ] **Step 2: Jalankan** — `playwright test --project=api` (stack Docker) dan `pnpm test:contract` → PASS; tunjukkan di laporan satu sel matriks gagal bila `bugs:delete` sengaja dilonggarkan (lalu kembalikan, tidak di-commit).
- [ ] **Step 3: Commit** — `test(api): authorization matrix and contracts for bugs and comparison`

---

### Task 12: Visual regression

**Files:**
- Create: `tests/visual/pages.spec.ts`, `tests/visual/seed.ts`, `tests/visual/__screenshots__/` (baseline), `scripts/visual.sh`
- Modify: `tests/playwright.config.ts` (project `visual`, `snapshotPathTemplate`, `expect.toHaveScreenshot` default), `tests/package.json` (`test:visual`, `test:visual:update`), `package.json` root (alias), `.github/workflows/ci.yml` (job `visual` setelah `stack-tests`, sebelum `report`), `docs/TEST_STRATEGY.md`

**Interfaces:**
- Produces: `pnpm test:visual` / `pnpm test:visual:update` menjalankan `docker run --rm --network testpulse_default -v <repo>:/work -w /work/tests -e BASE_URL=http://web:8080 mcr.microsoft.com/playwright:v<versi @playwright/test terpasang di lockfile>-noble npx playwright test --project=visual [--update-snapshots]`; project `visual` tidak ikut `e2e-*`.

- [ ] **Step 1: Tulis spec** — `seed.ts` membuat user, project publik, token, run berversi `1.0.0`/`1.0.1` berpola tetap, dan 3 bug dengan nilai tetap; `pages.spec.ts`: landing, dashboard, perbandingan, daftar bug, detail bug × terang/gelap × 1280×800/375×812; `page.clock.install({ time: <tanggal tetap> })` sebelum navigasi; tunggu `document.fonts.ready`; `mask` untuk waktu relatif, id, dan nama/email acak; `animations: "disabled"`; `maxDiffPixelRatio: 0.01`.
- [ ] **Step 2: Buat baseline** lewat `pnpm test:visual:update` terhadap stack Docker; periksa beberapa PNG secara visual (baca file gambar) sebelum commit; jalankan `pnpm test:visual` dua kali berturut-turut → PASS (stabil).
- [ ] **Step 3: Buktikan gate** — ubah sementara satu warna token di `index.css` → `test:visual` FAIL dengan diff; kembalikan.
- [ ] **Step 4: Job CI** — compose up, jalankan container Playwright di network compose, upload `tests/test-results` (expected/actual/diff) sebagai artifact bila gagal; validasi actionlint.
- [ ] **Step 5: Commit** — `test(visual): Playwright screenshot regression in the official container`

---

### Task 13: k6, dogfooding versi, dokumentasi, landing

**Files:**
- Modify: `tests/perf/setup.mjs`, `tests/perf/read.js`, `package.json` root (`"version": "0.3.0"`), `.github/workflows/deploy.yml` (`--app-version` dari `package.json`), `docs/TEST_STRATEGY.md`, `README.md`, `docs/deploy.md` (bila perlu), `apps/web/src/pages/landing/Features.tsx` (Bug tracker → Tersedia; deskripsi kartu dashboard menyebut perbandingan versi), `Roadmap.tsx` (Tahap 3 Live, Tahap 4 Berikutnya), `Quality.tsx` (snapshot), `tests/e2e/landing.spec.ts` (badge "Segera" kini 2: Tahap 4–5), `tests/scripts/screenshots.ts` (+ perbandingan & bug)
- Create: `docs/test-plans/tahap-3.md`, `docs/adr/0005-perbandingan-versi-dan-markdown-aman.md`, `docs/images/compare-light.png`, `compare-dark.png`, `bugs-light.png`, `bugs-dark.png`

- [ ] **Step 1: Ubah test dulu** — `landing.spec.ts` (2 badge Segera; kartu Bug tracker Tersedia) → FAIL; k6 `read.js` + `GET /bugs`, `GET /compare`, `GET /versions` (setup: ≥ 50 run berversi, ≥ 100 bug).
- [ ] **Step 2: Implementasi** landing, `version` root, deploy.yml (`node -p "require('./package.json').version"`), dokumen (ADR: urutan versi, definisi regresi, pembanding default, aturan Markdown; test plan mengikuti format tahap-2; README: fitur, contoh `version` di curl & reporter, screenshot, roadmap Tahap 3 ✅).
- [ ] **Step 3: Verifikasi** — E2E chromium penuh di stack Docker; k6 baca lokal (p95 < 300 ms, 0 gagal) dan buktikan masih bisa gagal (threshold sementara); actionlint kedua workflow; reporter manual dengan `--app-version` terhadap stack Docker; link-check README/docs; angka snapshot = hitungan nyata.
- [ ] **Step 4: Commit** — `feat: version dogfooding, performance scenarios, and Tahap 3 documentation`

---

## Definisi selesai

Sama dengan spec §14: bug dibuat (manual & dari test gagal), dikelola sampai ditutup dengan komentar & riwayat; badge bug di halaman hasil test; perbandingan versi otomatis di dashboard, detail run, halaman perbandingan & versi dengan kalimat kesimpulan jelas; tab navigasi project; semua halaman lolos a11y dua tema, 375 px, gate CSP; semua lapisan termasuk visual regression & k6 hijau di CI; `/p/testpulse` menampilkan run berversi `0.3.0`; dokumentasi diperbarui.
