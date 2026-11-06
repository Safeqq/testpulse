import {
  bugDto,
  compareDto,
  compareGroupPageDto,
  createdTokenDto,
  flakyTestDto,
  runDetailDto,
  testHistoryDto,
  versionDto,
  type BugDto,
  type CompareDto,
  type ProjectDto,
  type ResultStatus,
} from "@testpulse/shared";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import type { Db } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";
import { bugs, runs, testCases } from "../../src/db/schema.js";
import type { ParsedResult } from "../../src/modules/results/domain/junit.js";
import { insertRun } from "../../src/modules/results/repository.js";
import { addMember, createProject, createTestApp, registerUser, type RegisteredUser } from "./helpers.js";

const BASE_TIME = Date.parse("2026-10-01T00:00:00.000Z");
const minutes = (n: number) => new Date(BASE_TIME + n * 60_000);
const UNKNOWN_ID = "11111111-1111-4111-8111-111111111111";

/** Satu hasil test untuk `insertRun`; suite default "suite", durasi default 100 ms. */
function result(
  name: string,
  status: ResultStatus,
  opts: Partial<Pick<ParsedResult, "suite" | "flakyInRun" | "durationMs" | "message">> = {},
): ParsedResult {
  return {
    suite: opts.suite ?? "suite",
    name,
    status,
    flakyInRun: opts.flakyInRun ?? false,
    retries: opts.flakyInRun ? 1 : 0,
    durationMs: opts.durationMs ?? 100,
    message: opts.message ?? (status === "failed" ? `${name} gagal` : null),
  };
}

const versionsDto = z.array(versionDto);

describe("API versi, perbandingan, badge bug, dan petunjuk test", () => {
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
    project: ProjectDto;
    tokenId: string;
  }

  async function setup(opts: { visibility?: "public" | "private" } = {}): Promise<Fixture> {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.cookie);
    if (opts.visibility === "public") {
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${project.slug}`,
        headers: { cookie: admin.cookie },
        payload: { visibility: "public" },
      });
      expect(patch.statusCode).toBe(200);
    }
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.slug}/tokens`,
      headers: { cookie: admin.cookie },
      payload: { name: "CI" },
    });
    expect(res.statusCode).toBe(201);
    return { admin, project, tokenId: createdTokenDto.parse(res.json()).id };
  }

  /** Menyimpan run lewat `insertRun` (jalur upload) lalu menetapkan `created_at` agar urutan waktu terkendali. */
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

  const get = (url: string, cookie?: string, headers: Record<string, string> = {}, target = app) =>
    target.inject({ method: "GET", url: `/api/v1${url}`, headers: cookie ? { cookie, ...headers } : headers });

  async function testCaseId(projectId: string, name: string, suite = "suite"): Promise<string> {
    const [match] = await app.db
      .select({ id: testCases.id })
      .from(testCases)
      .where(and(eq(testCases.projectId, projectId), eq(testCases.suite, suite), eq(testCases.name, name)));
    if (!match) throw new Error(`test case ${suite}/${name} tidak ada`);
    return match.id;
  }

  async function createBug(fx: Fixture, body: Record<string, unknown>): Promise<BugDto> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${fx.project.slug}/bugs`,
      headers: { cookie: fx.admin.cookie },
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(201);
    return bugDto.parse(res.json());
  }

  async function closeBug(fx: Fixture, bug: BugDto): Promise<void> {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${fx.project.slug}/bugs/${bug.number}`,
      headers: { cookie: fx.admin.cookie },
      payload: { version: bug.version, status: "closed", resolution: "fixed" },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function compare(fx: Fixture, query = ""): Promise<CompareDto> {
    const res = await get(`/projects/${fx.project.slug}/compare${query}`, fx.admin.cookie);
    expect(res.statusCode, res.body).toBe(200);
    return compareDto.parse(res.json());
  }

  const emptySummary = { regressions: 0, fixed: 0, stillFailing: 0, slower: 0, added: 0, removed: 0 };
  const emptyGroup = { items: [], nextCursor: null };
  const emptyGroups = {
    regressions: emptyGroup,
    fixed: emptyGroup,
    stillFailing: emptyGroup,
    slower: emptyGroup,
    added: emptyGroup,
    removed: emptyGroup,
  };

  describe("GET /compare — pembanding default", () => {
    it("1.0.0 (2 run) lalu 1.0.1 → target = run 1.0.1, base = run terakhir 1.0.0", async () => {
      const fx = await setup();
      await seedRun(fx, { version: "1.0.0", at: 0 });
      const latest100 = await seedRun(fx, { version: "1.0.0", at: 1 });
      const v101 = await seedRun(fx, { version: "1.0.1", at: 2 });
      await seedRun(fx, { branch: "lain", version: "9.0.0", at: 3 });

      const body = await compare(fx, "?branch=main");
      expect(body.target?.id).toBe(v101);
      expect(body.base?.id).toBe(latest100);
      expect(body.target?.version).toBe("1.0.1");

      // Tanpa `branch`: branch run terbaru project ("lain", satu run) → tanpa pembanding.
      const byLatest = await compare(fx);
      expect(byLatest.target?.branch).toBe("lain");
      expect(byLatest.base).toBeNull();
    });

    it("tanpa versi → run terakhir vs run sebelumnya; target eksplisit → run tepat sebelum target", async () => {
      const fx = await setup();
      const first = await seedRun(fx, { at: 0 });
      const second = await seedRun(fx, { at: 1 });
      const third = await seedRun(fx, { at: 2 });

      const body = await compare(fx);
      expect([body.base?.id, body.target?.id]).toEqual([second, third]);

      const explicit = await compare(fx, `?target=${second}`);
      expect([explicit.base?.id, explicit.target?.id]).toEqual([first, second]);
    });

    it("satu run → base null, semua kelompok kosong; tanpa run → base & target null", async () => {
      const fx = await setup();
      expect(await compare(fx)).toEqual({ base: null, target: null, summary: emptySummary, groups: emptyGroups });

      const only = await seedRun(fx, { at: 0, results: [result("a", "failed"), result("b", "passed")] });
      const body = await compare(fx);
      expect(body.target?.id).toBe(only);
      expect(body.base).toBeNull();
      expect(body.summary).toEqual(emptySummary);
      expect(body.groups).toEqual(emptyGroups);
    });

    it("Review Focus 2: v1.0.1 dan 1.0.1 satu versi — tidak dibandingkan satu sama lain", async () => {
      const fx = await setup();
      const v100 = await seedRun(fx, { version: "1.0.0", at: 0 });
      const prefixed = await seedRun(fx, { version: "v1.0.1", at: 1 });
      const plain = await seedRun(fx, { version: "1.0.1", at: 2 });

      const body = await compare(fx);
      expect([body.base?.id, body.target?.id]).toEqual([v100, plain]);
      const older = await compare(fx, `?target=${prefixed}`);
      expect([older.base?.id, older.target?.id]).toEqual([v100, prefixed]);

      const versions = versionsDto.parse((await get(`/projects/${fx.project.slug}/versions`, fx.admin.cookie)).json());
      expect(versions.map((v) => [v.version, v.run.id, v.runCount])).toEqual([
        ["1.0.1", plain, 2],
        ["1.0.0", v100, 1],
      ]);
    });
  });

  describe("GET /compare — kelompok & paginasi", () => {
    it("kelompok benar pada data berpola; skipped diabaikan; urut suite lalu nama", async () => {
      const fx = await setup();
      const base = await seedRun(fx, {
        at: 0,
        results: [
          result("z-regresi", "passed", { suite: "a-suite" }),
          result("a-regresi", "passed", { suite: "b-suite" }),
          result("fix", "failed", { message: "dulu gagal" }),
          result("still", "failed", { message: "gagal lama" }),
          result("slow", "passed", { durationMs: 1000 }),
          result("almost-slow", "passed", { durationMs: 2000 }),
          result("gone", "passed"),
          result("skip-now", "passed"),
          result("skip-before", "skipped"),
        ],
      });
      const target = await seedRun(fx, {
        at: 1,
        branch: "feature/x",
        results: [
          result("z-regresi", "failed", { suite: "a-suite", message: "AssertionError: z" }),
          result("a-regresi", "failed", { suite: "b-suite" }),
          result("fix", "passed", { flakyInRun: true }),
          result("still", "failed", { message: "gagal baru" }),
          result("slow", "passed", { durationMs: 2001 }),
          result("almost-slow", "passed", { durationMs: 3000 }),
          result("new", "passed"),
          result("skip-now", "skipped"),
          result("skip-before", "failed"),
        ],
      });

      // Base & target dari branch berbeda boleh (dipilih manual).
      const body = await compare(fx, `?base=${base}&target=${target}`);
      expect(body.base?.id).toBe(base);
      expect(body.target?.id).toBe(target);
      expect(body.summary).toEqual({ regressions: 2, fixed: 1, stillFailing: 1, slower: 1, added: 1, removed: 1 });

      const names = (group: keyof CompareDto["groups"]) => body.groups[group].items.map((i) => `${i.suite}/${i.name}`);
      expect(names("regressions")).toEqual(["a-suite/z-regresi", "b-suite/a-regresi"]);
      expect(names("fixed")).toEqual(["suite/fix"]);
      expect(names("stillFailing")).toEqual(["suite/still"]);
      expect(names("slower")).toEqual(["suite/slow"]);
      expect(names("added")).toEqual(["suite/new"]);
      expect(names("removed")).toEqual(["suite/gone"]);
      for (const group of Object.values(body.groups)) expect(group.nextCursor).toBeNull();

      expect(body.groups.regressions.items[0]).toEqual({
        testCaseId: await testCaseId(fx.project.id, "z-regresi", "a-suite"),
        suite: "a-suite",
        name: "z-regresi",
        base: { status: "passed", durationMs: 100, message: null, flakyInRun: false },
        target: { status: "failed", durationMs: 100, message: "AssertionError: z", flakyInRun: false },
        bugs: [],
      });
      expect(body.groups.fixed.items[0]?.target).toEqual({
        status: "passed",
        durationMs: 100,
        message: null,
        flakyInRun: true,
      });
      expect(body.groups.added.items[0]?.base).toBeNull();
      expect(body.groups.removed.items[0]?.target).toBeNull();
      expect(body.groups.removed.items[0]?.base?.status).toBe("passed");
      expect(body.groups.stillFailing.items[0]).toMatchObject({
        base: { status: "failed", message: "gagal lama" },
        target: { status: "failed", message: "gagal baru" },
      });
    });

    it("groups=none: ringkasan angka sama, semua kelompok kosong, tanpa query pesan dan badge bug", async () => {
      const fx = await setup();
      await seedRun(fx, { at: 0, results: [result("a", "passed"), result("b", "failed"), result("gone", "passed")] });
      await seedRun(fx, { at: 1, results: [result("a", "failed", { message: "boom" }), result("b", "passed"), result("new", "passed")] });
      await createBug(fx, { title: "Bug a", testCaseId: await testCaseId(fx.project.id, "a") });

      const full = await compare(fx);
      const none = await compare(fx, "?groups=none");
      expect(none.base).toEqual(full.base);
      expect(none.target).toEqual(full.target);
      expect(none.summary).toEqual(full.summary);
      expect(none.summary).toEqual({ regressions: 1, fixed: 1, stillFailing: 0, slower: 0, added: 1, removed: 1 });
      expect(none.groups).toEqual(emptyGroups);
      // Contoh yang sama dengan item penuh membuktikan bahwa data yang dilewati memang ada di respons lengkap.
      expect(full.groups.regressions.items[0]?.bugs).toHaveLength(1);

      // Lebih sedikit query: pesan hasil dan badge bug dilewati (tetap ada query sesi, akses, run, dan hasil).
      const queries = async (query: string) => {
        queryCount = 0;
        const res = await get(`/projects/${fx.project.slug}/compare${query}`, fx.admin.cookie, {}, countingApp);
        expect(res.statusCode, res.body).toBe(200);
        return queryCount;
      };
      const fullCount = await queries("");
      const noneCount = await queries("?groups=none");
      expect(noneCount).toBeLessThan(fullCount);
    });

    it("groups=none tanpa pembanding mengembalikan bentuk yang sama; nilai lain atau bersama group ditolak", async () => {
      const fx = await setup();
      await seedRun(fx, { at: 0 });
      const single = await compare(fx, "?groups=none");
      expect(single.base).toBeNull();
      expect(single.summary).toEqual(emptySummary);
      expect(single.groups).toEqual(emptyGroups);

      for (const query of ["?groups=all", "?groups=none&group=fixed"]) {
        const res = await get(`/projects/${fx.project.slug}/compare${query}`, fx.admin.cookie);
        expect(res.statusCode, query).toBe(400);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("Ruling F-b: ringkasan groups=none di-cache per (project, base, target); pasangan lain dan respons penuh dihitung segar", async () => {
      const fx = await setup();
      const first = await seedRun(fx, { at: 0, results: [result("a", "passed"), result("b", "failed")] });
      const second = await seedRun(fx, { at: 1, results: [result("a", "failed"), result("b", "passed")] });
      const pair = `?base=${first}&target=${second}`;
      const cached = await compare(fx, `${pair}&groups=none`);
      expect(cached.summary).toEqual({ ...emptySummary, regressions: 1, fixed: 1 });

      // Run tidak pernah berubah setelah upload; di sini hasilnya diubah langsung di DB hanya untuk membuktikan cache.
      await app.db.execute(sql`update test_results set status = 'passed', message = null where run_id = ${second}`);

      const hit = await compare(fx, `${pair}&groups=none`);
      expect(hit).toEqual(cached);
      // Default (tanpa base/target) memilih pasangan yang sama → kunci yang sama.
      expect((await compare(fx, "?groups=none")).summary).toEqual(cached.summary);
      // Respons penuh (item + badge bug) tidak pernah dari cache.
      expect((await compare(fx, pair)).summary).toEqual({ ...emptySummary, fixed: 1 });
      // Pasangan lain (dibalik) = kunci lain → dihitung dari data terkini.
      expect((await compare(fx, `?base=${second}&target=${first}&groups=none`)).summary).toEqual({
        ...emptySummary,
        regressions: 1,
      });

      // Otorisasi dan resolusi run tetap berjalan sebelum cache: anonim 404, run yang dihapus 404.
      const anonymous = await get(`/projects/${fx.project.slug}/compare${pair}&groups=none`);
      expect(anonymous.statusCode).toBe(404);
      expect(anonymous.json().error.code).toBe("PROJECT_NOT_FOUND");
      expect((await get(`/projects/${fx.project.slug}/runs/${first}`, fx.admin.cookie)).statusCode).toBe(200);
      const removed = await app.inject({
        method: "DELETE",
        url: `/api/v1/projects/${fx.project.slug}/runs/${first}`,
        headers: { cookie: fx.admin.cookie },
      });
      expect(removed.statusCode).toBe(204);
      const gone = await get(`/projects/${fx.project.slug}/compare${pair}&groups=none`, fx.admin.cookie);
      expect(gone.statusCode).toBe(404);
      expect(gone.json().error.code).toBe("RUN_NOT_FOUND");
    });

    it("added 250 test → 200 item + nextCursor; ?group=added&cursor= → 50 sisanya", async () => {
      const fx = await setup();
      const base = await seedRun(fx, { at: 0, results: [result("keep", "passed")] });
      const added = Array.from({ length: 250 }, (_, i) => result(`t${String(i).padStart(3, "0")}`, "passed"));
      const target = await seedRun(fx, { at: 1, results: [result("keep", "passed"), ...added] });

      const body = await compare(fx);
      expect(body.summary.added).toBe(250);
      expect(body.groups.added.items).toHaveLength(200);
      expect(body.groups.added.items[0]?.name).toBe("t000");
      expect(body.groups.added.items[199]?.name).toBe("t199");
      expect(body.groups.added.nextCursor).not.toBeNull();

      const cursor = encodeURIComponent(body.groups.added.nextCursor!);
      const res = await get(
        `/projects/${fx.project.slug}/compare?base=${base}&target=${target}&group=added&cursor=${cursor}`,
        fx.admin.cookie,
      );
      expect(res.statusCode, res.body).toBe(200);
      const next = compareGroupPageDto.parse(res.json());
      expect(next.items.map((i) => i.name)).toEqual(added.slice(200).map((r) => r.name));
      expect(next.nextCursor).toBeNull();

      // Tanpa cursor: halaman pertama kelompok itu (100 item).
      const first = compareGroupPageDto.parse(
        (await get(`/projects/${fx.project.slug}/compare?group=added`, fx.admin.cookie)).json(),
      );
      expect(first.items.map((i) => i.name)).toEqual(added.slice(0, 100).map((r) => r.name));
      expect(first.nextCursor).not.toBeNull();
      const second = compareGroupPageDto.parse(
        (
          await get(
            `/projects/${fx.project.slug}/compare?group=added&cursor=${encodeURIComponent(first.nextCursor!)}`,
            fx.admin.cookie,
          )
        ).json(),
      );
      expect(second.items.map((i) => i.name)).toEqual(added.slice(100, 200).map((r) => r.name));
      expect(second.nextCursor).not.toBeNull();
    });

    it("cursor terikat pada pasangan run: upload baru di antara halaman (pasangan default bergeser) → 400 fields.cursor", async () => {
      const fx = await setup();
      const added = Array.from({ length: 101 }, (_, i) => result(`t${String(i).padStart(3, "0")}`, "passed"));
      const base = await seedRun(fx, { at: 0, results: [result("keep", "passed")] });
      const target = await seedRun(fx, { at: 1, results: [result("keep", "passed"), ...added] });
      const url = `/projects/${fx.project.slug}/compare`;

      const first = compareGroupPageDto.parse((await get(`${url}?group=added`, fx.admin.cookie)).json());
      expect(first.items).toHaveLength(100);
      const cursor = encodeURIComponent(first.nextCursor!);

      await seedRun(fx, { at: 2, results: [result("keep", "passed"), ...added] });
      const stale = await get(`${url}?group=added&cursor=${cursor}`, fx.admin.cookie);
      expect(stale.statusCode).toBe(400);
      expect(stale.json().error.code).toBe("VALIDATION_ERROR");
      expect(stale.json().error.fields.cursor).toMatch(/tidak berlaku/);

      // Pasangan lain secara eksplisit (base/target tertukar) juga ditolak.
      const swapped = await get(`${url}?base=${target}&target=${base}&group=added&cursor=${cursor}`, fx.admin.cookie);
      expect(swapped.statusCode).toBe(400);
      expect(swapped.json().error.fields).toHaveProperty("cursor");

      // Pasangan asli (eksplisit) tetap melanjutkan halaman.
      const resumed = await get(`${url}?base=${base}&target=${target}&group=added&cursor=${cursor}`, fx.admin.cookie);
      expect(resumed.statusCode, resumed.body).toBe(200);
      expect(compareGroupPageDto.parse(resumed.json()).items.map((i) => i.name)).toEqual(["t100"]);
    });

    it("400: cursor tanpa group, cursor rusak, group tak dikenal", async () => {
      const fx = await setup();
      await seedRun(fx, { at: 0 });
      await seedRun(fx, { at: 1 });
      const cases: [string, string][] = [
        ["?cursor=abc", "group"],
        ["?group=added&cursor=rusak!", "cursor"],
        [`?group=added&cursor=${Buffer.from('["a","b","bukan-uuid"]').toString("base64url")}`, "cursor"],
        ["?group=apa", "group"],
      ];
      for (const [query, field] of cases) {
        const res = await get(`/projects/${fx.project.slug}/compare${query}`, fx.admin.cookie);
        expect({ query, status: res.statusCode, code: res.json().error?.code }).toEqual({
          query,
          status: 400,
          code: "VALIDATION_ERROR",
        });
        expect(res.json().error.fields).toHaveProperty(field);
      }
    });

    it("Review Focus 3: base == target → 400 VALIDATION_ERROR; run project lain / id rusak → 404 RUN_NOT_FOUND", async () => {
      const fx = await setup();
      const other = await setup();
      const run = await seedRun(fx, { at: 0 });
      const otherRun = await seedRun(other, { at: 0 });
      // Tester di kedua project: run project lain tetap 404.
      await addMember(app, other.project.id, fx.admin.user.id, "tester");

      const same = await get(`/projects/${fx.project.slug}/compare?base=${run}&target=${run}`, fx.admin.cookie);
      expect(same.statusCode).toBe(400);
      expect(same.json().error.code).toBe("VALIDATION_ERROR");
      expect(same.json().error.fields.base).toMatch(/sama/);

      // Base eksplisit = target default (run terakhir branch) juga ditolak.
      const sameAsDefault = await get(`/projects/${fx.project.slug}/compare?base=${run}`, fx.admin.cookie);
      expect(sameAsDefault.statusCode).toBe(400);

      for (const query of [
        `?base=${otherRun}&target=${run}`,
        `?target=${otherRun}`,
        `?target=${UNKNOWN_ID}`,
        "?target=bukan-uuid",
        `?base=bukan-uuid&target=${run}`,
      ]) {
        const res = await get(`/projects/${fx.project.slug}/compare${query}`, fx.admin.cookie);
        expect({ query, status: res.statusCode, code: res.json().error?.code }).toEqual({
          query,
          status: 404,
          code: "RUN_NOT_FOUND",
        });
      }
    });
  });

  describe("GET /versions", () => {
    it("semver: urut terbaru dulu, runCount, passRate, passRateDelta (null untuk versi terendah)", async () => {
      const fx = await setup();
      const half = [result("a", "passed"), result("b", "failed")];
      await seedRun(fx, { version: "1.0.0", at: 0, results: half });
      const v110 = await seedRun(fx, { version: "1.10.0", at: 1, results: [result("a", "passed")] });
      const v100 = await seedRun(fx, { version: "1.0.0", at: 2, results: [...half, result("c", "failed")] });
      const v120 = await seedRun(fx, {
        version: "1.2.0",
        at: 3,
        results: [result("a", "passed"), result("b", "passed"), result("c", "failed"), result("d", "skipped")],
      });
      await seedRun(fx, { at: 4 }); // tanpa versi: diabaikan
      await seedRun(fx, { branch: "lain", version: "2.0.0", at: 0 });

      const res = await get(`/projects/${fx.project.slug}/versions?branch=main`, fx.admin.cookie);
      expect(res.statusCode, res.body).toBe(200);
      const versions = versionsDto.parse(res.json());
      expect(versions.map((v) => ({ ...v, run: v.run.id }))).toEqual([
        { version: "1.10.0", run: v110, runCount: 1, passRate: 100, passRateDelta: 33.3 },
        { version: "1.2.0", run: v120, runCount: 1, passRate: 66.7, passRateDelta: 33.4 },
        { version: "1.0.0", run: v100, runCount: 2, passRate: 33.3, passRateDelta: null },
      ]);
      expect(versions[0]?.run).toMatchObject({ version: "1.10.0", branch: "main", total: 1 });

      // Tanpa `branch`: branch run terbaru project (main, run tanpa versi pada menit 4).
      const byDefault = versionsDto.parse((await get(`/projects/${fx.project.slug}/versions`, fx.admin.cookie)).json());
      expect(byDefault.map((v) => v.version)).toEqual(["1.10.0", "1.2.0", "1.0.0"]);
    });

    it("branch dengan versi non-semver diurutkan menurut waktu run terakhir; passRate null bila tanpa test dijalankan", async () => {
      const fx = await setup();
      await seedRun(fx, { version: "release-b", at: 0 });
      const alpha = await seedRun(fx, { version: "alpha", at: 1, results: [result("a", "skipped")] });
      const releaseB = await seedRun(fx, { version: "release-b", at: 2 });
      const semver = await seedRun(fx, { version: "1.0.0", at: 3, results: [result("a", "failed")] });

      const versions = versionsDto.parse((await get(`/projects/${fx.project.slug}/versions`, fx.admin.cookie)).json());
      expect(versions.map((v) => ({ ...v, run: v.run.id }))).toEqual([
        { version: "1.0.0", run: semver, runCount: 1, passRate: 0, passRateDelta: -100 },
        { version: "release-b", run: releaseB, runCount: 2, passRate: 100, passRateDelta: null },
        { version: "alpha", run: alpha, runCount: 1, passRate: null, passRateDelta: null },
      ]);
    });

    it("maks 100 versi tertinggi; delta versi ke-100 tetap dihitung terhadap versi di bawahnya", async () => {
      const fx = await setup();
      for (let i = 0; i < 101; i += 1) await seedRun(fx, { version: `1.0.${i}`, at: i });
      const versions = versionsDto.parse((await get(`/projects/${fx.project.slug}/versions`, fx.admin.cookie)).json());
      expect(versions).toHaveLength(100);
      expect(versions[0]?.version).toBe("1.0.100");
      expect(versions[99]?.version).toBe("1.0.1");
      expect(versions[99]?.passRateDelta).toBe(0);
    });

    it("project tanpa run → []", async () => {
      const fx = await setup();
      const res = await get(`/projects/${fx.project.slug}/versions`, fx.admin.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe("otorisasi", () => {
    it("project privat: anonim, non-anggota, dan Bearer token CI 404 di /versions & /compare; viewer 200", async () => {
      const fx = await setup();
      await seedRun(fx, { version: "1.0.0", at: 0 });
      const outsider = await registerUser(app);
      const viewer = await registerUser(app);
      await addMember(app, fx.project.id, viewer.user.id, "viewer");
      const tokenRes = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${fx.project.slug}/tokens`,
        headers: { cookie: fx.admin.cookie },
        payload: { name: "CI baca" },
      });
      const bearer = { authorization: `Bearer ${createdTokenDto.parse(tokenRes.json()).token}` };

      for (const url of [`/projects/${fx.project.slug}/versions`, `/projects/${fx.project.slug}/compare`]) {
        for (const res of [await get(url), await get(url, outsider.cookie), await get(url, undefined, bearer)]) {
          expect({ url, status: res.statusCode, code: res.json().error?.code }).toEqual({
            url,
            status: 404,
            code: "PROJECT_NOT_FOUND",
          });
        }
        expect({ url, status: (await get(url, viewer.cookie)).statusCode }).toEqual({ url, status: 200 });
      }
      // Validasi query terjadi setelah keputusan akses.
      const invalid = await get(`/projects/${fx.project.slug}/compare?cursor=x`);
      expect(invalid.statusCode).toBe(404);
    });

    it("project publik: anonim 200 di /versions & /compare", async () => {
      const fx = await setup({ visibility: "public" });
      await seedRun(fx, { version: "1.0.0", at: 0 });
      for (const url of [`/projects/${fx.project.slug}/versions`, `/projects/${fx.project.slug}/compare`]) {
        expect({ url, status: (await get(url)).statusCode }).toEqual({ url, status: 200 });
      }
    });
  });

  describe("badge bug", () => {
    it("bug non-closed tertaut test muncul di detail run, flaky, riwayat, dan perbandingan (maks 5, terbaru dulu)", async () => {
      const fx = await setup();
      const first = await seedRun(fx, {
        at: 0,
        results: [result("a", "failed"), result("b", "passed"), result("c", "failed")],
      });
      const second = await seedRun(fx, {
        at: 1,
        results: [result("a", "passed"), result("b", "failed"), result("c", "passed")],
      });
      const a = await testCaseId(fx.project.id, "a");
      const b = await testCaseId(fx.project.id, "b");
      const c = await testCaseId(fx.project.id, "c");

      const aBugs: BugDto[] = [];
      for (let i = 1; i <= 7; i += 1) aBugs.push(await createBug(fx, { title: `Bug a ${i}`, testCaseId: a }));
      await closeBug(fx, aBugs[6]!); // #7 terbaru, tetapi closed
      await closeBug(fx, await createBug(fx, { title: "Bug b closed", testCaseId: b })); // #8
      const cBug = await createBug(fx, { title: "Bug c", testCaseId: c, runId: first }); // #9
      await createBug(fx, { title: "Bug tanpa test" }); // #10

      const ref = (bug: BugDto) => ({ number: bug.number, title: bug.title, status: bug.status });
      const expected: Record<string, unknown[]> = {
        [a]: [6, 5, 4, 3, 2].map((n) => ref(aBugs[n - 1]!)),
        [b]: [],
        [c]: [ref(cBug)],
      };

      const detail = runDetailDto.parse(
        (await get(`/projects/${fx.project.slug}/runs/${second}?status=all`, fx.admin.cookie)).json(),
      );
      expect(Object.fromEntries(detail.results.map((r) => [r.testCaseId, r.bugs]))).toEqual(expected);

      const flaky = z
        .array(flakyTestDto)
        .parse((await get(`/projects/${fx.project.slug}/flaky`, fx.admin.cookie)).json());
      expect(flaky).toHaveLength(3);
      expect(Object.fromEntries(flaky.map((t) => [t.testCaseId, t.bugs]))).toEqual(expected);

      for (const id of [a, b, c]) {
        const history = testHistoryDto.parse(
          (await get(`/projects/${fx.project.slug}/tests/${id}/history`, fx.admin.cookie)).json(),
        );
        expect(history.testCase.bugs).toEqual(expected[id]);
      }

      const body = await compare(fx);
      const items = Object.values(body.groups).flatMap((g) => g.items);
      expect(items).toHaveLength(3);
      expect(Object.fromEntries(items.map((i) => [i.testCaseId, i.bugs]))).toEqual(expected);
    });

    it("Ruling T1-b: badge di daftar flaky (yang di-cache) langsung mengikuti bug baru & bug yang ditutup", async () => {
      const fx = await setup();
      await seedRun(fx, { at: 0, results: [result("a", "failed")] });
      await seedRun(fx, { at: 1, results: [result("a", "passed")] });
      const a = await testCaseId(fx.project.id, "a");
      const flaky = async () =>
        z.array(flakyTestDto).parse((await get(`/projects/${fx.project.slug}/flaky`, fx.admin.cookie)).json());

      expect((await flaky())[0]?.bugs).toEqual([]);
      const bug = await createBug(fx, { title: "Flaky a", testCaseId: a });
      expect((await flaky())[0]?.bugs).toEqual([{ number: bug.number, title: "Flaky a", status: "open" }]);
      await closeBug(fx, bug);
      expect((await flaky())[0]?.bugs).toEqual([]);
    });

    it("jumlah query sama untuk 1 vs 100 test bertaut bug (detail run & perbandingan)", async () => {
      async function seedWithBugs(size: number) {
        const fx = await setup();
        const names = Array.from({ length: size }, (_, i) => `t${String(i).padStart(3, "0")}`);
        await seedRun(fx, { at: 0, results: names.map((n) => result(n, "passed")) });
        const run = await seedRun(fx, { at: 1, results: names.map((n) => result(n, "failed")) });
        const cases = await app.db
          .select({ id: testCases.id })
          .from(testCases)
          .where(eq(testCases.projectId, fx.project.id));
        await app.db.insert(bugs).values(
          cases.map((tc, i) => ({
            projectId: fx.project.id,
            number: i + 1,
            title: `Bug ${i + 1}`,
            status: "open",
            priority: "medium",
            severity: "major",
            reporterId: fx.admin.user.id,
            testCaseId: tc.id,
          })),
        );
        return { fx, run };
      }

      async function countQueries(url: string, cookie: string) {
        queryCount = 0;
        const res = await get(url, cookie, {}, countingApp);
        expect(res.statusCode, res.body).toBe(200);
        return { count: queryCount, body: res.json() };
      }

      const small = await seedWithBugs(1);
      const large = await seedWithBugs(100);

      const detailUrl = (s: typeof small) => `/projects/${s.fx.project.slug}/runs/${s.run}`;
      const smallDetail = await countQueries(detailUrl(small), small.fx.admin.cookie);
      const largeDetail = await countQueries(detailUrl(large), large.fx.admin.cookie);
      const largeResults = runDetailDto.parse(largeDetail.body).results;
      expect(largeResults).toHaveLength(100);
      expect(largeResults.every((r) => r.bugs.length === 1)).toBe(true);
      // Sanity: logger menghitung query (sesi, akses project, transaksi, run, hasil, lencana).
      expect(smallDetail.count).toBeGreaterThan(5);
      expect(largeDetail.count).toBe(smallDetail.count);

      const compareUrl = (s: typeof small) => `/projects/${s.fx.project.slug}/compare`;
      const smallCompare = await countQueries(compareUrl(small), small.fx.admin.cookie);
      const largeCompare = await countQueries(compareUrl(large), large.fx.admin.cookie);
      const regressions = compareDto.parse(largeCompare.body).groups.regressions.items;
      expect(regressions).toHaveLength(100);
      expect(regressions.every((i) => i.bugs.length === 1)).toBe(true);
      expect(largeCompare.count).toBe(smallCompare.count);

      // Daftar flaky (dihitung pertama kali di app penghitung untuk kedua project): maks 50 test.
      const flakyUrl = (s: typeof small) => `/projects/${s.fx.project.slug}/flaky`;
      const smallFlaky = await countQueries(flakyUrl(small), small.fx.admin.cookie);
      const largeFlaky = await countQueries(flakyUrl(large), large.fx.admin.cookie);
      const flakyTests = z.array(flakyTestDto).parse(largeFlaky.body);
      expect(flakyTests).toHaveLength(50);
      expect(flakyTests.every((t) => t.bugs.length === 1)).toBe(true);
      expect(largeFlaky.count).toBe(smallFlaky.count);
    });

    it("isolasi antar project: bug project lain tidak pernah muncul sebagai lencana", async () => {
      const mine = await setup();
      const other = await setup();
      const pattern = (status: ResultStatus) => [result("a", status)];
      await seedRun(mine, { at: 0, results: pattern("failed") });
      const mineRun = await seedRun(mine, { at: 1, results: pattern("passed") });
      await seedRun(other, { at: 0, results: pattern("failed") });
      await seedRun(other, { at: 1, results: pattern("passed") });
      const mineA = await testCaseId(mine.project.id, "a");
      const otherA = await testCaseId(other.project.id, "a");

      // Bug sah di project lain pada test bernama sama, plus baris bug project lain yang (secara tidak sah)
      // menunjuk test project ini — keduanya tidak boleh tampil.
      await createBug(other, { title: "Bug project lain", testCaseId: otherA });
      await app.db.insert(bugs).values({
        projectId: other.project.id,
        number: 99,
        title: "Bug salah tautan",
        reporterId: other.admin.user.id,
        testCaseId: mineA,
      });

      const slug = mine.project.slug;
      const detail = runDetailDto.parse((await get(`/projects/${slug}/runs/${mineRun}?status=all`, mine.admin.cookie)).json());
      expect(detail.results.map((r) => r.bugs)).toEqual([[]]);
      const flaky = z.array(flakyTestDto).parse((await get(`/projects/${slug}/flaky`, mine.admin.cookie)).json());
      expect(flaky.map((t) => t.bugs)).toEqual([[]]);
      const history = testHistoryDto.parse((await get(`/projects/${slug}/tests/${mineA}/history`, mine.admin.cookie)).json());
      expect(history.testCase.bugs).toEqual([]);
      const body = await compare(mine);
      expect(Object.values(body.groups).flatMap((g) => g.items.map((i) => i.bugs))).toEqual([[]]);

      // Kontrol: project lain melihat bug sahnya.
      const otherFlaky = z
        .array(flakyTestDto)
        .parse((await get(`/projects/${other.project.slug}/flaky`, other.admin.cookie)).json());
      expect(otherFlaky[0]?.bugs.map((b) => b.title)).toEqual(["Bug project lain"]);
    });
  });

  describe("testHint pada detail bug", () => {
    async function getBug(fx: Fixture, number: number): Promise<BugDto> {
      const res = await get(`/projects/${fx.project.slug}/bugs/${number}`, fx.admin.cookie);
      expect(res.statusCode, res.body).toBe(200);
      return bugDto.parse(res.json());
    }

    it("20 hasil terakhir di branch run asal, consecutivePasses, lastStatus; run asal terhapus → branch hasil terbaru", async () => {
      const fx = await setup();
      const mainRuns: { id: string; status: ResultStatus }[] = [];
      for (let i = 0; i < 22; i += 1) {
        const status: ResultStatus = i >= 19 ? "passed" : i === 18 ? "failed" : i % 2 === 0 ? "passed" : "skipped";
        mainRuns.push({ id: await seedRun(fx, { at: i, results: [result("x", status)] }), status });
      }
      // Run lain yang lebih baru di branch lain dan run main tanpa test x.
      const feature = await seedRun(fx, { branch: "feature", at: 30, results: [result("x", "failed")] });
      await seedRun(fx, { at: 31, results: [result("y", "passed")] });
      const x = await testCaseId(fx.project.id, "x");

      const origin = mainRuns[5]!.id;
      const bug = await createBug(fx, { title: "x gagal", testCaseId: x, runId: origin });
      const expectedMain = mainRuns.slice(2).map((r, i) => ({
        runId: r.id,
        createdAt: minutes(i + 2).toISOString(),
        status: r.status,
      }));
      const hint = { branch: "main", results: expectedMain, consecutivePasses: 3, lastStatus: "passed" };
      expect(bug.testHint).toEqual(hint);
      expect((await getBug(fx, bug.number)).testHint).toEqual(hint);

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/projects/${fx.project.slug}/runs/${origin}`,
        headers: { cookie: fx.admin.cookie },
      });
      expect(del.statusCode).toBe(204);
      const after = await getBug(fx, bug.number);
      expect(after.runId).toBeNull();
      expect(after.testHint).toEqual({
        branch: "feature",
        results: [{ runId: feature, createdAt: minutes(30).toISOString(), status: "failed" }],
        consecutivePasses: 0,
        lastStatus: "failed",
      });
    });

    it("bug tanpa test → null; test tanpa hasil lagi → branch null, results kosong", async () => {
      const fx = await setup();
      const run = await seedRun(fx, { at: 0, results: [result("x", "failed")] });
      const x = await testCaseId(fx.project.id, "x");
      const plain = await createBug(fx, { title: "Tanpa test" });
      expect(plain.testHint).toBeNull();

      const linked = await createBug(fx, { title: "Dengan test", testCaseId: x });
      expect(linked.testHint).toEqual({
        branch: "main",
        results: [{ runId: run, createdAt: minutes(0).toISOString(), status: "failed" }],
        consecutivePasses: 0,
        lastStatus: "failed",
      });

      await app.db.delete(runs).where(eq(runs.id, run));
      expect((await getBug(fx, linked.number)).testHint).toEqual({
        branch: null,
        results: [],
        consecutivePasses: 0,
        lastStatus: null,
      });
    });
  });
});
