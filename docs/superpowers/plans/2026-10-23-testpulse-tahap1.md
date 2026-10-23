# TestPulse Tahap 1 — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun fondasi TestPulse (akun, project, tim & role, undangan, project publik) sebagai modular monolith yang live di internet, lengkap dengan seluruh pipeline QA (unit → integration → API → contract → E2E → a11y → ZAP → Allure → deploy + smoke).

**Architecture:** Monorepo pnpm. `apps/api` (Fastify + Drizzle + Postgres) dibagi per modul (`auth`, `projects`, `invitations`); modul hanya memanggil fungsi yang diekspor modul lain. `apps/web` (React + Vite SPA) memanggil API lewat `/api` (proxy Vite lokal, nginx di Docker, Pages Function di production) sehingga cookie sesi `httpOnly` bekerja di satu origin. `packages/shared` menyimpan schema Zod & tipe yang dipakai API, web, dan test.

**Tech Stack:** Node ≥ 24, pnpm 10.22.0, TypeScript strict (ESM), Fastify 5 (+ `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit`), Drizzle ORM + drizzle-kit, `pg`, Zod 4, React 19 + React Router + Vite, Vitest, Testcontainers (`@testcontainers/postgresql`), Playwright, Pact JS (`@pact-foundation/pact`, PactV4), `@axe-core/playwright`, `@faker-js/faker`, Allure (`allure-playwright`, `allure-vitest`), ESLint 9 + typescript-eslint, OWASP ZAP, GitHub Actions, Render, Cloudflare Pages, Neon.

**Spec:** [docs/superpowers/specs/2026-10-23-testpulse-tahap1-design.md](../specs/2026-10-23-testpulse-tahap1-design.md). Baca spec bersama rencana ini; nomor `§` di bawah merujuk ke spec.

## Global Constraints

- **Prasyarat lokal:** Docker Desktop harus terpasang sebelum Task 3 (Testcontainers, compose, ZAP). Jika `docker info` gagal, berhenti dan minta user memasangnya — jangan mencari jalan pintas.
- **Bahasa:** semua teks UI dan pesan error API berbahasa Indonesia; identifier kode berbahasa Inggris.
- **Bentuk error API:** `{ "error": { "code": ErrorCode, "message": string, "fields"?: Record<string,string> } }`; `fields` hanya pada `VALIDATION_ERROR` (§7).
- **Prefix rute:** health di `/api/health`; semua endpoint lain di `/api/v1/...`. API sendiri yang memakai prefix `/api` (proxy tidak me-rewrite path).
- **Cookie sesi:** nama `tp_session`; `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` jika `COOKIE_SECURE=true`; umur 14 hari; DB hanya menyimpan SHA-256 token (§8).
- **Batas nilai (§5):** nama user & project 1–80 karakter setelah trim; password 8–128; slug 3–40 `^[a-z0-9]+(?:-[a-z0-9]+)*$`, kata cadangan `api, new, settings, invite, login, register`; undangan berlaku 7 hari, role `tester|viewer`.
- **Rate limit:** `POST /api/v1/auth/login` & `/register` maks 10/menit/IP → `429 RATE_LIMITED`. Nilai bisa di-override lewat env `RATE_LIMIT_MAX` **hanya** untuk stack test (default 10). Ini tambahan atas daftar env §8 agar suite test paralel tidak terkena 429.
- **Env API:** `DATABASE_URL`, `APP_ORIGIN`, `COOKIE_SECURE`, `PORT` (default 3000), `RATE_LIMIT_MAX` (default 10). Tidak ada secret di repo.
- **Port:** API 3000, web dev 5173, web Docker 8080, Postgres 5432.
- **Testability:** elemen yang dipakai test memakai `data-testid` yang tercantum di task; semua input punya `<label>` terhubung.
- **Commit:** commit kecil per task dengan pesan `feat|test|chore|docs: ...` (Bahasa Indonesia boleh). Jangan push / membuat repo GitHub tanpa persetujuan user (Task 14).

## Review Focus

1. **Nama project yang tidak menghasilkan slug valid** (mis. `"测试"`, `"!!!"`, `"ab"`) tanpa slug manual → `400 VALIDATION_ERROR` dengan `fields.slug` yang meminta slug diisi manual, bukan 500 atau slug kosong. Test di Task 5.
2. **Login dengan email beda huruf besar/kecil & spasi** (`"  Budi@Mail.COM "` setelah daftar `budi@mail.com`) → berhasil. Test di Task 4.
3. **Cookie sesi yang sudah kedaluwarsa** → `401 UNAUTHENTICATED` dan baris sesi terhapus. Test di Task 4.
4. **Menerima undangan setelah project dihapus atau undangan dicabut** → `404 INVITATION_NOT_FOUND` (bukan 500). Test di Task 7.
5. **Admin menurunkan dirinya sendiri saat masih ada admin lain** → diizinkan (`200`), sementara admin terakhir → `409 LAST_ADMIN`. Test di Task 6.

---

## Struktur file

```
package.json, pnpm-workspace.yaml (services dihapus; tambah packages/*, tests)
eslint.config.js, tsconfig.base.json, .env.example, docker-compose.yml
packages/shared/src/
  index.ts, roles.ts, errors.ts, slug.ts
  schemas/auth.ts, projects.ts, members.ts, invitations.ts
apps/api/
  drizzle/                      migrasi SQL hasil drizzle-kit
  drizzle.config.ts, vitest.config.ts, Dockerfile
  src/app.ts, server.ts, config.ts
  src/db/schema.ts, client.ts, migrate.ts
  src/http/errors.ts, validate.ts, security.ts
  src/modules/auth/domain/passwords.ts, tokens.ts
  src/modules/auth/repository.ts, service.ts, routes.ts
  src/modules/projects/domain/permissions.ts, admins.ts
  src/modules/projects/repository.ts, access.ts, routes.ts, members.routes.ts
  src/modules/invitations/domain/invitations.ts
  src/modules/invitations/repository.ts, routes.ts
  test/integration/setup/global-setup.ts, helpers.ts
  test/integration/*.int.test.ts
  test/contract/provider.pact.test.ts
apps/web/
  index.html, vite.config.ts, nginx.conf, Dockerfile
  public/_headers, functions/api/[[path]].ts
  src/main.tsx, App.tsx, styles.css
  src/lib/api.ts, auth.tsx
  src/components/Layout.tsx, FormField.tsx, Alert.tsx, RequireAuth.tsx
  src/pages/LoginPage.tsx, RegisterPage.tsx, ProjectsPage.tsx, NewProjectPage.tsx,
            ProjectPage.tsx, InvitePage.tsx, settings/*.tsx
  test/contract/*.pact.test.ts, test/functions/proxy.test.ts
tests/                          paket @testpulse/tests (Playwright)
  playwright.config.ts
  support/data.ts, api-client.ts, fixtures.ts, a11y.ts
  pages/*.ts                    Page Object Model
  api/*.spec.ts, e2e/*.spec.ts, smoke/*.spec.ts
  security/check-zap-report.mjs, .zap/ (opsional)
.github/workflows/ci.yml, deploy.yml; .github/dependabot.yml
render.yaml
docs/TEST_STRATEGY.md, docs/test-plans/tahap-1.md, docs/adr/0001-*.md, 0002-*.md, docs/deploy.md
pacts/                          file pact (di-gitignore)
```

---

### Task 1: Transisi repo, workspace & paket `shared`

**Files:**
- Delete: `services/`, seluruh isi `apps/web/` lama, `docker/postgres/init.sql`, `docker-compose.yml` lama
- Modify: `package.json` (name `testpulse`, scripts), `pnpm-workspace.yaml`, `.gitignore` (+`pacts/`), `.env.example`, `README.md` (ringkas: "TestPulse — dalam pengembangan, lihat spec")
- Create: `eslint.config.js`, `packages/shared/**` (lihat struktur), `packages/shared/src/**/*.test.ts`

**Interfaces:**
- Produces (diekspor dari `@testpulse/shared`):
  - `ROLES = ["admin","tester","viewer"] as const`, `type Role`, `roleRank(role: Role): number` (admin 3, tester 2, viewer 1)
  - `INVITABLE_ROLES = ["tester","viewer"] as const`, `type InvitableRole`
  - `VISIBILITIES = ["private","public"] as const`, `type Visibility`
  - `type ErrorCode = "NOT_FOUND" | "VALIDATION_ERROR" | "UNAUTHENTICATED" | "FORBIDDEN" | "PROJECT_NOT_FOUND" | "MEMBER_NOT_FOUND" | "INVITATION_NOT_FOUND" | "RATE_LIMITED" | "INTERNAL_ERROR" | "EMAIL_TAKEN" | "INVALID_CREDENTIALS" | "SLUG_TAKEN" | "CONFIRMATION_MISMATCH" | "LAST_ADMIN" | "ALREADY_MEMBER" | "INVITATION_USED" | "INVITATION_EXPIRED"`
  - `interface ApiErrorBody { error: { code: ErrorCode; message: string; fields?: Record<string, string> } }`
  - `SLUG_PATTERN`, `RESERVED_SLUGS`, `slugify(name: string): string`, `slugSchema`
  - Schema Zod + tipe inferensinya: `registerBody`, `loginBody`, `userDto`; `createProjectBody`, `updateProjectBody`, `deleteProjectBody`, `projectDto`; `updateMemberBody`, `memberDto`; `createInvitationBody`, `invitationDto`, `createdInvitationDto`, `invitationPreviewDto`, `acceptInvitationDto`
  - Bentuk DTO: `UserDto {id, email, name}`; `ProjectDto {id, name, slug, visibility, createdAt: string, myRole: Role | null}`; `MemberDto {userId, name, email, role, joinedAt: string}`; `InvitationDto {id, role, expiresAt, createdAt, createdBy: {id, name}}`; `CreatedInvitationDto {id, url, role, expiresAt}`; `InvitationPreviewDto {projectName, projectSlug, role, expiresAt}`; `AcceptInvitationDto {projectSlug, role}`

- [ ] **Step 1: Hapus kode toko & sesuaikan workspace**

Hapus folder/file di atas dengan `git rm -r`. `pnpm-workspace.yaml` berisi `apps/*`, `packages/*`, `tests`. Root `package.json`: name `testpulse`, script `build` (`pnpm -r build`), `typecheck`, `lint` (`eslint .`), `test:unit`, `test:int`, `dev`. Jalankan `rm -rf node_modules && pnpm install` (node_modules lama rusak karena rename folder).

- [ ] **Step 2: Buat paket `shared`** (`@testpulse/shared`, `type: module`, build `tsc` ke `dist`, `exports` → `./dist/index.js` + types `./dist/index.d.ts`, devDep vitest). Root ESLint flat config: `typescript-eslint` recommended untuk semua `.ts/.tsx`, `eslint-plugin-react-hooks` untuk `apps/web`, abaikan `dist`, `drizzle`, `playwright-report`.

- [ ] **Step 3: Tulis test yang gagal** — `packages/shared/src/slug.test.ts` dan `schemas/schemas.test.ts`:

```ts
it.each([
  ["Proyek Saya", "proyek-saya"],
  ["  TestPulse  QA!! ", "testpulse-qa"],
  ["Café Ünïcode", "cafe-unicode"],          // diakritik dibuang (NFKD)
  ["a".repeat(50), "a".repeat(40)],
  ["x---y", "x-y"],
])("slugify(%j) = %j", (input, out) => expect(slugify(input)).toBe(out));
it("slugify tidak menghasilkan '-' di ujung setelah dipotong", () =>
  expect(slugify("a".repeat(39) + " b")).toBe("a".repeat(39)));
it("slugify karakter non-latin → string kosong", () => expect(slugify("测试")).toBe(""));

it.each(["ab", "a".repeat(41), "-abc", "abc-", "a--b", "ABC", "api", "settings"])
  ("slugSchema menolak %j", (s) => expect(slugSchema.safeParse(s).success).toBe(false));
it.each(["abc", "a".repeat(40), "qa-2026"])
  ("slugSchema menerima %j", (s) => expect(slugSchema.safeParse(s).success).toBe(true));

it("registerBody menormalkan email", () =>
  expect(registerBody.parse({ name: " Budi ", email: "  Budi@Mail.COM ", password: "12345678" }))
    .toEqual({ name: "Budi", email: "budi@mail.com", password: "12345678" }));
it.each([["1234567", false], ["12345678", true], ["a".repeat(128), true], ["a".repeat(129), false]])
  ("password %j valid=%s", (pw, ok) =>
    expect(registerBody.safeParse({ name: "A", email: "a@b.co", password: pw }).success).toBe(ok));
it.each([["", false], ["a".repeat(80), true], ["a".repeat(81), false], ["   ", false]])
  ("nama project %j valid=%s", (name, ok) => expect(createProjectBody.safeParse({ name }).success).toBe(ok));
it("updateProjectBody wajib minimal satu field", () =>
  expect(updateProjectBody.safeParse({}).success).toBe(false));
it("createInvitationBody menolak role admin", () =>
  expect(createInvitationBody.safeParse({ role: "admin" }).success).toBe(false));
it("roleRank berurutan", () => expect(roleRank("admin") > roleRank("tester") && roleRank("tester") > roleRank("viewer")).toBe(true));
```

- [ ] **Step 4: Jalankan — harus gagal.** Run: `pnpm --filter @testpulse/shared exec vitest run` → FAIL (modul belum ada).

- [ ] **Step 5: Implementasi** file-file `shared` sesuai Interfaces. `slugify`: `normalize("NFKD")`, buang tanda diakritik, lowercase, karakter selain `a-z0-9` → `-`, rapatkan `-` berulang, potong ke 40, lalu buang `-` di awal/akhir. `loginBody.email` juga trim + lowercase; `loginBody.password` min 1 max 128.

- [ ] **Step 6: Jalankan — harus lulus.** Run: `pnpm --filter @testpulse/shared exec vitest run` → PASS. Lalu `pnpm --filter @testpulse/shared build && pnpm lint` → tanpa error.

- [ ] **Step 7: Commit** — `chore: ganti kode toko dengan workspace TestPulse + paket shared`

---

### Task 2: Logika domain API (murni, tanpa I/O)

**Files:**
- Create: `apps/api/package.json` (`@testpulse/api`), `apps/api/tsconfig.json`, `apps/api/vitest.config.ts` (project `unit`: `src/**/*.test.ts`; coverage v8 `include: ["src/modules/**/domain/**"]`, threshold 80 untuk lines/branches/functions/statements)
- Create: `src/modules/auth/domain/passwords.ts`, `tokens.ts`; `src/modules/projects/domain/permissions.ts`, `admins.ts`; `src/modules/invitations/domain/invitations.ts` + `*.test.ts` berdampingan

**Interfaces:**
- Consumes: `Role`, `Visibility` dari shared
- Produces:
  - `hashPassword(password: string): Promise<string>` (format `salt:hash` hex, scrypt keylen 64), `verifyPassword(password: string, stored: string): Promise<boolean>`, `burnPasswordCheck(password: string): Promise<false>` (scrypt terhadap hash dummy)
  - `SESSION_TTL_DAYS = 14`, `generateToken(): string` (32 byte, base64url), `hashToken(token: string): string` (SHA-256 hex)
  - `type ProjectAction = "project:read" | "members:read" | "project:manage" | "members:manage" | "invitations:manage"`
  - `type AccessDecision = "allow" | "unauthenticated" | "not_found" | "forbidden"`
  - `decideAccess(action: ProjectAction, ctx: { authenticated: boolean; visibility: Visibility; role: Role | null }): AccessDecision`
  - `wouldLeaveNoAdmin(input: { adminCount: number; targetCurrentRole: Role; targetNewRole: Role | null }): boolean` (`targetNewRole: null` = dikeluarkan/keluar)
  - `INVITATION_TTL_DAYS = 7`, `type InvitationStatus = "active" | "used" | "expired" | "revoked"`, `invitationStatus(inv: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null }, now: Date): InvitationStatus` (prioritas: revoked > used > expired > active; `expiresAt <= now` = expired)

- [ ] **Step 1: Tulis test yang gagal.** `permissions.test.ts` membangkitkan test dari tabel yang menyalin matriks §7 (kolom: anonim-publik, anonim-privat, bukan-anggota-privat, bukan-anggota-publik, viewer, tester, admin), mis.:

```ts
const matrix: Record<ProjectAction, AccessDecision[]> = {
  //                 anonPub        anonPriv      nonMemPriv   nonMemPub    viewer   tester   admin
  "project:read":   ["allow",       "not_found",  "not_found", "allow",     "allow", "allow", "allow"],
  "members:read":   ["unauthenticated","unauthenticated","not_found","forbidden","allow","allow","allow"],
  "project:manage": ["unauthenticated","unauthenticated","not_found","forbidden","forbidden","forbidden","allow"],
  "members:manage": [/* sama dengan project:manage */],
  "invitations:manage": [/* sama dengan project:manage */],
};
```

`admins.test.ts`: `{adminCount:1, targetCurrentRole:"admin", targetNewRole:"tester"}` → true; `null` → true; `adminCount:2` → false; target non-admin dengan `adminCount:1` → false; admin→admin → false.
`invitations.test.ts`: aktif; `acceptedAt` terisi → used; `expiresAt` = now → expired; revoked + expired → revoked.
`passwords.test.ts`: hash ≠ password; verify benar → true; salah → false; dua hash password sama berbeda (salt); stored rusak (`"abc"`) → false; `burnPasswordCheck` → false.
`tokens.test.ts`: `generateToken()` panjang ≥ 43, dua panggilan berbeda; `hashToken` deterministik 64 hex.

- [ ] **Step 2: Jalankan — gagal.** Run: `pnpm --filter @testpulse/api exec vitest run --project unit` → FAIL.
- [ ] **Step 3: Implementasi** fungsi-fungsi di Interfaces.
- [ ] **Step 4: Jalankan dengan coverage — lulus.** Run: `pnpm --filter @testpulse/api exec vitest run --project unit --coverage` → PASS, coverage ≥ 80%.
- [ ] **Step 5: Commit** — `feat(api): logika domain auth, izin, admin terakhir, undangan`

---

### Task 3: Database, app factory, error handler & health

**Files:**
- Create: `src/config.ts`, `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `drizzle.config.ts`, `drizzle/*` (generate), `src/http/errors.ts`, `src/http/validate.ts`, `src/app.ts`, `src/server.ts`
- Create: `test/integration/setup/global-setup.ts`, `test/integration/helpers.ts`, `test/integration/health.int.test.ts`
- Modify: `vitest.config.ts` (project `integration`: `test/integration/**/*.int.test.ts`, `globalSetup`, `testTimeout: 30000`)

**Interfaces:**
- Produces:
  - `interface AppConfig { databaseUrl: string; appOrigin: string; cookieSecure: boolean; port: number; rateLimitMax: number }`, `loadConfig(env: NodeJS.ProcessEnv): AppConfig` (throw jika `DATABASE_URL`/`APP_ORIGIN` kosong)
  - Tabel Drizzle `users, sessions, projects, memberships, invitations` persis §6 (uuid `defaultRandom()`, `created_at defaultNow()`, CHECK constraint role/visibility)
  - `type Db`, `createDb(url: string): { db: Db; pool: pg.Pool }`, `runMigrations(db: Db): Promise<void>` (folder `apps/api/drizzle`)
  - `class AppError extends Error { constructor(statusCode: number, code: ErrorCode, message: string, fields?: Record<string,string>) }`
  - `parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T` → `AppError(400,"VALIDATION_ERROR","Data tidak valid", fields)`; `fields` = path bertitik → pesan pertama
  - `buildApp(config: AppConfig, opts?: { db?: Db }): Promise<FastifyInstance>` — dekorasi `app.db`, error handler (AppError → statusnya; error rate-limit → `429 RATE_LIMITED`; Fastify `statusCode` 4xx lain → `400 VALIDATION_ERROR`; selain itu `500 INTERNAL_ERROR` tanpa membocorkan detail), logger pino dengan `redact: ["req.headers.cookie","req.headers.authorization","*.password","*.token"]`, `GET /api/health`
  - Helper integration: `inject("databaseUrl")` dari global setup; `createTestApp(overrides?: Partial<AppConfig>): Promise<FastifyInstance>` (rateLimitMax 1000, appOrigin `http://localhost:5173`)

- [ ] **Step 1: Cek Docker.** Run: `docker info` → sukses. Jika gagal: berhenti, minta user memasang Docker Desktop.
- [ ] **Step 2: Tulis test yang gagal** — `health.int.test.ts`:

```ts
it("GET /api/health → 200 saat DB terjangkau", async () => {
  const app = await createTestApp();
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "ok" });
});
it("GET /api/health → 503 saat DB tidak terjangkau", async () => {
  const app = await createTestApp({ databaseUrl: "postgres://x:x@127.0.0.1:1/none" });
  expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(503);
});
it("rute tidak dikenal → 404 NOT_FOUND dengan bentuk error standar", async () => {
  const res = await (await createTestApp()).inject({ method: "GET", url: "/api/v1/tidak-ada" });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ error: { code: "NOT_FOUND", message: expect.any(String) } });
});
it("migrasi membuat kelima tabel", async () => {
  // query information_schema.tables → berisi users, sessions, projects, memberships, invitations
});
```

Rute tidak dikenal ditangani `setNotFoundHandler` → `AppError(404, "NOT_FOUND", "Halaman tidak ditemukan")`.

- [ ] **Step 3: Jalankan — gagal.** Run: `pnpm --filter @testpulse/api exec vitest run --project integration` → FAIL.
- [ ] **Step 4: Implementasi.** Global setup: `new PostgreSqlContainer("postgres:17-alpine").start()`, jalankan `runMigrations`, `project.provide("databaseUrl", url)`, stop di teardown. `drizzle-kit generate` untuk membuat migrasi awal. `server.ts`: `loadConfig(process.env)` → `runMigrations` → `buildApp` → `listen({ port, host: "0.0.0.0" })`, shutdown rapi pada SIGINT/SIGTERM.
- [ ] **Step 5: Jalankan — lulus.** Run: sama seperti Step 3 → PASS.
- [ ] **Step 6: Commit** — `feat(api): skema database, migrasi, app factory, health`

---

### Task 4: Modul auth (daftar, masuk, keluar, me) + keamanan HTTP

**Files:**
- Create: `src/modules/auth/repository.ts`, `service.ts`, `routes.ts`, `src/http/security.ts`, `test/integration/auth.int.test.ts`, `test/integration/security.int.test.ts`
- Modify: `src/app.ts` (register cookie, helmet, rate-limit, security guard, auth routes), `test/integration/helpers.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `burnPasswordCheck`, `generateToken`, `hashToken`, `SESSION_TTL_DAYS` (Task 2); `AppError`, `parseOrThrow` (Task 3); `registerBody`, `loginBody`, `UserDto` (Task 1)
- Produces:
  - `interface AuthUser { id: string; email: string; name: string }`; Fastify request decoration `req.user: AuthUser | null`
  - `loadUser` preHandler (mengisi `req.user` dari cookie `tp_session`, menghapus sesi kedaluwarsa), `requireUser` preHandler (`401 UNAUTHENTICATED` jika `req.user` null)
  - `registerSecurity(app, config)`: helmet; untuk metode POST/PATCH/PUT/DELETE: tolak `Content-Type` selain `application/json` → `400 VALIDATION_ERROR` (kecuali body kosong pada DELETE/POST tanpa body), dan `Origin` yang ada tapi ≠ `config.appOrigin` → `403 FORBIDDEN`
  - Helper integration: `registerUser(app, overrides?): Promise<{ user: UserDto; cookie: string; password: string }>` (data unik via faker)

- [ ] **Step 1: Tulis test yang gagal** — `auth.int.test.ts`:
  - `register → 201`, body `{id,email,name}` lolos `userDto.parse`, header `set-cookie` berisi `tp_session=`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=1209600`; tanpa `Secure` saat `cookieSecure:false`, dengan `Secure` saat `true`
  - email terpakai (beda huruf besar) → `409 EMAIL_TAKEN`
  - body invalid (password 7 karakter) → `400 VALIDATION_ERROR` dengan `fields.password`
  - **Review Focus 2:** login dengan `"  " + email.toUpperCase() + " "` → `200`
  - password salah dan email tak terdaftar → keduanya `401 INVALID_CREDENTIALS` dengan `message` identik
  - `GET /api/v1/auth/me` dengan cookie → `200` user; tanpa cookie → `401 UNAUTHENTICATED`
  - logout → `204`, cookie dihapus (`Max-Age=0`), `me` dengan cookie lama → `401`
  - **Review Focus 3:** set `expires_at` sesi ke masa lalu lewat `app.db` → `me` → `401` dan baris sesi sudah tidak ada
  - DB hanya menyimpan hash: `sessions.id` ≠ nilai cookie dan = `hashToken(cookie)`

  `security.int.test.ts`:
  - app dengan `rateLimitMax: 10`: 10× login gagal → 401, ke-11 → `429 RATE_LIMITED`
  - POST dengan `Origin: https://evil.example` → `403 FORBIDDEN`; tanpa `Origin` → diproses normal
  - POST `text/plain` → `400 VALIDATION_ERROR`
  - respons memuat header `x-content-type-options: nosniff` (helmet)
- [ ] **Step 2: Jalankan — gagal.** Run: `pnpm --filter @testpulse/api exec vitest run --project integration auth security` → FAIL.
- [ ] **Step 3: Implementasi** repository (`createUser`, `findUserByEmail`, `createSession`, `findSession`, `deleteSession`), service (alur register/login dengan `burnPasswordCheck` untuk email tak terdaftar), routes (`/api/v1/auth/register|login|logout|me`; `config.rateLimit` per-rute untuk register & login, `max: config.rateLimitMax`, `timeWindow: "1 minute"`), dan `registerSecurity`.
- [ ] **Step 4: Jalankan — lulus.** Sama seperti Step 2 → PASS.
- [ ] **Step 5: Commit** — `feat(api): modul auth dengan sesi cookie, rate limit, proteksi CSRF`

---

### Task 5: Modul projects (CRUD, visibilitas, akses)

**Files:**
- Create: `src/modules/projects/repository.ts`, `access.ts`, `routes.ts`, `test/integration/projects.int.test.ts`
- Modify: `src/app.ts`, `test/integration/helpers.ts`

**Interfaces:**
- Consumes: `decideAccess`, `ProjectAction` (Task 2); `loadUser`, `requireUser`, `AuthUser` (Task 4); schema project & `slugify` (Task 1)
- Produces:
  - `interface ProjectRecord { id: string; name: string; slug: string; visibility: Visibility; createdAt: Date }`
  - `resolveProject(db: Db, slug: string, user: AuthUser | null, action: ProjectAction): Promise<{ project: ProjectRecord; role: Role | null }>` — memetakan keputusan: `unauthenticated` → `401 UNAUTHENTICATED`, `not_found` → `404 PROJECT_NOT_FOUND`, `forbidden` → `403 FORBIDDEN`
  - `toProjectDto(project: ProjectRecord, role: Role | null): ProjectDto`
  - Helper integration: `createProject(app, cookie, overrides?): Promise<ProjectDto>`; `addMember(app, projectId, userId, role)` (insert langsung lewat `app.db`, untuk menyiapkan data)

- [ ] **Step 1: Tulis test yang gagal** — `projects.int.test.ts`:
  - `POST /api/v1/projects {name:"Proyek QA"}` → `201`, `slug: "proyek-qa"`, `visibility: "private"`, `myRole: "admin"`
  - slug eksplisit dipakai; slug sudah dipakai → `409 SLUG_TAKEN`; slug cadangan `"api"` → `400` `fields.slug`
  - **Review Focus 1:** `{name:"测试"}` dan `{name:"!!"}` tanpa slug → `400 VALIDATION_ERROR` dengan `fields.slug` berisi pesan "isi slug secara manual"
  - `GET /api/v1/projects` hanya berisi project tempat user menjadi anggota (project publik orang lain tidak muncul)
  - `GET /api/v1/projects/:slug`: anggota → `200` dengan `myRole`; bukan anggota privat → `404 PROJECT_NOT_FOUND`; slug tidak ada → respons identik dengan project privat (status + body); anonim privat → `404`; anonim publik → `200` `myRole: null`; bukan anggota publik → `200` `myRole: null`
  - `PATCH {visibility:"public"}` oleh admin → `200`; oleh tester → `403 FORBIDDEN`; anonim → `401`; `PATCH {}` → `400`
  - `DELETE` dengan `confirmSlug` salah → `400 CONFIRMATION_MISMATCH`; benar → `204`, lalu `GET` → `404`, membership & undangan ikut terhapus (cek tabel)
- [ ] **Step 2: Jalankan — gagal.** Run: `pnpm --filter @testpulse/api exec vitest run --project integration projects` → FAIL.
- [ ] **Step 3: Implementasi** repository (`insertProjectWithAdmin` dalam satu transaksi, `findBySlug`, `listForUser`, `update`, `delete`), `resolveProject`, routes. Slug kosong hasil `slugify` → `AppError(400,"VALIDATION_ERROR",...,{ slug: "Slug tidak dapat dibuat dari nama ini, isi slug secara manual" })`. Unique violation `23505` pada slug → `409 SLUG_TAKEN`.
- [ ] **Step 4: Jalankan — lulus.** → PASS.
- [ ] **Step 5: Commit** — `feat(api): modul projects dengan visibilitas & kontrol akses`

---

### Task 6: Anggota & aturan admin terakhir

**Files:**
- Create: `src/modules/projects/members.routes.ts`, `test/integration/members.int.test.ts`
- Modify: `src/modules/projects/repository.ts`, `src/app.ts`

**Interfaces:**
- Consumes: `resolveProject` (Task 5), `wouldLeaveNoAdmin` (Task 2), `updateMemberBody`, `MemberDto`
- Produces: `changeMemberRole(db, projectId, userId, newRole: Role | null): Promise<"ok" | "not_member" | "last_admin">` — `null` = keluarkan. Berjalan dalam transaksi: `SELECT ... FROM memberships WHERE project_id = $1 AND role = 'admin' FOR UPDATE`, lalu cek `wouldLeaveNoAdmin`.

- [ ] **Step 1: Tulis test yang gagal** — `members.int.test.ts`:
  - `GET members` oleh viewer → `200`, array lolos `memberDto`; bukan anggota publik → `403`; anonim → `401`
  - admin ubah tester → viewer → `200`; tester mengubah role → `403`; userId bukan anggota → `404 MEMBER_NOT_FOUND`
  - admin satu-satunya menurunkan diri → `409 LAST_ADMIN`; **Review Focus 5:** dengan 2 admin, admin A menurunkan diri → `200`
  - admin keluarkan tester → `204`; viewer keluar sendiri → `204`; admin terakhir keluar sendiri → `409 LAST_ADMIN`; bukan anggota project publik mencoba keluar → `404 MEMBER_NOT_FOUND`
  - **Paralel:** project dengan 2 admin; `Promise.all` dua request yang masing-masing menurunkan admin yang berbeda → tepat satu `200` dan satu `409 LAST_ADMIN`; jumlah admin di DB tetap 1
- [ ] **Step 2: Jalankan — gagal.** → FAIL.
- [ ] **Step 3: Implementasi** `changeMemberRole` + rute `GET/PATCH/DELETE /api/v1/projects/:slug/members[/:userId]`. DELETE: jika `userId === req.user.id` → resolve dengan `project:read`; role null → `404 MEMBER_NOT_FOUND`; selain itu resolve dengan `members:manage`.
- [ ] **Step 4: Jalankan — lulus.** → PASS.
- [ ] **Step 5: Commit** — `feat(api): kelola anggota dengan aturan minimal satu admin (aman paralel)`

---

### Task 7: Modul undangan

**Files:**
- Create: `src/modules/invitations/repository.ts`, `routes.ts`, `test/integration/invitations.int.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `resolveProject` (Task 5), `invitationStatus`, `INVITATION_TTL_DAYS` (Task 2), `generateToken`, `hashToken` (Task 2), schema undangan (Task 1)
- Produces: rute `GET|POST /api/v1/projects/:slug/invitations`, `DELETE /api/v1/projects/:slug/invitations/:id`, `GET /api/v1/invitations/:token`, `POST /api/v1/invitations/:token/accept`. URL undangan = `${config.appOrigin}/invite/${token}`.

- [ ] **Step 1: Tulis test yang gagal** — `invitations.int.test.ts`:
  - admin `POST {role:"tester"}` → `201` lolos `createdInvitationDto`, `expiresAt` ≈ sekarang + 7 hari (toleransi 1 menit), `url` diawali `appOrigin + "/invite/"`; token tidak tersimpan mentah di DB
  - `{role:"admin"}` → `400`; viewer membuat → `403`
  - `GET invitations` hanya menampilkan yang aktif (yang dicabut/terpakai/kedaluwarsa tidak ikut)
  - pratinjau publik → `200 {projectName, projectSlug, role, expiresAt}`
  - user lain `accept` → `200 {projectSlug, role:"tester"}`; `GET project` kini `myRole:"tester"`
  - accept kedua kali oleh user lain → `410 INVITATION_USED`; undangan kedaluwarsa (set `expires_at` lampau) → `410 INVITATION_EXPIRED` untuk pratinjau & accept
  - user yang sudah anggota menerima → `409 ALREADY_MEMBER` dan undangan tetap aktif (bisa dipakai user lain)
  - **Review Focus 4:** undangan dicabut → pratinjau & accept `404 INVITATION_NOT_FOUND`; project dihapus → `404 INVITATION_NOT_FOUND`
  - token acak tidak dikenal → `404 INVITATION_NOT_FOUND`; accept tanpa login → `401`; cabut id yang tidak dikenal → `404 INVITATION_NOT_FOUND`
- [ ] **Step 2: Jalankan — gagal.** → FAIL.
- [ ] **Step 3: Implementasi.** Accept dalam transaksi: kunci baris undangan `FOR UPDATE`, cek status, cek keanggotaan, insert membership, set `accepted_at/accepted_by`.
- [ ] **Step 4: Jalankan — lulus.** Lalu jalankan seluruh suite API: `pnpm --filter @testpulse/api exec vitest run` → PASS semua.
- [ ] **Step 5: Commit** — `feat(api): undangan lewat link`

---

### Task 8: Fondasi web + framework Playwright + halaman auth

**Files:**
- Create: `apps/web/**` dasar (`package.json` `@testpulse/web`, `index.html` lang `id`, `vite.config.ts` dengan proxy `/api` → `http://localhost:3000`, `src/main.tsx`, `App.tsx`, `styles.css`, `lib/api.ts`, `lib/auth.tsx`, `components/*`, `pages/LoginPage.tsx`, `RegisterPage.tsx`)
- Create: `tests/package.json` (`@testpulse/tests`), `tests/playwright.config.ts`, `tests/support/data.ts`, `api-client.ts`, `fixtures.ts`, `a11y.ts`, `tests/pages/LoginPage.ts`, `RegisterPage.ts`, `AppShell.ts`, `tests/e2e/auth.spec.ts`
- Modify: root `package.json` (`dev` menjalankan shared `tsc -w`, api `tsx watch`, web `vite` paralel; `.env.example` untuk API lokal)

**Interfaces:**
- Consumes: semua DTO & schema dari shared; endpoint Task 4–7
- Produces:
  - `class ApiError extends Error { status: number; code: ErrorCode; fields?: Record<string,string> }`
  - `createApiClient(baseUrl: string, fetchFn: typeof fetch = fetch)` mengembalikan `{ auth: { register, login, logout, me }, projects: { list, create, get, update, remove }, members: { list, updateRole, remove }, invitations: { list, create, revoke, preview, accept } }` (setiap fungsi typed dengan DTO shared; `credentials: "include"`; header `content-type: application/json` hanya jika ada body); `export const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? "/api")`
  - `AuthProvider`, `useAuth(): { user: UserDto | null; status: "loading" | "authenticated" | "anonymous"; login(body); register(body); logout() }`
  - `RequireAuth` (redirect ke `/login?next=<path>`; hanya izinkan `next` yang diawali `/` dan bukan `//`)
  - Playwright: projects `api` (testDir `api`), `e2e-chromium|firefox|webkit` (testDir `e2e`), `smoke` (testDir `smoke`); `baseURL = process.env.BASE_URL ?? "http://localhost:5173"`; `retries: process.env.CI ? 2 : 0`; `trace: "retain-on-failure"`; reporter `list` + `allure-playwright`
  - `support/data.ts`: `newUserData(): { name; email; password }` (email unik `${faker.string.alphanumeric(8)}@e2e.testpulse.dev`), `newProjectData()`
  - `support/api-client.ts`: `interface TestUser { user: UserDto; password: string; request: APIRequestContext }` (satu `APIRequestContext` per user agar cookie terpisah) dan `class TestApi` dengan `anonymous(): Promise<APIRequestContext>`, `register(data?: Partial<RegisterBody>): Promise<TestUser>`, `createProject(owner: TestUser, data?: Partial<CreateProjectBody>): Promise<ProjectDto>`, `setVisibility(owner: TestUser, slug: string, visibility: Visibility): Promise<void>`, `createInvitation(owner: TestUser, slug: string, role: InvitableRole): Promise<CreatedInvitationDto>`, `acceptInvitation(user: TestUser, token: string): Promise<AcceptInvitationDto>`, `addMember(owner: TestUser, slug: string, role: Role): Promise<TestUser>` (daftar user baru → undang → terima → ubah role jika `admin`); token diambil dari akhir `url`
  - `support/fixtures.ts`: `test` dengan fixture `api: TestApi`, `signedInPage(user?)` (register lewat API, menyalin `storageState` ke context baru), `expectNoA11yViolations(page)` dari `a11y.ts` (axe, gagal jika ada `serious`/`critical`)
  - data-testid: `register-name|email|password|submit`, `login-email|password|submit`, `form-error`, `field-error-<field>`, `current-user`, `logout`

- [ ] **Step 1: Tulis E2E yang gagal** — `tests/e2e/auth.spec.ts` (memakai POM):
  - daftar akun baru → diarahkan ke `/` dan `current-user` menampilkan nama
  - logout → tombol masuk terlihat; login kembali dengan email huruf besar → berhasil
  - password salah → `form-error` "Email atau password salah"
  - password 7 karakter → `field-error-password` muncul **tanpa** request ke server (validasi schema bersama)
  - halaman `/login` dan `/register` lolos `expectNoA11yViolations`
- [ ] **Step 2: Jalankan — gagal.** Jalankan Postgres lokal (`docker compose up -d postgres` dari Task 13 belum ada → sementara `docker run -d --name tp-pg -e POSTGRES_USER=testpulse -e POSTGRES_PASSWORD=testpulse -e POSTGRES_DB=testpulse -p 5432:5432 postgres:17-alpine`), `pnpm dev`, lalu `pnpm --filter @testpulse/tests exec playwright test --project e2e-chromium auth` → FAIL.
- [ ] **Step 3: Implementasi** web dasar, `api.ts`, `auth.tsx`, layout (header: logo TestPulse, navigasi, user), halaman login/daftar dengan validasi `registerBody`/`loginBody` di sisi klien dan pemetaan `ApiError.fields` ke field.
- [ ] **Step 4: Jalankan — lulus** di ketiga browser: `playwright test --project "e2e-*" auth` → PASS.
- [ ] **Step 5: Commit** — `feat(web): fondasi web, halaman auth, dan framework Playwright`

---

### Task 9: Halaman project (daftar, buat, ringkasan publik/privat)

**Files:**
- Create: `apps/web/src/pages/ProjectsPage.tsx`, `NewProjectPage.tsx`, `ProjectPage.tsx`; `tests/pages/ProjectsPage.ts`, `NewProjectPage.ts`, `ProjectPage.ts`; `tests/e2e/projects.spec.ts`

**Interfaces:**
- Consumes: `api.projects.*`, `useAuth`, `slugify`, `createProjectBody` (shared), fixtures Task 8
- Produces: rute `/`, `/projects/new`, `/p/:slug` (tanpa `RequireAuth`); data-testid `project-list`, `project-item-<slug>`, `empty-projects`, `new-project`, `project-name`, `project-slug`, `slug-preview`, `create-project-submit`, `project-title`, `public-badge`, `project-not-found`, `empty-results`, `settings-link`

- [ ] **Step 1: Tulis E2E yang gagal** — `projects.spec.ts`:
  - user baru melihat `empty-projects`; buat project "Proyek E2E" → `slug-preview` menampilkan `proyek-e2e` saat mengetik → diarahkan ke `/p/proyek-e2e…`, `project-title` benar, `empty-results` "Belum ada hasil test"
  - slug terpakai → `field-error-slug` dari respons `409`
  - project publik (disiapkan lewat API) dibuka di context anonim → `public-badge` "Project publik · hanya-baca", tidak ada `settings-link`
  - project privat dibuka anonim → `project-not-found` "Project tidak ditemukan. Jika ini project privat, silakan masuk."
  - ketiga halaman lolos `expectNoA11yViolations`
- [ ] **Step 2: Jalankan — gagal.** `playwright test --project e2e-chromium projects` → FAIL.
- [ ] **Step 3: Implementasi** halaman. `settings-link` hanya tampil jika `myRole !== null`.
- [ ] **Step 4: Jalankan — lulus** di ketiga browser.
- [ ] **Step 5: Commit** — `feat(web): halaman daftar, buat, dan ringkasan project`

---

### Task 10: Pengaturan project, tim, undangan & alur lengkap

**Files:**
- Create: `apps/web/src/pages/settings/ProjectSettingsPage.tsx`, `GeneralSection.tsx`, `VisibilitySection.tsx`, `MembersSection.tsx`, `InvitationsSection.tsx`, `DangerZone.tsx`, `apps/web/src/pages/InvitePage.tsx`; `tests/pages/SettingsPage.ts`, `InvitePage.ts`; `tests/e2e/team.spec.ts`

**Interfaces:**
- Consumes: `api.projects|members|invitations.*`, fixtures
- Produces: rute `/p/:slug/settings` (RequireAuth), `/invite/:token` (pratinjau tanpa login; tombol terima → jika anonim ke `/login?next=/invite/<token>`); data-testid `settings-name`, `settings-save`, `visibility-private`, `visibility-public`, `member-row-<userId>`, `member-role-<userId>` (select), `member-remove-<userId>`, `leave-project`, `invite-role`, `invite-create`, `invite-url`, `invite-copy`, `invite-row-<id>`, `invite-revoke-<id>`, `delete-confirm`, `delete-project`, `invite-preview`, `invite-accept`, `toast`

- [ ] **Step 1: Tulis E2E yang gagal** — `team.spec.ts` (satu skenario berurutan memakai tiga browser context, sesuai §9):
  1. admin (dibuat via API) membuka settings → membuat undangan `viewer` → membaca `invite-url`
  2. context user kedua (sudah daftar via API) membuka URL → `invite-preview` menampilkan nama project & role → `invite-accept` → masuk ke `/p/:slug`
  3. user kedua membuka settings → bagian admin (`settings-name`, `invite-create`, `delete-project`) tidak ada
  4. admin mencoba `leave-project` → `toast` berisi pesan admin terakhir; tetap anggota
  5. admin memilih `visibility-public` → context anonim membuka `/p/:slug` → `public-badge` terlihat; `/p/:slug/settings` → diarahkan ke login
  6. admin kembali ke `visibility-private` → reload context anonim → `project-not-found`
  7. admin mencabut undangan lain → hilang dari daftar; hapus project dengan `delete-confirm` salah → tombol `delete-project` nonaktif; benar → kembali ke `/`
  - settings & invite lolos `expectNoA11yViolations`
- [ ] **Step 2: Jalankan — gagal.** → FAIL.
- [ ] **Step 3: Implementasi** halaman & section. Pesan error API ditampilkan lewat `toast` (`role="status"`) atau `form-error` (`role="alert"`).
- [ ] **Step 4: Jalankan — lulus** di ketiga browser. Lalu seluruh E2E: `playwright test --project "e2e-*"` → PASS.
- [ ] **Step 5: Commit** — `feat(web): pengaturan project, tim, undangan, dan visibilitas`

---

### Task 11: Suite API test (alur, boundary, matriks otorisasi)

**Files:**
- Create: `tests/api/auth.spec.ts`, `tests/api/projects.spec.ts`, `tests/api/authorization-matrix.ts`, `tests/api/authorization.spec.ts`, `tests/api/invitations.spec.ts`

**Interfaces:**
- Consumes: `TestApi`, `newUserData`, schema shared (`userDto`, `projectDto`, `memberDto`, …)
- Produces: `authorization-matrix.ts` mengekspor `type Actor = "anonymous" | "nonMemberPrivate" | "nonMemberPublic" | "viewer" | "tester" | "admin"` dan `const MATRIX: { name: string; request: (ctx) => Promise<APIResponse>; expected: Record<Actor, number> }[]` yang menyalin tabel §7 (baris DELETE member diri sendiri memakai ekspektasi `admin: 409` karena admin satu-satunya)

- [ ] **Step 1: Tulis test** — `authorization.spec.ts` membangkitkan satu test per (baris × aktor) dari `MATRIX`: `test(\`${row.name} sebagai ${actor} → ${status}\`)`; setiap test menyiapkan project segar via API (privat atau publik sesuai aktor). `auth.spec.ts`, `projects.spec.ts`, `invitations.spec.ts` menguji lewat HTTP nyata: setiap respons sukses di-`parse` dengan schema shared; boundary nama 80/81, password 8/7/128/129, slug 3/2/40/41; header `set-cookie` & `x-content-type-options` ada.
- [ ] **Step 2: Jalankan.** Run: `pnpm --filter @testpulse/tests exec playwright test --project api` dengan `pnpm dev` aktif → semua PASS (API sudah ada; test yang gagal berarti bug di API — perbaiki di modul terkait, jangan ubah ekspektasi matriks tanpa memeriksa spec).
- [ ] **Step 3: Commit** — `test(api): suite API test dan matriks otorisasi`

---

### Task 12: Contract test (Pact) web ↔ API

**Files:**
- Create: `apps/web/test/contract/auth.pact.test.ts`, `projects.pact.test.ts`, `members.pact.test.ts`, `invitations.pact.test.ts`, `apps/web/vitest.config.ts` (project `contract`)
- Create: `apps/api/test/contract/provider.pact.test.ts`, `apps/api/test/contract/states.ts`
- Modify: `apps/api/vitest.config.ts` (project `contract`, memakai global setup Testcontainers), root `package.json` (`test:contract`)

**Interfaces:**
- Consumes: `createApiClient` (Task 8) — consumer test memanggil fungsi klien asli terhadap mock server Pact; `fetchFn` pembungkus menambahkan header `Cookie: tp_session=pact-token` untuk interaksi yang butuh login
- Produces: file `pacts/testpulse-web-testpulse-api.json`; provider state: `"tidak ada user"`, `"user budi@pact.dev terdaftar"`, `"budi login"`, `"budi admin project pact-project"`, `"project publik pact-public ada"`, `"undangan pact-invite-token aktif untuk pact-project"`

- [ ] **Step 1: Tulis consumer test** — satu interaksi per endpoint §7 (sukses) plus error utama (`401` me, `409 SLUG_TAKEN`, `409 LAST_ADMIN`, `410 INVITATION_EXPIRED`). Gunakan matcher (`like`, `uuid`, `iso8601DateTimeWithMillis`, `regex` untuk slug) agar kontrak tidak bergantung pada nilai acak.
- [ ] **Step 2: Jalankan consumer.** Run: `pnpm --filter @testpulse/web exec vitest run --project contract` → PASS dan file pact terbentuk di `pacts/`.
- [ ] **Step 3: Tulis provider test** — jalankan `buildApp` di port acak dengan DB Testcontainers; `stateHandlers` membuat data dengan slug/email tetap; `requestFilter` mengganti cookie `pact-token` dengan token sesi asli milik user state tersebut.
- [ ] **Step 4: Jalankan provider.** Run: `pnpm --filter @testpulse/api exec vitest run --project contract` → PASS (semua interaksi terverifikasi). Ubah sementara satu field di `toProjectDto` (mis. hapus `visibility`) → provider FAIL; kembalikan.
- [ ] **Step 5: Commit** — `test(contract): kontrak Pact antara web dan API`

---

### Task 13: Docker, compose & ZAP

**Files:**
- Create: `apps/api/Dockerfile` (multi-stage; build shared lalu api; `pnpm deploy --prod --legacy`; `HEALTHCHECK` ke `/api/health`; user `node`), `apps/web/Dockerfile` (build → `nginx:1.27-alpine`), `apps/web/nginx.conf` (proxy `/api/` → `http://api:3000/api/`, SPA fallback, header keamanan yang sama dengan `_headers`), `docker-compose.yml` (postgres:17-alpine + healthcheck, api dengan `RATE_LIMIT_MAX=1000`, `APP_ORIGIN=http://localhost:8080`, `COOKIE_SECURE=false`, web di 8080), `.dockerignore`, `tests/security/check-zap-report.mjs`

**Interfaces:**
- Produces: `docker compose up -d --build --wait` menghasilkan stack di `http://localhost:8080`; `node tests/security/check-zap-report.mjs <report.json>` exit 1 jika ada alert `riskcode` `"3"` (High), mencetak ringkasan per tingkat risiko

- [ ] **Step 1: Bangun & jalankan stack.** Run: `docker compose up -d --build --wait` → semua service healthy; `curl -s http://localhost:8080/api/health` → `{"status":"ok"}`.
- [ ] **Step 2: Jalankan suite terhadap stack Docker.** Run: `BASE_URL=http://localhost:8080 pnpm --filter @testpulse/tests exec playwright test --project api --project e2e-chromium` → PASS.
- [ ] **Step 3: Jalankan ZAP baseline lokal.** Run: `docker run --rm --network host -v "$PWD/zap:/zap/wrk" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://localhost:8080 -J report.json -I` lalu `node tests/security/check-zap-report.mjs zap/report.json` → exit 0. Jika ada High: perbaiki header/konfigurasi, bukan mengabaikan rule.
- [ ] **Step 4: Commit** — `chore: Dockerfile, docker-compose, dan pemeriksaan ZAP`

---

### Task 14: CI GitHub Actions + Allure + Dependabot

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/dependabot.yml` (npm & github-actions, mingguan)
- Modify: `apps/api/vitest.config.ts` & `apps/web/vitest.config.ts` (reporter `allure-vitest` → `allure-results`), README (badge CI)

**Interfaces:**
- Produces: job `ci.yml` berurutan (`needs`) sesuai §10: `lint-typecheck` (juga `pnpm audit --audit-level high`) → `unit` (coverage gate) → `integration` → `contract` → `stack-tests` (matrix `shard: [1/3, 2/3, 3/3]`: compose up → api tests (shard 1 saja) + E2E `--shard`) → `zap` → `report` (unduh semua artefak `allure-results`, generate dengan Allure CLI, upload; publish ke GitHub Pages lewat `actions/deploy-pages` hanya pada `main`). Cache pnpm; Node 24; Playwright browsers di-install dengan `--with-deps`. Artefak `playwright-report` & trace diunggah saat gagal.

- [ ] **Step 1: Tulis workflow** dan validasi sintaks: `npx --yes @action-validator/cli .github/workflows/ci.yml` (atau `actionlint` jika tersedia) → tanpa error.
- [ ] **Step 2: Minta persetujuan user** untuk membuat repo GitHub publik `testpulse` dan push. Tanpa persetujuan, berhenti di sini dan laporkan.
- [ ] **Step 3: Push & amati CI.** Setelah disetujui: `gh repo create testpulse --public --source . --push`, aktifkan GitHub Pages (source: GitHub Actions), lalu `gh run watch` → semua job hijau. Perbaiki penyebab kegagalan nyata (bukan menambah retry).
- [ ] **Step 4: Commit** (jika ada perbaikan) — `ci: pipeline lengkap dengan laporan Allure`

---

### Task 15: Deploy production (Render + Neon + Cloudflare Pages) & smoke test

**Files:**
- Create: `render.yaml` (web service Docker dari `apps/api/Dockerfile`, `healthCheckPath: /api/health`, env `DATABASE_URL` (sync: false), `APP_ORIGIN`, `COOKIE_SECURE=true`), `apps/web/functions/api/[[path]].ts`, `apps/web/public/_headers`, `apps/web/test/functions/proxy.test.ts`, `.github/workflows/deploy.yml`, `tests/smoke/smoke.spec.ts`, `docs/deploy.md`

**Interfaces:**
- Produces:
  - Pages Function `onRequest(context: { request: Request; env: { API_ORIGIN: string } })`: meneruskan method, header (tanpa `host`), body, dan path+query asli ke `env.API_ORIGIN`; mengembalikan respons apa adanya (termasuk `set-cookie`)
  - `_headers`: `/*` → `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `deploy.yml`: `on: workflow_run` (`ci` selesai, `main`, conclusion success) → `curl -fsS -X POST "$RENDER_DEPLOY_HOOK_URL"` → tunggu `${PRODUCTION_URL}/api/health` 200 (maks 10 menit, polling 15 detik) → build web & `wrangler pages deploy apps/web/dist --project-name testpulse` → `playwright test --project smoke` dengan `BASE_URL=$PRODUCTION_URL`
  - Secrets: `RENDER_DEPLOY_HOOK_URL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PRODUCTION_URL`, `SMOKE_EMAIL`, `SMOKE_PASSWORD`, `SMOKE_PUBLIC_SLUG`

- [ ] **Step 1: Tulis test proxy yang gagal** — `proxy.test.ts`: request `POST https://app.example/api/v1/auth/login?x=1` dengan body & cookie → `fetch` stub menerima `https://api.example/api/v1/auth/login?x=1`, method `POST`, body sama, cookie diteruskan, `host` tidak diteruskan; header `set-cookie` dari respons stub ikut dikembalikan.
- [ ] **Step 2: Jalankan — gagal**, implementasi, **jalankan — lulus.** Run: `pnpm --filter @testpulse/web exec vitest run test/functions` → FAIL lalu PASS.
- [ ] **Step 3: Tulis smoke test** — `smoke.spec.ts` (semua bertag `@smoke`, hanya membaca): health 200; `/login` tampil; login dengan `SMOKE_EMAIL/PASSWORD` → `current-user` tampil; context anonim membuka `/p/${SMOKE_PUBLIC_SLUG}` → `public-badge` tampil.
- [ ] **Step 4: Siapkan layanan (langkah user).** Tulis `docs/deploy.md` berisi checklist berurutan untuk user: buat database Neon → buat service Render dari `render.yaml` dan isi `DATABASE_URL`/`APP_ORIGIN` → buat project Cloudflare Pages `testpulse` dan set env `API_ORIGIN` → daftarkan akun smoke & buat project publik `testpulse` di production → isi GitHub Secrets. Pandu user langkah demi langkah; jangan memasukkan kredensial apa pun atas nama user.
- [ ] **Step 5: Verifikasi deploy.** Merge/push ke `main` → `gh run watch` untuk `deploy.yml` → smoke hijau; buka URL production secara manual dan pastikan alur daftar → buat project berjalan.
- [ ] **Step 6: Commit** — `feat: deploy production dengan smoke test`

---

### Task 16: Dokumen QA & README final

**Files:**
- Create: `docs/TEST_STRATEGY.md`, `docs/test-plans/tahap-1.md`, `docs/adr/0001-modular-monolith.md`, `docs/adr/0002-cookie-session.md`
- Modify: `README.md`

- [ ] **Step 1: Tulis dokumen** sesuai §12: strategy (piramida & alasan tiap lapisan, risiko yang dicakup — mis. kebocoran keberadaan project privat, race admin terakhir, CSRF — dan yang sengaja tidak diuji), test plan tahap 1 (skenario per fitur, kriteria masuk/keluar, merujuk file test), dua ADR (konteks, keputusan, konsekuensi). README: deskripsi produk (termasuk roadmap tahap 2–6), link live, link laporan Allure, badge CI, diagram arsitektur mermaid, cara menjalankan lokal (`pnpm install`, `docker compose up`, `pnpm dev`), cara menjalankan tiap lapisan test.
- [ ] **Step 2: Verifikasi** semua link relatif di README & docs menunjuk file yang ada (`grep -o "](\./[^)]*)"` lalu cek tiap path) dan perintah di README berjalan.
- [ ] **Step 3: Commit & push** (repo sudah disetujui di Task 14) — `docs: test strategy, test plan, ADR, dan README`

---

## Definisi selesai

Sama dengan §14 spec: semua endpoint & halaman berfungsi; semua lapisan hijau di CI (coverage ≥ 80% domain, ZAP 0 High); aplikasi live dan smoke test production hijau; laporan Allure terpublikasi; dokumen §12 tersedia.
