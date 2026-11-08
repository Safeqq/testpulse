# TestPulse Tahap 4 — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Test case manual (suite + langkah terstruktur), test run manual dengan snapshot dan hasil per langkah, integrasi dengan hasil CI per versi, bug dari case gagal, dan mutation testing StrykerJS untuk kode domain TestPulse.

**Architecture:** Modul API baru `manual` (tabel `case_suites`, `manual_cases`, `manual_case_labels`, `manual_runs`, `manual_run_cases`, counter `projects.case_seq`/`manual_run_seq`; langkah & hasil langkah dalam JSONB) dengan logika murni di `manual/domain`. Perluasan `results` (`/versions` + `manual`) dan `bugs` (`manual_run_case_id`, `manualOrigin`, badge run case). Web menambah tab "Test manual" (sub-tab Test case / Run manual) dengan halaman lazy. Workflow `mutation.yml` terjadwal menjalankan Stryker; laporannya ikut dipublikasikan ke GitHub Pages oleh job report di `ci.yml`.

**Tech Stack:** Fastify 5, Drizzle + Postgres (JSONB), Zod 4, React 19 + Router 7 + Tailwind/shadcn (komponen yang diizinkan), Vitest 5, Testcontainers, Playwright, Pact, k6, StrykerJS (`@stryker-mutator/core`, `vitest-runner` atau runner `command`, `typescript-checker`), GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-11-08-testpulse-tahap4-design.md](../specs/2026-11-08-testpulse-tahap4-design.md). Juga mengikat spec Tahap 1, UI 2026-10-26, Tahap 2, dan Tahap 3.

## Global Constraints

- **Suite:** nama trim 1–100, unik per project tanpa peka huruf besar/kecil (`400 fields.name` "Nama suite sudah dipakai"); deskripsi 0–2000; maks 200 suite per project; tanpa `version`; hapus hanya bila tanpa case (termasuk arsip) → `409 SUITE_NOT_EMPTY` "Pindahkan atau hapus case di suite ini terlebih dahulu.".
- **Case:**
  - Judul trim 3–200; prasyarat Markdown 0–5000.
  - Langkah 1–50 `{ action: trim 1–2000, expected: 0–2000 }`; error `fields["steps.<i>.action"]`.
  - Priority `low`·`medium`·`high`·`urgent` (default `medium`); label persis aturan bug (maks 10, unik, 1–30 `[a-z0-9-]`, di-lowercase & di-trim).
  - `TC-<n>` tidak dipakai ulang; konflik `409 CASE_CONFLICT`.
- **Run:**
  - Nama trim 3–120; `appVersion` 1–50 `[A-Za-z0-9._+-]` (pakai `runVersion` shared).
  - Seleksi 1–500 case aktif (`400 fields.selection` "Pilih 1–500 case aktif"); `TR-<n>` tidak dipakai ulang.
  - Konflik run/run case `409 MANUAL_RUN_CONFLICT`; run selesai → `409 RUN_COMPLETED`.
- **Run case:** status `untested`·`passed`·`failed`·`blocked`·`skipped`; `stepResults` sepanjang langkah snapshot, elemen `{ status: passed|failed|blocked|skipped|null, note: 0–1000 }`; `note` Markdown 0–5000; saran status persis spec §4.3 (tidak pernah disimpan otomatis).
- **Paginasi & batas:**
  - Cases 50/halaman; manual runs 20; run cases 100.
  - `GET /tests?q=` 2–100 karakter, maks 20 hasil; `recentResults` maks 10; badge `bugs` maks 5, non-`closed`; labels maks 200; versions maks 100 baris.
- **Kode error & izin:** kode error baru `SUITE_NOT_FOUND`, `SUITE_NOT_EMPTY`, `CASE_NOT_FOUND`, `CASE_CONFLICT`, `MANUAL_RUN_NOT_FOUND`, `RUN_CASE_NOT_FOUND`, `MANUAL_RUN_CONFLICT`, `RUN_COMPLETED`. Aksi izin `"manual:write"` (tester, admin), `"manual:delete"` (admin). Matriks spec §7.1.
- **Token & error:** token CI **tidak** berlaku di endpoint baru (= anonim). Bentuk error `{ error: { code, message, fields? } }`; cursor rusak → 400.
- **Penamaan:** field versi aplikasi di modul manual bernama `appVersion` (DB `app_version`); `version` selalu berarti optimistic concurrency.
- **Markdown:** pakai renderer aman Tahap 3 (`<Markdown>` / `LazyMarkdown`), jangan membuat renderer baru. Isian awal bug dari run case memakai helper escape di `apps/web/src/lib/bugReport.ts` (`codeSpan`, `fenceFor`, `stripControlChars`; ekspor bila perlu).
- **CSP & komponen:**
  - CSP **tidak** dilonggarkan; tanpa atribut `style`.
  - Komponen shadcn yang diizinkan saja (button, card, input, label, badge, separator, dropdown-menu `modal={false}`); tanpa dialog, konfirmasi inline.
  - `<select>`, radio, checkbox, dan `<datalist>` native. `<select>` ditempatkan di luar subtree Suspense yang baru dimuat (artefak guard CSP WebKit). Jangan mengubah `tests/support/csp.ts`.
- **UI:**
  - Bahasa Indonesia.
  - Setiap halaman baru lolos `expectNoA11yViolationsInBothThemes`, tanpa scroll horizontal di 375 px, dan lolos gate CSP (stack Docker).
  - Fixture `newContext`, bukan `browser.newContext`. Halaman baru di-lazy-load lewat `lazyPages.ts`.
- **Migrasi:** `0005` hanya menambah; jangan mengubah migrasi lama.
- **Commit:** pesan bahasa Inggris (conventional), tanpa trailer atribusi; implementer commit saja, controller yang push.
- **Lingkungan lokal:**
  - Postgres `tp-pg` port **5433**; `PLAYWRIGHT_BROWSERS_PATH=C:\pw-browsers`; worker ≤ 4; TypeScript `^6.0.3`.
  - Docker dari Git Bash: `export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"`.
  - Heredoc bash panjang gagal; tulis file dengan tool penulis file. Playwright dijalankan dari `tests/` dengan `--project=<nama>`.

## Review Focus

1. **Ganti huruf besar/kecil nama suite sendiri** (`login` → `Login`) diterima. Suite lain bernama `LOGIN` ditolak `400 fields.name`. Test di Task 4.
2. **Seleksi run tumpang tindih atau hanya berisi arsip.** Suite X dipilih bersama `TC-3` yang ada di X → `TC-3` hanya disalin sekali. Suite yang semua case-nya diarsipkan → `400 fields.selection`. Test di Task 2 (domain) dan Task 5 (API).
3. **Run diselesaikan di tab lain saat tester sedang mengisi hasil.** Simpan → banner `exec-completed`, form hanya-baca, isian yang belum tersimpan **tetap terlihat** (tidak dibuang). Test di Task 10.
4. **`v0.4.0` di run manual dan `0.4.0` di run CI** → satu baris versi dengan kolom Manual terisi. Versi non-semver `build-7` manual-saja tampil di bawah daftar. Test di Task 2 (domain) dan Task 6 (API).
5. **Teks langkah/prasyarat sangat panjang tanpa spasi, ber-emoji, atau berisi blok kode** → tersimpan utuh; editor, detail case, dan halaman eksekusi tidak scroll horizontal di 375 px. Test di Task 8 dan Task 10.

---

## Struktur file

```
packages/shared/src/errors.ts, schemas/manual.ts (+test), schemas/compare.ts (VersionDto), schemas/bugs.ts, index.ts
apps/api/
  drizzle/ (migrasi 0005 baru)
  src/db/schema.ts                                 + 5 tabel, 2 counter, bugs.manual_run_case_id
  src/modules/projects/domain/permissions.ts       + "manual:write", "manual:delete"
  src/modules/projects/repository.ts               + kosongkan assignee run case saat anggota keluar
  src/modules/manual/domain/{order,selection,snapshot,results,summary,versions}.ts (+tests)
  src/modules/manual/{suites.routes,cases.routes,cases.repository,suites.repository,runs.routes,runs.repository,
                      run-cases.repository,summary.routes,cursor,errors}.ts
  src/modules/results/compare.routes.ts|compare.repository.ts   + manual di /versions
  src/modules/bugs/{routes,write.repository,read.repository}.ts  + manualRunCaseId, manualOrigin
  stryker.config.mjs
  test/integration/{manual-cases,manual-runs,manual-integration,migration-0005}.int.test.ts
packages/shared/stryker.config.mjs
apps/web/src/lib/api.ts (+ manual), lib/manualSteps.ts, lib/manualBugReport.ts, lib/manualStatus.ts (+tests)
apps/web/src/components/ProjectTabs.tsx, ManualSubTabs.tsx, StepEditor.tsx, CoverageMeter.tsx, RunProgress.tsx,
                        ManualStatus.tsx, AutomationLink.tsx
apps/web/src/pages/project/ CasesPage.tsx, CaseFormPage.tsx, CasePage.tsx, ManualRunsPage.tsx, ManualRunNewPage.tsx,
                            ManualRunPage.tsx, ManualExecutePage.tsx, ManualCard.tsx, lazyPages.ts
tests/support/manual.ts, api-client.ts (+ helper manual), tests/api/manual.spec.ts, authorization-matrix.ts
tests/e2e/manual-cases.spec.ts, manual-runs.spec.ts, manual-integration.spec.ts
tests/visual/pages.spec.ts, seed.ts, __screenshots__/
tests/perf/setup.mjs, read.js
.github/workflows/mutation.yml (baru), ci.yml (job report mengambil laporan mutation)
scripts/seed-dogfood-manual.mjs, package.json root ("version": "0.4.0")
docs/test-plans/tahap-4.md, docs/adr/0006-run-manual-snapshot-dan-mutation-testing.md, docs/TEST_STRATEGY.md, README.md
apps/web/src/pages/landing/{Hero,Features,Roadmap,Quality}.tsx, tests/e2e/landing.spec.ts
```

---

### Task 1: Schema bersama, kode error, dan aksi izin

**Files:**
- Create: `packages/shared/src/schemas/manual.ts` (+ `manual.test.ts`)
- Modify: `packages/shared/src/errors.ts`, `schemas/bugs.ts`, `index.ts`, `apps/api/src/modules/projects/domain/permissions.ts` (+ test)

**Interfaces:**
- Produces (`@testpulse/shared`):
  - Konstanta & enum:
    - `CASE_PRIORITIES` (= nilai priority bug), `MANUAL_RESULT_STATUSES = ["untested","passed","failed","blocked","skipped"]`, `STEP_RESULT_STATUSES = ["passed","failed","blocked","skipped"]`, `MANUAL_RUN_STATUSES = ["open","completed"]` + tipe.
    - Batas: `MAX_STEPS = 50`, `MAX_RUN_CASES = 500`, `MAX_SUITES = 200`.
  - Input:
    - `caseStep` `{ action, expected }`; `suiteBody` `{ name, description? }`; `updateSuiteBody` `{ name?, description?, position?: int ≥ 0 }` (minimal satu).
    - `createCaseBody` `{ suiteId: uuid, title, preconditions?, steps, priority?, labels?, automatedTestId?: uuid|null }`; `updateCaseBody` `{ version, …opsional, archived?: boolean }` (minimal satu selain `version`); `caseListQuery` (spec §7); `testSearchQuery` `{ q: 2–100 }`.
    - `createManualRunBody` `{ name, appVersion?, suiteIds: uuid[] (default []), caseNumbers: int[] (default []) }` (refine: tidak keduanya kosong); `updateManualRunBody` `{ version, name?, appVersion?: string|null, status? }`; `manualRunListQuery`.
    - `stepResult` `{ status: enum|null, note: string ≤ 1000 (default "") }`; `updateRunCaseBody` `{ version, status?, stepResults?, note?, assigneeId?: uuid|null }` (minimal satu); `runCaseListQuery`.
  - DTO:
    - `suiteDto`; `manualCaseListItemDto`; `casesPageDto` `{ items, nextCursor, coverage: { active, automated } }`; `manualCaseDto` (field spec §3.2 + `automatedTest: { id, suite, name, lastResult: { status, runId, createdAt, branch } | null } | null` + `recentResults`).
    - `testSearchItemDto`; `manualCountsDto`; `manualRunSummaryDto`; `manualRunsPageDto`; `runCaseListItemDto` (+ `bugs: BugRefDto[]`); `runCasesPageDto`; `runCaseDto` (+ `nextUntestedId`, `caseId`, `runStatus`).
    - `manualRunRefDto` `{ number, name, status, total, counts }`; `manualSummaryDto`.
  - `createBugBody` + `manualRunCaseId?: uuid`, dengan refine: tidak boleh bersama `testCaseId`/`runId` (`fields.manualRunCaseId`). `bugDto` + `manualOrigin: { runNumber, runName, caseNumber, caseTitle } | null`.
  - `ErrorCode` + 8 kode baru (Global Constraints).
- Produces (API): `ProjectAction` + `"manual:write"` (di `TESTER_ACTIONS`), `"manual:delete"` (khusus admin).

- [ ] **Step 1: Test gagal**
  - **Langkah:** 0 dan 51 langkah ditolak; 1 dan 50 diterima; `action` spasi saja ditolak dengan path `steps.<i>.action`; `expected` kosong diterima; 2001 karakter ditolak.
  - **Label & nama:** label case dinormalisasi seperti bug; nama suite 0/101 ditolak, 1/100 diterima.
  - **Run:** `createManualRunBody` dengan dua array kosong ditolak; `appVersion` `1 0` ditolak.
  - **Body update:** `updateCaseBody` hanya `version` ditolak; `stepResult.note` 1001 ditolak; `createBugBody` dengan `manualRunCaseId` + `testCaseId` ditolak.
  - **Izin:** `"manual:write"` mengizinkan tester/admin dan menolak viewer; `"manual:delete"` hanya admin; anonim di project publik tidak bisa menulis.
- [ ] **Step 2: Jalankan — gagal.** `pnpm --filter @testpulse/shared test:unit` dan `pnpm --filter @testpulse/api exec vitest run --project unit permissions`.
- [ ] **Step 3: Implementasi** (pakai ulang `bugLabel`, `runVersion`, `bugRefDto`; jangan menduplikasi aturannya).
- [ ] **Step 4: Jalankan — lulus** + `pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(shared): manual test case and manual run schemas, error codes, and permissions`

---

### Task 2: Domain murni — urutan, seleksi, snapshot, hasil, ringkasan, versi manual

**Files:**
- Create: `apps/api/src/modules/manual/domain/order.ts`, `selection.ts`, `snapshot.ts`, `results.ts`, `summary.ts`, `versions.ts` (+ test masing-masing)

**Interfaces:**
- Consumes: `parseSemver`, `compareSemver`, `isAllSemver`, `sameVersion` dari `results/domain/versions.ts`.
- Produces:
  - `moveItem<T>(items: readonly T[], from: number, to: number): T[]`: `to` dibatasi ke `[0, length-1]`; `from` di luar rentang mengembalikan salinan apa adanya.
  - `selectRunCases(input: { suites: ReadonlyArray<{ id; position }>; cases: ReadonlyArray<{ id; number; suiteId; archived: boolean }>; suiteIds: readonly string[]; caseNumbers: readonly number[] }): { ok: true; caseIds: string[] } | { ok: false; field: "suiteIds" | "caseNumbers" | "selection" }`. Urutan: posisi suite, lalu nomor. Tanpa duplikat. Nomor case yang tak dikenal atau diarsipkan → `caseNumbers`. Hasil 0 atau > 500 → `selection`.
  - `buildSnapshot(c: { id; number; title; preconditions; steps; priority }, suite: { name; position }, position: number): RunCaseSnapshot`, dengan salinan langkah yang baru (bukan referensi).
  - `emptyStepResults(stepCount: number): StepResult[]`; `stepResultsMatch(results: readonly unknown[], stepCount: number): boolean`; `suggestStatus(results: readonly StepResult[]): ManualResultStatus | null` (spec §4.3, urutan aturan 1–5).
  - `summarize(counts: Partial<ManualCounts>): { counts: ManualCounts; total: number; progress: number }` (total 0 → progress 0); `coveragePercent(active: number, automated: number): number | null` (`Math.floor`; active 0 → `null`).
  - `mergeManualVersions(input: { automated: readonly string[] /* urutan Tahap 3, terendah → tertinggi */; manual: ReadonlyArray<{ appVersion: string; latestAt: Date }> }): { rows: Array<{ version: string; automated: boolean }>; matchOf: (manualVersion: string) => string | null }`. Mengikuti spec §5.1 langkah 1–3. Hasil terendah → tertinggi; pemanggil yang membalik urutan dan memotong ke 100.

- [ ] **Step 1: Test gagal**
  - **`moveItem`:** awal ke akhir, akhir ke awal, `to` −1 dan 99 dibatasi, daftar satu elemen.
  - **`selectRunCases`:**
    - Suite + case satuan dari suite yang sama → tanpa duplikat (**Review Focus 2**).
    - Urutan menurut posisi suite, bukan urutan input.
    - Case arsip di suite terpilih dibuang; suite yang semua case-nya arsip → `selection` (**Review Focus 2**).
    - Nomor case arsip atau tak dikenal → `caseNumbers`; id suite tak dikenal → `suiteIds`.
    - Tepat 500 diterima, 501 → `selection`.
  - **`buildSnapshot`:** mengubah array langkah sumber setelah snapshot dibuat tidak mengubah snapshot.
  - **`suggestStatus`:** setiap aturan (gagal mengalahkan diblokir; semua lulus; lulus + dilewati → lulus; semua dilewati → dilewati; satu langkah `null` → `null`).
  - **`summarize`:** termasuk total 0. **`coveragePercent`:** 39/40 → 97; 0/0 → `null`; 40/40 → 100.
  - **`mergeManualVersions`:**
    - `v0.4.0` cocok dengan `0.4.0` (**Review Focus 4**).
    - Semver manual-saja `0.3.5` disisipkan di antara `0.3.0` dan `0.4.0`.
    - Manual-saja non-semver `build-7` → di bawah semua versi automated (**Review Focus 4**).
    - Automated berisi versi non-semver → semua versi manual-saja ditaruh di bawah, urut `latestAt`.
    - Tanpa versi automated dan semua manual semver → urut semver.
- [ ] **Step 2: Jalankan — gagal.** `pnpm --filter @testpulse/api exec vitest run --project unit manual/domain`.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan — lulus** dengan coverage domain ≥ 80% (`pnpm --filter @testpulse/api exec vitest run --project unit --coverage`).
- [ ] **Step 5: Commit** — `feat(api): manual testing domain logic`

---

### Task 3: Migrasi DB 0005

**Files:**
- Modify: `apps/api/src/db/schema.ts`, `apps/api/drizzle/*` (generate 0005)
- Create: `apps/api/test/integration/migration-0005.int.test.ts`

**Interfaces:**
- Produces: tabel & kolom spec §6, dengan nama Drizzle `caseSuites`, `manualCases`, `manualCaseLabels`, `manualRuns`, `manualRunCases`, `projects.caseSeq`, `projects.manualRunSeq`, `bugs.manualRunCaseId`. Kolom JSONB bertipe `$type<CaseStep[]>()` / `$type<StepResult[]>()`.

- [ ] **Step 1: Test gagal** (pola `migration-0004.int.test.ts`):
  - Migrasi 0005 diterapkan di atas DB berisi data Tahap 3 (run berversi, bug, komentar) tanpa error; data lama utuh; counter baru = 0.
  - Constraint `UNIQUE (project_id, lower(name))` menolak `Login`/`login`.
  - Menghapus suite yang masih punya case gagal karena FK `RESTRICT`.
  - Menghapus `test_cases` mengosongkan `manual_cases.automated_test_id`.
  - Menghapus `manual_run_cases` mengosongkan `bugs.manual_run_case_id`.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi** + `drizzle-kit generate`. Cek SQL: hanya `ADD COLUMN`/`CREATE TABLE`/`CREATE INDEX`/`ADD CONSTRAINT`. Index unik berbasis ekspresi `lower(name)` dan index parsial seperti spec §6.
- [ ] **Step 4: Jalankan — lulus** + seluruh suite integration API.
- [ ] **Step 5: Commit** — `feat(api): manual testing tables (migration 0005)`

---

### Task 4: API suite, case, label, dan pencarian automated test

**Files:**
- Create: `apps/api/src/modules/manual/suites.routes.ts`, `suites.repository.ts`, `cases.routes.ts`, `cases.repository.ts`, `cursor.ts` (+ test), `errors.ts`, `apps/api/test/integration/manual-cases.int.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: Task 1 (schema/DTO), `moveItem` (Task 2), `resolveProject` dengan `"project:read"`/`"manual:write"`/`"manual:delete"`, pola nomor `UPDATE projects SET case_seq = case_seq + 1 … RETURNING`, pola cursor buram & escape `q` dari modul `bugs`.
- Produces:
  - Rute spec §7: `/suites` (GET/POST), `/suites/:id` (PATCH/DELETE), `/cases` (GET/POST), `/cases/labels`, `/cases/:number` (GET/PATCH/DELETE), `/tests?q=`.
  - `findCaseByNumber(db, projectId, number)`.
  - Di task ini `GET /cases/:number` mengembalikan `automatedTest` tanpa `lastResult` (`null`) dan `recentResults: []`; keduanya diisi Task 6.

- [ ] **Step 1: Test gagal** (`manual-cases.int.test.ts`)
  - **Suite — validasi & batas:**
    - Buat → posisi terakhir.
    - **Review Focus 1:** `login` → `Login` pada suite yang sama diterima; suite lain `LOGIN` → 400 `fields.name`.
    - Suite ke-201 → 400.
  - **Suite — urutan & hapus:**
    - Pindah posisi 0 ↔ akhir menomori ulang semua suite tanpa celah; `position` 99 dibatasi.
    - Hapus suite kosong → 204; suite berisi case arsip → `409 SUITE_NOT_EMPTY`; suite project lain → `404 SUITE_NOT_FOUND`.
  - **Case — buat & ubah:**
    - Buat → `TC-1`, default `medium`; 20 case dibuat paralel → nomor 1–20 unik; hapus `TC-20` lalu buat case baru → `TC-21`.
    - `suiteId` project lain → 400 `fields.suiteId`; `automatedTestId` project lain → 400 `fields.automatedTestId`.
    - `version` basi → `409 CASE_CONFLICT` tanpa perubahan.
    - Pindah suite, arsip & pulihkan; `steps` mengganti seluruh daftar.
  - **Case — daftar & cari:**
    - Filter `suite`, `priority`, `label` (`UI` cocok dengan `ui`), `automated=yes|no`, `archived=true`; `q` dengan `%`/`_` dicocokkan literal.
    - 60 case → 50 + cursor → 10; cursor rusak → 400.
    - `coverage` dihitung dari seluruh case aktif, tidak ikut filter.
  - **Lain-lain:**
    - `labels` unik dan urut abjad.
    - `GET /tests?q=lo` mencari nama atau suite, maks 20, hanya project ini; `q` 1 karakter → 400.
    - Hapus case: admin 204, tester 403, sesudahnya `404 CASE_NOT_FOUND`.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi** (label ditulis dalam transaksi yang sama; isi JSONB di-parse schema shared saat dibaca).
- [ ] **Step 4: Jalankan — lulus** + seluruh suite API.
- [ ] **Step 5: Commit** — `feat(api): test suites and manual test cases endpoints`

---

### Task 5: API run manual & eksekusi run case

**Files:**
- Create: `apps/api/src/modules/manual/runs.routes.ts`, `runs.repository.ts`, `run-cases.repository.ts`, `apps/api/test/integration/manual-runs.int.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/modules/projects/repository.ts` (pemanggil `clearAssigneeOnLeave` juga memanggil `clearRunCaseAssigneesOnLeave`)

**Interfaces:**
- Consumes: `selectRunCases`, `buildSnapshot`, `emptyStepResults`, `stepResultsMatch`, `summarize` (Task 2); `findCaseByNumber` (Task 4).
- Produces:
  - Rute `/manual-runs` (GET/POST), `/manual-runs/:number` (GET/PATCH/DELETE), `/manual-runs/:number/cases` (GET), dan `/manual-runs/:number/cases/:id` (GET/PATCH).
  - `createManualRun(db, input): Promise<ManualRunSummaryDto | { field }>`: satu transaksi; run case ditulis dengan satu `INSERT` multi-baris.
  - `updateRunCase(db, input): Promise<RunCaseDto | "conflict" | "completed" | { field }>`: `SELECT … FOR SHARE` baris run, lalu `SELECT … FOR UPDATE` run case. `executedBy`/`executedAt` mengikuti spec §4.3.
  - `updateManualRun(…)`: `FOR UPDATE` baris run; saat `completed` hanya `{ status: "open" }` yang diterima; selain itu `"completed"`.
  - `clearRunCaseAssigneesOnLeave(tx, projectId, userId): Promise<void>`.
  - Hitungan dihitung dengan `GROUP BY` saat dibaca.
  - Di task ini `bugs` pada item run case = `[]`; diisi Task 6.

- [ ] **Step 1: Test gagal** (`manual-runs.int.test.ts`)
  - **Buat run:**
    - Dari 1 suite + 1 case suite lain → snapshot berurut (posisi suite, nomor).
    - **Review Focus 2:** seleksi tumpang tindih → satu salinan; suite berisi arsip saja → 400 `fields.selection`.
    - 501 case → 400; 10 run dibuat paralel → `TR-1…10`.
  - **Snapshot:**
    - Edit langkah case, pindah suite, arsipkan, lalu hapus case → run case tetap menampilkan judul, langkah, dan nama suite lama.
    - Setelah case dihapus: `caseId` `null`, hasil tetap ada.
  - **Eksekusi run case:**
    - PATCH `status: passed` mengisi `executedBy/At`; kembali ke `untested` mengosongkannya.
    - `stepResults` dengan panjang salah → 400 `fields.stepResults`; assignee bukan anggota → 400 `fields.assigneeId`.
  - **Konkurensi & run selesai:**
    - Dua run case **berbeda** di-PATCH paralel → keduanya 200. Run case **sama** dengan `version` yang sama → tepat satu `409 MANUAL_RUN_CONFLICT`.
    - Run diselesaikan → PATCH run case dan rename → `409 RUN_COMPLETED`. Buka ulang → bisa menulis lagi.
    - Penyelesaian run dan PATCH run case dijalankan berulang secara paralel → tidak ada run case dengan `updated_at` > `completed_at`.
  - **Navigasi `nextUntestedId`:** case berikutnya setelah posisi saat ini, berputar ke awal; `null` bila semua sudah dites.
  - **Daftar & hapus:**
    - Daftar run: filter `status` & `appVersion`, 25 run → 20 + cursor.
    - Daftar run case: filter `status`, `assignee=me|none`, `suite`.
    - Hapus run: admin 204, tester 403.
  - **Anggota dikeluarkan** → assignee run case-nya `null`.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan — lulus** + seluruh suite API.
- [ ] **Step 5: Commit** — `feat(api): manual runs with snapshots and per-step execution results`

---

### Task 6: Integrasi API — versi, ringkasan manual, detail case, dan bug dari run case

**Files:**
- Create: `apps/api/src/modules/manual/summary.routes.ts`, `apps/api/test/integration/manual-integration.int.test.ts`
- Modify:
  - Shared: `packages/shared/src/schemas/compare.ts` (`versionDto.run` nullable, + `manual`).
  - API: `apps/api/src/modules/results/compare.routes.ts`, `compare.repository.ts`, `apps/api/src/modules/manual/cases.repository.ts`, `run-cases.repository.ts`, `apps/api/src/modules/bugs/routes.ts`, `write.repository.ts`, `read.repository.ts`, `apps/api/src/app.ts`.
  - Web: `apps/web/src/pages/project/VersionsPage.tsx`, adaptasi minimal agar typecheck lulus: baris dengan `run: null` menampilkan "–".
  - Pact: `apps/web/test/contract/compare.pact.test.ts` (bentuk baru), `apps/api/test/contract/states.ts`.

**Interfaces:**
- Consumes: `mergeManualVersions`, `coveragePercent` (Task 2); Task 4–5 repository; `bugRefsForTests` sebagai pola.
- Produces:
  - `GET /versions` dengan `manual` dan baris manual-saja (spec §5.1).
  - `GET /manual/summary`.
  - `automatedTest.lastResult` dan `recentResults` di detail case.
  - `bugRefsForRunCases(db, projectId, runCaseIds: string[]): Promise<Map<string, BugRefDto[]>>`, satu query, dipakai di daftar & detail run case.
  - `POST /bugs` dengan `manualRunCaseId`; `BugDto.manualOrigin` (detail & respons buat/ubah).

- [ ] **Step 1: Test gagal** (`manual-integration.int.test.ts`)
  - **`/versions`:**
    - Run CI `0.4.0` + run manual `v0.4.0` (dua run; yang terbaru dipakai) → satu baris dengan `manual.number` run terbaru (**Review Focus 4**).
    - Manual-saja `0.3.5` muncul di posisi semver dengan `run: null`, `runCount: 0`; manual-saja `build-7` di bawah.
    - `passRateDelta` versi automated tidak berubah oleh baris manual.
    - Baris manual-saja muncul di semua pilihan branch; total dipotong 100.
  - **`/manual/summary`:** project tanpa case → `latestRun: null`, `coverage {0,0}`; dengan data → run terbaru + cakupan.
  - **Detail case:**
    - `automatedTest.lastResult` dari branch default project; test tanpa hasil → `null`.
    - `recentResults` maks 10, terbaru dulu.
  - **Bug dari run case:**
    - `POST /bugs { manualRunCaseId }` → `manualOrigin` terisi. Run case project lain → 400 `fields.manualRunCaseId`. Bersama `testCaseId` → 400.
    - Badge muncul di daftar & detail run case; bug `closed` tidak muncul.
    - Jumlah query tetap untuk 1 vs 100 run case (pola hitung query Tahap 3).
  - **Hapus run** → bug tetap ada, `manualOrigin: null`.
  - **Akses:** project privat → anonim 404 di `/manual/summary`.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi.** Query `/versions` tetap memakai `statement_timeout` baca Tahap 2. Run manual diambil dengan satu query `DISTINCT ON (app_version)`.
- [ ] **Step 4: Jalankan — lulus**: seluruh suite API, `pnpm typecheck`, `pnpm test:contract`.
- [ ] **Step 5: Commit** — `feat(api): manual results on versions, manual summary, and bugs from manual run cases`

---

### Task 7: Web — klien API, tab "Test manual", dan daftar case

**Files:**
- Create:
  - `apps/web/src/components/ManualSubTabs.tsx`, `CoverageMeter.tsx`.
  - `apps/web/src/pages/project/CasesPage.tsx`.
  - `tests/support/manual.ts` (helper data E2E), `tests/e2e/manual-cases.spec.ts` (bagian daftar & suite).
- Modify: `apps/web/src/lib/api.ts`, `components/ProjectTabs.tsx`, `App.tsx`, `pages/project/lazyPages.ts`, `tests/support/api-client.ts`

**Interfaces:**
- Produces:
  - **Klien API:**
    - `api.manual.suites.{list, create, update, remove}`.
    - `api.manual.cases.{list, labels, get, create, update, remove}`, `api.manual.searchTests(slug, q)`.
    - `api.manual.runs.{list, get, create, update, remove}`, `api.manual.runCases.{list, get, update}`, `api.manual.summary(slug)`.
  - **Navigasi:** tab `manual` di `ProjectTabs` (antara Versi dan Bug; aktif untuk `/cases*` dan `/manual-runs*`; tanpa `?branch=`); `<ManualSubTabs slug active: "cases" | "runs" />`.
  - **Komponen & rute:** `<CoverageMeter active automated />` (testid `coverage-meter`); rute `/p/:slug/cases`.
  - **Helper test:**
    - `TestApi`: `createSuite(user, slug, body)`, `createCase(user, slug, body)`, `createManualRun(user, slug, body)`, `updateRunCase(user, slug, runNumber, id, body)`.
    - `tests/support/manual.ts`: `seedManualProject(api, { suites, casesPerSuite })`.

- [ ] **Step 1: E2E gagal**
  - **Navigasi:** tab `tab-manual` tampil di semua halaman project, `aria-current` benar di `/cases` dan `/manual-runs`; sub-tab berfungsi.
  - **Suite di desktop:** sidebar suite dengan jumlah; tambah suite inline; rename inline; ▲/▼ mengubah urutan dan bertahan setelah reload; hapus suite kosong dengan konfirmasi inline; suite berisi case menampilkan pesan `SUITE_NOT_EMPTY`.
  - **Suite di HP:** di 375 px sidebar diganti `suite-select`.
  - **Daftar case:**
    - Meter cakupan "X dari Y case aktif sudah diotomasi (Z%)".
    - Filter (cari, prioritas, label, otomasi, arsip) tersimpan di URL dan bertahan setelah reload.
    - 60 case → 50 + "Muat lagi".
  - **Akses:** tester melihat `case-create`; viewer dan anonim publik tidak melihat kontrol tulis.
  - **Kualitas:** a11y dua tema; 375 px.
- [ ] **Step 2: Jalankan — gagal**, lalu **implementasi**.
- [ ] **Step 3: Jalankan** — unit web + E2E tiga browser + stack Docker (gate CSP) → PASS.
- [ ] **Step 4: Commit** — `feat(web): manual testing tab, suite sidebar, and test case list`

---

### Task 8: Web — form case (editor langkah, tautan otomasi) & detail case

**Files:**
- Create:
  - `apps/web/src/components/StepEditor.tsx`, `AutomationLink.tsx`.
  - `apps/web/src/lib/manualSteps.ts` (+ test).
  - `apps/web/src/pages/project/CaseFormPage.tsx`, `CasePage.tsx`.
- Modify: `App.tsx`, `lazyPages.ts`, `tests/e2e/manual-cases.spec.ts`

**Interfaces:**
- Consumes: Task 7 klien; `MarkdownEditor`, `LazyMarkdown`, `BugLabelsInput` (dipakai ulang untuk label case).
- Produces:
  - **Rute:** `/p/:slug/cases/new?suite=`, `/p/:slug/cases/:number`, `/p/:slug/cases/:number/edit`.
  - **Helper langkah:** `manualSteps.ts` berisi `addStep(steps)`, `removeStep(steps, i)`, `moveStep(steps, i, dir: -1 | 1)`, `stepErrors(fields)` (memetakan `steps.<i>.action` ke langkah).
  - **Testid:** sesuai spec §8.10 untuk form dan detail.

- [ ] **Step 1: Test gagal**
  - **Unit `manualSteps.test.ts`:**
    - Tambah langkah sampai 50, lalu tambah lagi → tetap 50.
    - Hapus langkah terakhir yang tersisa → tetap 1 langkah kosong.
    - ▲ di langkah pertama dan ▼ di langkah terakhir tidak mengubah apa pun.
    - Error server per langkah terpetakan ke langkahnya.
  - **E2E — form & tautan otomasi:**
    - Buat case 3 langkah, ubah urutan langkah 3 → 1, simpan; detail menampilkan urutan baru.
    - Pratinjau Markdown langkah berfungsi.
    - Validasi judul dan langkah kosong tampil di bawah field-nya.
    - Tautan otomasi: upload JUnit, cari "lo", pilih test → kartu otomasi menampilkan status terakhir; meter cakupan di daftar naik; lepas tautan → "Belum diotomasi".
  - **E2E — konflik, arsip, hapus:**
    - Konflik dua tab → `case-conflict`, isian tidak dibuang.
    - Arsipkan → case hilang dari daftar default dan tampil dengan filter arsip; pulihkan.
    - Admin menghapus case lewat konfirmasi inline.
  - **E2E — Review Focus 5 & kualitas:**
    - Langkah dan prasyarat 300 karakter tanpa spasi + emoji, blok kode 500 karakter → tersimpan utuh; tidak ada scroll horizontal di 375 px, baik di form maupun di detail.
    - a11y dua tema.
- [ ] **Step 2: Jalankan — gagal**, lalu **implementasi**.
- [ ] **Step 3: Jalankan** — tiga browser + stack Docker → PASS.
- [ ] **Step 4: Commit** — `feat(web): test case editor with structured steps and automation linking`

---

### Task 9: Web — daftar run manual, buat run, detail run

**Files:**
- Create:
  - `apps/web/src/components/RunProgress.tsx`, `ManualStatus.tsx`.
  - `apps/web/src/pages/project/ManualRunsPage.tsx`, `ManualRunNewPage.tsx`, `ManualRunPage.tsx`.
  - `tests/e2e/manual-runs.spec.ts`.
- Modify: `App.tsx`, `lazyPages.ts`

**Interfaces:**
- Consumes: Task 7 klien; `api.results.versions` (saran versi lewat `<datalist>`).
- Produces:
  - **Komponen:** `<RunProgress counts total />` (bar + legenda teks "18/25 dieksekusi · 15 lulus · 2 gagal · 1 diblokir"), `<ManualStatus status />` (ikon + teks + warna; label: Belum dites, Lulus, Gagal, Diblokir, Dilewati).
  - **Rute:** `/p/:slug/manual-runs`, `/manual-runs/new`, `/manual-runs/:number`.
  - **Testid:** sesuai spec §8.10.

- [ ] **Step 1: E2E gagal**
  - **Daftar run:** filter status/versi di URL; progres dan legenda benar.
  - **Buat run:**
    - Centang 2 suite + cari & tambah satu case → ringkasan "N case akan disalin" benar.
    - Tombol nonaktif bila 0.
    - Saran versi muncul di `<datalist>`.
    - Simpan → detail run.
  - **Detail run:**
    - Case dikelompokkan per suite; filter status/assignee ("Case saya", "Belum di-assign")/suite.
    - "Mulai eksekusi" membuka case `untested` pertama (sementara cukup URL termuat).
  - **Selesaikan & buka ulang:**
    - "Selesaikan run" dengan 4 case untested → konfirmasi inline menyebut 4 → run hanya-baca → "Buka ulang".
    - Rename dan hapus (admin) inline.
  - **Akses & kualitas:** viewer/anonim publik hanya baca; a11y dua tema; 375 px.
- [ ] **Step 2: Jalankan — gagal**, lalu **implementasi**.
- [ ] **Step 3: Jalankan** — tiga browser + stack Docker → PASS.
- [ ] **Step 4: Commit** — `feat(web): manual run list, run creation, and run detail`

---

### Task 10: Web — eksekusi case, laporkan bug dari run case, asal bug

**Files:**
- Create:
  - `apps/web/src/pages/project/ManualExecutePage.tsx`.
  - `apps/web/src/lib/manualStatus.ts` (+ test), `apps/web/src/lib/manualBugReport.ts` (+ test).
- Modify:
  - `apps/web/src/lib/bugReport.ts` (ekspor helper escape).
  - `pages/project/BugNewPage.tsx`, `bugReportSource.ts` (sumber `?manualRun=<number>&manualRunCase=<id>`).
  - `BugPage.tsx` / `components/BugTestOrigin.tsx` (asal "Dari test run manual TR-3 · TC-12").
  - `App.tsx`, `lazyPages.ts`, `tests/e2e/manual-runs.spec.ts`.

**Interfaces:**
- Consumes: Task 9; `suggestStatus` diimplementasikan ulang di web, karena domain API tidak diekspor. Implementasinya ada di `manualStatus.ts` dengan tabel test yang sama dengan Task 2.
- Produces:
  - **Rute:** `/p/:slug/manual-runs/:number/cases/:id`.
  - **Isian awal bug:** `buildManualBugTitle(caseNumber: number, title: string): string` ("TC-12 gagal: {judul}", maks 200 di batas code point) dan `buildManualBugDescription(source: { runNumber; runName; appVersion: string|null; suiteName; preconditions; steps; stepResults; note }): string` (spec §5.4; langkah gagal ditandai **✗**; teks dari case dalam code span atau blok kode; dipotong ke 20.000 dengan pola `buildBugReportDescription`).
  - **Testid:** `exec-*`, `bug-manual-origin`.

- [ ] **Step 1: Test gagal**
  - **Unit:**
    - `manualStatus.test.ts` memakai tabel yang sama dengan Task 2.
    - `manualBugReport.test.ts`:
      - Judul 300 karakter dipotong tanpa separuh surrogate.
      - Langkah berisi `](javascript:` dan backtick tetap inert (code span lebih panjang).
      - Langkah gagal bertanda ✗ beserta catatannya.
      - Deskripsi sangat panjang dipotong ≤ 20.000.
  - **E2E — eksekusi beruntun:**
    - Run 3 case: case 1 semua langkah Lulus → saran "Lulus" → "Pakai saran" → "Simpan & lanjut" pindah ke case 2.
    - Case 2: langkah 2 Gagal + catatan → saran Gagal → simpan.
    - "Laporkan bug" → form bug terisi (judul `TC-… gagal: …`, deskripsi memuat run, versi, tabel langkah dengan ✗) → simpan → detail bug menampilkan `bug-manual-origin` dengan link kembali.
    - Halaman eksekusi dan detail run menampilkan badge bug menggantikan tombol.
    - Case terakhir "Simpan & lanjut" → kembali ke detail run dengan "Semua case sudah dieksekusi".
  - **E2E — dua tab:** case sama → `exec-conflict`; case berbeda → keduanya tersimpan.
  - **E2E — Review Focus 3:** run diselesaikan di tab A, tab B menyimpan → `exec-completed`, form hanya-baca, catatan yang diketik tetap terlihat.
  - **E2E — snapshot & case terhapus:** edit case setelah run dibuat → halaman eksekusi tetap menampilkan langkah lama; case dihapus → catatan "Case asli sudah dihapus…".
  - **E2E — Markdown berbahaya** di langkah dan catatan tampil inert, gate CSP bersih.
  - **E2E — Review Focus 5:** halaman eksekusi tanpa scroll horizontal di 375 px untuk teks panjang.
  - **E2E — kualitas:** a11y dua tema, termasuk `fieldset`/`legend` radio.
- [ ] **Step 2: Jalankan — gagal**, lalu **implementasi**.
- [ ] **Step 3: Jalankan** — unit web + tiga browser + stack Docker → PASS.
- [ ] **Step 4: Commit** — `feat(web): manual case execution with step results and bug reporting`

---

### Task 11: Web — kolom Manual di halaman Versi & kartu dashboard

**Files:**
- Create: `apps/web/src/pages/project/ManualCard.tsx`, `tests/e2e/manual-integration.spec.ts`
- Modify: `VersionsPage.tsx`, `Dashboard.tsx`

**Interfaces:**
- Consumes: `VersionDto.manual` (Task 6), `api.manual.summary`, `<RunProgress>` (Task 9), `<CoverageMeter>` (Task 7).
- Produces: kolom Manual (`version-manual-<versi>`); kartu `manual-card` (tidak tampil bila project tanpa case).

- [ ] **Step 1: E2E gagal**
  - **Halaman Versi:**
    - Upload CI `0.4.0` dan `0.3.0`, buat run manual `v0.4.0` (2 lulus, 1 gagal) dan manual-saja `build-7`.
    - Baris `0.4.0` menampilkan "TR-… · 2/3 lulus · 1 gagal" dengan link (**Review Focus 4**); baris `0.3.0` "–"; baris `build-7` di bawah dengan kolom automated "–".
    - Link "Bandingkan dengan versi sebelumnya" tetap benar.
  - **Dashboard:** kartu run terbaru + cakupan; project tanpa case → kartu tidak ada.
  - **Akses & kualitas:** anonim publik melihat keduanya; a11y dua tema; 375 px (tabel versi bertumpuk).
- [ ] **Step 2: Jalankan — gagal**, lalu **implementasi**.
- [ ] **Step 3: Jalankan** — tiga browser + stack Docker → PASS; `tests/e2e/compare.spec.ts` dan `dashboard.spec.ts` tetap lulus.
- [ ] **Step 4: Commit** — `feat(web): manual results on the versions page and dashboard`

---

### Task 12: Matriks otorisasi API & kontrak web

**Files:**
- Create: `tests/api/manual.spec.ts`, `apps/web/test/contract/manual.pact.test.ts`
- Modify: `tests/api/authorization-matrix.ts`, `tests/api/authorization.spec.ts`, `apps/api/test/contract/states.ts`, `apps/web/test/contract/bugs.pact.test.ts` (`manualRunCaseId`/`manualOrigin`)

- [ ] **Step 1: Tulis test**
  - **Matriks otorisasi:** matriks spec §7.1 sebagai baris data untuk 6 aktor + anonim publik, mencakup setiap `GET` baru, POST/PATCH suite/case/run/run case, dan DELETE suite/case/run. Replay dengan Bearer token = anonim.
  - **`manual.spec.ts`:** alur lewat proxy; setiap respons di-parse schema shared; `409 CASE_CONFLICT`, `MANUAL_RUN_CONFLICT`, `RUN_COMPLETED`, `SUITE_NOT_EMPTY` lewat proxy.
  - **Pact web:**
    - Satu interaksi sukses per endpoint baru, plus `404 CASE_NOT_FOUND` dan kode 409 di atas.
    - `GET /versions` dengan `manual` dan baris `run: null`.
    - State provider deterministik (id dan nomor tetap).
- [ ] **Step 2: Jalankan** `playwright test --project=api` (stack Docker) dan `pnpm test:contract` → PASS. Di laporan, tunjukkan satu sel matriks gagal ketika `"manual:delete"` sengaja dilonggarkan, lalu kembalikan (jangan di-commit).
- [ ] **Step 3: Commit** — `test(api): authorization matrix and contracts for manual testing`

---

### Task 13: Visual regression halaman manual

**Files:**
- Modify: `tests/visual/seed.ts` (suite, case, run berisi hasil tetap), `tests/visual/pages.spec.ts`, `tests/visual/__screenshots__/` (baseline baru)

- [ ] **Step 1: Tambah kasus**
  - Daftar case, detail run, dan eksekusi case × terang/gelap × 1280×800/375×812.
  - Pakai pola dan toleransi `FULL_PAGE`/`ELEMENT` yang ada, `freezeApiTimestamps`, dan mask untuk waktu relatif & id.
- [ ] **Step 2: Buat baseline** lewat `pnpm test:visual:update`.
  - Periksa beberapa PNG baru secara visual (baca file gambarnya).
  - Jalankan `pnpm test:visual` dua kali berturut-turut → PASS, dengan baseline lama tidak berubah.
- [ ] **Step 3: Buktikan gate** — ubah sementara warna `ManualStatus` gagal → `test:visual` FAIL dengan diff; kembalikan.
- [ ] **Step 4: Commit** — `test(visual): screenshots for manual testing pages`

---

### Task 14: Mutation testing (StrykerJS) & publikasi laporan

**Files:**
- Create:
  - `apps/api/stryker.config.mjs`, `packages/shared/stryker.config.mjs`.
  - `.github/workflows/mutation.yml`.
- Modify:
  - `apps/api/package.json`, `packages/shared/package.json` (devDependency Stryker + skrip `test:mutation`), `package.json` root (alias `test:mutation`).
  - `.gitignore` (`reports/`, `.stryker-tmp/`).
  - `.github/workflows/ci.yml` (job `report`): langkah "Fetch latest mutation report" sebelum `upload-pages-artifact`, plus `permissions: actions: read` dan `GH_TOKEN`.
  - File test domain yang perlu diperkuat.

**Interfaces:**
- Produces:
  - **Skrip:** `pnpm test:mutation` (kedua paket).
  - **Artifact & Pages:**
    - Artifact `mutation-report` berisi `api/` dan `shared/` (HTML + `mutation.json`), retensi 90 hari.
    - Pages `/mutation/` berisi `index.html` berupa tautan ke `api/` dan `shared/` beserta skor masing-masing.
    - Bila artifact belum ada, `/mutation/` berisi placeholder "Laporan mutation testing belum tersedia".

- [ ] **Step 1: Cek kompatibilitas runner**
  - Pasang `@stryker-mutator/core`, `@stryker-mutator/vitest-runner`, dan `@stryker-mutator/typescript-checker` versi stabil terbaru yang dirilis ≥ 2 minggu lalu.
  - Bila `vitest-runner` menolak Vitest 5 (peer dependency atau error saat run), hapus paket itu dan pakai `testRunner: "command"` dengan `commandRunner.command` = `pnpm exec vitest run --project unit` (api) / `pnpm exec vitest run` (shared). Catat sebagai ruling di laporan.
- [ ] **Step 2: Konfigurasi.**
  - **`mutate`:** `src/modules/**/domain/**/*.ts` dan `!**/*.test.ts` (api); `src/slug.ts`, `src/roles.ts` (shared).
  - **Gate & checker:** `thresholds: { high: 90, low: 80, break: 80 }`; `checkers: ["typescript"]`.
  - **Reporter & incremental:** `reporters: ["html", "json", "clear-text", "progress"]`; `incremental: true` dengan `incrementalFile: "reports/stryker-incremental.json"`.
- [ ] **Step 3: Ukur skor awal per paket**, lalu perkuat test.
  - Analisis setiap mutan yang selamat. Bila menunjukkan test lemah, tambah atau perketat assert di file test domain.
  - Bila benar-benar setara dengan kode asli, beri `// Stryker disable next-line <mutator>: <alasan>`.
  - Ulangi sampai kedua paket ≥ 80%.
  - Laporkan skor awal dan akhir, serta daftar mutan yang dikecualikan beserta alasannya (Task 15 memindahkannya ke `TEST_STRATEGY.md`).
- [ ] **Step 4: Workflow `mutation.yml`.**
  - **Pemicu:** `schedule: cron "0 2 * * 1"` dan `workflow_dispatch`.
  - **Setup:** `./.github/actions/setup`; `actions/cache` untuk `**/reports/stryker-incremental.json`, key per branch + sha, restore-key per branch.
  - **Jalankan:** `pnpm test:mutation`, lalu salin laporan ke `mutation-report/{api,shared}`.
  - **Halaman indeks:** buat `mutation-report/index.html` (skor dibaca dari `mutation.json` dengan skrip Node kecil di `.github/scripts/`); tulis skor ke `$GITHUB_STEP_SUMMARY`.
  - **Upload:** artifact `mutation-report` dengan `if: always()` setelah langkah test, agar laporan tetap ada saat gate gagal.
- [ ] **Step 5: Job `report` di `ci.yml`.**
  - Ambil run sukses terakhir: `gh run list --workflow mutation.yml --branch main --status success --limit 1 --json databaseId -q '.[0].databaseId'`.
  - Bila ada: `gh run download <id> -n mutation-report -D allure-report/mutation`. Bila tidak (atau download gagal): tulis placeholder. Langkah ini tidak pernah menggagalkan job.
  - Validasi kedua workflow dengan actionlint.
- [ ] **Step 6: Verifikasi.**
  - `pnpm test:mutation` lokal lulus.
  - Buktikan gate: hapus sementara satu assert penting di test transisi bug → skor api turun di bawah 80 dan perintah exit ≠ 0. Kembalikan.
  - Seluruh unit test tetap lulus.
- [ ] **Step 7: Commit** — `test: mutation testing with StrykerJS on domain code`

---

### Task 15: k6, seed dogfooding, versi 0.4.0, dokumentasi, landing

**Files:**
- Create:
  - `scripts/seed-dogfood-manual.mjs`.
  - `docs/test-plans/tahap-4.md`, `docs/adr/0006-run-manual-snapshot-dan-mutation-testing.md`.
  - `docs/images/manual-run-light.png`, `manual-run-dark.png`, `manual-exec-light.png`, `manual-exec-dark.png`.
- Modify:
  - Perf: `tests/perf/setup.mjs`, `tests/perf/read.js`.
  - Root & screenshot: `package.json` root (`"version": "0.4.0"`), `tests/scripts/screenshots.ts` (+ halaman manual).
  - Docs: `docs/TEST_STRATEGY.md`, `README.md`, `docs/deploy.md` (cara menjalankan seed).
  - Landing: `apps/web/src/pages/landing/Hero.tsx`, `Features.tsx`, `Roadmap.tsx`, `Quality.tsx`, `Footer.tsx`, `tests/e2e/landing.spec.ts`.

**Interfaces:**
- Produces: `node scripts/seed-dogfood-manual.mjs`.
  - **Env:** `TP_BASE_URL` (default `https://testpulse-d2p.pages.dev`), `TP_EMAIL`, `TP_PASSWORD`, `TP_SLUG` (default `testpulse`).
  - **Request:** login lewat `/api/v1/auth/login` dengan header `Origin` = `TP_BASE_URL`, menyimpan cookie `tp_session`.
  - **Data:**
    - Suite: Autentikasi, Upload hasil, Bug tracker, Perbandingan versi, Test manual.
    - ±12 case dengan langkah nyata (contoh di spec §13).
    - Tautan otomasi lewat `GET /tests?q=` untuk case yang punya padanan automated.
  - **Perilaku:** idempoten (judul case/suite yang sudah ada dilewati); tidak pernah mencetak cookie atau password; exit ≠ 0 dengan pesan jelas bila env kosong atau login gagal.

- [ ] **Step 1: Ubah test dulu**
  - `landing.spec.ts`: 1 badge "Segera" (Tahap 5); kartu "Test case manual" Tersedia; link laporan mutation ada → FAIL.
  - k6 `read.js` + `GET /cases`, `GET /manual-runs/:number`, `GET /manual-runs/:number/cases`, `GET /versions` dengan data manual. Setup: ≥ 10 suite, ≥ 200 case, satu run 200 case yang sebagian dieksekusi.
- [ ] **Step 2: Implementasi**
  - **Landing:**
    - Kartu Tersedia, Roadmap Tahap 4 Live / Tahap 5 Berikutnya, hero menyebut test manual.
    - Quality dan Footer menautkan `https://safeqq.github.io/testpulse/mutation/`; snapshot Quality disinkronkan.
  - **Versi & seed:** `version` root 0.4.0 (deploy.yml sudah membacanya); skrip seed.
  - **Dokumen:**
    - ADR: snapshot vs referensi, JSONB, saran status tidak otomatis, versi manual-saja, mutation testing beserta gate dan jadwalnya.
    - Test plan dengan format tahap-3.
    - `TEST_STRATEGY`: mutation testing jadi lapisan aktif; skor awal/akhir dan mutan yang dikecualikan dari laporan Task 14; risiko baru; snapshot jumlah test.
    - README: fitur Tahap 4, link mutation, screenshot, roadmap Tahap 4 ✅, cara seed dogfooding.
- [ ] **Step 3: Verifikasi**
  - **E2E:** chromium penuh di stack Docker.
  - **k6:** baca lokal p95 < 300 ms dengan 0 gagal, dan buktikan masih bisa gagal (threshold sementara).
  - **Seed:** skrip dijalankan terhadap stack Docker lokal (user uji dari seed lokal, bukan production) dua kali; jalan kedua tidak membuat duplikat.
  - **Lainnya:** actionlint; link-check README/docs; angka snapshot = hitungan nyata.
- [ ] **Step 4: Commit** — `feat: manual testing dogfooding, performance scenarios, and Tahap 4 documentation`

---

## Setelah semua task (oleh controller dan pengguna)

1. **Controller:** push → CI hijau → deploy `0.4.0` → smoke & dogfooding automated, lalu jalankan `mutation.yml` sekali lewat `workflow_dispatch`. Setelah itu push berikutnya ke main (atau re-run job report) mempublikasikan `/mutation/`.
2. **Pengguna:**
   - Isi `TP_EMAIL`/`TP_PASSWORD` di shell sendiri dan jalankan `node scripts/seed-dogfood-manual.mjs` ke production.
   - Buat run "Regresi 0.4.0" di UI dan eksekusi semua case-nya secara nyata.

## Definisi selesai

Sama dengan spec §16:

- **Fitur:**
  - Suite dan case bisa disusun, diedit, diarsipkan, dan ditautkan ke automated test.
  - Run manual bisa dibuat, dieksekusi per langkah sampai selesai, dan dibuka ulang.
  - Bug dari case gagal punya isian awal lengkap.
  - Data manual tampil di halaman Versi, dashboard, dan detail bug.
- **Kualitas:**
  - Semua halaman lolos a11y dua tema, 375 px, dan gate CSP.
  - Semua lapisan termasuk visual regression dan k6 hijau di CI.
  - Mutation score domain ≥ 80% dengan laporan di GitHub Pages.
- **Production:** `/p/testpulse` berisi test case manual TestPulse dan run berversi `0.4.0`.
- **Dokumentasi:** diperbarui.
