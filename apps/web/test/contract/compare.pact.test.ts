import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";
import {
  BASE_RUN_ID,
  BRANCH,
  COOKIE_HEADERS,
  MISSING_RUN_ID,
  PROJECT_SLUG,
  REGRESSION_TEST_ID,
  STATE,
  TARGET_RUN_ID,
  clientFor,
  createPact,
  dateTime,
  errorBody,
  text,
  uuidLike,
} from "./pact.js";

const pact = createPact();
const { eachLike, fromProviderState, integer, number, regex } = MatchersV3;

const BASE = `/api/v1/projects/${PROJECT_SLUG}`;
const resultStatus = (example: "passed" | "failed" | "skipped") => regex(/^(passed|failed|skipped)$/, example);

/** RunSummaryDto dari state `compareSeeded`; `version` terisi dan `total`/`passed`/`failed` mengikuti state. */
const runSummary = (id: string, version: string, passed: number, failed: number) => ({
  id: uuidLike(id),
  branch: text(BRANCH),
  commitSha: text("aaaaaaa"),
  ciUrl: null,
  name: null,
  createdAt: dateTime(),
  durationMs: integer(2000),
  total: integer(2),
  passed: integer(passed),
  failed: integer(failed),
  skipped: integer(0),
  flaky: integer(0),
  version: text(version),
});

/** ManualRunRef (Tahap 4 §5.1) dari state `manualVersionsSeeded`; hitungan yang tidak disebut = 0. */
const manualRef = (runNumber: number, name: string, counts: Partial<Record<"untested" | "passed", number>>) => {
  const untested = counts.untested ?? 0;
  const passed = counts.passed ?? 0;
  return {
    number: integer(runNumber),
    name: text(name),
    status: regex(/^(open|completed)$/, "open"),
    total: integer(untested + passed),
    counts: { untested: integer(untested), passed: integer(passed), failed: integer(0), blocked: integer(0), skipped: integer(0) },
  };
};

const baseRun = runSummary(BASE_RUN_ID, "1.0.0", 2, 0);
const targetRun = runSummary(TARGET_RUN_ID, "1.0.1", 1, 1);

const emptyGroup = { items: [], nextCursor: null };

/** Satu regresi: "A regresi" lulus di v1.0.0 lalu gagal di v1.0.1. */
const regressionItem = {
  testCaseId: uuidLike(REGRESSION_TEST_ID),
  suite: text("checkout"),
  name: text("A regresi"),
  base: {
    status: resultStatus("passed"),
    durationMs: integer(1000),
    message: null,
    flakyInRun: MatchersV3.boolean(false),
  },
  target: {
    status: resultStatus("failed"),
    durationMs: integer(1000),
    message: text("Diharapkan 200 tetapi 500"),
    flakyInRun: MatchersV3.boolean(false),
  },
  bugs: [],
};

const summary = { regressions: integer(1), fixed: integer(0), stillFailing: integer(0), slower: integer(0), added: integer(0), removed: integer(0) };

describe("kontrak versi dan perbandingan", () => {
  it("GET /projects/:slug/versions?branch= mengembalikan versi tertinggi dulu dengan pass rate (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.compareSeeded)
      .uponReceiving("daftar versi pada satu branch")
      .withRequest("GET", `${BASE}/versions`, (b) => b.headers(COOKIE_HEADERS).query({ branch: BRANCH }))
      .willRespondWith(200, (b) =>
        b.jsonBody([
          {
            version: text("1.0.1"),
            run: targetRun,
            runCount: integer(1),
            passRate: number(50),
            passRateDelta: number(-50),
            manual: null,
          },
          { version: text("1.0.0"), run: baseRun, runCount: integer(1), passRate: number(100), passRateDelta: null, manual: null },
        ]),
      )
      .executeTest(async (server) => {
        const versions = await clientFor(server, true).results.versions(PROJECT_SLUG, BRANCH);
        expect(versions.map((v) => v.version)).toEqual(["1.0.1", "1.0.0"]);
        expect(versions[0]).toMatchObject({ passRate: 50, passRateDelta: -50, manual: null });
        expect(versions[1]?.passRateDelta).toBeNull();
      });
  });

  it("GET /projects/:slug/versions?branch= memuat run manual per versi dan baris manual-saja (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.compareSeeded)
      .given(STATE.manualVersionsSeeded)
      .uponReceiving("daftar versi dengan run manual")
      .withRequest("GET", `${BASE}/versions`, (b) => b.headers(COOKIE_HEADERS).query({ branch: BRANCH }))
      .willRespondWith(200, (b) =>
        b.jsonBody([
          {
            version: text("1.0.1"),
            run: targetRun,
            runCount: integer(1),
            passRate: number(50),
            passRateDelta: number(-50),
            manual: manualRef(1, "Regresi 1.0.1", { untested: 1, passed: 1 }),
          },
          { version: text("1.0.0"), run: baseRun, runCount: integer(1), passRate: number(100), passRateDelta: null, manual: null },
          // Versi yang hanya punya run manual: tanpa run CI, ditaruh di posisi semver-nya.
          {
            version: text("0.9.0"),
            run: null,
            runCount: integer(0),
            passRate: null,
            passRateDelta: null,
            manual: manualRef(2, "Eksplorasi 0.9", {}),
          },
        ]),
      )
      .executeTest(async (server) => {
        const versions = await clientFor(server, true).results.versions(PROJECT_SLUG, BRANCH);
        expect(versions.map((v) => [v.version, v.run?.id ?? null, v.manual?.number ?? null])).toEqual([
          ["1.0.1", TARGET_RUN_ID, 1],
          ["1.0.0", BASE_RUN_ID, null],
          ["0.9.0", null, 2],
        ]);
        expect(versions[0]?.manual).toMatchObject({ total: 2, counts: { untested: 1, passed: 1, failed: 0 } });
      });
  });

  it("GET /projects/:slug/compare memakai pembanding default dan memuat enam kelompok (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.compareSeeded)
      .uponReceiving("perbandingan default pada branch terbaru")
      .withRequest("GET", `${BASE}/compare`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          base: baseRun,
          target: targetRun,
          summary,
          groups: {
            regressions: { items: [regressionItem], nextCursor: null },
            fixed: emptyGroup,
            stillFailing: emptyGroup,
            slower: emptyGroup,
            added: emptyGroup,
            removed: emptyGroup,
          },
        }),
      )
      .executeTest(async (server) => {
        const compare = await clientFor(server, true).results.compare(PROJECT_SLUG);
        expect(compare.base?.id).toBe(BASE_RUN_ID);
        expect(compare.target?.id).toBe(TARGET_RUN_ID);
        expect(compare.summary).toEqual({ regressions: 1, fixed: 0, stillFailing: 0, slower: 0, added: 0, removed: 0 });
        expect(compare.groups.regressions.items.map((item) => item.name)).toEqual(["A regresi"]);
      });
  });

  it("GET /projects/:slug/compare?groups=none hanya mengembalikan ringkasan angka (200)", async () => {
    // Dipakai kartu dashboard dan panel detail run: semua kelompok kosong meski ringkasan terisi.
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.compareSeeded)
      .uponReceiving("ringkasan perbandingan tanpa kelompok")
      .withRequest("GET", `${BASE}/compare`, (b) => b.headers(COOKIE_HEADERS).query({ groups: "none" }))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          base: baseRun,
          target: targetRun,
          summary,
          groups: {
            regressions: emptyGroup,
            fixed: emptyGroup,
            stillFailing: emptyGroup,
            slower: emptyGroup,
            added: emptyGroup,
            removed: emptyGroup,
          },
        }),
      )
      .executeTest(async (server) => {
        const compare = await clientFor(server, true).results.compare(PROJECT_SLUG, { groups: "none" });
        expect(compare.summary.regressions).toBe(1);
        expect(compare.groups.regressions).toEqual({ items: [], nextCursor: null });
      });
  });

  it("GET /projects/:slug/compare?base=&target= membandingkan dua run yang dipilih (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.compareSeeded)
      .uponReceiving("perbandingan dua run eksplisit")
      .withRequest("GET", `${BASE}/compare`, (b) =>
        b.headers(COOKIE_HEADERS).query({ base: BASE_RUN_ID, target: TARGET_RUN_ID }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          base: baseRun,
          target: targetRun,
          summary,
          groups: {
            regressions: { items: eachLike(regressionItem), nextCursor: null },
            fixed: emptyGroup,
            stillFailing: emptyGroup,
            slower: emptyGroup,
            added: emptyGroup,
            removed: emptyGroup,
          },
        }),
      )
      .executeTest(async (server) => {
        const compare = await clientFor(server, true).results.compare(PROJECT_SLUG, {
          base: BASE_RUN_ID,
          target: TARGET_RUN_ID,
        });
        expect(compare.groups.regressions.items[0]?.testCaseId).toBe(REGRESSION_TEST_ID);
      });
  });

  it("GET /projects/:slug/compare?group=&cursor= memuat halaman berikutnya satu kelompok (200)", async () => {
    // Cursor dibuat provider dengan encoder API sendiri (item ke-200 kelompok regresi) lalu disuntikkan ke request;
    // contoh di sini hanya untuk mock server consumer. Bentuknya tetap rahasia API: klien meneruskannya apa adanya.
    const exampleCursor = Buffer.from(
      JSON.stringify([BASE_RUN_ID, TARGET_RUN_ID, "checkout", "R200", REGRESSION_TEST_ID]),
    ).toString("base64url");
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manyRegressions)
      .uponReceiving("halaman kedua kelompok regresi dengan cursor")
      .withRequest("GET", `${BASE}/compare`, (b) =>
        b.headers(COOKIE_HEADERS).query({
          base: BASE_RUN_ID,
          target: TARGET_RUN_ID,
          group: "regressions",
          cursor: fromProviderState("${cursor}", exampleCursor),
        }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          items: eachLike(
            {
              testCaseId: uuidLike(REGRESSION_TEST_ID),
              suite: text("checkout"),
              name: text("R201"),
              base: { status: resultStatus("passed"), durationMs: integer(1000), message: null, flakyInRun: MatchersV3.boolean(false) },
              target: {
                status: resultStatus("failed"),
                durationMs: integer(1000),
                message: text("R201 gagal"),
                flakyInRun: MatchersV3.boolean(false),
              },
              bugs: [],
            },
            1,
          ),
          nextCursor: null,
        }),
      )
      .executeTest(async (server) => {
        const page = await clientFor(server, true).results.compareGroup(PROJECT_SLUG, {
          base: BASE_RUN_ID,
          target: TARGET_RUN_ID,
          group: "regressions",
          cursor: exampleCursor,
        });
        expect(page.items[0]?.name).toBe("R201");
        expect(page.nextCursor).toBeNull();
      });
  });

  it("GET /projects/:slug/compare dengan run yang tidak ada -> 404 RUN_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.compareSeeded)
      .uponReceiving("perbandingan dengan run target yang tidak ada")
      .withRequest("GET", `${BASE}/compare`, (b) => b.headers(COOKIE_HEADERS).query({ target: MISSING_RUN_ID }))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("RUN_NOT_FOUND", "Run tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).results.compare(PROJECT_SLUG, { target: MISSING_RUN_ID }),
        ).rejects.toMatchObject({ status: 404, code: "RUN_NOT_FOUND" });
      });
  });
});
