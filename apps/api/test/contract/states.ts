import type { IncomingHttpHeaders } from "node:http";
import type { VerifierOptions } from "@pact-foundation/pact";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../../src/db/client.js";
import {
  bugComments,
  bugEvents,
  bugLabels,
  bugLinks,
  bugs,
  invitations,
  manualRunCases,
  manualRuns,
  memberships,
  projectTokens,
  projects,
  runs,
  sessions,
  testCases,
  testResults,
  users,
} from "../../src/db/schema.js";
import { hashPassword } from "../../src/modules/auth/domain/passwords.js";
import { generateToken, hashToken, SESSION_TTL_DAYS } from "../../src/modules/auth/domain/tokens.js";
import { COMPARE_FIRST_PAGE } from "../../src/modules/results/compare.routes.js";
import { encodeCompareCursor } from "../../src/modules/results/cursor.js";

type StateHandlers = NonNullable<VerifierOptions["stateHandlers"]>;
// Tipe express tidak tersedia di workspace ini; cukup bentuk minimal yang dipakai filter.
type RequestFilter = (req: { headers: IncomingHttpHeaders }, res: unknown, next: () => void) => void;

const DAY_MS = 24 * 60 * 60 * 1000;

// Data tetap; harus sama dengan nilai yang dipakai consumer (apps/web/test/contract/pact.ts).
const PASSWORD = "rahasia123";
const BUDI = { id: "11111111-1111-4111-8111-111111111111", email: "budi@pact.dev", name: "Budi" };
const SARI = { id: "22222222-2222-4222-8222-222222222222", email: "sari@pact.dev", name: "Sari" };
const OWNER = { id: "55555555-5555-4555-8555-555555555555", email: "owner@pact.dev", name: "Pemilik" };
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "66666666-6666-4666-8666-666666666666";
const TEST_CASE_ID = "88888888-8888-4888-8888-888888888888";
const TOKEN_ID = "99999999-9999-4999-8999-999999999999";
// Bug tracker & perbandingan (Tahap 3); id harus UUID v4 sah (z.uuid() shared ketat). Sama dengan consumer.
const COMMENT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const BASE_RUN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TARGET_RUN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REGRESSION_TEST_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const MAX_ACTIVE_TOKENS = 10;
/** Jumlah regresi pada state halaman kelompok: lebih dari halaman pertama (200), sisanya 50 di halaman berikutnya. */
const MANY_REGRESSIONS = 250;
const PROJECT_SLUG = "pact-project";
const PUBLIC_SLUG = "pact-public";
const INGEST_PROJECT_SLUG = "testpulse";

/** Token mentah yang dikirim consumer (hanya SHA-256-nya yang disimpan, seperti pada API). */
const FAKE_SESSION_TOKEN = "pact-token";
const INVITE_TOKEN = "pact-invite-token";
const EXPIRED_INVITE_TOKEN = "pact-expired-token";
/**
 * Token CI mentah yang dikirim reporter (packages/reporter/test/contract/pact.ts). Bentuknya `tp_` + 43 karakter
 * base64url, seperti token asli; hanya SHA-256-nya yang disimpan.
 */
const INGEST_TOKEN = "tp_pact-ingest-token-for-contract-tests-A1B2C3";

interface Person {
  id: string;
  email: string;
  name: string;
}

export interface ContractStates {
  stateHandlers: StateHandlers;
  /** Dipanggil sebelum tiap interaksi: mengosongkan DB agar tiap interaksi terisolasi. */
  beforeEach: () => Promise<void>;
  /** Mengganti cookie sesi palsu `pact-token` dengan token sesi asli milik user pada state. */
  requestFilter: RequestFilter;
}

export function createContractStates(db: Db): ContractStates {
  /** Token sesi asli untuk interaksi yang sedang diverifikasi; null jika state tidak membuat sesi. */
  let sessionToken: string | null = null;
  let passwordHash: string | undefined;

  async function ensureUser(person: Person): Promise<void> {
    passwordHash ??= await hashPassword(PASSWORD);
    await db.insert(users).values({ ...person, passwordHash }).onConflictDoNothing();
  }

  async function ensureSession(userId: string): Promise<void> {
    const token = generateToken();
    await db.insert(sessions).values({
      id: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS),
    });
    sessionToken = token;
  }

  async function findProject(slug: string) {
    const [project] = await db.select().from(projects).where(eq(projects.slug, slug));
    return project;
  }

  /** Membuat project (beserta admin pembuatnya) bila belum ada; kembali memakai yang sudah ada. */
  async function ensureProject(slug: string, name: string, visibility: "private" | "public", owner: Person) {
    const existing = await findProject(slug);
    if (existing) return existing;
    await ensureUser(owner);
    const [created] = await db
      .insert(projects)
      .values({ name, slug, visibility, createdBy: owner.id })
      .returning();
    if (!created) throw new Error(`gagal membuat project ${slug}`);
    await db.insert(memberships).values({ projectId: created.id, userId: owner.id, role: "admin" });
    return created;
  }

  async function ensureMembership(projectId: string, userId: string, role: "admin" | "tester" | "viewer") {
    await db
      .insert(memberships)
      .values({ projectId, userId, role })
      .onConflictDoUpdate({ target: [memberships.projectId, memberships.userId], set: { role } });
  }

  async function ensureInvitation(token: string, expiresAt: Date, id?: string) {
    const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
    const tokenHash = hashToken(token);
    const [existing] = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.tokenHash, tokenHash));
    if (existing) return;
    await db.insert(invitations).values({
      ...(id ? { id } : {}),
      projectId: project.id,
      tokenHash,
      role: "tester",
      createdBy: project.createdBy,
      expiresAt,
    });
  }

  /**
   * Run `main` dengan dua test: `gagal` (failed) dan `goyang` (lulus setelah satu percobaan ulang, flaky).
   * Angka di sini harus cocok dengan total & skor yang diharapkan consumer (apps/web/test/contract/results.pact.test.ts).
   */
  async function ensureRun(project: { id: string }) {
    const [existing] = await db.select({ id: runs.id }).from(runs).where(eq(runs.id, RUN_ID));
    if (existing) return;
    await db.insert(runs).values({
      id: RUN_ID,
      projectId: project.id,
      branch: "main",
      commitSha: "abcdef1",
      durationMs: 1500,
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      flaky: 1,
    });
    const [gagal, goyang] = await db
      .insert(testCases)
      .values([
        { projectId: project.id, suite: "login", name: "gagal" },
        { id: TEST_CASE_ID, projectId: project.id, suite: "login", name: "goyang" },
      ])
      .returning({ id: testCases.id });
    if (!gagal || !goyang) throw new Error("gagal membuat test case");
    await db.insert(testResults).values([
      { runId: RUN_ID, testCaseId: gagal.id, status: "failed", flakyInRun: false, retries: 0, durationMs: 500, message: "Assertion gagal" },
      { runId: RUN_ID, testCaseId: goyang.id, status: "passed", flakyInRun: true, retries: 1, durationMs: 1000, message: null },
    ]);
  }

  /**
   * Bug bernomor tetap (`number`) di project; idempoten. Penghitung `bugSeq` project dinaikkan ke nomor itu sehingga
   * bug yang dibuat consumer berikutnya mendapat nomor berikutnya dengan pasti.
   */
  async function ensureBug(
    project: { id: string },
    number: number,
    values: Partial<typeof bugs.$inferInsert> & { title: string },
  ) {
    const [existing] = await db
      .select({ id: bugs.id })
      .from(bugs)
      .where(sql`${bugs.projectId} = ${project.id} and ${bugs.number} = ${number}`);
    if (existing) return existing.id;
    await ensureUser(OWNER);
    const [created] = await db
      .insert(bugs)
      .values({ projectId: project.id, number, reporterId: OWNER.id, ...values })
      .returning({ id: bugs.id });
    if (!created) throw new Error(`gagal membuat bug #${number}`);
    await db
      .update(projects)
      .set({ bugSeq: sql`greatest(${projects.bugSeq}, ${number})` })
      .where(eq(projects.id, project.id));
    return created.id;
  }

  /**
   * Dua run di `main`: v1.0.0 (dua test lulus) lalu v1.0.1 (satu test gagal), sehingga perbandingan default
   * memuat tepat satu regresi ("A regresi") dan satu test stabil. Waktu run tetap agar urutannya pasti.
   */
  async function ensureCompareRuns(project: { id: string }) {
    const [existing] = await db.select({ id: runs.id }).from(runs).where(eq(runs.id, BASE_RUN_ID));
    if (existing) return;
    const common = { projectId: project.id, branch: "main", durationMs: 2000, total: 2, skipped: 0, flaky: 0 };
    await db.insert(runs).values([
      { ...common, id: BASE_RUN_ID, version: "1.0.0", commitSha: "aaaaaaa", passed: 2, failed: 0, createdAt: new Date("2026-01-01T00:00:00.000Z") },
      { ...common, id: TARGET_RUN_ID, version: "1.0.1", commitSha: "bbbbbbb", passed: 1, failed: 1, createdAt: new Date("2026-01-02T00:00:00.000Z") },
    ]);
    const [regresi, stabil] = await db
      .insert(testCases)
      .values([
        { id: REGRESSION_TEST_ID, projectId: project.id, suite: "checkout", name: "A regresi" },
        { projectId: project.id, suite: "checkout", name: "B stabil" },
      ])
      .returning({ id: testCases.id });
    if (!regresi || !stabil) throw new Error("gagal membuat test case perbandingan");
    const result = { flakyInRun: false, retries: 0, durationMs: 1000 };
    await db.insert(testResults).values([
      { ...result, runId: BASE_RUN_ID, testCaseId: regresi.id, status: "passed", message: null },
      { ...result, runId: BASE_RUN_ID, testCaseId: stabil.id, status: "passed", message: null },
      { ...result, runId: TARGET_RUN_ID, testCaseId: regresi.id, status: "failed", message: "Diharapkan 200 tetapi 500" },
      { ...result, runId: TARGET_RUN_ID, testCaseId: stabil.id, status: "passed", message: null },
    ]);
  }

  /**
   * Dua run berversi seperti `ensureCompareRuns`, tetapi dengan `MANY_REGRESSIONS` test yang lulus di v1.0.0 dan gagal di
   * v1.0.1 (`R001`…`R250`, suite `checkout`). Mengembalikan cursor halaman kedua kelompok regresi, dibuat dengan encoder
   * API sendiri dari item ke-200 menurut urutan perbandingan (suite, nama, id test).
   */
  async function ensureManyRegressions(project: { id: string }): Promise<string> {
    const common = { projectId: project.id, branch: "main", durationMs: 2000, total: MANY_REGRESSIONS, skipped: 0, flaky: 0 };
    await db.insert(runs).values([
      { ...common, id: BASE_RUN_ID, version: "1.0.0", commitSha: "aaaaaaa", passed: MANY_REGRESSIONS, failed: 0, createdAt: new Date("2026-01-01T00:00:00.000Z") },
      { ...common, id: TARGET_RUN_ID, version: "1.0.1", commitSha: "bbbbbbb", passed: 0, failed: MANY_REGRESSIONS, createdAt: new Date("2026-01-02T00:00:00.000Z") },
    ]);
    const cases = await db
      .insert(testCases)
      .values(
        Array.from({ length: MANY_REGRESSIONS }, (_, i) => ({
          projectId: project.id,
          suite: "checkout",
          name: `R${String(i + 1).padStart(3, "0")}`,
        })),
      )
      .returning({ id: testCases.id, suite: testCases.suite, name: testCases.name });
    const result = { flakyInRun: false, retries: 0, durationMs: 1000 };
    await db.insert(testResults).values(
      cases.flatMap((testCase) => [
        { ...result, runId: BASE_RUN_ID, testCaseId: testCase.id, status: "passed", message: null },
        { ...result, runId: TARGET_RUN_ID, testCaseId: testCase.id, status: "failed", message: `${testCase.name} gagal` },
      ]),
    );
    const last = cases.toSorted((a, b) => (a.name < b.name ? -1 : 1))[COMPARE_FIRST_PAGE - 1];
    if (!last) throw new Error("gagal membuat regresi perbandingan");
    return encodeCompareCursor({ baseId: BASE_RUN_ID, targetId: TARGET_RUN_ID, suite: last.suite, name: last.name, testCaseId: last.id });
  }

  /**
   * Dua run manual (Tahap 4 §5.1): TR-1 `v1.0.1` (cocok dengan run CI 1.0.1 milik `ensureCompareRuns`) berisi dua run
   * case (satu lulus, satu belum dites), dan TR-2 `0.9.0` tanpa run case (versi manual-saja). Harus sama dengan
   * `manualRef` di apps/web/test/contract/compare.pact.test.ts.
   */
  async function ensureManualVersionRuns(project: { id: string }) {
    const [existing] = await db.select({ id: manualRuns.id }).from(manualRuns).where(eq(manualRuns.projectId, project.id));
    if (existing) return;
    await ensureUser(OWNER);
    const [tr1] = await db
      .insert(manualRuns)
      .values([
        { projectId: project.id, number: 1, name: "Regresi 1.0.1", appVersion: "v1.0.1", createdBy: OWNER.id },
        { projectId: project.id, number: 2, name: "Eksplorasi 0.9", appVersion: "0.9.0", createdBy: OWNER.id },
      ])
      .returning({ id: manualRuns.id });
    if (!tr1) throw new Error("gagal membuat run manual");
    await db.update(projects).set({ manualRunSeq: 2 }).where(eq(projects.id, project.id));
    const snapshot = { suiteName: "Checkout", suitePosition: 0, steps: [{ action: "Bayar", expected: "Berhasil" }], priority: "medium" as const };
    await db.insert(manualRunCases).values([
      { ...snapshot, runId: tr1.id, position: 0, caseNumber: 1, title: "Bayar kartu", status: "passed", stepResults: [{ status: "passed", note: "" }] },
      { ...snapshot, runId: tr1.id, position: 1, caseNumber: 2, title: "Bayar transfer", stepResults: [{ status: null, note: "" }] },
    ]);
  }

  async function insertTokens(project: { id: string; createdBy: string }, count: number, firstId?: string) {
    await db.insert(projectTokens).values(
      Array.from({ length: count }, (_, i) => ({
        ...(i === 0 && firstId ? { id: firstId } : {}),
        projectId: project.id,
        name: i === 0 ? "Pact CI" : `Pact CI ${i + 1}`,
        tokenHash: hashToken(`tp_pact-seeded-token-${i}`),
        createdBy: project.createdBy,
      })),
    );
  }

  const stateHandlers: StateHandlers = {
    "tidak ada user": async () => {},

    "user budi@pact.dev terdaftar": async () => {
      await ensureUser(BUDI);
    },

    "budi login": async () => {
      await ensureUser(BUDI);
      await ensureSession(BUDI.id);
    },

    "budi admin project pact-project": async () => {
      await ensureUser(BUDI);
      await ensureSession(BUDI.id);
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", BUDI);
      await ensureMembership(project.id, BUDI.id, "admin");
    },

    "project publik pact-public ada": async () => {
      await ensureProject(PUBLIC_SLUG, "Pact Public", "public", OWNER);
    },

    "undangan pact-invite-token aktif untuk pact-project": async () => {
      await ensureInvitation(INVITE_TOKEN, new Date(Date.now() + 7 * DAY_MS), INVITATION_ID);
    },

    "undangan pact-expired-token kedaluwarsa untuk pact-project": async () => {
      await ensureInvitation(EXPIRED_INVITE_TOKEN, new Date(Date.now() - DAY_MS));
    },

    "project testpulse punya token aktif pact-ingest-token": async () => {
      const project = await ensureProject(INGEST_PROJECT_SLUG, "TestPulse", "public", OWNER);
      await db
        .insert(projectTokens)
        .values({ projectId: project.id, name: "Pact ingest", tokenHash: hashToken(INGEST_TOKEN), createdBy: OWNER.id })
        .onConflictDoNothing();
    },

    "pact-project punya run pact-run di branch main dengan satu test gagal dan satu flaky": async () => {
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
      await ensureRun(project);
    },

    "pact-project punya token CI aktif Pact CI": async () => {
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
      await insertTokens(project, 1, TOKEN_ID);
    },

    "pact-project sudah punya 10 token CI aktif": async () => {
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
      await insertTokens(project, MAX_ACTIVE_TOKENS);
    },

    "pact-project punya bug #1 tertaut ke test goyang dengan satu komentar dari budi dan satu event": async () => {
      await ensureUser(BUDI);
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
      await ensureRun(project);
      const bugId = await ensureBug(project, 1, {
        title: "Tombol bayar error",
        description: "Tombol bayar tidak merespons.",
        priority: "high",
        testCaseId: TEST_CASE_ID,
        runId: RUN_ID,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T02:00:00.000Z"),
      });
      await db.insert(bugLabels).values({ bugId, label: "ui" }).onConflictDoNothing();
      const [link] = await db.select({ id: bugLinks.id }).from(bugLinks).where(eq(bugLinks.bugId, bugId));
      if (!link) await db.insert(bugLinks).values({ bugId, position: 0, url: "https://ci.example.com/builds/1", title: "Build CI" });
      // Event lebih awal dari komentar, sehingga urutan linimasa tetap: event dulu, lalu komentar.
      const [event] = await db.select({ id: bugEvents.id }).from(bugEvents).where(eq(bugEvents.bugId, bugId));
      if (!event) {
        await db.insert(bugEvents).values({
          bugId,
          actorId: OWNER.id,
          field: "priority",
          oldValue: "medium",
          newValue: "high",
          createdAt: new Date("2026-01-01T01:00:00.000Z"),
        });
      }
      await db
        .insert(bugComments)
        .values({ id: COMMENT_ID, bugId, authorId: BUDI.id, body: "Sudah direproduksi", createdAt: new Date("2026-01-01T02:00:00.000Z") })
        .onConflictDoNothing();
    },

    "pact-project punya bug #2 berstatus closed": async () => {
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
      await ensureBug(project, 2, {
        title: "Bug lama sudah ditutup",
        status: "closed",
        resolution: "wont_fix",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T03:00:00.000Z"),
        closedAt: new Date("2026-01-01T03:00:00.000Z"),
      });
    },

    "pact-project punya run v1.0.0 dan v1.0.1 di branch main dengan satu regresi": async () => {
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
      await ensureCompareRuns(project);
    },

    // Nilai yang dikembalikan disuntikkan ke request consumer (`fromProviderState("${cursor}", …)`).
    "pact-project punya 250 regresi antara run v1.0.0 dan v1.0.1 di branch main": async () => {
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
      return { cursor: await ensureManyRegressions(project) };
    },

    "pact-project punya run manual TR-1 v1.0.1 dan TR-2 0.9.0": async () => {
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
      await ensureManualVersionRuns(project);
    },

    "sari anggota tester di pact-project": async () => {
      const project = await ensureProject(PROJECT_SLUG, "Pact Project", "private", OWNER);
      await ensureUser(SARI);
      await ensureMembership(project.id, SARI.id, "tester");
    },
  };

  const beforeEach = async () => {
    sessionToken = null;
    await db.execute(sql`truncate table ${invitations}, ${memberships}, ${sessions}, ${projects}, ${users} cascade`);
  };

  const requestFilter: RequestFilter = (req, _res, next) => {
    const cookie = req.headers.cookie;
    if (cookie && sessionToken) {
      req.headers.cookie = cookie.replace(`tp_session=${FAKE_SESSION_TOKEN}`, `tp_session=${sessionToken}`);
    }
    // Request tanpa body (mis. logout) dikirim verifier tanpa content-length; proxy-nya lalu meneruskan
    // dengan `transfer-encoding: chunked` sehingga dianggap membawa body. Klien asli (fetch) mengirim
    // `content-length: 0`, jadi samakan di sini.
    if (req.headers["content-length"] === undefined && req.headers["content-type"] === undefined) {
      req.headers["content-length"] = "0";
    }
    next();
  };

  return { stateHandlers, beforeEach, requestFilter };
}
