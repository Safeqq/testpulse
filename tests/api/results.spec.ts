import {
  branchDto,
  flakyTestDto,
  ingestResultDto,
  runDetailDto,
  runsPageDto,
  statsDto,
  testHistoryDto,
  tokenDto,
  type CreatedTokenDto,
  type ErrorCode,
} from "@testpulse/shared";
import type { APIResponse } from "@playwright/test";
import type { TestApi, TestUser } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { expectApiError, expectFieldError, parseBody } from "../support/http.js";
import { buildJUnit } from "../support/junit.js";

const API = "/api/v1";
const MB = 1024 * 1024;
/** Batas laju stack test (docker-compose.yml `INGEST_RATE_LIMIT_MAX`, Ruling P3). */
const CONFIGURED_RATE_LIMIT = Number(process.env["INGEST_RATE_LIMIT_MAX"] ?? 1000);

interface Project {
  owner: TestUser;
  slug: string;
  token: CreatedTokenDto;
}

async function setup(api: TestApi): Promise<Project> {
  const owner = await api.register();
  const { slug } = await api.createProject(owner);
  return { owner, slug, token: await api.createToken(owner, slug) };
}

/** Upload mentah (tanpa cookie) agar test bisa mengatur header dan query sendiri. */
async function rawUpload(
  api: TestApi,
  slug: string,
  options: { query?: string; headers?: Record<string, string>; data?: string | Buffer },
): Promise<APIResponse> {
  const ctx = await api.anonymous();
  return ctx.post(`${API}/projects/${slug}/runs${options.query ?? "?branch=main"}`, {
    headers: options.headers ?? {},
    data: options.data ?? buildJUnit([{ name: "lulus" }]),
  });
}

const bearer = (token: string, contentType = "application/xml") => ({
  authorization: `Bearer ${token}`,
  "content-type": contentType,
});

test.describe("POST /projects/:slug/runs (upload lewat proxy)", () => {
  test("201 sesuai schema: total (termasuk flaky), url run, dan query tersimpan di run", async ({ api }) => {
    const { owner, slug, token } = await setup(api);
    const xml = buildJUnit([
      { name: "lulus" },
      { name: "gagal", status: "failed", message: "Assertion gagal: <a & b>" },
      { name: "dilewati", status: "skipped" },
      { name: "kadang gagal", retries: 2 },
    ]);

    const res = await api.uploadRun(token.token, slug, xml, {
      branch: "main",
      commit: "ABCDEF1234",
      ciUrl: "https://ci.example.com/jobs/42",
      name: "Build #42",
    });
    const created = await parseBody(res, 201, ingestResultDto);
    expect(created.totals).toEqual({ total: 4, passed: 2, failed: 1, skipped: 1, flaky: 1 });
    expect(created.url).toMatch(new RegExp(`^https?://[^/]+/p/${slug}/runs/${created.runId}$`));

    const detail = await parseBody(
      await owner.request.get(`${API}/projects/${slug}/runs/${created.runId}?status=all`),
      200,
      runDetailDto,
    );
    expect(detail.run).toMatchObject({
      id: created.runId,
      branch: "main",
      commitSha: "abcdef1234",
      ciUrl: "https://ci.example.com/jobs/42",
      name: "Build #42",
      ...created.totals,
    });
    expect(detail.results).toHaveLength(4);
    expect(detail.results.find((r) => r.name === "gagal")).toMatchObject({
      status: "failed",
      message: "Assertion gagal: <a & b>",
    });
    expect(detail.results.find((r) => r.name === "kadang gagal")).toMatchObject({
      status: "passed",
      flakyInRun: true,
      retries: 2,
    });
  });

  test("upload memperbarui last_used_at token; nilai token tidak pernah muncul di daftar token", async ({ api }) => {
    const { owner, slug, token } = await setup(api);
    const before = await parseBody(await owner.request.get(`${API}/projects/${slug}/tokens`), 200, tokenDto.array());
    expect(before[0]?.lastUsedAt).toBeNull();

    await parseBody(await api.uploadRun(token.token, slug, buildJUnit([{ name: "a" }]), { branch: "main" }), 201, ingestResultDto);

    const res = await owner.request.get(`${API}/projects/${slug}/tokens`);
    const after = await parseBody(res, 200, tokenDto.array());
    expect(after[0]?.lastUsedAt).toEqual(expect.any(String));
    expect(await res.text()).not.toContain(token.token);
  });

  test("seluruh endpoint baca mengembalikan data sesuai schema setelah upload", async ({ api }) => {
    const { owner, slug, token } = await setup(api);
    const upload = async () =>
      parseBody(
        await api.uploadRun(token.token, slug, buildJUnit([{ suite: "s", name: "goyang", retries: 1 }, { suite: "s", name: "stabil" }]), {
          branch: "main",
        }),
        201,
        ingestResultDto,
      );
    await upload();
    const second = await upload();
    const base = `${API}/projects/${slug}`;

    const branches = await parseBody(await owner.request.get(`${base}/branches`), 200, branchDto.array());
    expect(branches.map((b) => b.branch)).toEqual(["main"]);
    expect(branches[0]?.lastRun.id).toBe(second.runId);

    const runs = await parseBody(await owner.request.get(`${base}/runs`), 200, runsPageDto);
    expect(runs.runs).toHaveLength(2);
    expect(runs.nextCursor).toBeNull();
    expect(runs.runs[0]?.id).toBe(second.runId);

    const stats = await parseBody(await owner.request.get(`${base}/stats`), 200, statsDto);
    expect(stats.branch).toBe("main");
    expect(stats.points).toHaveLength(2);
    expect(stats.points.at(-1)?.runId).toBe(second.runId);
    expect(stats.latest?.id).toBe(second.runId);

    const flaky = await parseBody(await owner.request.get(`${base}/flaky`), 200, flakyTestDto.array());
    expect(flaky.map((f) => f.name)).toEqual(["goyang"]);
    expect(flaky[0]?.score).toBeGreaterThan(0);

    const history = await parseBody(
      await owner.request.get(`${base}/tests/${flaky[0]!.testCaseId}/history`),
      200,
      testHistoryDto,
    );
    expect(history.testCase).toMatchObject({ suite: "s", name: "goyang" });
    expect(history.branch).toBe("main");
    expect(history.results).toHaveLength(2);
    expect(history.results.every((r) => r.flakyInRun)).toBe(true);
  });

  test("project tanpa run: endpoint baca mengembalikan kosong, bukan error", async ({ api }) => {
    const { owner, slug } = await setup(api);
    const base = `${API}/projects/${slug}`;
    expect(await parseBody(await owner.request.get(`${base}/branches`), 200, branchDto.array())).toEqual([]);
    expect(await parseBody(await owner.request.get(`${base}/runs`), 200, runsPageDto)).toEqual({ runs: [], nextCursor: null });
    expect(await parseBody(await owner.request.get(`${base}/stats`), 200, statsDto)).toEqual({
      branch: null,
      points: [],
      latest: null,
    });
    expect(await parseBody(await owner.request.get(`${base}/flaky`), 200, flakyTestDto.array())).toEqual([]);
  });

  test("project publik: anonim membaca hasil, tetapi tidak boleh menghapus run", async ({ api }) => {
    const { owner, slug, token } = await setup(api);
    await api.setVisibility(owner, slug, "public");
    const { runId } = await parseBody(
      await api.uploadRun(token.token, slug, buildJUnit([{ name: "a", status: "failed" }]), { branch: "main" }),
      201,
      ingestResultDto,
    );

    const anon = await api.anonymous();
    const detail = await parseBody(await anon.get(`${API}/projects/${slug}/runs/${runId}`), 200, runDetailDto);
    expect(detail.results.map((r) => r.name)).toEqual(["a"]);
    await expectApiError(await anon.delete(`${API}/projects/${slug}/runs/${runId}`), 401, "UNAUTHENTICATED");
  });
});

test.describe("POST runs: Content-Type", () => {
  for (const contentType of ["application/xml", "text/xml", "application/xml; charset=utf-8", "text/xml;charset=UTF-8"]) {
    test(`${contentType} diterima → 201`, async ({ api }) => {
      const { slug, token } = await setup(api);
      const res = await rawUpload(api, slug, { headers: bearer(token.token, contentType) });
      await parseBody(res, 201, ingestResultDto);
    });
  }

  for (const contentType of ["application/json", "text/plain", "application/xml; charset=iso-8859-1"]) {
    test(`${contentType} ditolak → 400 VALIDATION_ERROR`, async ({ api }) => {
      const { slug, token } = await setup(api);
      const res = await rawUpload(api, slug, { headers: bearer(token.token, contentType) });
      await expectApiError(res, 400, "VALIDATION_ERROR");
    });
  }
});

test.describe("POST runs: autentikasi (401 / 404)", () => {
  test("token tidak ada, salah format, tidak dikenal, atau dicabut → 401 dengan pesan identik", async ({ api }) => {
    const { owner, slug, token } = await setup(api);
    const revoked = await api.createToken(owner, slug, "akan dicabut");
    const revokeRes = await owner.request.delete(`${API}/projects/${slug}/tokens/${revoked.id}`);
    expect(revokeRes.status()).toBe(204);

    const attempts: Record<string, Record<string, string>> = {
      "tanpa header Authorization": { "content-type": "application/xml" },
      "skema bukan Bearer": { authorization: `Basic ${token.token}`, "content-type": "application/xml" },
      "format salah": bearer("bukan-token"),
      "tidak dikenal": bearer("tp_token-yang-tidak-pernah-dibuat-0000000000"),
      dicabut: bearer(revoked.token),
    };
    const messages = new Set<string>();
    for (const headers of Object.values(attempts)) {
      const error = await expectApiError(await rawUpload(api, slug, { headers }), 401, "UNAUTHENTICATED");
      messages.add(error.message);
    }
    expect(messages.size).toBe(1);
  });

  test("cookie sesi tanpa token → 401, bahkan untuk admin project itu", async ({ api }) => {
    const { owner, slug } = await setup(api);
    const res = await owner.request.post(`${API}/projects/${slug}/runs?branch=main`, {
      headers: { "content-type": "application/xml" },
      data: buildJUnit([{ name: "a" }]),
    });
    await expectApiError(res, 401, "UNAUTHENTICATED");
    const runs = await parseBody(await owner.request.get(`${API}/projects/${slug}/runs`), 200, runsPageDto);
    expect(runs.runs).toEqual([]);
  });

  test("token valid milik project lain → 404 PROJECT_NOT_FOUND, sama dengan slug yang tidak ada", async ({ api }) => {
    const mine = await setup(api);
    const other = await setup(api);

    const crossProject = await rawUpload(api, other.slug, { headers: bearer(mine.token.token) });
    const missing = await rawUpload(api, "tidak-ada-sama-sekali", { headers: bearer(mine.token.token) });
    await expectApiError(crossProject, 404, "PROJECT_NOT_FOUND");
    await expectApiError(missing, 404, "PROJECT_NOT_FOUND");
    expect(await crossProject.json()).toEqual(await missing.json());
  });
});

test.describe("POST runs: query (400)", () => {
  const cases: Array<[string, string, string]> = [
    ["branch tidak diisi", "", "branch"],
    ["branch kosong", "?branch=", "branch"],
    ["branch berisi karakter terlarang", "?branch=main%20dev", "branch"],
    ["branch lebih dari 200 karakter", `?branch=${"a".repeat(201)}`, "branch"],
    ["commit bukan hex", "?branch=main&commit=zzzzzzz", "commit"],
    ["commit terlalu pendek", "?branch=main&commit=abc12", "commit"],
    ["ciUrl bukan http/https", "?branch=main&ciUrl=ftp%3A%2F%2Fci.example.com", "ciUrl"],
    ["name lebih dari 120 karakter", `?branch=main&name=${"n".repeat(121)}`, "name"],
  ];
  for (const [label, query, field] of cases) {
    test(`${label} → 400 fields.${field}`, async ({ api }) => {
      const { slug, token } = await setup(api);
      await expectFieldError(await rawUpload(api, slug, { query, headers: bearer(token.token) }), field);
    });
  }
});

test.describe("POST runs: ukuran body (413)", () => {
  test("body > 5 MB (tetapi di bawah batas nginx 6 MB) → 413 PAYLOAD_TOO_LARGE berformat JSON dari API", async ({ api }) => {
    const { slug, token } = await setup(api);
    const padding = "x".repeat(5 * MB + 1024);
    const res = await rawUpload(api, slug, {
      headers: bearer(token.token),
      data: `<testsuites><testsuite><!-- ${padding} --></testsuite></testsuites>`,
    });
    await expectApiError(res, 413, "PAYLOAD_TOO_LARGE");
    expect(res.headers()["content-type"]).toContain("application/json");
  });

  test("urutan cek: token salah dengan body > 5 MB tetap 401 (body tidak dibaca)", async ({ api }) => {
    const { slug } = await setup(api);
    const res = await rawUpload(api, slug, {
      headers: bearer("tp_token-yang-tidak-pernah-dibuat-0000000000"),
      data: "x".repeat(5 * MB + 1024),
    });
    await expectApiError(res, 401, "UNAUTHENTICATED");
  });
});

test.describe("POST runs: laporan tidak valid (422)", () => {
  const reports: Array<[string, string]> = [
    ["XML rusak", "<testsuites><testsuite><testcase name='a'></testsuites>"],
    ["memuat <!DOCTYPE>", `<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><testsuites><testsuite><testcase name="&x;"/></testsuite></testsuites>`],
    ["bukan JUnit", "<html><body>halo</body></html>"],
    ["tanpa testcase", `<testsuites><testsuite name="kosong"></testsuite></testsuites>`],
    ["body kosong", ""],
  ];
  for (const [label, xml] of reports) {
    test(`${label} → 422 INVALID_REPORT`, async ({ api }) => {
      const { slug, token } = await setup(api);
      await expectApiError(await rawUpload(api, slug, { headers: bearer(token.token), data: xml }), 422, "INVALID_REPORT");
    });
  }

  test("laporan yang ditolak tidak membuat run", async ({ api }) => {
    const { owner, slug, token } = await setup(api);
    await rawUpload(api, slug, { headers: bearer(token.token), data: "<html/>" });
    const runs = await parseBody(await owner.request.get(`${API}/projects/${slug}/runs`), 200, runsPageDto);
    expect(runs.runs).toEqual([]);
  });
});

test.describe("POST runs: batas laju (429)", () => {
  // Ruling P3: 429 tidak dipaksa lewat stack (batas stack test 1000); dipastikan di integration test API. Di sini
  // dipastikan batasnya terpasang pada route upload dan menghitung per upload.
  test("respons upload memuat x-ratelimit-limit sesuai konfigurasi dan x-ratelimit-remaining yang turun", async ({ api }) => {
    const { slug, token } = await setup(api);
    const remaining: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await api.uploadRun(token.token, slug, buildJUnit([{ name: `t${i}` }]), { branch: "main" });
      await parseBody(res, 201, ingestResultDto);
      expect(Number(res.headers()["x-ratelimit-limit"])).toBe(CONFIGURED_RATE_LIMIT);
      remaining.push(Number(res.headers()["x-ratelimit-remaining"]));
    }
    expect(remaining[0]).toBeLessThan(CONFIGURED_RATE_LIMIT);
    expect(remaining[1]).toBe(remaining[0]! - 1);
    expect(remaining[2]).toBe(remaining[1]! - 1);
  });

  test("batas dihitung per token: token lain di project yang sama punya jatah sendiri", async ({ api }) => {
    const { owner, slug, token } = await setup(api);
    const second = await api.createToken(owner, slug, "kedua");
    await api.uploadRun(token.token, slug, buildJUnit([{ name: "a" }]), { branch: "main" });
    await api.uploadRun(token.token, slug, buildJUnit([{ name: "b" }]), { branch: "main" });

    const res = await api.uploadRun(second.token, slug, buildJUnit([{ name: "c" }]), { branch: "main" });
    expect(res.status()).toBe(201);
    expect(Number(res.headers()["x-ratelimit-remaining"])).toBe(CONFIGURED_RATE_LIMIT - 1);
  });
});

test.describe("GET runs: pagination dan branch", () => {
  test("20 run per halaman, nextCursor buram, halaman terakhir nextCursor null, tanpa duplikat", async ({ api }) => {
    const { owner, slug, token } = await setup(api);
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) {
      const created = await parseBody(
        await api.uploadRun(token.token, slug, buildJUnit([{ name: "a" }]), { branch: "main" }),
        201,
        ingestResultDto,
      );
      ids.push(created.runId);
    }

    const first = await parseBody(await owner.request.get(`${API}/projects/${slug}/runs`), 200, runsPageDto);
    expect(first.runs).toHaveLength(20);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.runs[0]?.id).toBe(ids[20]);

    const second = await parseBody(
      await owner.request.get(`${API}/projects/${slug}/runs`, { params: { cursor: first.nextCursor! } }),
      200,
      runsPageDto,
    );
    expect(second.runs.map((r) => r.id)).toEqual([ids[0]]);
    expect(second.nextCursor).toBeNull();
  });

  test("cursor rusak → 400 VALIDATION_ERROR fields.cursor", async ({ api }) => {
    const { owner, slug } = await setup(api);
    await expectFieldError(await owner.request.get(`${API}/projects/${slug}/runs?cursor=bukan-cursor`), "cursor");
  });

  test("detail run: 100 hasil per halaman dengan nextCursor, filter status default failed", async ({ api }) => {
    const { owner, slug, token } = await setup(api);
    const cases = Array.from({ length: 101 }, (_, i) => ({ name: `test-${String(i).padStart(3, "0")}`, status: "failed" as const }));
    const { runId } = await parseBody(
      await api.uploadRun(token.token, slug, buildJUnit([...cases, { name: "hijau" }]), { branch: "main" }),
      201,
      ingestResultDto,
    );
    const url = `${API}/projects/${slug}/runs/${runId}`;

    const page1 = await parseBody(await owner.request.get(url), 200, runDetailDto);
    expect(page1.results).toHaveLength(100);
    expect(page1.results.every((r) => r.status === "failed")).toBe(true);
    expect(page1.nextCursor).toEqual(expect.any(String));

    const page2 = await parseBody(await owner.request.get(url, { params: { cursor: page1.nextCursor! } }), 200, runDetailDto);
    expect(page2.results).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    const seen = new Set([...page1.results, ...page2.results].map((r) => r.testCaseId));
    expect(seen.size).toBe(101);

    const all = await parseBody(await owner.request.get(url, { params: { status: "all" } }), 200, runDetailDto);
    expect(all.results).toHaveLength(100);
    expect(all.nextCursor).not.toBeNull();
    await expectFieldError(await owner.request.get(`${url}?status=bukan`), "status");
  });

  test("branch ber-slash: upload, filter runs (di-encode maupun tidak), stats, flaky, dan daftar branch", async ({ api }) => {
    const { owner, slug, token } = await setup(api);
    const branch = "feature/login-ui";
    const onFeature = await parseBody(
      await api.uploadRun(token.token, slug, buildJUnit([{ name: "goyang", retries: 1 }]), { branch }),
      201,
      ingestResultDto,
    );
    await api.uploadRun(token.token, slug, buildJUnit([{ name: "lain" }]), { branch: "main" });
    const base = `${API}/projects/${slug}`;

    const encoded = await parseBody(await owner.request.get(`${base}/runs?branch=${encodeURIComponent(branch)}`), 200, runsPageDto);
    const raw = await parseBody(await owner.request.get(`${base}/runs?branch=${branch}`), 200, runsPageDto);
    expect(encoded.runs.map((r) => r.id)).toEqual([onFeature.runId]);
    expect(raw).toEqual(encoded);

    const stats = await parseBody(await owner.request.get(`${base}/stats`, { params: { branch } }), 200, statsDto);
    expect(stats).toMatchObject({ branch, latest: { id: onFeature.runId } });
    const flaky = await parseBody(await owner.request.get(`${base}/flaky`, { params: { branch } }), 200, flakyTestDto.array());
    expect(flaky.map((f) => f.name)).toEqual(["goyang"]);
    // Branch lain tidak memuat test goyang itu.
    expect(await parseBody(await owner.request.get(`${base}/flaky?branch=main`), 200, flakyTestDto.array())).toEqual([]);

    const branches = await parseBody(await owner.request.get(`${base}/branches`), 200, branchDto.array());
    expect(branches.map((b) => b.branch).sort()).toEqual([branch, "main"]);
  });
});

test.describe("DELETE /projects/:slug/runs/:runId dan 404 sumber daya", () => {
  test("tester menghapus run → 204; run hilang (404 RUN_NOT_FOUND) dan hapus ulang juga 404", async ({ api }) => {
    const { owner, slug, token } = await setup(api);
    const tester = await api.addMember(owner, slug, "tester");
    const { runId } = await parseBody(
      await api.uploadRun(token.token, slug, buildJUnit([{ name: "a" }]), { branch: "main" }),
      201,
      ingestResultDto,
    );
    const url = `${API}/projects/${slug}/runs/${runId}`;

    expect((await tester.request.delete(url)).status()).toBe(204);
    await expectApiError(await owner.request.get(url), 404, "RUN_NOT_FOUND");
    await expectApiError(await tester.request.delete(url), 404, "RUN_NOT_FOUND");
    expect((await parseBody(await owner.request.get(`${API}/projects/${slug}/runs`), 200, runsPageDto)).runs).toEqual([]);
  });

  test("run dari project lain atau id bukan UUID → 404 RUN_NOT_FOUND", async ({ api }) => {
    const mine = await setup(api);
    const other = await setup(api);
    const { runId } = await parseBody(
      await api.uploadRun(other.token.token, other.slug, buildJUnit([{ name: "a" }]), { branch: "main" }),
      201,
      ingestResultDto,
    );

    await expectApiError(await mine.owner.request.get(`${API}/projects/${mine.slug}/runs/${runId}`), 404, "RUN_NOT_FOUND");
    await expectApiError(await mine.owner.request.delete(`${API}/projects/${mine.slug}/runs/${runId}`), 404, "RUN_NOT_FOUND");
    await expectApiError(await mine.owner.request.get(`${API}/projects/${mine.slug}/runs/bukan-uuid`), 404, "RUN_NOT_FOUND");
    // Run milik project lain tetap utuh.
    expect((await other.owner.request.get(`${API}/projects/${other.slug}/runs/${runId}`)).status()).toBe(200);
  });

  test("riwayat test yang tidak ada → 404 TEST_NOT_FOUND", async ({ api }) => {
    const { owner, slug } = await setup(api);
    const code: ErrorCode = "TEST_NOT_FOUND";
    await expectApiError(
      await owner.request.get(`${API}/projects/${slug}/tests/00000000-0000-4000-8000-000000000000/history`),
      404,
      code,
    );
    await expectApiError(await owner.request.get(`${API}/projects/${slug}/tests/bukan-uuid/history`), 404, code);
  });
});
