import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";
import {
  BRANCH,
  COOKIE_HEADERS,
  MISSING_RUN_ID,
  PROJECT_SLUG,
  RUN_ID,
  STATE,
  TEST_CASE_ID,
  clientFor,
  createPact,
  dateTime,
  errorBody,
  text,
  uuidLike,
} from "./pact.js";

const pact = createPact();
const { eachLike, integer, number, regex } = MatchersV3;

const BASE = `/api/v1/projects/${PROJECT_SLUG}`;
const status = (example: "passed" | "failed" | "skipped") => regex(/^(passed|failed|skipped)$/, example);

/** RunSummaryDto dari state `runSeeded`: dua test (satu gagal, satu lulus-setelah-retry = flaky). */
const runSummary = {
  id: uuidLike(RUN_ID),
  branch: text(BRANCH),
  commitSha: text("abcdef1"),
  ciUrl: null,
  name: null,
  createdAt: dateTime(),
  durationMs: integer(1500),
  total: integer(2),
  passed: integer(1),
  failed: integer(1),
  skipped: integer(0),
  flaky: integer(1),
};

describe("kontrak hasil test", () => {
  it("GET /projects/:slug/branches mengembalikan branch beserta run terakhirnya (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.runSeeded)
      .uponReceiving("daftar branch project")
      .withRequest("GET", `${BASE}/branches`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(eachLike({ branch: text(BRANCH), lastRun: runSummary })))
      .executeTest(async (server) => {
        const branches = await clientFor(server, true).results.branches(PROJECT_SLUG);
        expect(branches.map((b) => b.branch)).toEqual([BRANCH]);
        expect(branches[0]?.lastRun.id).toBe(RUN_ID);
      });
  });

  it("GET /projects/:slug/runs?branch= mengembalikan satu halaman run (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.runSeeded)
      .uponReceiving("daftar run pada satu branch")
      .withRequest("GET", `${BASE}/runs`, (b) => b.headers(COOKIE_HEADERS).query({ branch: BRANCH }))
      .willRespondWith(200, (b) => b.jsonBody({ runs: eachLike(runSummary), nextCursor: null }))
      .executeTest(async (server) => {
        const page = await clientFor(server, true).results.runs(PROJECT_SLUG, { branch: BRANCH });
        expect(page.runs.map((r) => r.id)).toEqual([RUN_ID]);
        expect(page.nextCursor).toBeNull();
      });
  });

  it("GET /projects/:slug/runs/:runId?status=failed mengembalikan ringkasan run dan hasil yang gagal (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.runSeeded)
      .uponReceiving("detail run dengan hasil yang gagal")
      .withRequest("GET", `${BASE}/runs/${RUN_ID}`, (b) => b.headers(COOKIE_HEADERS).query({ status: "failed" }))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          run: runSummary,
          results: eachLike({
            testCaseId: uuidLike(TEST_CASE_ID),
            suite: text("login"),
            name: text("gagal"),
            status: status("failed"),
            flakyInRun: MatchersV3.boolean(false),
            retries: integer(0),
            durationMs: integer(500),
            message: text("Assertion gagal"),
          }),
          nextCursor: null,
        }),
      )
      .executeTest(async (server) => {
        const detail = await clientFor(server, true).results.run(PROJECT_SLUG, RUN_ID, { status: "failed" });
        expect(detail.run.id).toBe(RUN_ID);
        expect(detail.results.map((r) => r.name)).toEqual(["gagal"]);
      });
  });

  it("GET /projects/:slug/runs/:runId yang tidak ada -> 404 RUN_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("detail run yang tidak ada")
      .withRequest("GET", `${BASE}/runs/${MISSING_RUN_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("RUN_NOT_FOUND", "Run tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).results.run(PROJECT_SLUG, MISSING_RUN_ID)).rejects.toMatchObject({
          status: 404,
          code: "RUN_NOT_FOUND",
        });
      });
  });

  it("DELETE /projects/:slug/runs/:runId menghapus run (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.runSeeded)
      .uponReceiving("menghapus run")
      .withRequest("DELETE", `${BASE}/runs/${RUN_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).results.deleteRun(PROJECT_SLUG, RUN_ID)).resolves.toBeUndefined();
      });
  });

  it("DELETE /projects/:slug/runs/:runId yang tidak ada -> 404 RUN_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("menghapus run yang tidak ada")
      .withRequest("DELETE", `${BASE}/runs/${MISSING_RUN_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("RUN_NOT_FOUND", "Run tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).results.deleteRun(PROJECT_SLUG, MISSING_RUN_ID)).rejects.toMatchObject({
          status: 404,
          code: "RUN_NOT_FOUND",
        });
      });
  });

  it("GET /projects/:slug/stats?branch= mengembalikan titik tren dan run terakhir (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.runSeeded)
      .uponReceiving("statistik tren branch")
      .withRequest("GET", `${BASE}/stats`, (b) => b.headers(COOKIE_HEADERS).query({ branch: BRANCH }))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          branch: text(BRANCH),
          points: eachLike({
            runId: uuidLike(RUN_ID),
            createdAt: dateTime(),
            passRate: number(50),
            durationMs: integer(1500),
          }),
          latest: runSummary,
        }),
      )
      .executeTest(async (server) => {
        const stats = await clientFor(server, true).results.stats(PROJECT_SLUG, BRANCH);
        expect(stats.branch).toBe(BRANCH);
        expect(stats.points[0]?.passRate).toBe(50);
        expect(stats.latest?.id).toBe(RUN_ID);
      });
  });

  it("GET /projects/:slug/flaky?branch= mengembalikan test flaky (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.runSeeded)
      .uponReceiving("daftar test flaky")
      .withRequest("GET", `${BASE}/flaky`, (b) => b.headers(COOKIE_HEADERS).query({ branch: BRANCH }))
      .willRespondWith(200, (b) =>
        b.jsonBody(
          eachLike({
            testCaseId: uuidLike(TEST_CASE_ID),
            suite: text("login"),
            name: text("goyang"),
            score: integer(100),
            lastStatus: status("passed"),
          }),
        ),
      )
      .executeTest(async (server) => {
        const flaky = await clientFor(server, true).results.flaky(PROJECT_SLUG, BRANCH);
        expect(flaky.map((t) => t.testCaseId)).toEqual([TEST_CASE_ID]);
      });
  });

  it("GET /projects/:slug/tests/:testCaseId/history mengembalikan riwayat hasil test (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.runSeeded)
      .uponReceiving("riwayat satu test")
      .withRequest("GET", `${BASE}/tests/${TEST_CASE_ID}/history`, (b) =>
        b.headers(COOKIE_HEADERS).query({ branch: BRANCH }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          testCase: { id: uuidLike(TEST_CASE_ID), suite: text("login"), name: text("goyang") },
          branch: text(BRANCH),
          results: eachLike({
            runId: uuidLike(RUN_ID),
            createdAt: dateTime(),
            status: status("passed"),
            flakyInRun: MatchersV3.boolean(true),
            retries: integer(1),
            durationMs: integer(1000),
          }),
        }),
      )
      .executeTest(async (server) => {
        const history = await clientFor(server, true).results.history(PROJECT_SLUG, TEST_CASE_ID, BRANCH);
        expect(history.testCase.id).toBe(TEST_CASE_ID);
        expect(history.results.map((r) => r.runId)).toEqual([RUN_ID]);
      });
  });
});
