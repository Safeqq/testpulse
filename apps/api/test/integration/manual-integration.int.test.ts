import { faker } from "@faker-js/faker";
import {
  bugDto,
  createdTokenDto,
  manualCaseDto,
  manualRunDto,
  manualSummaryDto,
  runCaseDto,
  runCasesPageDto,
  suiteDto,
  versionDto,
  type BugDto,
  type ProjectDto,
  type ResultStatus,
} from "@testpulse/shared";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import type { Db } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { bugs, manualCases, manualRuns, projects, runs, testCases } from "../../src/db/schema.js";
import type { ParsedResult } from "../../src/modules/results/domain/junit.js";
import { insertRun } from "../../src/modules/results/repository.js";
import { addMember, createProject, createTestApp, registerUser, type RegisteredUser } from "./helpers.js";

// Integrasi test manual dengan API lain (spec Tahap 4 §5): versi, ringkasan manual, detail case, bug dari run case.

const BASE_TIME = Date.parse("2026-10-01T00:00:00.000Z");
const minutes = (n: number) => new Date(BASE_TIME + n * 60_000);
const versionsDto = z.array(versionDto);

function result(name: string, status: ResultStatus): ParsedResult {
  return {
    suite: "suite",
    name,
    status,
    flakyInRun: false,
    retries: 0,
    durationMs: 100,
    message: status === "failed" ? `${name} gagal` : null,
  };
}

describe("integrasi test manual", () => {
  let app: FastifyInstance;
  /** App kedua di atas Db yang menghitung setiap query (logger drizzle), untuk asersi jumlah query. */
  let countingApp: FastifyInstance;
  let countingPool: pg.Pool;
  let queryCount = 0;

  beforeAll(async () => {
    app = await createTestApp();
    countingPool = new pg.Pool({ connectionString: inject("databaseUrl") });
    const countingDb: Db = drizzle(countingPool, {
      schema,
      logger: {
        logQuery: () => {
          queryCount += 1;
        },
      },
    });
    countingApp = await createTestApp({}, { db: countingDb });
  });

  afterAll(async () => {
    await countingPool.end();
  });

  interface Fixture {
    admin: RegisteredUser;
    tester: RegisteredUser;
    viewer: RegisteredUser;
    project: ProjectDto;
    tokenId: string;
  }

  async function setup(opts: { visibility?: "public" | "private" } = {}): Promise<Fixture> {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.cookie);
    const tester = await registerUser(app);
    const viewer = await registerUser(app);
    await addMember(app, project.id, tester.user.id, "tester");
    await addMember(app, project.id, viewer.user.id, "viewer");
    if (opts.visibility === "public") {
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${project.slug}`,
        headers: { cookie: admin.cookie },
        payload: { visibility: "public" },
      });
      expect(patch.statusCode).toBe(200);
    }
    const token = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.slug}/tokens`,
      headers: { cookie: admin.cookie },
      payload: { name: "CI" },
    });
    expect(token.statusCode).toBe(201);
    return { admin, tester, viewer, project, tokenId: createdTokenDto.parse(token.json()).id };
  }

  const request = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    fx: Fixture,
    path: string,
    cookie?: string | null,
    payload?: unknown,
    target = app,
  ) =>
    target.inject({
      method,
      url: `/api/v1/projects/${fx.project.slug}${path}`,
      headers: cookie ? { cookie } : {},
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  function expectError(res: LightMyRequestResponse, status: number, code: string, field?: string) {
    expect(res.statusCode, res.body).toBe(status);
    expect(res.json().error.code).toBe(code);
    if (field !== undefined) expect(Object.keys(res.json().error.fields ?? {}), res.body).toContain(field);
  }

  /** Run CI lewat `insertRun` (jalur upload) dengan `created_at` terkendali. */
  async function seedRun(
    fx: Fixture,
    opts: { branch?: string; version?: string; at: number; results?: ParsedResult[] },
  ): Promise<string> {
    const { runId } = await insertRun(app.db, {
      projectId: fx.project.id,
      tokenId: fx.tokenId,
      query: { branch: opts.branch ?? "main", ...(opts.version !== undefined ? { version: opts.version } : {}) },
      report: { durationMs: 1000, results: opts.results ?? [result("a", "passed")] },
    });
    await app.db.update(runs).set({ createdAt: minutes(opts.at) }).where(eq(runs.id, runId));
    return runId;
  }

  async function testCaseId(projectId: string, name: string): Promise<string> {
    const [match] = await app.db
      .select({ id: testCases.id })
      .from(testCases)
      .where(and(eq(testCases.projectId, projectId), eq(testCases.name, name)));
    if (!match) throw new Error(`test case ${name} tidak ada`);
    return match.id;
  }

  async function createSuite(fx: Fixture) {
    const res = await request("POST", fx, "/suites", fx.tester.cookie, { name: `Suite ${faker.string.alphanumeric(8)}` });
    expect(res.statusCode, res.body).toBe(201);
    return suiteDto.parse(res.json());
  }

  async function createCase(fx: Fixture, suiteId: string, payload: Record<string, unknown> = {}) {
    const res = await request("POST", fx, "/cases", fx.tester.cookie, {
      suiteId,
      title: `Case ${faker.string.alphanumeric(8)}`,
      steps: [{ action: "Buka halaman", expected: "Tampil" }],
      ...payload,
    });
    expect(res.statusCode, res.body).toBe(201);
    return manualCaseDto.parse(res.json());
  }

  async function createRun(fx: Fixture, payload: Record<string, unknown>) {
    const res = await request("POST", fx, "/manual-runs", fx.tester.cookie, { name: "Regresi rilis", ...payload });
    expect(res.statusCode, res.body).toBe(201);
    return manualRunDto.parse(res.json());
  }

  async function setRunCreatedAt(fx: Fixture, number: number, at: number) {
    await app.db
      .update(manualRuns)
      .set({ createdAt: minutes(at) })
      .where(and(eq(manualRuns.projectId, fx.project.id), eq(manualRuns.number, number)));
  }

  /**
   * Run manual tanpa run case langsung ke DB (nomor lanjut dari `manual_run_seq`), untuk banyak versi sekaligus.
   * `created_at` menit ke-`i` agar urutannya pasti.
   */
  async function seedManualRuns(fx: Fixture, appVersions: readonly string[]) {
    const [project] = await app.db
      .update(projects)
      .set({ manualRunSeq: sql`${projects.manualRunSeq} + ${appVersions.length}` })
      .where(eq(projects.id, fx.project.id))
      .returning({ seq: projects.manualRunSeq });
    const first = project!.seq - appVersions.length + 1;
    await app.db.insert(manualRuns).values(
      appVersions.map((appVersion, i) => ({
        projectId: fx.project.id,
        number: first + i,
        name: `Run ${appVersion}`,
        appVersion,
        createdBy: fx.admin.user.id,
        createdAt: minutes(i),
      })),
    );
  }

  async function listRunCases(fx: Fixture, runNumber: number, target = app) {
    const res = await request("GET", fx, `/manual-runs/${runNumber}/cases`, fx.tester.cookie, undefined, target);
    expect(res.statusCode, res.body).toBe(200);
    return runCasesPageDto.parse(res.json());
  }

  async function getRunCase(fx: Fixture, runNumber: number, id: string) {
    const res = await request("GET", fx, `/manual-runs/${runNumber}/cases/${id}`, fx.tester.cookie);
    expect(res.statusCode, res.body).toBe(200);
    return runCaseDto.parse(res.json());
  }

  async function patchRunCase(fx: Fixture, runNumber: number, id: string, payload: Record<string, unknown>) {
    const current = await getRunCase(fx, runNumber, id);
    const res = await request("PATCH", fx, `/manual-runs/${runNumber}/cases/${id}`, fx.tester.cookie, {
      version: current.version,
      ...payload,
    });
    expect(res.statusCode, res.body).toBe(200);
    return runCaseDto.parse(res.json());
  }

  async function versions(fx: Fixture, query = "") {
    const res = await request("GET", fx, `/versions${query}`, fx.tester.cookie);
    expect(res.statusCode, res.body).toBe(200);
    return versionsDto.parse(res.json());
  }

  async function createBugRaw(fx: Fixture, body: Record<string, unknown>) {
    return request("POST", fx, "/bugs", fx.tester.cookie, { title: "Tombol simpan error", ...body });
  }

  async function createBug(fx: Fixture, body: Record<string, unknown>): Promise<BugDto> {
    const res = await createBugRaw(fx, body);
    expect(res.statusCode, res.body).toBe(201);
    return bugDto.parse(res.json());
  }

  async function getBug(fx: Fixture, number: number): Promise<BugDto> {
    const res = await request("GET", fx, `/bugs/${number}`, fx.tester.cookie);
    expect(res.statusCode, res.body).toBe(200);
    return bugDto.parse(res.json());
  }

  async function closeBug(fx: Fixture, bug: BugDto) {
    const res = await request("PATCH", fx, `/bugs/${bug.number}`, fx.admin.cookie, {
      version: bug.version,
      status: "closed",
      resolution: "fixed",
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  /** Run berisi `count` case dari satu suite baru; mengembalikan run, id run case urut posisi, dan case-nya. */
  async function runWithCases(fx: Fixture, count: number, payload: Record<string, unknown> = {}) {
    const suite = await createSuite(fx);
    const cases = [];
    for (let i = 0; i < count; i += 1) cases.push(await createCase(fx, suite.id));
    const run = await createRun(fx, { suiteIds: [suite.id], ...payload });
    const ids = (await listRunCases(fx, run.number)).items.map((item) => item.id);
    return { run, ids, suite, cases };
  }

  const summarized = (rows: z.infer<typeof versionsDto>) =>
    rows.map((v) => ({
      version: v.version,
      run: v.run?.id ?? null,
      runCount: v.runCount,
      passRate: v.passRate,
      passRateDelta: v.passRateDelta,
      manual: v.manual?.number ?? null,
    }));

  // ---------------------------------------------------------------------------------------------------------
  describe("GET /versions", () => {
    it("Review Focus 4: run CI 0.4.0 + dua run manual v0.4.0 → satu baris dengan run manual bernomor terbesar", async () => {
      const fx = await setup();
      await seedRun(fx, { version: "0.3.0", at: 0, results: [result("a", "passed"), result("b", "failed")] });
      const v040 = await seedRun(fx, { version: "0.4.0", at: 1 });
      const { run: older } = await runWithCases(fx, 2, { appVersion: "v0.4.0", name: "Regresi lama" });
      const { run: newer, ids } = await runWithCases(fx, 2, { appVersion: "v0.4.0", name: "Regresi 0.4" });
      // Ruling R5: "terbaru" = nomor TR terbesar, walau `created_at`-nya lebih awal.
      await setRunCreatedAt(fx, older.number, 30);
      await setRunCreatedAt(fx, newer.number, 20);
      await patchRunCase(fx, newer.number, ids[0]!, { status: "passed" });

      const rows = await versions(fx);
      expect(summarized(rows)).toEqual([
        { version: "0.4.0", run: v040, runCount: 1, passRate: 100, passRateDelta: 50, manual: newer.number },
        { version: "0.3.0", run: expect.any(String), runCount: 1, passRate: 50, passRateDelta: null, manual: null },
      ]);
      expect(rows[0]?.manual).toEqual({
        number: newer.number,
        name: "Regresi 0.4",
        status: "open",
        total: 2,
        counts: { untested: 1, passed: 1, failed: 0, blocked: 0, skipped: 0 },
      });
    });

    it("manual-saja semver 0.3.5 disisipkan di posisi semver (run null, runCount 0); passRateDelta automated tetap", async () => {
      const fx = await setup();
      const v030 = await seedRun(fx, { version: "0.3.0", at: 0, results: [result("a", "passed"), result("b", "failed")] });
      const v040 = await seedRun(fx, { version: "0.4.0", at: 1 });
      const { run } = await runWithCases(fx, 1, { appVersion: "0.3.5" });

      expect(summarized(await versions(fx))).toEqual([
        { version: "0.4.0", run: v040, runCount: 1, passRate: 100, passRateDelta: 50, manual: null },
        { version: "0.3.5", run: null, runCount: 0, passRate: null, passRateDelta: null, manual: run.number },
        { version: "0.3.0", run: v030, runCount: 1, passRate: 50, passRateDelta: null, manual: null },
      ]);
    });

    it("Review Focus 4: manual-saja non-semver build-7 di bawah semua versi automated", async () => {
      const fx = await setup();
      await seedRun(fx, { version: "0.3.0", at: 0 });
      await seedRun(fx, { version: "0.4.0", at: 1 });
      const { run: build } = await runWithCases(fx, 1, { appVersion: "build-7" });
      const { run: semver } = await runWithCases(fx, 1, { appVersion: "0.3.5" });
      await setRunCreatedAt(fx, build.number, 10);
      await setRunCreatedAt(fx, semver.number, 5);

      // Ada manual-saja non-semver → semua manual-saja ke bawah, terbaru dulu (build-7 menit 10, 0.3.5 menit 5).
      expect(summarized(await versions(fx)).map((v) => [v.version, v.manual])).toEqual([
        ["0.4.0", null],
        ["0.3.0", null],
        ["build-7", build.number],
        ["0.3.5", semver.number],
      ]);
    });

    it("baris manual-saja muncul di setiap pilihan branch, juga branch tanpa run dan project tanpa run CI", async () => {
      const fx = await setup();
      const { run } = await runWithCases(fx, 1, { appVersion: "1.0.0" });
      // Tanpa run CI sama sekali.
      expect(summarized(await versions(fx))).toEqual([
        { version: "1.0.0", run: null, runCount: 0, passRate: null, passRateDelta: null, manual: run.number },
      ]);

      await seedRun(fx, { version: "1.0.0", at: 0 });
      const other = await seedRun(fx, { branch: "lain", version: "2.0.0", at: 1 });
      expect(summarized(await versions(fx, "?branch=main")).map((v) => [v.version, v.runCount, v.manual])).toEqual([
        ["1.0.0", 1, run.number],
      ]);
      expect(summarized(await versions(fx, "?branch=lain"))).toEqual([
        { version: "2.0.0", run: other, runCount: 1, passRate: 100, passRateDelta: null, manual: null },
        { version: "1.0.0", run: null, runCount: 0, passRate: null, passRateDelta: null, manual: run.number },
      ]);
      expect(summarized(await versions(fx, "?branch=tidak-ada")).map((v) => [v.version, v.run])).toEqual([["1.0.0", null]]);
    });

    it("run manual tanpa appVersion diabaikan", async () => {
      const fx = await setup();
      await runWithCases(fx, 1);
      expect(await versions(fx)).toEqual([]);
    });

    it("total dipotong 100 baris setelah penggabungan (tertinggi dulu)", async () => {
      const fx = await setup();
      await seedRun(fx, { version: "0.1.0", at: 0 });
      await seedManualRuns(
        fx,
        Array.from({ length: 100 }, (_, i) => `1.0.${i}`),
      );
      const rows = await versions(fx);
      expect(rows).toHaveLength(100);
      expect(rows[0]).toMatchObject({ version: "1.0.99", run: null, manual: { number: 100, total: 0 } });
      expect(rows[99]?.version).toBe("1.0.0");
      expect(rows.some((v) => v.version === "0.1.0")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("GET /manual/summary", () => {
    it("project tanpa case → latestRun null, coverage {0,0}", async () => {
      const fx = await setup();
      const res = await request("GET", fx, "/manual/summary", fx.viewer.cookie);
      expect(res.statusCode, res.body).toBe(200);
      expect(manualSummaryDto.parse(res.json())).toEqual({ latestRun: null, coverage: { active: 0, automated: 0 } });
    });

    it("dengan data → run bernomor terbesar + cakupan otomasi case aktif", async () => {
      const fx = await setup();
      await seedRun(fx, { at: 0 });
      const testId = await testCaseId(fx.project.id, "a");
      const suite = await createSuite(fx);
      await createCase(fx, suite.id, { automatedTestId: testId });
      await createCase(fx, suite.id);
      const archived = await createCase(fx, suite.id, { automatedTestId: testId });
      expect((await request("PATCH", fx, `/cases/${archived.number}`, fx.tester.cookie, { version: 1, archived: true })).statusCode).toBe(200);
      const first = await createRun(fx, { suiteIds: [suite.id], name: "Run pertama" });
      const second = await createRun(fx, { suiteIds: [suite.id], name: "Run kedua", appVersion: "0.4.0" });
      await setRunCreatedAt(fx, first.number, 50);
      await setRunCreatedAt(fx, second.number, 10);

      const res = await request("GET", fx, "/manual/summary", fx.viewer.cookie);
      expect(res.statusCode, res.body).toBe(200);
      const summary = manualSummaryDto.parse(res.json());
      expect(summary.coverage).toEqual({ active: 2, automated: 1 });
      expect(summary.latestRun).toMatchObject({
        number: second.number,
        name: "Run kedua",
        appVersion: "0.4.0",
        status: "open",
        total: 2,
        counts: { untested: 2, passed: 0, failed: 0, blocked: 0, skipped: 0 },
        progress: 0,
      });
    });

    it("akses: privat → anonim, non-anggota, dan token CI 404; publik → anonim 200", async () => {
      const fx = await setup();
      const outsider = await registerUser(app);
      const token = await request("POST", fx, "/tokens", fx.admin.cookie, { name: "CI baca" });
      const bearer = `Bearer ${createdTokenDto.parse(token.json()).token}`;
      expectError(await request("GET", fx, "/manual/summary"), 404, "PROJECT_NOT_FOUND");
      expectError(await request("GET", fx, "/manual/summary", outsider.cookie), 404, "PROJECT_NOT_FOUND");
      const withToken = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${fx.project.slug}/manual/summary`,
        headers: { authorization: bearer },
      });
      expectError(withToken, 404, "PROJECT_NOT_FOUND");

      const pub = await setup({ visibility: "public" });
      expect((await request("GET", pub, "/manual/summary")).statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("detail case: automatedTest.lastResult dan recentResults", () => {
    it("lastResult = hasil terakhir test di branch default project (branch run terbaru); tanpa hasil di sana → null", async () => {
      const fx = await setup();
      const mainOld = await seedRun(fx, { at: 0, results: [result("a", "failed")] });
      await seedRun(fx, { branch: "feature", at: 1, results: [result("a", "passed"), result("c", "passed")] });
      // Run terbaru project di main, tanpa test "a" dan "c".
      await seedRun(fx, { at: 2, results: [result("b", "passed")] });
      const suite = await createSuite(fx);
      const linked = await createCase(fx, suite.id, { automatedTestId: await testCaseId(fx.project.id, "a") });
      const noResult = await createCase(fx, suite.id, { automatedTestId: await testCaseId(fx.project.id, "c") });

      const res = await request("GET", fx, `/cases/${linked.number}`, fx.viewer.cookie);
      expect(res.statusCode, res.body).toBe(200);
      expect(manualCaseDto.parse(res.json()).automatedTest).toEqual({
        id: await testCaseId(fx.project.id, "a"),
        suite: "suite",
        name: "a",
        lastResult: { status: "failed", runId: mainOld, createdAt: minutes(0).toISOString(), branch: "main" },
      });

      const none = manualCaseDto.parse((await request("GET", fx, `/cases/${noResult.number}`, fx.viewer.cookie)).json());
      expect(none.automatedTest).toMatchObject({ name: "c", lastResult: null });
      // Respons tulis (PATCH) memakai DTO yang sama.
      const patched = await request("PATCH", fx, `/cases/${linked.number}`, fx.tester.cookie, { version: 1, title: "Judul baru" });
      expect(patched.statusCode, patched.body).toBe(200);
      expect(manualCaseDto.parse(patched.json()).automatedTest?.lastResult?.runId).toBe(mainOld);
    });

    it("recentResults: maks 10, run terbaru (nomor TR terbesar) dulu, dengan run case, versi, status, executedAt", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      const target = await createCase(fx, suite.id);
      const other = await createCase(fx, suite.id);
      const empty = manualCaseDto.parse((await request("GET", fx, `/cases/${target.number}`, fx.viewer.cookie)).json());
      expect(empty.recentResults).toEqual([]);

      for (let i = 1; i <= 11; i += 1) {
        await createRun(fx, { caseNumbers: [target.number, other.number], name: `Run ${i}`, appVersion: `0.${i}.0` });
      }
      // Run ke-11: case target gagal; run ke-1 tetap untested dan terpotong.
      const latest = (await listRunCases(fx, 11)).items.find((item) => item.caseNumber === target.number)!;
      const executed = await patchRunCase(fx, 11, latest.id, { status: "failed" });

      const res = await request("GET", fx, `/cases/${target.number}`, fx.viewer.cookie);
      expect(res.statusCode, res.body).toBe(200);
      const recent = manualCaseDto.parse(res.json()).recentResults;
      expect(recent).toHaveLength(10);
      expect(recent.map((r) => r.runNumber)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
      expect(recent[0]).toEqual({
        runCaseId: latest.id,
        runNumber: 11,
        runName: "Run 11",
        appVersion: "0.11.0",
        status: "failed",
        executedAt: executed.executedAt,
      });
      expect(recent[1]).toMatchObject({ runNumber: 10, status: "untested", executedAt: null });
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("bug dari run case", () => {
    it("POST /bugs { manualRunCaseId } → manualOrigin dari snapshot; detail & PATCH memuatnya", async () => {
      const fx = await setup();
      const { run, ids, cases } = await runWithCases(fx, 1, { name: "Regresi 0.4" });
      // Judul case diubah setelah run dibuat: asal bug memakai judul snapshot.
      await request("PATCH", fx, `/cases/${cases[0]!.number}`, fx.tester.cookie, { version: 1, title: "Judul baru" });

      const bug = await createBug(fx, { manualRunCaseId: ids[0] });
      const origin = {
        runNumber: run.number,
        runName: "Regresi 0.4",
        caseNumber: cases[0]!.number,
        caseTitle: cases[0]!.title,
        runCaseId: ids[0],
      };
      expect(bug).toMatchObject({ manualOrigin: origin, testCase: null, runId: null });
      expect((await getBug(fx, bug.number)).manualOrigin).toEqual(origin);

      const patched = await request("PATCH", fx, `/bugs/${bug.number}`, fx.tester.cookie, { version: bug.version, priority: "high" });
      expect(patched.statusCode, patched.body).toBe(200);
      expect(bugDto.parse(patched.json()).manualOrigin).toEqual(origin);

      // Bug biasa tetap tanpa asal manual.
      expect((await createBug(fx, {})).manualOrigin).toBeNull();
    });

    it("run case project lain atau tak dikenal → 400 fields.manualRunCaseId; bersama testCaseId → 400", async () => {
      const fx = await setup();
      const other = await setup();
      const { ids: foreign } = await runWithCases(other, 1);
      await seedRun(fx, { at: 0 });

      expectError(await createBugRaw(fx, { manualRunCaseId: foreign[0] }), 400, "VALIDATION_ERROR", "manualRunCaseId");
      expectError(await createBugRaw(fx, { manualRunCaseId: faker.string.uuid() }), 400, "VALIDATION_ERROR", "manualRunCaseId");
      const { ids } = await runWithCases(fx, 1);
      expectError(
        await createBugRaw(fx, { manualRunCaseId: ids[0], testCaseId: await testCaseId(fx.project.id, "a") }),
        400,
        "VALIDATION_ERROR",
        "manualRunCaseId",
      );
      // Penolakan tidak memakai nomor bug.
      expect((await createBug(fx, { manualRunCaseId: ids[0] })).number).toBe(1);
    });

    it("badge di daftar & detail run case: non-closed, maks 5, terbaru dulu", async () => {
      const fx = await setup();
      const { run, ids } = await runWithCases(fx, 2);
      const created: BugDto[] = [];
      for (let i = 0; i < 7; i += 1) created.push(await createBug(fx, { manualRunCaseId: ids[0], title: `Bug ke-${i + 1}` }));
      await closeBug(fx, created[6]!);

      const expected = [6, 5, 4, 3, 2].map((n) => ({ number: n, title: `Bug ke-${n}`, status: "open" }));
      const page = await listRunCases(fx, run.number);
      expect(page.items.map((item) => item.bugs)).toEqual([expected, []]);
      expect((await getRunCase(fx, run.number, ids[0]!)).bugs).toEqual(expected);
      expect((await getRunCase(fx, run.number, ids[1]!)).bugs).toEqual([]);
      // Respons PATCH run case memakai DTO yang sama.
      expect((await patchRunCase(fx, run.number, ids[0]!, { status: "failed" })).bugs).toEqual(expected);
    });

    it("jumlah query daftar run case sama untuk 1 vs 100 run case bertaut bug", async () => {
      async function seeded(count: number) {
        const fx = await setup();
        const suite = await createSuite(fx);
        const [project] = await app.db
          .update(projects)
          .set({ caseSeq: count })
          .where(eq(projects.id, fx.project.id))
          .returning({ id: projects.id });
        await app.db.insert(manualCases).values(
          Array.from({ length: count }, (_, i) => ({
            projectId: project!.id,
            number: i + 1,
            suiteId: suite.id,
            title: `Case massal ${i + 1}`,
            steps: [{ action: "Buka", expected: "" }],
            priority: "medium" as const,
            createdBy: fx.admin.user.id,
            updatedBy: fx.admin.user.id,
          })),
        );
        const run = await createRun(fx, { suiteIds: [suite.id] });
        const ids = (await listRunCases(fx, run.number)).items.map((item) => item.id);
        await app.db.insert(bugs).values(
          ids.map((manualRunCaseId, i) => ({
            projectId: fx.project.id,
            number: i + 1,
            title: `Bug ${i + 1}`,
            reporterId: fx.admin.user.id,
            manualRunCaseId,
          })),
        );
        await app.db.update(projects).set({ bugSeq: count }).where(eq(projects.id, fx.project.id));
        return { fx, run };
      }
      const count = async ({ fx, run }: Awaited<ReturnType<typeof seeded>>) => {
        queryCount = 0;
        const page = await listRunCases(fx, run.number, countingApp);
        return { queries: queryCount, page };
      };

      const small = await count(await seeded(1));
      const large = await count(await seeded(100));
      expect(small.page.items.every((item) => item.bugs.length === 1)).toBe(true);
      expect(large.page.items).toHaveLength(100);
      expect(large.page.items.every((item) => item.bugs.length === 1)).toBe(true);
      expect(large.queries).toBe(small.queries);
    });

    it("hapus run → bug tetap ada, manualOrigin null", async () => {
      const fx = await setup();
      const { run, ids } = await runWithCases(fx, 1);
      const bug = await createBug(fx, { manualRunCaseId: ids[0] });
      expect(bug.manualOrigin).not.toBeNull();

      expect((await request("DELETE", fx, `/manual-runs/${run.number}`, fx.admin.cookie)).statusCode).toBe(204);
      const after = await getBug(fx, bug.number);
      expect(after).toMatchObject({ number: bug.number, title: bug.title, manualOrigin: null });
    });
  });
});
