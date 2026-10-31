import { createdTokenDto, ingestResultDto } from "@testpulse/shared";
import { and, asc, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { projectTokens, runs, testCases, testResults } from "../../src/db/schema.js";
import { createProject, createTestApp, registerUser } from "./helpers.js";

const APP_ORIGIN = "http://localhost:5173";
const MAX_BODY_BYTES = 5 * 1024 * 1024;

interface CaseSpec {
  suite?: string;
  name: string;
  status?: "passed" | "failed" | "skipped";
  time?: string;
  message?: string;
}

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Laporan JUnit minimal: satu `<testsuite>` berisi testcase sesuai urutan `cases`. */
function junit(cases: CaseSpec[], opts: { suiteName?: string; padding?: string } = {}): string {
  const body = cases
    .map((c) => {
      const attrs = `${c.suite !== undefined ? ` classname="${escapeXml(c.suite)}"` : ""} name="${escapeXml(c.name)}"${c.time ? ` time="${c.time}"` : ""}`;
      if (c.status === "failed") return `<testcase${attrs}><failure message="${escapeXml(c.message ?? "gagal")}"/></testcase>`;
      if (c.status === "skipped") return `<testcase${attrs}><skipped/></testcase>`;
      return `<testcase${attrs}/>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="${escapeXml(opts.suiteName ?? "suite")}">${body}</testsuite>${opts.padding ?? ""}`;
}

/** Laporan valid yang dipenuhi komentar XML sampai panjang tepat `bytes` byte (ASCII). */
function junitOfSize(bytes: number): string {
  const base = junit([{ name: "padded" }]);
  const overhead = base.length + "<!---->".length;
  return junit([{ name: "padded" }], { padding: `<!--${"x".repeat(bytes - overhead)}-->` });
}

describe("POST /api/v1/projects/:slug/runs (ingest)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  async function setup(target: FastifyInstance = app) {
    const admin = await registerUser(target);
    const project = await createProject(target, admin.cookie);
    const token = await createToken(target, project.slug, admin.cookie);
    return { admin, project, token };
  }

  async function createToken(target: FastifyInstance, slug: string, cookie: string) {
    const res = await target.inject({
      method: "POST",
      url: `/api/v1/projects/${slug}/tokens`,
      headers: { cookie },
      payload: { name: "CI" },
    });
    expect(res.statusCode).toBe(201);
    return createdTokenDto.parse(res.json());
  }

  function upload(
    slug: string,
    opts: {
      token?: string;
      body?: string;
      query?: string;
      contentType?: string;
      headers?: Record<string, string>;
      target?: FastifyInstance;
    } = {},
  ) {
    const headers: Record<string, string> = { "content-type": opts.contentType ?? "application/xml", ...opts.headers };
    if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
    return (opts.target ?? app).inject({
      method: "POST",
      url: `/api/v1/projects/${slug}/runs?${opts.query ?? "branch=main"}`,
      headers,
      payload: opts.body ?? junit([{ name: "a" }]),
    });
  }

  /** Menyisipkan `n` run kosong langsung ke DB, `created_at` berurutan satu menit mulai sehari lalu. */
  const seedRuns = (projectId: string, n: number) => {
    const start = Date.now() - 1000 * 60 * 60 * 24;
    return app.db
      .insert(runs)
      .values(
        Array.from({ length: n }, (_, i) => ({
          projectId,
          branch: "main",
          createdAt: new Date(start + i * 60_000),
          durationMs: 0,
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          flaky: 0,
        })),
      )
      .returning({ id: runs.id, createdAt: runs.createdAt });
  };

  const countTestCases = async (projectId: string) => {
    const [row] = await app.db.select({ n: count() }).from(testCases).where(eq(testCases.projectId, projectId));
    return row?.n ?? 0;
  };

  describe("sukses", () => {
    it("201: totals, url, baris runs/test_cases/test_results, dan last_used_at terisi", async () => {
      const { project, token } = await setup();
      const report = junit([
        { suite: "auth", name: "login", time: "1.5" },
        { suite: "auth", name: "logout", status: "failed", message: "expected 200" },
        { suite: "auth", name: "reset", status: "skipped" },
        { suite: "cart", name: "add", status: "failed", time: "0.25" },
        { suite: "cart", name: "add", time: "0.25" },
      ]);

      const res = await upload(project.slug, {
        token: token.token,
        body: report,
        query: "branch=feature/x-1&commit=ABCDEF1&ciUrl=https%3A%2F%2Fci.example%2Fjob%2F1&name=Nightly",
      });

      expect(res.statusCode).toBe(201);
      const body = ingestResultDto.parse(res.json());
      expect(body.totals).toEqual({ total: 4, passed: 2, failed: 1, skipped: 1, flaky: 1 });
      expect(body.url).toBe(`${APP_ORIGIN}/p/${project.slug}/runs/${body.runId}`);

      const [run] = await app.db.select().from(runs).where(eq(runs.id, body.runId));
      expect(run).toMatchObject({
        projectId: project.id,
        branch: "feature/x-1",
        commitSha: "abcdef1",
        ciUrl: "https://ci.example/job/1",
        name: "Nightly",
        durationMs: 2000,
        total: 4,
        passed: 2,
        failed: 1,
        skipped: 1,
        flaky: 1,
        tokenId: token.id,
      });

      const results = await app.db
        .select({
          suite: testCases.suite,
          name: testCases.name,
          status: testResults.status,
          flakyInRun: testResults.flakyInRun,
          retries: testResults.retries,
          durationMs: testResults.durationMs,
          message: testResults.message,
        })
        .from(testResults)
        .innerJoin(testCases, eq(testCases.id, testResults.testCaseId))
        .where(eq(testResults.runId, body.runId))
        .orderBy(asc(testCases.suite), asc(testCases.name));
      expect(results).toEqual([
        { suite: "auth", name: "login", status: "passed", flakyInRun: false, retries: 0, durationMs: 1500, message: null },
        { suite: "auth", name: "logout", status: "failed", flakyInRun: false, retries: 0, durationMs: 0, message: "expected 200" },
        { suite: "auth", name: "reset", status: "skipped", flakyInRun: false, retries: 0, durationMs: 0, message: null },
        { suite: "cart", name: "add", status: "passed", flakyInRun: true, retries: 1, durationMs: 500, message: "gagal" },
      ]);

      const [tokenRow] = await app.db.select().from(projectTokens).where(eq(projectTokens.id, token.id));
      expect(tokenRow?.lastUsedAt).toBeInstanceOf(Date);
    });

    it("commit/ciUrl/name opsional → NULL; Content-Type text/xml dan charset diterima", async () => {
      const { project, token } = await setup();
      for (const contentType of ["text/xml", "application/xml; charset=utf-8", "text/xml;charset=UTF-8", "application/xml; charset=\"utf-8\""]) {
        const res = await upload(project.slug, { token: token.token, contentType });
        expect(res.statusCode).toBe(201);
        const [run] = await app.db.select().from(runs).where(eq(runs.id, res.json().runId));
        expect(run).toMatchObject({ branch: "main", commitSha: null, ciUrl: null, name: null });
      }
    });

    it("test_cases dipakai ulang pada upload kedua (jumlah baris tetap untuk test yang sama)", async () => {
      const { project, token } = await setup();
      const report = junit([{ suite: "s", name: "a" }, { suite: "s", name: "b" }]);

      expect((await upload(project.slug, { token: token.token, body: report })).statusCode).toBe(201);
      expect(await countTestCases(project.id)).toBe(2);
      const second = await upload(project.slug, { token: token.token, body: report });
      expect(second.statusCode).toBe(201);
      expect(await countTestCases(project.id)).toBe(2);

      const [stored] = await app.db
        .select({ n: count() })
        .from(testResults)
        .where(eq(testResults.runId, second.json().runId));
      expect(stored?.n).toBe(2);
    });

    it("Review Focus 2: `login` di suite A dan suite B → dua test_cases", async () => {
      const { project, token } = await setup();
      const report = junit([
        { suite: "A", name: "login" },
        { suite: "B", name: "login", status: "failed" },
      ]);
      const res = await upload(project.slug, { token: token.token, body: report });
      expect(res.statusCode).toBe(201);
      expect(res.json().totals).toEqual({ total: 2, passed: 1, failed: 1, skipped: 0, flaky: 0 });
      const rows = await app.db
        .select({ suite: testCases.suite, name: testCases.name })
        .from(testCases)
        .where(eq(testCases.projectId, project.id))
        .orderBy(asc(testCases.suite));
      expect(rows).toEqual([
        { suite: "A", name: "login" },
        { suite: "B", name: "login" },
      ]);
    });

    it("upload paralel berisi test yang sama (urutan berbeda) → semua 201, tanpa duplikat test_cases", async () => {
      const { project, token } = await setup();
      const cases = Array.from({ length: 300 }, (_, i) => ({ suite: `s${i % 7}`, name: `t${i}` }));
      const reports = [cases, [...cases].reverse(), cases, [...cases].reverse()].map((c) => junit(c));

      const responses = await Promise.all(reports.map((body) => upload(project.slug, { token: token.token, body })));

      expect(responses.map((r) => r.statusCode)).toEqual([201, 201, 201, 201]);
      expect(await countTestCases(project.id)).toBe(300);
      const [stored] = await app.db
        .select({ n: count() })
        .from(testResults)
        .innerJoin(runs, eq(runs.id, testResults.runId))
        .where(eq(runs.projectId, project.id));
      expect(stored?.n).toBe(1200);
    });

    it("20.000 testcase tersimpan (insert dipecah di bawah batas 65.535 parameter Postgres)", async () => {
      const { project, token } = await setup();
      const cases = Array.from({ length: 20000 }, (_, i) => ({ suite: "big", name: `t${i}` }));

      const res = await upload(project.slug, { token: token.token, body: junit(cases) });

      expect(res.statusCode).toBe(201);
      expect(res.json().totals.total).toBe(20000);
      expect(await countTestCases(project.id)).toBe(20000);
      const [stored] = await app.db
        .select({ n: count() })
        .from(testResults)
        .where(eq(testResults.runId, res.json().runId));
      expect(stored?.n).toBe(20000);
    });

    it("Review Focus 5: 200 run lama + 1 upload → tersisa tepat 200, run terlama hilang, run baru ada", async () => {
      const { project, token } = await setup();
      const seeded = await seedRuns(project.id, 200);
      const oldest = seeded.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
      const secondOldest = seeded.filter((r) => r.id !== oldest.id).reduce((a, b) => (a.createdAt < b.createdAt ? a : b));

      // Project lain tidak tersentuh retensi project ini.
      const other = await setup();
      expect((await upload(other.project.slug, { token: other.token.token })).statusCode).toBe(201);

      const res = await upload(project.slug, { token: token.token });
      expect(res.statusCode).toBe(201);

      const remaining = await app.db.select({ id: runs.id }).from(runs).where(eq(runs.projectId, project.id));
      const ids = new Set(remaining.map((r) => r.id));
      expect(ids.size).toBe(200);
      expect(ids.has(oldest.id)).toBe(false);
      expect(ids.has(secondOldest.id)).toBe(true);
      expect(ids.has(res.json().runId)).toBe(true);
      const [otherRuns] = await app.db.select({ n: count() }).from(runs).where(eq(runs.projectId, other.project.id));
      expect(otherRuns?.n).toBe(1);
    });

    it("retensi serentak: 199 run lama + 4 upload paralel → tersisa tepat 200", async () => {
      const { project, token } = await setup();
      const seeded = await seedRuns(project.id, 199);

      const responses = await Promise.all(Array.from({ length: 4 }, () => upload(project.slug, { token: token.token })));

      expect(responses.map((r) => r.statusCode)).toEqual([201, 201, 201, 201]);
      const remaining = await app.db.select({ id: runs.id }).from(runs).where(eq(runs.projectId, project.id));
      const ids = new Set(remaining.map((r) => r.id));
      expect(ids.size).toBe(200);
      for (const res of responses) expect(ids.has(res.json().runId)).toBe(true);
      const oldestThree = [...seeded].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, 3);
      for (const run of oldestThree) expect(ids.has(run.id)).toBe(false);
    });

    it("body tepat 5 MB diterima", async () => {
      const { project, token } = await setup();
      const body = junitOfSize(MAX_BODY_BYTES);
      expect(Buffer.byteLength(body)).toBe(MAX_BODY_BYTES);
      expect((await upload(project.slug, { token: token.token, body })).statusCode).toBe(201);
    });
  });

  describe("autentikasi: hanya Bearer token CI", () => {
    it("401 tanpa token, token dicabut, format salah, token tak dikenal, cookie sesi admin — pesan identik", async () => {
      const { admin, project, token } = await setup();
      const revoked = await createToken(app, project.slug, admin.cookie);
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/projects/${project.slug}/tokens/${revoked.id}`,
        headers: { cookie: admin.cookie },
      });
      expect(del.statusCode).toBe(204);

      const attempts = [
        upload(project.slug),
        upload(project.slug, { token: revoked.token }),
        upload(project.slug, { token: "abc" }),
        upload(project.slug, { token: `tp_${"A".repeat(43)}` }),
        upload(project.slug, { headers: { authorization: `Basic ${token.token}` } }),
        upload(project.slug, { headers: { authorization: token.token } }),
        upload(project.slug, { headers: { cookie: admin.cookie } }),
      ];
      const responses = await Promise.all(attempts);
      const bodies = responses.map((r) => ({ status: r.statusCode, body: r.json() }));
      for (const { status, body } of bodies) {
        expect(status).toBe(401);
        expect(body).toEqual(bodies[0]!.body);
        expect(body.error.code).toBe("UNAUTHENTICATED");
      }

      const [run] = await app.db.select({ n: count() }).from(runs).where(eq(runs.projectId, project.id));
      expect(run?.n).toBe(0);
    });

    it("token project A ke slug project B → 404 PROJECT_NOT_FOUND; slug tidak ada → 404", async () => {
      const a = await setup();
      const b = await setup();
      const wrong = await upload(b.project.slug, { token: a.token.token });
      expect(wrong.statusCode).toBe(404);
      expect(wrong.json().error.code).toBe("PROJECT_NOT_FOUND");
      const missing = await upload("tidak-ada-project-ini", { token: a.token.token });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual(wrong.json());
    });

    it("token CI tidak berlaku di endpoint lain", async () => {
      const { project, token } = await setup();
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${project.slug}/tokens`,
        headers: { authorization: `Bearer ${token.token}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it("upload gagal tidak mengisi last_used_at", async () => {
      const { project, token } = await setup();
      expect((await upload(project.slug, { token: token.token, body: "<bukan xml" })).statusCode).toBe(422);
      const [row] = await app.db.select().from(projectTokens).where(eq(projectTokens.id, token.id));
      expect(row?.lastUsedAt).toBeNull();
    });
  });

  describe("validasi", () => {
    it("Content-Type application/json → 400 VALIDATION_ERROR (juga tanpa token: Content-Type dicek pertama)", async () => {
      const { project, token } = await setup();
      for (const t of [token.token, undefined]) {
        const res = await upload(project.slug, { token: t, contentType: "application/json", body: "{}" });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");
      }
      const plain = await upload(project.slug, { token: token.token, contentType: "text/plain" });
      expect(plain.statusCode).toBe(400);
    });

    it("charset selain utf-8 → 400 VALIDATION_ERROR (juga tanpa token)", async () => {
      const { project, token } = await setup();
      for (const contentType of ["application/xml; charset=iso-8859-1", "text/xml; charset=utf-16", "text/xml; charset=utf8"]) {
        for (const t of [token.token, undefined]) {
          const res = await upload(project.slug, { token: t, contentType });
          expect(res.statusCode).toBe(400);
          expect(res.json().error.code).toBe("VALIDATION_ERROR");
        }
      }
      const [run] = await app.db.select({ n: count() }).from(runs).where(eq(runs.projectId, project.id));
      expect(run?.n).toBe(0);
    });

    it("karakter kontrol mentah (U+0000, U+0001) di nama/pesan → 422 INVALID_REPORT, bukan 500", async () => {
      const { project, token } = await setup();
      const bodies = [
        junit([{ name: "a\u0000b" }]),
        junit([{ name: "a", status: "failed", message: "boom\u0001" }]),
      ];
      for (const body of bodies) {
        const res = await upload(project.slug, { token: token.token, body });
        expect(res.statusCode).toBe(422);
        expect(res.json()).toEqual({ error: { code: "INVALID_REPORT", message: expect.any(String) } });
      }
      const [run] = await app.db.select({ n: count() }).from(runs).where(eq(runs.projectId, project.id));
      expect(run?.n).toBe(0);
    });

    it("testcase tanpa name / name kosong → 422 INVALID_REPORT, tidak ada run tersimpan", async () => {
      const { project, token } = await setup();
      const bodies = [junit([{ name: "" }]), junit([{ name: "ok" }, { name: "   " }]), `<testsuite name="s"><testcase/></testsuite>`];
      for (const body of bodies) {
        const res = await upload(project.slug, { token: token.token, body });
        expect(res.statusCode).toBe(422);
        expect(res.json()).toEqual({ error: { code: "INVALID_REPORT", message: expect.any(String) } });
      }
      const [run] = await app.db.select({ n: count() }).from(runs).where(eq(runs.projectId, project.id));
      expect(run?.n).toBe(0);
    });

    it("time 1.000.000 digit + 'x' (testcase dan root) → cepat 201 dengan durasi 0 (bukan ReDoS)", async () => {
      const { project, token } = await setup();
      const evil = `${"1".repeat(1_000_000)}x`;
      const body = `<testsuite name="s" time="${evil}"><testcase name="a" time="${evil}"/></testsuite>`;
      const started = performance.now();
      const res = await upload(project.slug, { token: token.token, body });
      const elapsed = performance.now() - started;
      expect(res.statusCode).toBe(201);
      expect(elapsed).toBeLessThan(2000);
      const { runId } = ingestResultDto.parse(res.json());
      const [run] = await app.db.select({ durationMs: runs.durationMs }).from(runs).where(eq(runs.id, runId));
      expect(run?.durationMs).toBe(0);
      const [result] = await app.db
        .select({ durationMs: testResults.durationMs })
        .from(testResults)
        .where(eq(testResults.runId, runId));
      expect(result?.durationMs).toBe(0);
    });

    it("branch kosong / tidak ada / tidak valid → 400 dengan fields.branch", async () => {
      const { project, token } = await setup();
      for (const query of ["branch=", "", "branch=a%20b", "branch=main&branch=dev"]) {
        const res = await upload(project.slug, { token: token.token, query });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");
        expect(res.json().error.fields.branch).toBeTypeOf("string");
      }
      const commit = await upload(project.slug, { token: token.token, query: "branch=main&commit=xyz" });
      expect(commit.statusCode).toBe(400);
      expect(commit.json().error.fields.commit).toBeTypeOf("string");
    });

    it("body 5 MB + 1 byte → 413 PAYLOAD_TOO_LARGE", async () => {
      const { project, token } = await setup();
      const res = await upload(project.slug, { token: token.token, body: junitOfSize(MAX_BODY_BYTES + 1) });
      expect(res.statusCode).toBe(413);
      expect(res.json()).toEqual({ error: { code: "PAYLOAD_TOO_LARGE", message: expect.any(String) } });
    });

    it("<!DOCTYPE → 422 INVALID_REPORT; XML rusak → 422; tanpa testcase → 422", async () => {
      const { project, token } = await setup();
      const bodies = [
        `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><testsuite name="s"><testcase name="&a;"/></testsuite>`,
        `<testsuite name="s"><testcase name="a"></testsuite>`,
        `<testsuite name="s"></testsuite>`,
        "",
      ];
      for (const body of bodies) {
        const res = await upload(project.slug, { token: token.token, body });
        expect(res.statusCode).toBe(422);
        expect(res.json()).toEqual({ error: { code: "INVALID_REPORT", message: expect.any(String) } });
      }
      const [run] = await app.db.select({ n: count() }).from(runs).where(eq(runs.projectId, project.id));
      expect(run?.n).toBe(0);
    });

    it("urutan cek: Content-Type → 401 → 404 → 400 → 413 → 422", async () => {
      const a = await setup();
      const b = await setup();
      const huge = "x".repeat(MAX_BODY_BYTES + 1);
      const status = async (opts: Parameters<typeof upload>[1], slug = a.project.slug) =>
        (await upload(slug, opts)).statusCode;

      expect(await status({ contentType: "application/json", query: "", body: huge })).toBe(400);
      expect(await status({ token: "abc", query: "", body: huge })).toBe(401);
      expect(await status({ token: a.token.token, query: "", body: huge }, b.project.slug)).toBe(404);
      expect(await status({ token: a.token.token, query: "", body: huge })).toBe(400);
      expect(await status({ token: a.token.token, body: huge })).toBe(413);
      expect(await status({ token: a.token.token, body: "<!DOCTYPE x><a/>" })).toBe(422);
    });

    it("Origin asing tetap → 403 FORBIDDEN (pemeriksaan Origin tidak dilewati)", async () => {
      const { project, token } = await setup();
      const res = await upload(project.slug, { token: token.token, headers: { origin: "https://evil.example" } });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
      const same = await upload(project.slug, { token: token.token, headers: { origin: APP_ORIGIN } });
      expect(same.statusCode).toBe(201);
    });
  });

  describe("rate limit per token", () => {
    it("ingestRateLimitMax 3: upload ke-4 dalam satu jam → 429; token lain tetap 201", async () => {
      const limited = await createTestApp({ ingestRateLimitMax: 3 });
      const { admin, project, token } = await setup(limited);
      const other = await createToken(limited, project.slug, admin.cookie);

      for (let i = 0; i < 3; i++) {
        const res = await upload(project.slug, { token: token.token, target: limited });
        expect(res.statusCode).toBe(201);
        expect(res.headers["x-ratelimit-limit"]).toBe("3");
      }
      const blocked = await upload(project.slug, { token: token.token, target: limited });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({ error: { code: "RATE_LIMITED", message: expect.any(String) } });

      // Cek token dan query berjalan sebelum batas laju: bukan 429 meski bucket token habis.
      expect((await upload(project.slug, { token: "abc", target: limited })).statusCode).toBe(401);
      expect((await upload(project.slug, { token: token.token, query: "branch=", target: limited })).statusCode).toBe(400);

      // Upload dengan query tidak valid tidak memakai jatah: 5 kali 400, lalu tetap 3 upload sukses sebelum 429.
      for (let i = 0; i < 5; i++) {
        expect((await upload(project.slug, { token: other.token, query: "", target: limited })).statusCode).toBe(400);
      }
      for (let i = 0; i < 3; i++) {
        expect((await upload(project.slug, { token: other.token, target: limited })).statusCode).toBe(201);
      }
      expect((await upload(project.slug, { token: other.token, target: limited })).statusCode).toBe(429);

      const [stored] = await limited.db
        .select({ n: count() })
        .from(runs)
        .where(and(eq(runs.projectId, project.id), eq(runs.tokenId, token.id)));
      expect(stored?.n).toBe(3);
    });
  });
});
