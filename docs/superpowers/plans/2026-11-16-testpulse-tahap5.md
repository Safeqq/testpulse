# TestPulse Tahap 5 — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crowdtesting. Test cycle publik (aplikasi sebagai link) yang bisa diikuti siapa pun yang login; crowd tester mengirim laporan terstruktur; tim mentriase laporan (diterima → bug Tahap 3, ditolak, duplikat); poin reputasi, leaderboard, dan profil publik. Tanpa pembayaran, dengan privasi dan anti-spam yang ketat.

**Architecture:**
- Modul API baru `crowd`:
  - Tabel `crowd_cycles`, `crowd_cycle_links`, `crowd_cycle_environments`, `crowd_participants`, `crowd_reports`, `crowd_report_links`, `crowd_report_events`, `crowd_report_comments`.
  - Counter `projects.cycle_seq` / `crowd_report_seq` dan kolom `bugs.crowd_report_id`.
  - Logika murni di `crowd/domain`.
- Dua permukaan API: `/projects/:slug/...` untuk tim dan `/crowd/...` untuk publik.
- Laporan yang diterima membuat bug lewat repository `bugs` dalam transaksi yang sama.
- Web menambah area publik `/crowd` (menu header) dan tab project "Crowd", semua halaman lazy.
- Helper Markdown aman dipindah ke `packages/shared` agar server bisa membuat deskripsi bug.

**Tech Stack:** Fastify 5 (+ `@fastify/rate-limit` per rute), Drizzle + Postgres, Zod 4, React 19 + Router 7 + Tailwind/shadcn (komponen yang diizinkan), Vitest 5, Testcontainers, Playwright, Pact, k6, ZAP, StrykerJS, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-11-16-testpulse-tahap5-design.md](../specs/2026-11-16-testpulse-tahap5-design.md). Juga mengikat spec Tahap 1, UI 2026-10-26, Tahap 2, Tahap 3, dan Tahap 4.

## Global Constraints

- **Cycle:**
  - `CY-<n>` per project, tidak dipakai ulang. Judul trim 3–120; ringkasan trim 0–280.
  - Link 1–5: `url` http/https ≤ 2000 tanpa username/password; `label` trim 1–60.
  - Instruksi Markdown 0–10.000; `inScope`/`outOfScope` masing-masing 0–2000.
  - Lingkungan 0–10 label unik tanpa peka huruf besar/kecil, trim 1–40.
  - `appVersion` 1–50 `[A-Za-z0-9._+-]` (pakai `runVersion`). `endsAt` saat diisi/diubah harus di masa depan (`400 fields.endsAt`).
  - Status `draft`·`open`·`closed`. Transisi `draft→open`, `open→closed`, `closed→open` (bila `endsAt` lewat harus diganti dulu); tidak pernah kembali ke draft; lainnya `409 INVALID_TRANSITION`.
  - Status efektif: `open` dengan `endsAt ≤ sekarang` = selesai. Konflik `409 CYCLE_CONFLICT`. Hapus hanya bila tanpa laporan (`409 CYCLE_HAS_REPORTS`).
- **Peserta:**
  - Join `{ acceptRules: true }` saat status efektif open; idempoten; `left` bisa ikut lagi, `removed` tidak pernah (`403 PARTICIPANT_REMOVED`).
  - Anggota project → `403 MEMBER_CANNOT_JOIN`, juga untuk mengirim laporan. Bukan peserta → `403 NOT_PARTICIPANT`. Alasan dikeluarkan ≤ 500.
- **Laporan:**
  - `CR-<n>` per project; API publik memakai `id` uuid.
  - Judul trim 5–200; `steps` Markdown trim 10–10.000; `expected`/`actual` trim 1–2000; `environment` trim 3–200.
  - Severity `minor`·`major`·`critical`·`blocker`. Link bukti 0–5 dengan aturan link bug. Karakter kontrol ditolak.
  - Status `submitted`·`accepted`·`rejected`·`duplicate`·`withdrawn`. Transisi persis spec §5.2; lainnya `409 INVALID_TRIAGE`.
  - Edit hanya oleh pelapor saat `submitted`. Konflik `409 REPORT_CONFLICT`.
- **Triase:**
  - **Terima:** severity default usulan, prioritas default `medium`. Poin minor 1 · major 3 · critical 5 · blocker 8 dikunci saat diterima. Bug label `crowd`, reporter = anggota tim yang menerima. Satu transaksi; penerimaan bersamaan → tepat satu bug.
  - **Tolak:** `reason` ∈ `not_reproducible`·`out_of_scope`·`not_a_bug`·`insufficient_info`·`other`; `note` ≤ 1000, wajib bila `other`.
  - **Duplikat:** cycle sama, dikirim lebih dulu, bukan diri sendiri, status `submitted`/`accepted` (`400 fields.duplicateOf`).
  - **Kembalikan:** mengosongkan alasan/catatan/target. `hideFromKnownIssues` hanya untuk `accepted`.
- **Anti-spam** (dalam transaksi yang mengunci baris peserta; `429 RATE_LIMITED` dengan pesan yang menyebut batasnya):
  - ≤ 10 `submitted` sekaligus per tester per cycle.
  - ≤ 50 laporan per tester per cycle, termasuk yang ditarik.
  - ≤ 30 laporan per 24 jam (rolling) per tester di semua cycle.
  - Plus rate limit per IP (`config.rateLimitMax`/menit, pola auth) pada POST laporan, komentar, dan join.
- **Komentar:** Markdown trim 1–5000. Tulis oleh pelapor dan tester+, baca oleh pelapor dan anggota. Hanya hapus milik sendiri (soft delete), tanpa edit.
- **Reputasi:**
  - Poin = jumlah poin laporan `accepted`. Tingkat penerimaan = diterima / (diterima + ditolak + duplikat), `null` bila belum ada keputusan.
  - Leaderboard top 50 + posisi saya. Urutan poin ↓, jumlah diterima ↓, waktu poin terakhir dicapai ↑; hanya poin > 0.
  - Leaderboard global di-cache LRU 30 detik.
  - Profil: nama, poin, tingkat penerimaan, jumlah cycle, dan 10 laporan diterima terbaru yang tidak disembunyikan.
- **Privasi:**
  - Email crowd tester tidak pernah ada di respons crowd mana pun (publik maupun tim); hanya `name`.
  - Laporan orang lain → `404 REPORT_NOT_FOUND`. Cycle draft untuk bukan anggota → `404 CYCLE_NOT_FOUND`.
  - Cycle publik dari project privat → `project.slug = null`.
  - Data laporan dan peserta hanya untuk anggota, juga di project publik (`crowd:read`).
- **Izin:**
  - `crowd:read` (viewer, tester, admin), `crowd:triage` (tester, admin), `crowd:manage` (admin). Matriks persis spec §8.4.
  - Token CI = anonim. Bentuk error `{ error: { code, message, fields? } }`; cursor rusak → 400.
- **Paginasi:**
  - 20 per halaman: cycle tim, direktori.
  - 50 per halaman: peserta, laporan tim, komentar.
  - 100 per halaman: masalah diketahui.
- **Kode error baru:** `CYCLE_NOT_FOUND`, `CYCLE_NOT_OPEN`, `CYCLE_HAS_REPORTS`, `CYCLE_CONFLICT`, `MEMBER_CANNOT_JOIN`, `NOT_PARTICIPANT`, `PARTICIPANT_REMOVED`, `REPORT_NOT_FOUND`, `REPORT_CONFLICT`, `INVALID_TRIAGE`. `RATE_LIMITED` dan `INVALID_TRANSITION` dipakai ulang.
- **Deskripsi bug dari laporan** (dibuat di server dengan helper shared):
  - Metadata (nomor, cycle, nama pelapor, lingkungan) ditulis sebagai code span.
  - `steps`/`expected`/`actual` disalin sebagai Markdown di bawah judul bagian.
  - Link bukti sebagai autolink hanya bila http(s) tanpa spasi/`<`/`>`.
  - Dipotong ke 20.000 karakter di batas code point.
- **Data:**
  - Migrasi `0007` hanya menambah; jangan mengubah migrasi lama. Setiap FK `SET NULL`/`CASCADE` punya index penuh.
  - Urutan kunci: project → cycle → peserta → laporan, didokumentasikan di repository.
  - Nomor via `UPDATE projects SET … + 1 RETURNING`.
- **Keamanan & UI:**
  - CSP **tidak** dilonggarkan; tanpa atribut `style`. Markdown hanya lewat renderer aman yang ada.
  - Link luar: `target="_blank" rel="noopener noreferrer"`.
  - Komponen shadcn yang diizinkan saja (button, card, input, label, badge, separator, dropdown-menu `modal={false}`); tanpa dialog. `<select>`/radio/checkbox/`datetime-local` native. `<select>` tidak dibuat di subtree Suspense yang baru muncul. Jangan mengubah `tests/support/csp.ts`.
  - UI bahasa Indonesia. Waktu tampil di zona browser, disimpan dalam UTC.
  - Setiap halaman baru lolos `expectNoA11yViolationsInBothThemes`, tanpa scroll horizontal di 375 px, gate CSP. Fixture `newContext`. Halaman baru di-lazy-load.
- **Ruling dari Tahap 4 yang tetap berlaku:**
  - Task yang mengubah baseline visual lama membuat ulang baseline itu dalam task yang sama (`pnpm test:visual:update`, periksa, `pnpm test:visual` PASS).
  - Pengecualian Stryker hanya untuk mutan yang benar-benar setara, dengan alasan; mutan lain di baris yang sama disebut eksplisit.
- **Commit:** pesan bahasa Inggris (conventional), tanpa trailer atribusi; implementer commit saja, controller yang push.
- **Lingkungan lokal:**
  - Postgres `tp-pg` port **5433**; `PLAYWRIGHT_BROWSERS_PATH=C:\pw-browsers`; worker ≤ 2 untuk E2E (memori host terbatas). TypeScript `^6.0.3`.
  - Docker dari Git Bash: `export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"`.
  - `npx vitest` dari folder paket bila `pnpm --filter … exec vitest` gagal. Heredoc bash panjang gagal; tulis file dengan tool penulis file. Playwright dijalankan dari `tests/` dengan `--project=<nama>`.
  - CI Linux merender font lebih lebar: untuk teks panjang di grid/flex, pakai `min-w-0`/`break-words` sejak awal.

## Review Focus

1. **Open redirect lewat login `?next=`.** Hanya path relatif yang diawali `/` (bukan `//`, bukan `/\`, bukan skema) yang diikuti; selain itu kembali ke `/`. Test di Task 8.
2. **Peserta yang dikeluarkan, lalu keluar, lalu mencoba ikut lagi.** Statusnya harus tetap `removed`: join `403 PARTICIPANT_REMOVED`, dan `me.state` = `removed`. Keluar tidak boleh "mencuci" status dikeluarkan. Test di Task 2 (domain) dan Task 5 (API).
3. **Cycle ditutup atau `endsAt` lewat saat tester sedang mengisi laporan.** Kirim → `409 CYCLE_NOT_OPEN`, pesan jelas, isian tetap terlihat. Test di Task 6 (API) dan Task 10 (E2E).
4. **Markdown dari crowd yang meniru UI tim.** Heading "## Status: Diterima", tabel palsu, link `javascript:`/`data:`, gambar eksternal di laporan → di halaman triase dan bug yang dibuat semuanya inert. Metadata pelapor tidak bisa ditimpa karena ditulis sebagai code span. Test di Task 2 (unit pembuat deskripsi) dan Task 12 (E2E).
5. **Cycle di project privat.** Halaman publik cycle menampilkan nama project tanpa link; `GET /projects/:slug` untuk anonim tetap 404; tidak ada respons crowd yang memuat slug, id run, atau bug internal project itu. Test di Task 5 (API) dan Task 9 (E2E).

---

## Struktur file

```
packages/shared/src/errors.ts, schemas/crowd.ts (+test), schemas/bugs.ts (+ crowdOrigin), markdown-safe.ts (+test), index.ts
apps/api/
  drizzle/ (migrasi 0007)
  src/db/schema.ts                                   + 8 tabel, 2 counter, bugs.crowd_report_id
  src/modules/projects/domain/permissions.ts         + crowd:read, crowd:triage, crowd:manage
  src/modules/crowd/domain/{cycles,reports,reputation,access,limits,bug-description}.ts (+tests)
  src/modules/crowd/{cycles.routes,cycles.repository,participants.repository,public.routes,public.repository,
                     reports.routes,reports.repository,triage.repository,comments.repository,reputation.repository,
                     cursor,errors}.ts
  src/modules/bugs/{write.repository,read.repository}.ts   + createBug dalam transaksi pemanggil, crowdOrigin
  test/integration/{crowd-cycles,crowd-public,crowd-reports,crowd-triage,migration-0007}.int.test.ts
apps/web/src/lib/api.ts (+ crowd), lib/bugReport.ts (impor dari shared), lib/crowd.ts (+test), lib/safeNext.ts (+test)
apps/web/src/components/{Layout.tsx (menu), CycleStatus.tsx, SeverityBadge.tsx, LeaderboardTable.tsx, ExternalLink.tsx}
apps/web/src/pages/crowd/{CrowdDirectoryPage,CrowdCyclePage,CrowdReportFormPage,CrowdMyReportPage,
                          CrowdLeaderboardPage,CrowdTesterPage,CrowdMePage}.tsx
apps/web/src/pages/project/{CyclesPage,CycleFormPage,CyclePage,CrowdTriagePage,CrowdCard}.tsx, lazyPages.ts
apps/web/src/pages/LoginPage.tsx, RegisterPage.tsx (?next=)
tests/support/crowd.ts, api-client.ts (+ helper crowd), tests/api/crowd.spec.ts, authorization-matrix.ts
tests/e2e/crowd-public.spec.ts, crowd-team.spec.ts, crowd-flow.spec.ts, crowd-security.spec.ts
tests/visual/pages.spec.ts, seed.ts, __screenshots__/
tests/perf/setup.mjs, read.js
.github/workflows/ci.yml (ZAP target tambahan)
scripts/seed-dogfood-crowd.mjs, package.json root ("version": "0.5.0")
docs/test-plans/tahap-5.md, docs/adr/0007-crowdtesting-visibilitas-privasi-dan-anti-spam.md, docs/TEST_STRATEGY.md, README.md, docs/deploy.md
apps/web/src/pages/landing/{Hero,Features,Roadmap,Quality}.tsx, tests/e2e/landing.spec.ts
```

---

### Task 1: Schema bersama, helper Markdown aman, kode error, dan aksi izin

**Files:**
- Create: `packages/shared/src/schemas/crowd.ts` (+ `crowd.test.ts`), `packages/shared/src/markdown-safe.ts` (+ `markdown-safe.test.ts`)
- Modify: `packages/shared/src/errors.ts`, `schemas/bugs.ts`, `index.ts`, `apps/web/src/lib/bugReport.ts` (impor helper dari shared, tanpa perubahan perilaku), `apps/api/src/modules/projects/domain/permissions.ts` (+ test)

**Interfaces:**
- Produces (`@testpulse/shared`):
  - **Konstanta:**
    - `CYCLE_STATUSES`, `CROWD_REPORT_STATUSES`, `CROWD_SEVERITIES` (= nilai severity bug), `REJECT_REASONS`, `PARTICIPANT_STATUSES`.
    - `SEVERITY_POINTS = { minor: 1, major: 3, critical: 5, blocker: 8 }`.
    - Batas: `MAX_CYCLE_LINKS = 5`, `MAX_ENVIRONMENTS = 10`, `MAX_SUBMITTED_PER_CYCLE = 10`, `MAX_REPORTS_PER_CYCLE = 50`, `MAX_REPORTS_PER_DAY = 30`, `LEADERBOARD_SIZE = 50`.
  - **Input:**
    - `cycleLink`, `createCycleBody`, `updateCycleBody` (`{ version, …opsional, status? }`, minimal satu field).
    - `joinBody` (`{ acceptRules: true }` literal).
    - `createCrowdReportBody`, `updateCrowdReportBody` (`{ version, … }`).
    - `triageBody`: discriminated union pada `decision`; `note` wajib bila `reason = "other"`.
    - `hideBody`, `crowdCommentBody`, `removeParticipantBody`.
    - Query: `crowdDirectoryQuery`, `teamCyclesQuery`, `teamReportsQuery`.
  - **DTO:**
    - Cycle: `publicCycleDto` (dengan `project: { name, slug: string | null }`, `stats`, `me: { state }`), `cycleDirectoryItemDto`, `teamCycleDto` (+ hitungan per status, `version`).
    - Laporan & peserta: `participantDto`, `crowdReportDto` (sisi pelapor), `teamCrowdReportDto` (+ pelapor `{id, name}`, event, `bug`, `duplicateOf`, `nextSubmittedNumber`), `knownIssueDto`, `crowdEventDto`, `crowdCommentDto`.
    - Reputasi: `leaderboardDto` (`{ entries: [{ rank, user, points, accepted }], me }`), `testerProfileDto`, `crowdMeDto`.
    - Ringkasan: `crowdSummaryDto | null`.
    - **Tidak ada field `email`** di DTO crowd mana pun.
  - **Helper Markdown** di `markdown-safe.ts`: `codeSpan(text)`, `fenceFor(text)`, `safeAutolink(url): string | null`, `clipCodePoints(text, max)`, dipindah dari web tanpa perubahan perilaku. Tes lama di web tetap lulus.
  - `bugDto` + `crowdOrigin: { cycleNumber, cycleTitle, reportNumber, reporterName } | null`. Sementara di API diisi `null` (placeholder, diganti Task 7).
  - `ErrorCode` + 10 kode baru.
- Produces (API): `ProjectAction` + `"crowd:read"` (anggota saja; **bukan** aksi baca publik), `"crowd:triage"` (tester+), `"crowd:manage"` (admin).

- [ ] **Step 1: Test gagal**
  - **Batas field:**
    - Cycle: judul 2/3/120/121; link 0 dan 6 ditolak, URL `javascript:` ditolak, URL dengan `user:pass@` ditolak; lingkungan `Chrome` + `chrome` → duplikat ditolak.
    - Laporan: judul 4/5/200/201; `steps` 9 karakter ditolak.
  - **Body triase:** `reject` + `other` tanpa `note` → ditolak; `duplicate` tanpa `duplicateOf` → ditolak; `joinBody` dengan `acceptRules: false` → ditolak.
  - **Privasi DTO:** `crowd.test.ts` mem-parse semua DTO dengan objek yang memuat `email` → field itu dibuang atau ditolak (pilih strict/strip secara konsisten dan catat di laporan).
  - **Helper Markdown:** `markdown-safe.test.ts` memakai tabel kasus dari test `bugReport.ts` yang ada.
  - **Izin:**
    - `crowd:read`: anggota ya; non-anggota di project publik → forbidden, anonim di project publik → unauthenticated.
    - `crowd:triage`: tester/admin. `crowd:manage`: admin.
- [ ] **Step 2: Jalankan — gagal.** `npx vitest run` di `packages/shared`; `npx vitest run --project unit permissions` di `apps/api`.
- [ ] **Step 3: Implementasi.** Pakai ulang `bugLabel`, `runVersion`, link bug, `noControlChars`, dan `bugRefDto`.
- [ ] **Step 4: Jalankan — lulus** + `pnpm typecheck` + unit web.
- [ ] **Step 5: Commit** — `feat(shared): crowdtesting schemas, safe markdown helpers in shared, error codes, and permissions`

---

### Task 2: Domain murni crowd

**Files:**
- Create: `apps/api/src/modules/crowd/domain/cycles.ts`, `reports.ts`, `reputation.ts`, `access.ts`, `limits.ts`, `bug-description.ts` (+ test masing-masing)

**Interfaces:**
- Consumes: Task 1 konstanta dan helper `markdown-safe`.
- Produces:
  - **Cycle (`cycles.ts`):**
    - `cycleTransition(from: CycleStatus, to: CycleStatus, ctx: { endsAt: Date | null; now: Date }): "ok" | "invalid" | "ends_at_passed"`.
    - `effectiveCycleStatus(c: { status; endsAt: Date | null }, now: Date): "draft" | "open" | "closed"`.
  - **Laporan (`reports.ts`):**
    - `reportTransition(from: CrowdReportStatus, decision: "accept" | "reject" | "duplicate" | "reopen" | "withdraw"): CrowdReportStatus | null`.
    - `duplicateTargetError(report, target): null | "other_cycle" | "not_earlier" | "self" | "bad_status"`. "Lebih dulu" dibandingkan dengan `(submittedAt, number)`.
  - **Reputasi (`reputation.ts`):**
    - `pointsFor(severity): number`.
    - `acceptanceRate(c: { accepted; rejected; duplicate }): number | null`.
    - `rankLeaderboard(rows: Array<{ userId; name; points; accepted; reachedAt: Date }>, meId: string | null, size: number): LeaderboardDto` (hanya poin > 0).
  - **Akses (`access.ts`):**
    - `participantState(input: { authenticated; isMember; participantStatus: "active" | "left" | "removed" | null; effectiveStatus }): MeState`.
    - `canSubmit(state, …): null | ErrorCode`.
  - **Batas (`limits.ts`):** `submissionLimit(c: { submittedInCycle; totalInCycle; last24h }): null | "submitted" | "total" | "daily"`.
  - **Deskripsi bug (`bug-description.ts`):** `buildCrowdBugDescription(input: { reportNumber; cycleNumber; cycleTitle; reporterName; environment; steps; expected; actual; links: string[] }): string`.

- [ ] **Step 1: Test gagal**
  - **Transisi:** seluruh pasangan `from × to` untuk cycle dan laporan (tabel spec §3.2 dan §5.2).
  - **Status efektif:** batas tepat `endsAt == now` → selesai; 1 ms sebelumnya → open.
  - **`participantState`:**
    - Setiap kombinasi: anonim, anggota, `left`, `removed` (termasuk `removed` dengan cycle closed → tetap `removed`), dan cycle draft/closed.
    - **Review Focus 2:** status `removed` tidak berubah oleh keluar lalu ikut lagi. State machine-nya menolak transisi `removed → left` (di sini) dan `left → active` untuk mantan `removed` (di Task 5).
  - **Duplikat:** keempat kesalahan, termasuk nomor lebih kecil tapi `submittedAt` sama.
  - **Batas:** 9/10/11 submitted, 49/50/51 total, 29/30/31 harian; prioritas pelanggaran `submitted` > `total` > `daily` bila beberapa terlampaui.
  - **Leaderboard:** urutan dan tie-break, entri poin 0 dibuang, `me` di luar top 50 tetap dikembalikan dengan rank aslinya, `me` tanpa poin → `null`.
  - **Deskripsi bug — Review Focus 4:**
    - Nama pelapor dan lingkungan yang berisi backtick, `](javascript:`, dan `# Heading` → muncul di dalam code span.
    - Link bukti `javascript:` tidak ditulis.
    - Teks 30.000 karakter dipotong ≤ 20.000 tanpa separuh surrogate.
    - Hasilnya dirender lewat `Markdown` web (impor test helper seperti Tahap 4 `manualBugReport.test.ts`, atau render server di test web Task 12). Di task ini cukup assert string.
- [ ] **Step 2: Jalankan — gagal.** `npx vitest run --project unit crowd/domain` di `apps/api`.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan — lulus** dengan coverage domain ≥ 80%.
- [ ] **Step 5: Commit** — `feat(api): crowdtesting domain logic`

---

### Task 3: Migrasi DB 0007

**Files:**
- Modify: `apps/api/src/db/schema.ts`, `apps/api/drizzle/*` (generate 0007)
- Create: `apps/api/test/integration/migration-0007.int.test.ts`

**Interfaces:**
- Produces: tabel & kolom spec §7 dengan nama Drizzle `crowdCycles`, `crowdCycleLinks`, `crowdCycleEnvironments`, `crowdParticipants`, `crowdReports`, `crowdReportLinks`, `crowdReportEvents`, `crowdReportComments`, `projects.cycleSeq`, `projects.crowdReportSeq`, `bugs.crowdReportId`. Kolom status memakai `$type<…>()` dari union shared.

- [ ] **Step 1: Test gagal** (pola `migration-0006.int.test.ts`)
  - Migrasi di atas DB berisi data Tahap 4 (suite, case, run manual, bug) tanpa error; data lama utuh.
  - CHECK menolak status/severity/alasan yang tidak dikenal.
  - Constraint unik:
    - `UNIQUE (project_id, number)` untuk cycle dan laporan.
    - `UNIQUE (cycle_id, lower(label))` lingkungan menolak `Chrome`/`chrome`.
  - Menghapus laporan mengosongkan `bugs.crowd_report_id`; menghapus bug mengosongkan `crowd_reports.bug_id`.
  - Menghapus project menghapus semua data crowd.
  - Setiap FK `SET NULL`/`CASCADE` punya index penuh: cek `pg_indexes` untuk `bugs.crowd_report_id`, `crowd_reports.bug_id`, `crowd_reports.duplicate_of_id`, `crowd_participants.user_id`, dan kolom `cycle_id`/`report_id` turunan.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi** + `drizzle-kit generate`. Cek SQL: hanya `CREATE TABLE`/`ADD COLUMN`/`CREATE INDEX`/`ADD CONSTRAINT`.
- [ ] **Step 4: Jalankan — lulus** + seluruh integration API.
- [ ] **Step 5: Commit** — `feat(api): crowdtesting tables (migration 0007)`

---

### Task 4: API tim — cycle, peserta, leaderboard cycle, ringkasan

**Files:**
- Create: `apps/api/src/modules/crowd/cycles.routes.ts`, `cycles.repository.ts`, `participants.repository.ts`, `reputation.repository.ts`, `cursor.ts` (+ test), `errors.ts`, `apps/api/test/integration/crowd-cycles.int.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: Task 1 schema/DTO/izin, Task 2 `cycleTransition`, `effectiveCycleStatus`, `rankLeaderboard`; `resolveProject`; pola nomor dan `withStatementTimeout`.
- Produces:
  - **Rute (spec §8.1):** `GET/POST /cycles`, `GET/PATCH/DELETE /cycles/:number`, `GET /cycles/:number/participants`, `POST /cycles/:number/participants/:userId/remove`, `GET /cycles/:number/leaderboard`, `GET /crowd/summary`.
  - **Repository:**
    - `findCycleByNumber(db, projectId, number)`, `findCycleById(db, id)`.
    - `cycleLeaderboard(db, cycleId, meId)`, `globalLeaderboard(db, meId)` (dipakai Task 5).
    - `removeParticipant(tx, …)`.
  - Di task ini hitungan laporan per status dan `awaitingTriage` = 0 (tabel laporan kosong). Task 6 tidak perlu mengubah query bila sudah ditulis atas `crowd_reports`.

- [ ] **Step 1: Test gagal** (`crowd-cycles.int.test.ts`)
  - **Buat cycle:**
    - Admin membuat → `CY-1` berstatus draft. Tester → 403.
    - 10 cycle dibuat paralel → `CY-1…10`.
  - **Transisi:**
    - `draft→open` mengisi `openedAt`; `open→closed`; `closed→open`.
    - `closed→open` dengan `endsAt` lewat → `400 fields.endsAt`; `open→draft` → `409 INVALID_TRANSITION`.
    - `version` basi → `409 CYCLE_CONFLICT`.
    - `endsAt` di masa lalu saat dibuat → 400.
  - **Hapus:** tanpa laporan → 204. Dengan laporan → `409 CYCLE_HAS_REPORTS`: sisipkan laporan langsung lewat Drizzle, karena endpoint laporan baru ada di Task 6.
  - **Visibilitas:** bukan anggota di project publik melihat cycle non-draft saja; draft → `404 CYCLE_NOT_FOUND`.
  - **Peserta:**
    - Daftar peserta, sisipkan langsung lewat Drizzle: hanya anggota (viewer 200, non-anggota publik 403, anonim publik 401).
    - Keluarkan peserta (tester 204, viewer 403) → status `removed` + alasan.
  - **Leaderboard cycle** dari laporan accepted yang disisipkan: urutan dan tie-break; tanpa email di JSON (pindai regex email pada seluruh body).
  - **`/crowd/summary`:** `null` tanpa cycle; dengan data → hitungan benar.
  - **Lain-lain:** cursor rusak → 400.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan — lulus** + seluruh integration API.
- [ ] **Step 5: Commit** — `feat(api): crowdtesting cycles and participants for project teams`

---

### Task 5: API publik — direktori, cycle, join/keluar, masalah diketahui, leaderboard, profil, me

**Files:**
- Create: `apps/api/src/modules/crowd/public.routes.ts`, `public.repository.ts`, `apps/api/test/integration/crowd-public.int.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/modules/crowd/reputation.repository.ts` (cache LRU global)

**Interfaces:**
- Consumes: Task 2 `participantState`, `effectiveCycleStatus`; Task 4 repository; LRU cache Tahap 3 (`results/lru-cache.ts`).
- Produces:
  - **Rute (spec §8.2):** `GET /crowd/cycles`, `GET /crowd/cycles/:id`, `POST`/`DELETE /crowd/cycles/:id/join`, `GET /crowd/cycles/:id/known-issues`, `GET /crowd/cycles/:id/leaderboard`, `GET /crowd/leaderboard`, `GET /crowd/testers/:userId`, `GET /crowd/me`.
  - **Join:** rate limit per IP, pola `auth/routes.ts`.
  - **Cache leaderboard global:** TTL 30 detik untuk entri; bagian `me` dihitung per permintaan.

- [ ] **Step 1: Test gagal** (`crowd-public.int.test.ts`)
  - **Direktori:**
    - Tab `open`: berakhir terdekat dulu, lalu dibuka terbaru. Cycle dengan `endsAt` lewat masuk `closed`; draft tidak pernah tampil.
    - `q` dengan `%`/`_` dicocokkan literal; 25 cycle → 20 + cursor.
  - **Detail cycle:**
    - `me.state` untuk setiap aktor: anonim, login non-peserta, peserta, keluar, dikeluarkan, anggota, cycle closed.
    - **Review Focus 5:** project privat → `project.slug === null`; seluruh JSON tidak memuat slug project.
  - **Join:**
    - Idempoten: 5 join paralel → satu baris peserta.
    - Anggota → `403 MEMBER_CANNOT_JOIN`; closed / lewat `endsAt` → `409 CYCLE_NOT_OPEN`; draft → 404.
  - **Keluar & dikeluarkan:**
    - Keluar → `left`; join lagi → `active`.
    - **Review Focus 2:** dikeluarkan → keluar (`DELETE join`) → join → `403 PARTICIPANT_REMOVED`; status tetap `removed`.
  - **Masalah diketahui:** hanya accepted dan tidak disembunyikan.
  - **Leaderboard global:** gabungan semua cycle non-draft. Cache: hasil yang sama dalam 30 detik meski data berubah; setelah TTL (clock disuntikkan) berubah. Bagian `me` selalu segar.
  - **Profil:**
    - Poin, tingkat penerimaan (`null` tanpa keputusan), dan 10 laporan terbaru tanpa yang disembunyikan.
    - Pengguna tanpa laporan diterima → profil kosong 200; uuid tidak dikenal → 404.
  - **`/crowd/me`:** butuh login (401).
  - **Privasi:** pindai seluruh body semua endpoint publik → tidak ada pola email.
  - **Token CI** di endpoint publik yang butuh login → 401.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi** (query baca di bawah `withStatementTimeout`).
- [ ] **Step 4: Jalankan — lulus** + seluruh integration API.
- [ ] **Step 5: Commit** — `feat(api): public crowdtesting directory, cycles, joining, and reputation`

---

### Task 6: API laporan — kirim (anti-spam), laporan saya, edit/tarik, komentar, daftar & detail tim

**Files:**
- Create: `apps/api/src/modules/crowd/reports.routes.ts`, `reports.repository.ts`, `comments.repository.ts`, `apps/api/test/integration/crowd-reports.int.test.ts`
- Modify: `apps/api/src/app.ts`, `public.routes.ts`, `cycles.routes.ts`

**Interfaces:**
- Consumes: Task 2 `canSubmit`, `submissionLimit`, `reportTransition`; Task 4–5 repository.
- Produces:
  - **Rute publik:** `GET`/`POST /crowd/cycles/:id/reports`, `GET`/`PATCH`/`DELETE /crowd/reports/:id`, `GET`/`POST /crowd/reports/:id/comments`, `DELETE /crowd/reports/:id/comments/:commentId`.
  - **Rute tim:** `GET /projects/:slug/cycles/:number/reports`, `GET /projects/:slug/crowd-reports/:number` (detail tim tanpa panel triase; field triase masih kosong), `GET`/`POST /projects/:slug/crowd-reports/:number/comments`, `DELETE …/comments/:id`.
  - **Repository:**
    - `submitReport(db, input): Promise<CrowdReportDto | { error }>`: satu transaksi. Kunci baris cycle `FOR SHARE` (status efektif dicek di dalam transaksi), lalu baris peserta `FOR UPDATE`, hitung batas, nomor `CR-n`, tulis laporan + link + event `null → submitted`.
    - `nextSubmittedNumber(db, cycleId, currentNumber)`.

- [ ] **Step 1: Test gagal** (`crowd-reports.int.test.ts`)
  - **Kirim laporan:**
    - Peserta mengirim → `CR-1` `submitted` + event.
    - Bukan peserta → `403 NOT_PARTICIPANT`; dikeluarkan → `403 PARTICIPANT_REMOVED`; anggota (termasuk peserta yang kemudian diundang menjadi anggota) → `403 MEMBER_CANNOT_JOIN`.
    - **Review Focus 3:** cycle ditutup atau `endsAt` lewat → `409 CYCLE_NOT_OPEN`.
  - **Anti-spam di bawah konkurensi:**
    - 9 submitted + 5 kiriman paralel → tepat 1 sukses, 4 → `429` dengan pesan batas submitted.
    - Total 50 (termasuk ditarik) → `429`; 30 dalam 24 jam di dua cycle → `429` harian.
    - Laporan > 24 jam tidak dihitung (atur `submitted_at` langsung).
    - Rate limit per IP pada POST.
  - **Akses laporan:**
    - **Privasi:** laporan orang lain lewat API publik → `404 REPORT_NOT_FOUND`; id acak → 404.
    - Pelapor edit saat submitted → `version` naik; `version` basi → `409 REPORT_CONFLICT`.
    - Tarik → `withdrawn` + event; edit/tarik setelah withdrawn → `409 INVALID_TRIAGE`.
  - **Komentar:** pelapor dan tester menulis di thread yang sama; viewer membaca tapi tidak bisa menulis (403); hapus milik sendiri → soft delete; hapus milik orang lain → 403/404.
  - **Daftar tim:** default submitted, terlama dulu; filter severity/q; detail tim memuat pelapor `{id, name}` tanpa email.
  - **`nextSubmittedNumber`:** berputar ke awal; `null` bila tidak ada.
  - **Privasi:** pindai seluruh body → tidak ada pola email.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi.** Dokumentasikan urutan kunci di kepala `reports.repository.ts`.
- [ ] **Step 4: Jalankan — lulus** + seluruh integration API.
- [ ] **Step 5: Commit** — `feat(api): crowd reports with anti-spam limits, comments, and team queue`

---

### Task 7: API triase dan integrasi bug

**Files:**
- Create: `apps/api/src/modules/crowd/triage.repository.ts`, `apps/api/test/integration/crowd-triage.int.test.ts`
- Modify:
  - API crowd: `reports.routes.ts` (`POST /crowd-reports/:number/triage`, `PATCH /crowd-reports/:number`).
  - Bugs: `apps/api/src/modules/bugs/write.repository.ts` (`createBug` bisa dipanggil dengan transaksi pemanggil, plus `crowdReportId`), `read.repository.ts` (`crowdOrigin` asli menggantikan placeholder Task 1).
  - Komentar urutan kunci di bugs.

**Interfaces:**
- Consumes: Task 2 `reportTransition`, `duplicateTargetError`, `pointsFor`, `buildCrowdBugDescription`; `createBug`.
- Produces:
  - `triageReport(db, input): Promise<TeamCrowdReportDto | "conflict" | "invalid" | { field }>`. Kunci laporan `FOR UPDATE`, cek `version` dan transisi; untuk `accept`, buat bug di transaksi yang sama.
  - `BugDto.crowdOrigin` terisi.

- [ ] **Step 1: Test gagal** (`crowd-triage.int.test.ts`)
  - **Terima:**
    - Severity diubah ke critical → `points = 5`, `finalSeverity`, `triagedBy/At`.
    - Bug berlabel `crowd`, severity critical, prioritas yang dipilih, reporter = penerima, dengan tautan dua arah. `GET /bugs/:n` memuat `crowdOrigin` dengan nama pelapor; deskripsinya sama dengan keluaran `buildCrowdBugDescription`.
  - **Konkurensi:** dua penerimaan paralel dengan `version` yang sama → tepat satu bug, satu `409 REPORT_CONFLICT`. Jumlah bug di project bertambah satu.
  - **Tolak:** alasan `other` tanpa catatan → 400; dengan catatan → `rejected`; poin 0.
  - **Duplikat:**
    - Target sah → `duplicate`.
    - Cycle lain / lebih baru / diri sendiri / withdrawn → `400 fields.duplicateOf`.
  - **Kembalikan & transisi tak sah:**
    - Kembalikan dari `rejected`/`duplicate` → field triase dikosongkan.
    - Terima atau kembalikan laporan `accepted` → `409 INVALID_TRIAGE`.
  - **Sembunyikan:** hanya untuk accepted; laporan yang disembunyikan hilang dari masalah diketahui dan profil, tapi poin tetap dihitung.
  - **Event & dampak:**
    - Setiap keputusan menulis event yang terlihat di detail tim dan detail pelapor.
    - Leaderboard cycle dan global berubah (cache global dilewati dengan clock).
  - **Hapus bug** → laporan tetap `accepted`, `bugId` null, poin tetap.
  - **Akses:** viewer → 403; non-anggota publik → 403; anonim publik → 401.
- [ ] **Step 2: Jalankan — gagal.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan — lulus**: seluruh integration API, `pnpm typecheck`, `pnpm test:contract` (bugs pact yang ada tetap lulus dengan `crowdOrigin: null`).
- [ ] **Step 5: Commit** — `feat(api): crowd report triage that turns accepted reports into bugs`

---

### Task 8: Web — klien API, menu header, `?next=` login, direktori, leaderboard global, profil, ringkasan saya

**Files:**
- Create:
  - Lib: `apps/web/src/lib/crowd.ts` (+ test), `apps/web/src/lib/safeNext.ts` (+ test).
  - Komponen: `components/CycleStatus.tsx`, `SeverityBadge.tsx`, `LeaderboardTable.tsx`, `ExternalLink.tsx`.
  - Halaman: `pages/crowd/CrowdDirectoryPage.tsx`, `CrowdLeaderboardPage.tsx`, `CrowdTesterPage.tsx`, `CrowdMePage.tsx`.
  - Test: `tests/support/crowd.ts`, `tests/e2e/crowd-public.spec.ts` (bagian direktori, leaderboard, profil, me).
- Modify: `apps/web/src/lib/api.ts`, `components/Layout.tsx` (menu "Crowdtesting"), `pages/LoginPage.tsx`, `RegisterPage.tsx`, `App.tsx`, `pages/project/lazyPages.ts` (atau lazy file crowd baru), `tests/support/api-client.ts`

**Interfaces:**
- Produces:
  - **Klien API:** `api.crowd.{directory, cycle, join, leave, knownIssues, leaderboard, globalLeaderboard, tester, me, myReports, submitReport, report, updateReport, withdrawReport, comments, addComment, deleteComment}` dan `api.cycles.{list, get, create, update, remove, participants, removeParticipant, reports, leaderboard, summary}`, `api.crowdReports.{get, triage, setHidden, comments, addComment, deleteComment}`.
  - **`safeNext(raw: string | null): string`** → path relatif aman atau `"/"`.
  - **Login dan register** menghormati `?next=`.
  - **Komponen:**
    - `<ExternalLink href label />`: domain + "membuka situs luar" + `rel`/`target`.
    - `<LeaderboardTable data meLabel? />`.
    - `<CycleStatus status endsAt />`, berisi teks relatif "berakhir 3 hari lagi".
  - **Helper E2E:** `TestApi.createCycle/openCycle/joinCycle/submitCrowdReport/triage` dan `tests/support/crowd.ts` `seedCrowd(api, …)`.

- [ ] **Step 1: Test gagal**
  - **Unit `safeNext.test.ts` — Review Focus 1:**
    - Diterima: `/crowd/c/1`, `/p/x?tab=1#h`.
    - Ditolak → `/`: `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:alert(1)`, `%2F%2Fevil.com`, string kosong, `null`, path dengan karakter kontrol.
  - **Unit `crowd.test.ts`:** label `me.state` → teks tombol/pesan, dan format "berakhir …".
  - **E2E navigasi & direktori:**
    - Menu header `nav-crowd` tampil untuk anonim dan login.
    - Direktori: tab Berlangsung/Selesai dan cari tersimpan di URL; 25 cycle → 20 + "Muat lagi"; cuplikan leaderboard top 5.
  - **E2E leaderboard, profil, me:**
    - Leaderboard global dengan baris "posisi saya" saat login.
    - Profil tester tanpa email (assert teks halaman tidak memuat `@`).
    - `/crowd/me` untuk anonim → login → kembali ke `/crowd/me` lewat `?next=`.
  - **E2E open redirect:** `/login?next=//evil.com` → setelah login berada di `/`.
  - **Kualitas:** a11y dua tema; 375 px.
- [ ] **Step 2: Jalankan — gagal**, lalu **implementasi**. Menu header baru mengubah baseline lama → buat ulang baseline yang terdampak.
- [ ] **Step 3: Jalankan** — unit web + E2E tiga browser (workers=2) + stack Docker (gate CSP) + `pnpm test:visual` → PASS.
- [ ] **Step 4: Commit** — `feat(web): crowdtesting directory, leaderboards, tester profiles, and safe login redirects`

---

### Task 9: Web — halaman cycle publik

**Files:**
- Create: `apps/web/src/pages/crowd/CrowdCyclePage.tsx`
- Modify: `App.tsx`, lazy file, `tests/e2e/crowd-public.spec.ts`

**Interfaces:**
- Consumes: Task 8 klien dan komponen.
- Produces:
  - Rute `/crowd/c/:id`.
  - Blok aksi sesuai `me.state` (spec §9.2), tab Instruksi / Masalah diketahui / Leaderboard / Laporan saya.
  - Testid spec §9.5 untuk halaman cycle.

- [ ] **Step 1: E2E gagal**
  - **Aksi per `me.state`:**
    - Anonim melihat isi + "Masuk untuk ikut" → login → kembali ke cycle.
    - Login: centang aturan wajib sebelum "Ikut cycle ini"; setelah ikut → "Kirim laporan" + "Keluar".
    - Keluar → "Ikut lagi".
    - Dikeluarkan dan anggota project → pesan penjelasan tanpa tombol ikut.
    - Cycle closed → pesan "Cycle sudah selesai".
  - **Link aplikasi:** domain + `target="_blank"` + `rel="noopener noreferrer"`.
  - **Tab:** masalah diketahui dengan "Muat lagi" bila > 100; leaderboard cycle; "Laporan saya" hanya bila pernah ikut.
  - **Review Focus 5:** cycle di project privat menampilkan nama project tanpa link; `/p/<slug>` untuk anonim tetap 404.
  - **Markdown berbahaya** di instruksi/cakupan tampil inert; gate CSP bersih.
  - **Kualitas:** a11y dua tema; 375 px dengan instruksi panjang tanpa spasi.
- [ ] **Step 2: Jalankan — gagal**, lalu **implementasi**.
- [ ] **Step 3: Jalankan** — tiga browser + stack Docker → PASS.
- [ ] **Step 4: Commit** — `feat(web): public crowdtesting cycle page`

---

### Task 10: Web — form laporan & laporan saya

**Files:**
- Create: `apps/web/src/pages/crowd/CrowdReportFormPage.tsx`, `CrowdMyReportPage.tsx`
- Modify: `App.tsx`, lazy file, `tests/e2e/crowd-public.spec.ts` (atau `crowd-flow.spec.ts` bagian pelapor)

**Interfaces:**
- Consumes: Task 8–9; `MarkdownEditor`, `BugLinksInput` (prefix testid `report`), `LazyMarkdown`, pola banner bentrok Tahap 3–4.
- Produces:
  - Rute `/crowd/c/:id/report`, `/crowd/r/:id`, `/crowd/r/:id/edit` (form yang sama).
  - Testid spec §9.5.

- [ ] **Step 1: E2E gagal**
  - **Form laporan:**
    - Validasi per field tampil di bawah field.
    - Chip lingkungan mengisi kolom teks yang tetap bisa diedit; radio severity dengan penjelasan; Markdown Tulis/Pratinjau; link bukti.
    - Panel masalah diketahui bisa dicari.
  - **Setelah kirim:** masuk ke `/crowd/r/:id` dengan status "Dikirim".
  - **Laporan saya:**
    - Edit → tersimpan; dua tab → banner bentrok, isian tetap.
    - Tarik dengan konfirmasi inline → "Ditarik"; tombol edit/tarik hilang.
  - **Batas & penutupan:**
    - Anti-spam: data 10 submitted disiapkan lewat API → pesan `report-limit` menyebut batas.
    - **Review Focus 3:** cycle ditutup lewat API saat form terbuka → kirim → pesan "Cycle sudah ditutup", isian tetap terlihat.
  - **Komentar** dari pelapor tampil di thread.
  - **Hasil triase** yang disiapkan lewat API:
    - Diterima → "+5 poin · Critical".
    - Ditolak → alasan + catatan.
    - Duplikat → judul laporan asli.
  - **Kualitas:** a11y dua tema; 375 px dengan teks panjang.
- [ ] **Step 2: Jalankan — gagal**, lalu **implementasi**.
- [ ] **Step 3: Jalankan** — tiga browser + stack Docker → PASS.
- [ ] **Step 4: Commit** — `feat(web): crowd report form and reporter's report page`

---

### Task 11: Web — tab Crowd: daftar cycle, form cycle, detail cycle

**Files:**
- Create: `apps/web/src/pages/project/CyclesPage.tsx`, `CycleFormPage.tsx`, `CyclePage.tsx`, `tests/e2e/crowd-team.spec.ts`
- Modify: `components/ProjectTabs.tsx` (tab `crowd` setelah `manual`), `App.tsx`, `lazyPages.ts`

**Interfaces:**
- Consumes: Task 8 klien; `MarkdownEditor`, `NativeSelect`, `StepEditor`-style list editor (atau komponen link editor baru), `api.results.versions` untuk saran versi.
- Produces:
  - Rute `/p/:slug/cycles`, `/cycles/new`, `/cycles/:number`, `/cycles/:number/edit`.
  - Testid spec §9.5 untuk area tim.

- [ ] **Step 1: E2E gagal**
  - **Daftar cycle:** status efektif dan jumlah menunggu triase.
  - **Form cycle (admin):**
    - Tambah/hapus/urutkan link, chip lingkungan, Markdown, saran versi, `endsAt`.
    - Validasi per field; `endsAt` di masa lalu → pesan.
    - Bentrok dua tab → banner, isian tetap.
  - **Detail cycle:**
    - Buka / Tutup / Buka ulang dengan konfirmasi inline.
    - "Salin" menyalin link publik; "Lihat sebagai crowd tester" membuka halaman publik.
  - **Tab di detail cycle:**
    - Antrian triase dengan filter.
    - Peserta: keluarkan dengan alasan; peserta itu lalu melihat pesan dikeluarkan.
    - Leaderboard.
  - **Hapus cycle:** tanpa laporan → bisa; dengan laporan → tombol menjelaskan kenapa tidak bisa.
  - **Akses:** tester tidak melihat kontrol admin; viewer hanya baca; anonim di project publik tidak melihat antrian/peserta.
  - **Kualitas:** a11y dua tema; 375 px.
- [ ] **Step 2: Jalankan — gagal**, lalu **implementasi**. Tab baru mengubah baseline lama → buat ulang yang terdampak.
- [ ] **Step 3: Jalankan** — tiga browser + stack Docker + `pnpm test:visual` → PASS.
- [ ] **Step 4: Commit** — `feat(web): project crowd tab with cycle management`

---

### Task 12: Web — halaman triase, asal bug, kartu dashboard, alur lengkap & keamanan

**Files:**
- Create: `apps/web/src/pages/project/CrowdTriagePage.tsx`, `CrowdCard.tsx`, `apps/web/src/components/BugCrowdOrigin.tsx`, `tests/e2e/crowd-flow.spec.ts`, `tests/e2e/crowd-security.spec.ts`
- Modify: `App.tsx`, `lazyPages.ts`, `pages/project/BugPage.tsx`, `Dashboard.tsx`, `ProjectResults.tsx` (kartu juga tampil tanpa run CI, pola Ruling R10 Tahap 4)

**Interfaces:**
- Consumes: Task 7 API; Task 8–11.
- Produces:
  - Rute `/p/:slug/crowd-reports/:number`; testid `triage-*`, `bug-crowd-origin`, `crowd-card`.
  - **Panel keputusan:** state lokal; saat `409` isian tetap. "Simpan & berikutnya" berpindah ke `nextSubmittedNumber`.

- [ ] **Step 1: E2E gagal**
  - **`crowd-flow.spec.ts`** (dua konteks):
    - **Alur terima:** admin membuat + membuka cycle → tester luar menemukannya di direktori → ikut → membaca masalah diketahui → kirim laporan.
    - Admin menerima dengan severity diubah ke critical → "Bug #n dibuat" → detail bug menampilkan label `crowd` dan `bug-crowd-origin`.
    - Tester melihat "+5 poin"; leaderboard cycle dan global menampilkan tester.
    - Laporan masuk masalah diketahui; disembunyikan → hilang.
    - **Alur tolak & duplikat:** tolak (alasan terlihat oleh tester); duplikat (pencarian hanya menawarkan kandidat sah); kembalikan.
    - **Kolaborasi:** komentar dua arah; "Simpan & berikutnya".
    - **Bentrok:** dua anggota tim menerima laporan yang sama → satu sukses, yang lain melihat `triage-conflict`.
    - **Dashboard:** kartu "Crowdtesting" menunjukkan menunggu triase.
  - **`crowd-security.spec.ts` — Review Focus 4:**
    - Laporan berisi `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `[klik](javascript:alert(1))`, `![g](https://example.com/a.png)`, `## Status: Diterima`, dan nama pelapor dengan backtick dan link.
    - Semuanya inert di halaman triase, di bug yang dibuat, dan di laporan saya: tanpa `<img>` eksternal, tanpa dialog, dan gate CSP bersih.
    - Metadata pelapor di bug tampil sebagai kode.
    - Teks halaman triase dan profil tidak memuat email pelapor.
  - **Kualitas:** a11y dua tema; 375 px halaman triase.
- [ ] **Step 2: Jalankan — gagal**, lalu **implementasi**. Bila kartu dashboard mengubah baseline lama, buat ulang.
- [ ] **Step 3: Jalankan** — tiga browser + stack Docker + visual → PASS; `bugs.spec.ts` dan `bug-detail.spec.ts` tetap lulus.
- [ ] **Step 4: Commit** — `feat(web): crowd report triage, bug origin, and dashboard card`

---

### Task 13: Matriks otorisasi API & kontrak web

**Files:**
- Create: `tests/api/crowd.spec.ts`, `apps/web/test/contract/crowd.pact.test.ts`
- Modify: `tests/api/authorization-matrix.ts`, `tests/api/authorization.spec.ts` (aktor publik baru: peserta, peserta keluar, dikeluarkan), `apps/api/test/contract/states.ts`, `apps/web/test/contract/pact.ts`, `apps/web/test/contract/bugs.pact.test.ts` (`crowdOrigin`)

- [ ] **Step 1: Tulis test**
  - **Matriks:**
    - Spec §8.4 tim: 6 aktor + anonim publik; setiap endpoint tim baru.
    - Spec §8.4 publik: anonim, login non-peserta, peserta aktif, keluar, dikeluarkan, anggota project.
    - Replay Bearer token = anonim.
  - **`crowd.spec.ts`:**
    - Alur lewat proxy; setiap respons di-parse schema shared.
    - Status lewat proxy: `409 REPORT_CONFLICT`/`INVALID_TRIAGE`/`CYCLE_NOT_OPEN`/`CYCLE_HAS_REPORTS`, `403 MEMBER_CANNOT_JOIN`/`PARTICIPANT_REMOVED`, `429 RATE_LIMITED`, `404 REPORT_NOT_FOUND` untuk laporan orang lain.
    - Pindai seluruh body: tidak ada email.
  - **Pact web:**
    - Satu interaksi sukses per endpoint baru + error di atas.
    - `BugDto.crowdOrigin` terisi.
    - State provider deterministik dengan id dan nomor tetap, satu state per skenario (pelajaran Tahap 4).
    - Matcher memakai nilai persis bila state deterministik.
- [ ] **Step 2: Jalankan** `playwright test --project=api --workers=2` (stack Docker) dan `pnpm test:contract` → PASS. Di laporan, tunjukkan satu sel matriks gagal ketika `"crowd:read"` sengaja dibuat aksi baca publik, lalu kembalikan (jangan di-commit).
- [ ] **Step 3: Commit** — `test(api): authorization matrix and contracts for crowdtesting`

---

### Task 14: Visual regression, ZAP, dan k6

**Files:**
- Modify: `tests/visual/seed.ts` (project crowd terpisah), `tests/visual/pages.spec.ts`, `tests/visual/__screenshots__/` (baseline baru), `.github/workflows/ci.yml` (job `zap`: target tambahan), `tests/perf/setup.mjs`, `tests/perf/read.js`

- [ ] **Step 1: Visual**
  - Direktori, halaman cycle (tab Instruksi), form laporan, dan halaman triase × terang/gelap × 1280×800/375×812.
  - Data tetap di project terpisah; baseline lama tidak berubah.
  - `pnpm test:visual:update` → periksa PNG → `pnpm test:visual` dua kali → PASS.
  - Bukti gate: ubah sementara warna `SeverityBadge` → FAIL; kembalikan.
- [ ] **Step 2: ZAP**
  - Pertahankan scan baseline ke `http://web:8080`, lalu tambahkan scan (atau URL seed) untuk `/crowd`, `/crowd/c/<id>`, `/crowd/leaderboard` dengan data dari langkah seed di job (pakai helper seed API yang ada di job, atau skrip Node kecil).
  - `check-zap-report.mjs` tetap gerbangnya. Validasi actionlint.
- [ ] **Step 3: k6**
  - `read.js` + `GET /crowd/cycles`, `GET /crowd/cycles/:id`, `GET /crowd/cycles/:id/known-issues`, `GET /crowd/leaderboard`.
  - `setup.mjs` membuat ≥ 20 cycle, ≥ 200 tester, dan ≥ 1000 laporan diterima tersebar, dengan check isi respons (bukan sekadar 200).
  - Jalankan lokal: p95 < 300 ms dan 0 gagal; buktikan bisa gagal dengan threshold sementara.
- [ ] **Step 4: Commit** — `test: visual baselines, ZAP targets, and k6 scenarios for crowdtesting`

---

### Task 15: Seed dogfooding, versi 0.5.0, dokumentasi, landing

**Files:**
- Create: `scripts/seed-dogfood-crowd.mjs`, `docs/test-plans/tahap-5.md`, `docs/adr/0007-crowdtesting-visibilitas-privasi-dan-anti-spam.md`, `docs/images/crowd-directory-{light,dark}.png`, `crowd-triage-{light,dark}.png`
- Modify: `package.json` root (`"version": "0.5.0"`), `docs/TEST_STRATEGY.md`, `README.md`, `docs/deploy.md` (Langkah seed crowd), `tests/scripts/screenshots.ts`, `apps/web/src/pages/landing/Hero.tsx`, `Features.tsx`, `Roadmap.tsx`, `Quality.tsx`, `tests/e2e/landing.spec.ts`, `tests/pages/LandingPage.ts`

**Interfaces:**
- Produces: `node scripts/seed-dogfood-crowd.mjs`.
  - **Env:** `TP_BASE_URL` (default `https://testpulse-d2p.pages.dev`), `TP_EMAIL`, `TP_PASSWORD`, `TP_SLUG` (default `testpulse`).
  - **Pengamanan:** sama dengan `seed-dogfood-manual.mjs`. Tujuan dicetak sebelum login; https saja kecuali localhost; `redirect: "error"`; slug di-encode; tidak pernah mencetak password/cookie; exit 2 untuk env/URL salah, exit 1 untuk login/permintaan gagal.
  - **Data:** membuat cycle "Uji TestPulse 0.5.0" lengkap dengan:
    - Link web production.
    - Instruksi alur: daftar, buat project, upload JUnit via curl, bug, test manual.
    - Cakupan; di luar cakupan: DoS dan social engineering.
    - Lingkungan: Chrome, Firefox, Safari, HP.
    - `appVersion` 0.5.0. Lalu membukanya.
  - **Idempoten:** cycle dengan judul sama dilewati, dan dibuka bila masih draft.

- [ ] **Step 1: Ubah test dulu.** `landing.spec.ts`: 0 badge "Segera"; kartu Crowdtesting "Tersedia"; Roadmap Tahap 5 Live / Tahap 6 Berikutnya → FAIL.
- [ ] **Step 2: Implementasi**
  - **Landing:** hero menyebut crowdtesting; Quality snapshot disinkronkan dengan hitungan nyata. Buat ulang baseline landing yang berubah.
  - **Versi & seed:** `version` 0.5.0; skrip seed.
  - **Dokumen:**
    - ADR: visibilitas cycle vs project privat, privasi tester, model poin, anti-spam beserta kuncinya, deskripsi bug dibuat di server, dan ruling yang relevan dari ledger.
    - Test plan (format tahap-4).
    - TEST_STRATEGY: risiko konten pihak luar, privasi, spam; lapisan keamanan yang diperluas; skor mutation terbaru; snapshot jumlah test.
    - README: fitur Tahap 5, screenshot, roadmap Tahap 5 ✅, cara seed beserta urutannya (setelah deploy 0.5.0).
    - `deploy.md`.
- [ ] **Step 3: Verifikasi**
  - E2E chromium penuh (workers=2) di stack Docker; landing di tiga browser; `pnpm test:visual`.
  - Seed terhadap stack Docker lokal dengan user uji sekali pakai (bukan production) dua kali; jalan kedua tidak mengubah apa pun. Juga uji URL non-https → exit 2.
  - Link-check README/docs; angka snapshot = hitungan nyata.
- [ ] **Step 4: Commit** — `feat: crowdtesting dogfooding seed, version 0.5.0, documentation, and landing`

---

## Setelah semua task (oleh controller dan pengguna)

1. **Controller:**
   - Push → CI hijau → deploy `0.5.0` → smoke & dogfooding automated.
   - Jalankan `mutation.yml` lewat `workflow_dispatch`; skor domain `crowd` harus ≥ 80%. Bila mutan selamat, perkuat test di gelombang perbaikan akhir.
2. **Pengguna:**
   - Isi `TP_EMAIL`/`TP_PASSWORD` di shell sendiri, lalu jalankan `node scripts/seed-dogfood-crowd.mjs` ke production.
   - Bagikan link cycle; triase laporan yang masuk.

## Definisi selesai

Sama dengan spec §17:

- **Cycle:** bisa dibuat, dibuka, ditutup, dan dibuka ulang. Tampil di `/crowd`, termasuk dari project privat, tanpa membocorkan isi project.
- **Crowd tester:** bisa bergabung, mengirim/mengedit/menarik laporan, dan berkomentar.
- **Tim:** bisa menerima (menjadi bug berlabel `crowd` dengan asal tercatat), menolak, menandai duplikat, dan mengembalikan.
- **Reputasi & anti-spam:** poin, leaderboard, dan profil benar; batas anti-spam berlaku.
- **Privasi:** email tidak pernah muncul.
- **Kualitas:** semua lapisan hijau, termasuk visual, k6, ZAP, dan mutation ≥ 80%.
- **Production:** `/crowd` menampilkan cycle "Uji TestPulse 0.5.0".
- **Dokumen:** diperbarui.
