import {
  branchDto,
  createdTokenDto,
  flakyTestDto,
  ingestResultDto,
  runDetailDto,
  runsPageDto,
  statsDto,
  testHistoryDto,
  type ProjectDto,
  type ResultStatus,
} from "@testpulse/shared";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { runs, testCases, testResults } from "../../src/db/schema.js";
import { flakyScore, FLAKY_WINDOW } from "../../src/modules/results/domain/flaky.js";
import type { ParsedResult } from "../../src/modules/results/domain/junit.js";
import { insertRun } from "../../src/modules/results/repository.js";
import { addMember, createProject, createTestApp, registerUser, type RegisteredUser } from "./helpers.js";

const UNKNOWN_ID = "11111111-1111-4111-8111-111111111111";
const BASE_TIME = Date.parse("2026-10-01T00:00:00.000Z");
const minutes = (n: number) => new Date(BASE_TIME + n * 60_000);

/** Satu hasil test untuk `insertRun`; suite default "suite". */
function result(
  name: string,
  status: ResultStatus,
  opts: Partial<Pick<ParsedResult, "suite" | "flakyInRun" | "retries" | "message">> = {},
): ParsedResult {
  return {
    suite: opts.suite ?? "suite",
    name,
    status,
    flakyInRun: opts.flakyInRun ?? false,
    retries: opts.retries ?? (opts.flakyInRun ? 1 : 0),
    durationMs: 10,
    message: opts.message ?? (status === "failed" ? `${name} gagal` : null),
  };
}

/** PRNG deterministik (mulberry32): pola "acak-terkendali" yang sama di setiap run test. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("API baca hasil test & hapus run", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
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
    opts: { branch?: string; createdAt: Date; results?: ParsedResult[] },
  ): Promise<string> {
    const { runId } = await insertRun(app.db, {
      projectId: fx.project.id,
      tokenId: fx.tokenId,
      query: { branch: opts.branch ?? "main" },
      report: { durationMs: 1000, results: opts.results ?? [result("a", "passed")] },
    });
    await app.db.update(runs).set({ createdAt: opts.createdAt }).where(eq(runs.id, runId));
    return runId;
  }

  const get = (url: string, cookie?: string, headers: Record<string, string> = {}) =>
    app.inject({ method: "GET", url: `/api/v1${url}`, headers: cookie ? { cookie, ...headers } : headers });
  const del = (url: string, cookie?: string) =>
    app.inject({ method: "DELETE", url: `/api/v1${url}`, headers: cookie ? { cookie } : {} });

  async function testCaseId(projectId: string, name: string, suite = "suite"): Promise<string> {
    const [match] = await app.db
      .select({ id: testCases.id })
      .from(testCases)
      .where(and(eq(testCases.projectId, projectId), eq(testCases.suite, suite), eq(testCases.name, name)));
    if (!match) throw new Error(`test case ${suite}/${name} tidak ada`);
    return match.id;
  }

  describe("GET /projects/:slug/runs", () => {
    it("25 run: halaman 1 berisi 20 terbaru + nextCursor, halaman 2 berisi 5 + nextCursor null; filter branch", async () => {
      const fx = await setup();
      const created: { id: string; branch: string; at: number }[] = [];
      for (let i = 0; i < 25; i += 1) {
        const branch = i % 8 === 3 ? "feature/login-v2" : "main";
        created.push({ id: await seedRun(fx, { branch, createdAt: minutes(i) }), branch, at: i });
      }
      const newestFirst = [...created].reverse();

      const page1 = runsPageDto.parse((await get(`/projects/${fx.project.slug}/runs`, fx.admin.cookie)).json());
      expect(page1.runs.map((r) => r.id)).toEqual(newestFirst.slice(0, 20).map((r) => r.id));
      expect(page1.nextCursor).not.toBeNull();
      expect(page1.runs[0]).toMatchObject({
        branch: newestFirst[0]!.branch,
        commitSha: null,
        ciUrl: null,
        name: null,
        createdAt: minutes(24).toISOString(),
        durationMs: 1000,
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        flaky: 0,
      });

      const res2 = await get(
        `/projects/${fx.project.slug}/runs?cursor=${encodeURIComponent(page1.nextCursor!)}`,
        fx.admin.cookie,
      );
      expect(res2.statusCode).toBe(200);
      const page2 = runsPageDto.parse(res2.json());
      expect(page2.runs.map((r) => r.id)).toEqual(newestFirst.slice(20).map((r) => r.id));
      expect(page2.nextCursor).toBeNull();

      // Review Focus 4: branch bergaris miring sebagai query param ter-encode.
      const feature = runsPageDto.parse(
        (await get(`/projects/${fx.project.slug}/runs?branch=feature%2Flogin-v2`, fx.admin.cookie)).json(),
      );
      expect(feature.runs.map((r) => r.id)).toEqual(
        newestFirst.filter((r) => r.branch === "feature/login-v2").map((r) => r.id),
      );
      expect(feature.runs).toHaveLength(3);
      expect(feature.nextCursor).toBeNull();

      const main1 = runsPageDto.parse((await get(`/projects/${fx.project.slug}/runs?branch=main`, fx.admin.cookie)).json());
      const mainIds = newestFirst.filter((r) => r.branch === "main").map((r) => r.id);
      expect(main1.runs.map((r) => r.id)).toEqual(mainIds.slice(0, 20));
      const main2 = runsPageDto.parse(
        (
          await get(
            `/projects/${fx.project.slug}/runs?branch=main&cursor=${encodeURIComponent(main1.nextCursor!)}`,
            fx.admin.cookie,
          )
        ).json(),
      );
      expect(main2.runs.map((r) => r.id)).toEqual(mainIds.slice(20));
      expect(main2.nextCursor).toBeNull();
    });

    it("tepat 20 run → nextCursor null; project tanpa run → daftar kosong", async () => {
      const fx = await setup();
      const empty = runsPageDto.parse((await get(`/projects/${fx.project.slug}/runs`, fx.admin.cookie)).json());
      expect(empty).toEqual({ runs: [], nextCursor: null });

      for (let i = 0; i < 20; i += 1) await seedRun(fx, { createdAt: minutes(i) });
      const page = runsPageDto.parse((await get(`/projects/${fx.project.slug}/runs`, fx.admin.cookie)).json());
      expect(page.runs).toHaveLength(20);
      expect(page.nextCursor).toBeNull();
    });

    it("created_at kembar dan selisih mikrodetik dalam milidetik yang sama: tidak ada run terlewat atau ganda", async () => {
      const fx = await setup();
      for (let i = 0; i < 22; i += 1) await seedRun(fx, { createdAt: minutes(0) });
      // Pasangan run berbagi created_at; antar-pasangan selisih 1 µs (tidak terwakili oleh Date JavaScript).
      await app.db.execute(sql`
        update runs set created_at = '2026-10-01T00:00:00.123400Z'::timestamptz + (numbered.k / 2) * interval '1 microsecond'
        from (select id, row_number() over (order by id) - 1 as k from runs where project_id = ${fx.project.id}) numbered
        where runs.id = numbered.id`);
      const expected = (
        await app.db
          .select({ id: runs.id })
          .from(runs)
          .where(eq(runs.projectId, fx.project.id))
          .orderBy(desc(runs.createdAt), desc(runs.id))
      ).map((r) => r.id);

      const page1 = runsPageDto.parse((await get(`/projects/${fx.project.slug}/runs`, fx.admin.cookie)).json());
      const page2 = runsPageDto.parse(
        (
          await get(`/projects/${fx.project.slug}/runs?cursor=${encodeURIComponent(page1.nextCursor!)}`, fx.admin.cookie)
        ).json(),
      );
      expect([...page1.runs, ...page2.runs].map((r) => r.id)).toEqual(expected);
      expect(page2.nextCursor).toBeNull();
    });

    it.each([
      ["cursor rusak", "cursor=bukan-cursor!"],
      ["cursor base64 sampah", "cursor=Zm9vYmFy"],
      ["cursor tahun di luar 0001–9999", `cursor=${Buffer.from(`+010000-01-01T00:00:00.000Z|${UNKNOWN_ID}`).toString("base64url")}`],
      ["cursor tahun 0000", `cursor=${Buffer.from(`0000-01-01T00:00:00.000Z|${UNKNOWN_ID}`).toString("base64url")}`],
      ["branch berspasi", "branch=a%20b"],
      ["branch kosong", "branch="],
      ["branch 201 karakter", `branch=${"a".repeat(201)}`],
      ["branch ganda", "branch=a&branch=b"],
    ])("400 VALIDATION_ERROR: %s", async (_label, query) => {
      const fx = await setup();
      const res = await get(`/projects/${fx.project.slug}/runs?${query}`, fx.admin.cookie);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /projects/:slug/runs/:runId", () => {
    const mixedResults = () => [
      result("f1", "failed", { message: "expected 200" }),
      result("f2", "failed"),
      result("flaky", "passed", { flakyInRun: true, retries: 2 }),
      result("p1", "passed"),
      result("p2", "passed"),
      result("p3", "passed"),
      result("s1", "skipped"),
    ];

    it("default hanya failed; status=flaky hanya flaky_in_run; status=all semua", async () => {
      const fx = await setup();
      const runId = await seedRun(fx, { createdAt: minutes(0), results: mixedResults() });
      const base = `/projects/${fx.project.slug}/runs/${runId}`;

      const failed = runDetailDto.parse((await get(base, fx.admin.cookie)).json());
      expect(failed.run).toMatchObject({ id: runId, total: 7, passed: 4, failed: 2, skipped: 1, flaky: 1 });
      expect(failed.results.map((r) => r.name)).toEqual(["f1", "f2"]);
      expect(failed.results[0]).toEqual({
        testCaseId: await testCaseId(fx.project.id, "f1"),
        suite: "suite",
        name: "f1",
        status: "failed",
        flakyInRun: false,
        retries: 0,
        durationMs: 10,
        message: "expected 200",
      });
      expect(failed.nextCursor).toBeNull();

      const explicitFailed = runDetailDto.parse((await get(`${base}?status=failed`, fx.admin.cookie)).json());
      expect(explicitFailed.results.map((r) => r.name)).toEqual(["f1", "f2"]);

      const flaky = runDetailDto.parse((await get(`${base}?status=flaky`, fx.admin.cookie)).json());
      expect(flaky.results).toEqual([
        expect.objectContaining({ name: "flaky", status: "passed", flakyInRun: true, retries: 2 }),
      ]);

      const all = runDetailDto.parse((await get(`${base}?status=all`, fx.admin.cookie)).json());
      expect(all.results.map((r) => r.name)).toEqual(["f1", "f2", "flaky", "p1", "p2", "p3", "s1"]);
    });

    it("status=all dipaginasi 100 per halaman", async () => {
      const fx = await setup();
      const names = Array.from({ length: 150 }, (_, i) => `t${String(i).padStart(3, "0")}`);
      const runId = await seedRun(fx, { createdAt: minutes(0), results: names.map((n) => result(n, "passed")) });
      const base = `/projects/${fx.project.slug}/runs/${runId}?status=all`;

      const page1 = runDetailDto.parse((await get(base, fx.admin.cookie)).json());
      expect(page1.results.map((r) => r.name)).toEqual(names.slice(0, 100));
      expect(page1.nextCursor).not.toBeNull();

      const page2 = runDetailDto.parse(
        (await get(`${base}&cursor=${encodeURIComponent(page1.nextCursor!)}`, fx.admin.cookie)).json(),
      );
      expect(page2.results.map((r) => r.name)).toEqual(names.slice(100));
      expect(page2.nextCursor).toBeNull();
    });

    it("404 RUN_NOT_FOUND: run project lain, id tak dikenal, id bukan uuid", async () => {
      const fx = await setup();
      const other = await setup();
      const foreignRun = await seedRun(other, { createdAt: minutes(0) });

      for (const runId of [foreignRun, UNKNOWN_ID, "bukan-uuid"]) {
        const res = await get(`/projects/${fx.project.slug}/runs/${runId}`, fx.admin.cookie);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("RUN_NOT_FOUND");
      }
    });

    it.each([
      ["status tidak dikenal", "status=passed"],
      ["cursor rusak", "cursor=%%%"],
      [
        "cursor run dipakai untuk hasil",
        `cursor=${Buffer.from(`2026-10-01T00:00:00.000Z|${UNKNOWN_ID}`).toString("base64url")}`,
      ],
    ])("400 VALIDATION_ERROR: %s", async (_label, query) => {
      const fx = await setup();
      const runId = await seedRun(fx, { createdAt: minutes(0) });
      const res = await get(`/projects/${fx.project.slug}/runs/${runId}?${query}`, fx.admin.cookie);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("DELETE /projects/:slug/runs/:runId", () => {
    const countResults = async (runId: string) => {
      const [row] = await app.db.select({ n: count() }).from(testResults).where(eq(testResults.runId, runId));
      return row?.n ?? 0;
    };

    it("tester 204 dan hasilnya ikut terhapus; admin 204", async () => {
      const fx = await setup();
      const tester = await registerUser(app);
      await addMember(app, fx.project.id, tester.user.id, "tester");
      const runId = await seedRun(fx, { createdAt: minutes(0), results: [result("a", "failed"), result("b", "passed")] });
      expect(await countResults(runId)).toBe(2);

      const res = await del(`/projects/${fx.project.slug}/runs/${runId}`, tester.cookie);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");
      expect(await app.db.select().from(runs).where(eq(runs.id, runId))).toEqual([]);
      expect(await countResults(runId)).toBe(0);
      expect((await get(`/projects/${fx.project.slug}/runs/${runId}`, fx.admin.cookie)).statusCode).toBe(404);

      const second = await seedRun(fx, { createdAt: minutes(1) });
      expect((await del(`/projects/${fx.project.slug}/runs/${second}`, fx.admin.cookie)).statusCode).toBe(204);
    });

    it("viewer 403, anonim 401, non-anggota publik 403, non-anggota privat 404; run tetap ada", async () => {
      const fx = await setup();
      const viewer = await registerUser(app);
      await addMember(app, fx.project.id, viewer.user.id, "viewer");
      const outsider = await registerUser(app);
      const runId = await seedRun(fx, { createdAt: minutes(0) });
      const url = `/projects/${fx.project.slug}/runs/${runId}`;

      const asViewer = await del(url, viewer.cookie);
      expect(asViewer.statusCode).toBe(403);
      expect(asViewer.json().error.code).toBe("FORBIDDEN");
      const anon = await del(url);
      expect(anon.statusCode).toBe(401);
      expect(anon.json().error.code).toBe("UNAUTHENTICATED");
      const privateOutsider = await del(url, outsider.cookie);
      expect(privateOutsider.statusCode).toBe(404);
      expect(privateOutsider.json().error.code).toBe("PROJECT_NOT_FOUND");

      const pub = await setup({ visibility: "public" });
      const pubRun = await seedRun(pub, { createdAt: minutes(0) });
      const publicOutsider = await del(`/projects/${pub.project.slug}/runs/${pubRun}`, outsider.cookie);
      expect(publicOutsider.statusCode).toBe(403);

      expect(await app.db.select({ id: runs.id }).from(runs).where(eq(runs.id, runId))).toHaveLength(1);
      expect(await app.db.select({ id: runs.id }).from(runs).where(eq(runs.id, pubRun))).toHaveLength(1);
    });

    it("404 RUN_NOT_FOUND untuk run project lain (tester di kedua project), id tak dikenal, id bukan uuid", async () => {
      const fx = await setup();
      const other = await setup();
      const foreignRun = await seedRun(other, { createdAt: minutes(0) });

      for (const runId of [foreignRun, UNKNOWN_ID, "bukan-uuid"]) {
        const res = await del(`/projects/${fx.project.slug}/runs/${runId}`, fx.admin.cookie);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("RUN_NOT_FOUND");
      }
      expect(await app.db.select({ id: runs.id }).from(runs).where(eq(runs.id, foreignRun))).toHaveLength(1);
    });
  });

  describe("GET /projects/:slug/stats", () => {
    /** [passed, failed, skipped] → passRate yang diharapkan (pembulatan 1 desimal, setengah ke atas). */
    const patterns: Array<{ p: number; f: number; s: number; rate: number | null }> = [
      { p: 2, f: 1, s: 0, rate: 66.7 },
      { p: 1, f: 2, s: 1, rate: 33.3 },
      { p: 1, f: 7, s: 0, rate: 12.5 },
      { p: 1, f: 15, s: 0, rate: 6.3 },
      { p: 0, f: 0, s: 2, rate: null },
      { p: 3, f: 0, s: 0, rate: 100 },
      { p: 0, f: 3, s: 0, rate: 0 },
    ];
    const resultsFor = ({ p, f, s }: { p: number; f: number; s: number }) => [
      ...Array.from({ length: p }, (_, i) => result(`p${i}`, "passed")),
      ...Array.from({ length: f }, (_, i) => result(`f${i}`, "failed")),
      ...Array.from({ length: s }, (_, i) => result(`s${i}`, "skipped")),
    ];

    it("30 titik terbaru urut waktu dengan passRate; tanpa branch memakai branch run terbaru", async () => {
      const fx = await setup();
      const mainRuns: { id: string; at: number; rate: number | null }[] = [];
      for (let i = 0; i < 32; i += 1) {
        const pattern = patterns[i % patterns.length]!;
        const id = await seedRun(fx, { branch: "main", createdAt: minutes(i), results: resultsFor(pattern) });
        mainRuns.push({ id, at: i, rate: pattern.rate });
      }
      const devRun = await seedRun(fx, { branch: "dev", createdAt: minutes(100), results: resultsFor(patterns[0]!) });

      const main = statsDto.parse((await get(`/projects/${fx.project.slug}/stats?branch=main`, fx.admin.cookie)).json());
      expect(main.branch).toBe("main");
      expect(main.points).toEqual(
        mainRuns.slice(2).map((r) => ({
          runId: r.id,
          createdAt: minutes(r.at).toISOString(),
          passRate: r.rate,
          durationMs: 1000,
        })),
      );
      expect(main.latest?.id).toBe(mainRuns[31]!.id);
      // Semua pola (termasuk 6,25 → 6,3 dan null tanpa passed/failed) muncul di 30 titik.
      expect(new Set(main.points.map((p) => p.passRate))).toEqual(new Set(patterns.map((p) => p.rate)));

      const defaultBranch = statsDto.parse((await get(`/projects/${fx.project.slug}/stats`, fx.admin.cookie)).json());
      expect(defaultBranch.branch).toBe("dev");
      expect(defaultBranch.points).toEqual([
        { runId: devRun, createdAt: minutes(100).toISOString(), passRate: 66.7, durationMs: 1000 },
      ]);
      expect(defaultBranch.latest?.id).toBe(devRun);
    });

    it("project tanpa run → branch null; branch tanpa run → titik kosong", async () => {
      const fx = await setup();
      const empty = statsDto.parse((await get(`/projects/${fx.project.slug}/stats`, fx.admin.cookie)).json());
      expect(empty).toEqual({ branch: null, points: [], latest: null });

      await seedRun(fx, { createdAt: minutes(0) });
      const unknown = statsDto.parse((await get(`/projects/${fx.project.slug}/stats?branch=nope`, fx.admin.cookie)).json());
      expect(unknown).toEqual({ branch: "nope", points: [], latest: null });
    });
  });

  describe("GET /projects/:slug/flaky", () => {
    type Step = { status: ResultStatus; flakyInRun?: boolean } | null;
    const L: Step = { status: "passed" };
    const G: Step = { status: "failed" };
    const S: Step = { status: "skipped" };
    const R: Step = { status: "passed", flakyInRun: true };

    /** Menyimpan satu run per kolom; `tests[name][i]` = hasil test di run ke-i (`null` = test tidak ada di run itu). */
    async function seedMatrix(fx: Fixture, tests: Record<string, Step[]>, opts: { branch?: string; start?: number } = {}) {
      const length = Math.max(...Object.values(tests).map((steps) => steps.length));
      for (let i = 0; i < length; i += 1) {
        const results = Object.entries(tests).flatMap(([name, steps]) => {
          const step = steps[i];
          return step ? [result(name, step.status, { flakyInRun: step.flakyInRun ?? false })] : [];
        });
        // Run tanpa test sama sekali tetap disimpan dengan test pengisi agar laporan tidak kosong.
        if (results.length === 0) results.push(result("__filler", "passed"));
        await seedRun(fx, { branch: opts.branch ?? "main", createdAt: minutes((opts.start ?? 0) + i), results });
      }
    }

    const fetchFlaky = async (fx: Fixture, query = "") => {
      const res = await get(`/projects/${fx.project.slug}/flaky${query}`, fx.admin.cookie);
      expect(res.statusCode).toBe(200);
      return z.array(flakyTestDto).parse(res.json());
    };

    it("contoh spec §6, urut skor turun lalu nama, maks 50, gagal konsisten tidak muncul", async () => {
      const fx = await setup();
      const shapes: Step[][] = [
        [L, G, L, G], // 75
        [L, G, L, L], // 50
        [L, L, L, G], // 25
        [G, L, L, L], // 25
        [L, L, L, R], // 25
        [L, R, G, G], // 50
      ];
      const tests: Record<string, Step[]> = {
        "always-pass": [L, L, L, L],
        "always-fail": [G, G, G, G],
        "skip-only": [S, S, S, S],
        // 3 flip + 2 flaky_in_run dari 4 hasil = 125 → dibatasi least(100, …).
        capped: [G, R, G, R],
      };
      for (let i = 0; i < 55; i += 1) tests[`t${String(54 - i).padStart(2, "0")}`] = shapes[i % shapes.length]!;
      await seedMatrix(fx, tests);

      const expected = Object.entries(tests)
        .map(([name, steps]) => ({
          name,
          score: flakyScore(steps.filter((s) => s !== null).map((s) => ({ status: s.status, flakyInRun: s.flakyInRun ?? false }))),
          lastStatus: steps[steps.length - 1]!.status,
        }))
        .filter((t) => t.score > 0)
        .sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(0, 50);

      const list = await fetchFlaky(fx, "?branch=main");
      expect(list).toHaveLength(50);
      expect(list.map(({ name, score, lastStatus }) => ({ name, score, lastStatus }))).toEqual(expected);
      expect(list.map((t) => t.name)).not.toContain("always-fail");
      expect(list.map((t) => t.name)).not.toContain("always-pass");
      expect(list.map((t) => t.name)).not.toContain("skip-only");
      expect(list[0]).toEqual({
        testCaseId: await testCaseId(fx.project.id, "capped"),
        suite: "suite",
        name: "capped",
        score: 100,
        lastStatus: "passed",
      });
      expect(list[1]).toMatchObject({ score: 75, lastStatus: "failed" });
    });

    it("paritas: 6 pola acak-terkendali, skor SQL = flakyScore atas 20 run terakhir yang memuat test", async () => {
      const fx = await setup();
      const random = mulberry32(20261028);
      const params = [
        { skip: 0.0, fail: 0.5, flaky: 0.0, absent: 0.0 },
        { skip: 0.3, fail: 0.2, flaky: 0.1, absent: 0.0 },
        { skip: 0.1, fail: 0.1, flaky: 0.3, absent: 0.3 },
        { skip: 0.5, fail: 0.4, flaky: 0.0, absent: 0.2 },
        { skip: 0.0, fail: 0.05, flaky: 0.05, absent: 0.5 },
        { skip: 0.2, fail: 0.7, flaky: 0.2, absent: 0.1 },
      ];
      const RUNS = 30;
      const tests: Record<string, Step[]> = {};
      params.forEach((p, k) => {
        tests[`pola-${k}`] = Array.from({ length: RUNS }, (): Step => {
          if (random() < p.absent) return null;
          if (random() < p.skip) return S;
          if (random() < p.fail) return G;
          return random() < p.flaky ? R : L;
        });
      });
      // Pola paritas pembulatan: 8 hasil dijalankan + 12 skip di jendela, 1 flip → 12,5 → 13 (round(numeric)).
      tests["setengah"] = [...Array.from({ length: 10 }, () => G), ...Array.from({ length: 12 }, () => S), L, L, L, L, L, L, L, G];
      // Pola pembatas: 3 flip + 2 flaky_in_run dari 4 hasil = 125 → least(100, …) = 100.
      tests["dibatasi"] = [G, R, G, R];
      await seedMatrix(fx, tests);
      // Run di branch lain tidak memengaruhi skor branch main.
      await seedMatrix(fx, { "pola-0": [G, L, G, L], setengah: [G, L, G, L] }, { branch: "dev", start: -100 });

      const list = await fetchFlaky(fx, "?branch=main");
      const scores = new Map(list.map((t) => [t.name, t.score]));
      let nonZero = 0;
      for (const [name, steps] of Object.entries(tests)) {
        const window = steps.filter((s) => s !== null).slice(-FLAKY_WINDOW);
        const expected = flakyScore(window.map((s) => ({ status: s.status, flakyInRun: s.flakyInRun ?? false })));
        if (expected > 0) nonZero += 1;
        expect({ name, score: scores.get(name) ?? 0 }).toEqual({ name, score: expected });
      }
      expect(scores.get("setengah")).toBe(13);
      expect(scores.get("dibatasi")).toBe(100);
      expect(nonZero).toBeGreaterThanOrEqual(5);

      // Tanpa branch: branch run terbaru (main), hasil sama.
      expect(await fetchFlaky(fx)).toEqual(list);
    });

    it("tanpa branch memakai branch run terbaru; project tanpa run → daftar kosong", async () => {
      const fx = await setup();
      expect(await fetchFlaky(fx)).toEqual([]);

      await seedMatrix(fx, { a: [L, G, L, G] }, { branch: "main", start: 0 });
      await seedMatrix(fx, { b: [G, L] }, { branch: "dev", start: 10 });
      expect((await fetchFlaky(fx)).map((t) => t.name)).toEqual(["b"]);
      expect((await fetchFlaky(fx, "?branch=main")).map((t) => t.name)).toEqual(["a"]);
    });

    describe("cache (Ruling F-I1)", () => {
      /**
       * Mengubah status hasil test langsung di DB tanpa menyentuh `runs`: kunci cache (run terbaru, jumlah run) tetap
       * sama, jadi respons berikutnya hanya berubah bila daftar flaky benar-benar dihitung ulang.
       */
      const setStatus = (runIds: string[], status: ResultStatus) =>
        app.db.update(testResults).set({ status }).where(inArray(testResults.runId, runIds));

      it("cache hit tanpa hitung ulang; upload baru dan hapus run membatalkan cache; otorisasi tetap dicek", async () => {
        const fx = await setup();
        const failing: string[] = [];
        for (let i = 0; i < 4; i += 1) {
          const runId = await seedRun(fx, { createdAt: minutes(i), results: [result("x", i % 2 === 1 ? "failed" : "passed")] });
          if (i % 2 === 1) failing.push(runId);
        }
        const first = await fetchFlaky(fx);
        expect(first.map((t) => [t.name, t.score])).toEqual([["x", 75]]);

        // Cache hit: data hasil berubah tetapi kunci tidak → body identik (tidak dihitung ulang).
        await setStatus(failing, "passed");
        expect(await fetchFlaky(fx)).toEqual(first);
        expect(await fetchFlaky(fx, "?branch=main")).toEqual(first);

        // Cache tidak pernah melewati otorisasi: anonim tetap 404 pada project privat.
        const anon = await get(`/projects/${fx.project.slug}/flaky`);
        expect(anon.statusCode).toBe(404);

        // Upload baru lewat endpoint ingest (run terbaru berubah) → dihitung ulang: semua lulus, tidak ada flaky.
        const tokenRes = await app.inject({
          method: "POST",
          url: `/api/v1/projects/${fx.project.slug}/tokens`,
          headers: { cookie: fx.admin.cookie },
          payload: { name: "cache" },
        });
        const { token } = createdTokenDto.parse(tokenRes.json());
        const upload = await app.inject({
          method: "POST",
          url: `/api/v1/projects/${fx.project.slug}/runs?branch=main`,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/xml" },
          payload: '<testsuite name="suite"><testcase name="x"/></testsuite>',
        });
        expect(upload.statusCode).toBe(201);
        const uploadedRunId = ingestResultDto.parse(upload.json()).runId;
        expect(await fetchFlaky(fx)).toEqual([]);

        // Kembalikan pola gagal: kunci tetap → masih hasil cache (kosong).
        await setStatus(failing, "failed");
        expect(await fetchFlaky(fx)).toEqual([]);

        // Hapus run (jumlah run dan run terbaru berubah) → dihitung ulang: pola L G L G kembali.
        const removed = await del(`/projects/${fx.project.slug}/runs/${uploadedRunId}`, fx.admin.cookie);
        expect(removed.statusCode).toBe(204);
        expect(await fetchFlaky(fx)).toEqual(first);
      });

      it("menghapus run lama (bukan yang terbaru) juga membatalkan cache", async () => {
        const fx = await setup();
        const runIds: string[] = [];
        for (let i = 0; i < 4; i += 1) {
          runIds.push(await seedRun(fx, { createdAt: minutes(i), results: [result("x", i % 2 === 1 ? "failed" : "passed")] }));
        }
        expect((await fetchFlaky(fx)).map((t) => t.score)).toEqual([75]);
        const [oldest] = runIds;
        if (!oldest) throw new Error("run tidak ada");
        expect((await del(`/projects/${fx.project.slug}/runs/${oldest}`, fx.admin.cookie)).statusCode).toBe(204);
        // Sisa G L G: dua pergantian dari tiga hasil → round(100 × 2 / 3) = 67.
        expect((await fetchFlaky(fx)).map((t) => t.score)).toEqual([67]);
      });

      it("cache terpisah per branch", async () => {
        const fx = await setup();
        await seedMatrix(fx, { a: [L, G, L, G] }, { branch: "main", start: 0 });
        await seedMatrix(fx, { b: [G, L] }, { branch: "dev", start: 10 });
        expect((await fetchFlaky(fx, "?branch=main")).map((t) => t.name)).toEqual(["a"]);
        expect((await fetchFlaky(fx, "?branch=dev")).map((t) => t.name)).toEqual(["b"]);
        expect((await fetchFlaky(fx, "?branch=main")).map((t) => t.name)).toEqual(["a"]);
      });
    });
  });

  describe("batas waktu query baca (statement_timeout)", () => {
    it("query melewati batas → 503 INTERNAL_ERROR pada flaky, stats, detail run, riwayat; tanpa hambatan → 200", async () => {
      const slowApp = await createTestApp({}, { readStatementTimeoutMs: 200 });
      const fx = await setup();
      const runId = await seedRun(fx, { createdAt: minutes(0) });
      const caseId = await testCaseId(fx.project.id, "a");
      const base = `/api/v1/projects/${fx.project.slug}`;
      const urls = [
        `${base}/flaky`,
        `${base}/stats?branch=main`,
        `${base}/runs/${runId}`,
        `${base}/tests/${caseId}/history?branch=main`,
      ];
      const request = (url: string) => slowApp.inject({ method: "GET", url, headers: { cookie: fx.admin.cookie } });

      // Koneksi lain mengunci tabel `runs` sehingga query baca menunggu sampai statement_timeout membatalkannya.
      const locker = new pg.Client({ connectionString: inject("databaseUrl") });
      await locker.connect();
      try {
        await locker.query("begin");
        await locker.query("lock table runs in access exclusive mode");
        for (const url of urls) {
          const res = await request(url);
          expect({ url, status: res.statusCode }).toEqual({ url, status: 503 });
          expect(res.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: expect.any(String) } });
        }
      } finally {
        await locker.query("rollback");
        await locker.end();
      }

      for (const url of urls) {
        expect({ url, status: (await request(url)).statusCode }).toEqual({ url, status: 200 });
      }
    });
  });

  describe("GET /projects/:slug/tests/:testCaseId/history", () => {
    it("20 hasil terbaru urut waktu di branch; tanpa branch memakai branch run terbaru", async () => {
      const fx = await setup();
      const mainRuns: string[] = [];
      for (let i = 0; i < 25; i += 1) {
        const status: ResultStatus = i % 3 === 0 ? "failed" : i % 5 === 0 ? "skipped" : "passed";
        mainRuns.push(
          await seedRun(fx, {
            createdAt: minutes(i),
            results: [result("target", status, { flakyInRun: i === 24, retries: i === 24 ? 1 : 0 })],
          }),
        );
      }
      const devRun = await seedRun(fx, { branch: "dev", createdAt: minutes(50), results: [result("target", "failed")] });
      await seedRun(fx, { branch: "main", createdAt: minutes(-10), results: [result("other", "passed")] });
      const id = await testCaseId(fx.project.id, "target");

      const main = testHistoryDto.parse(
        (await get(`/projects/${fx.project.slug}/tests/${id}/history?branch=main`, fx.admin.cookie)).json(),
      );
      expect(main.testCase).toEqual({ id, suite: "suite", name: "target" });
      expect(main.branch).toBe("main");
      expect(main.results.map((r) => r.runId)).toEqual(mainRuns.slice(5));
      expect(main.results[19]).toEqual({
        runId: mainRuns[24],
        createdAt: minutes(24).toISOString(),
        status: "failed",
        flakyInRun: true,
        retries: 1,
        durationMs: 10,
      });
      expect(main.results[0]?.createdAt).toBe(minutes(5).toISOString());
      expect(main.results[0]?.status).toBe("skipped");

      const latest = testHistoryDto.parse(
        (await get(`/projects/${fx.project.slug}/tests/${id}/history`, fx.admin.cookie)).json(),
      );
      expect(latest.branch).toBe("dev");
      expect(latest.results.map((r) => r.runId)).toEqual([devRun]);
    });

    it("404 TEST_NOT_FOUND: test project lain, id tak dikenal, id bukan uuid", async () => {
      const fx = await setup();
      const other = await setup();
      await seedRun(other, { createdAt: minutes(0), results: [result("foreign", "passed")] });
      const foreignId = await testCaseId(other.project.id, "foreign");

      for (const id of [foreignId, UNKNOWN_ID, "bukan-uuid"]) {
        const res = await get(`/projects/${fx.project.slug}/tests/${id}/history`, fx.admin.cookie);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("TEST_NOT_FOUND");
      }
    });
  });

  describe("GET /projects/:slug/branches", () => {
    it("urut run terbaru, setiap item dengan lastRun; branch bergaris miring ikut tampil", async () => {
      const fx = await setup();
      await seedRun(fx, { branch: "main", createdAt: minutes(0) });
      await seedRun(fx, { branch: "feature/login-v2", createdAt: minutes(1) });
      const mainLatest = await seedRun(fx, { branch: "main", createdAt: minutes(5) });
      const devLatest = await seedRun(fx, { branch: "dev", createdAt: minutes(3) });
      const featureLatest = await seedRun(fx, { branch: "feature/login-v2", createdAt: minutes(4) });

      const res = await get(`/projects/${fx.project.slug}/branches`, fx.admin.cookie);
      expect(res.statusCode).toBe(200);
      const list = z.array(branchDto).parse(res.json());
      expect(list.map((b) => [b.branch, b.lastRun.id])).toEqual([
        ["main", mainLatest],
        ["feature/login-v2", featureLatest],
        ["dev", devLatest],
      ]);
      expect(list[0]!.lastRun.createdAt).toBe(minutes(5).toISOString());
    });

    it("project tanpa run → daftar kosong", async () => {
      const fx = await setup();
      const res = await get(`/projects/${fx.project.slug}/branches`, fx.admin.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe("otorisasi baca", () => {
    async function readUrls(fx: Fixture) {
      const runId = await seedRun(fx, { createdAt: minutes(0), results: [result("a", "failed")] });
      const id = await testCaseId(fx.project.id, "a");
      const slug = fx.project.slug;
      return [
        `/projects/${slug}/branches`,
        `/projects/${slug}/runs`,
        `/projects/${slug}/runs/${runId}`,
        `/projects/${slug}/stats`,
        `/projects/${slug}/flaky`,
        `/projects/${slug}/tests/${id}/history`,
      ];
    }

    it("project publik: anonim dan non-anggota 200 di semua endpoint baca", async () => {
      const fx = await setup({ visibility: "public" });
      const outsider = await registerUser(app);
      for (const url of await readUrls(fx)) {
        expect({ url, status: (await get(url)).statusCode }).toEqual({ url, status: 200 });
        expect({ url, status: (await get(url, outsider.cookie)).statusCode }).toEqual({ url, status: 200 });
      }
    });

    it("project privat: anonim, non-anggota, dan Bearer token CI 404 PROJECT_NOT_FOUND; viewer 200", async () => {
      const fx = await setup();
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

      for (const url of await readUrls(fx)) {
        for (const res of [await get(url), await get(url, outsider.cookie), await get(url, undefined, bearer)]) {
          expect({ url, status: res.statusCode, code: res.json().error?.code }).toEqual({
            url,
            status: 404,
            code: "PROJECT_NOT_FOUND",
          });
        }
        expect({ url, status: (await get(url, viewer.cookie)).statusCode }).toEqual({ url, status: 200 });
      }
    });

    it("project privat: non-anggota mendapat 404 PROJECT_NOT_FOUND sebelum validasi query", async () => {
      const fx = await setup();
      const outsider = await registerUser(app);
      const res = await get(`/projects/${fx.project.slug}/runs?cursor=rusak!`, outsider.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
    });
  });
});
