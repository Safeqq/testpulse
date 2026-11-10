import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";
import {
  BUDI_ID,
  COOKIE_HEADERS,
  EMPTY_SUITE_ID,
  JSON_COOKIE_HEADERS,
  MISSING_UUID,
  OWNER_ID,
  PROJECT_SLUG,
  RUN_CASE_2_ID,
  RUN_CASE_ID,
  RUN_ID,
  STATE,
  SUITE_ID,
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
const MISSING_CASE_NUMBER = 99;
const MISSING_RUN_NUMBER = 99;

const oneOf = <T extends string>(values: readonly T[], example: T) =>
  regex(new RegExp(`^(${values.join("|")})$`), example);
const priority = (example: "low" | "medium" | "high" | "urgent") => oneOf(["low", "medium", "high", "urgent"], example);
const resultStatus = (example: "untested" | "passed" | "failed" | "blocked" | "skipped") =>
  oneOf(["untested", "passed", "failed", "blocked", "skipped"], example);
const runStatus = (example: "open" | "completed") => oneOf(["open", "completed"], example);

const owner = { id: uuidLike(OWNER_ID), name: text("Pemilik") };
const budi = { id: uuidLike(BUDI_ID), name: text("Budi") };

/** Langkah case dari state `manualSeeded` (TC-1 dua langkah, TC-2 hanya yang pertama). */
const steps = [
  { action: text("Buka halaman bayar"), expected: text("Form bayar tampil") },
  { action: text("Klik Bayar"), expected: text("Pembayaran berhasil") },
];

const suiteDtoBody = (id: string, name: string, counts: { active: number; archived?: number }, position = 0) => ({
  id: uuidLike(id),
  name: text(name),
  description: text(""),
  position: integer(position),
  activeCount: integer(counts.active),
  archivedCount: integer(counts.archived ?? 0),
});

/** Item daftar case TC-1 (suite Checkout, tertaut ke test otomatis). */
const caseListItem = {
  number: integer(1),
  title: text("Bayar dengan kartu"),
  suite: { id: uuidLike(SUITE_ID), name: text("Checkout") },
  priority: priority("high"),
  labels: eachLike(text("ui")),
  stepCount: integer(2),
  automated: MatchersV3.boolean(true),
  archived: MatchersV3.boolean(false),
  updatedAt: dateTime(),
};

/** ManualCaseDto TC-1; `version` mengikuti state (1) dan naik pada hasil PATCH. */
const caseDetail = (version: number) => ({
  number: integer(1),
  suite: { id: uuidLike(SUITE_ID), name: text("Checkout") },
  title: text("Bayar dengan kartu"),
  preconditions: text("Keranjang berisi satu barang"),
  steps,
  priority: priority("high"),
  labels: eachLike(text("ui")),
  archivedAt: null,
  createdBy: owner,
  updatedBy: owner,
  createdAt: dateTime(),
  updatedAt: dateTime(),
  version: integer(version),
  automatedTest: {
    id: uuidLike(TEST_CASE_ID),
    suite: text("login"),
    name: text("goyang"),
    lastResult: {
      status: oneOf(["passed", "failed", "skipped"], "passed"),
      runId: uuidLike(RUN_ID),
      createdAt: dateTime(),
      branch: text("main"),
    },
  },
  recentResults: eachLike({
    runCaseId: uuidLike(RUN_CASE_ID),
    runNumber: integer(1),
    runName: text("Regresi 1.0.1"),
    appVersion: text("v1.0.1"),
    status: resultStatus("untested"),
    executedAt: null,
  }),
});

const counts = (c: Partial<Record<"untested" | "passed" | "failed" | "blocked" | "skipped", number>>) => ({
  untested: integer(c.untested ?? 0),
  passed: integer(c.passed ?? 0),
  failed: integer(c.failed ?? 0),
  blocked: integer(c.blocked ?? 0),
  skipped: integer(c.skipped ?? 0),
});

/** ManualRunSummaryDto; `completedAt` hanya terisi pada run selesai. */
const runSummary = (n: number, name: string, appVersion: string, status: "open" | "completed", total: number) => ({
  number: integer(n),
  name: text(name),
  appVersion: text(appVersion),
  status: runStatus(status),
  total: integer(total),
  counts: counts({ untested: total }),
  progress: number(0),
  createdBy: owner,
  createdAt: dateTime(),
  completedAt: status === "completed" ? dateTime() : null,
});

/** ManualRunDto = ringkasan + audit dan concurrency. */
const runDetail = (
  n: number,
  name: string,
  appVersion: string,
  status: "open" | "completed",
  total: number,
  version: number,
) => ({
  ...runSummary(n, name, appVersion, status, total),
  completedBy: status === "completed" ? owner : null,
  updatedAt: dateTime(),
  version: integer(version),
});

/** RunCaseListItemDto TC-1 (run case pertama, `untested`). */
const runCaseListItem = (id: string, caseNumber: number, title: string, status: "untested" | "passed") => ({
  id: uuidLike(id),
  position: integer(caseNumber - 1),
  caseNumber: integer(caseNumber),
  title: text(title),
  suiteName: text("Checkout"),
  priority: priority(caseNumber === 1 ? "high" : "medium"),
  status: resultStatus(status),
  assignee: null,
  executedAt: status === "passed" ? dateTime() : null,
  bugs: [],
});

/** RunCaseDto TC-1 (dua langkah); hasil PATCH mengisi langkah, status, dan eksekutor. */
const runCaseDetail = (opts: { status: "untested" | "passed"; version: number; runState: "open" | "completed" }) => ({
  ...runCaseListItem(RUN_CASE_ID, 1, "Bayar dengan kartu", opts.status),
  preconditions: text("Keranjang berisi satu barang"),
  steps,
  stepResults: [
    { status: opts.status === "passed" ? oneOf(["passed", "failed", "blocked", "skipped"], "passed") : null, note: text("") },
    { status: opts.status === "passed" ? oneOf(["passed", "failed", "blocked", "skipped"], "passed") : null, note: text("") },
  ],
  note: text(""),
  executedBy: opts.status === "passed" ? budi : null,
  version: integer(opts.version),
  updatedAt: dateTime(),
  nextUntestedId: uuidLike(RUN_CASE_2_ID),
  caseId: uuidLike("18181818-1818-4818-8818-181818181818"),
  runStatus: runStatus(opts.runState),
});

describe("kontrak test manual: suite", () => {
  it("GET /projects/:slug/suites mengembalikan suite beserta jumlah case (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("daftar suite")
      .withRequest("GET", `${BASE}/suites`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody([{ ...suiteDtoBody(SUITE_ID, "Checkout", { active: 2 }), description: text("Alur bayar") }]))
      .executeTest(async (server) => {
        const suites = await clientFor(server, true).manual.suites.list(PROJECT_SLUG);
        expect(suites).toMatchObject([{ id: SUITE_ID, name: "Checkout", activeCount: 2, archivedCount: 0 }]);
      });
  });

  it("POST /projects/:slug/suites membuat suite di posisi pertama (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("membuat suite")
      .withRequest("POST", `${BASE}/suites`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ name: "Pembayaran" }))
      .willRespondWith(201, (b) => b.jsonBody(suiteDtoBody("17171717-1717-4717-8717-171717171717", "Pembayaran", { active: 0 })))
      .executeTest(async (server) => {
        const suite = await clientFor(server, true).manual.suites.create(PROJECT_SLUG, { name: "Pembayaran" });
        expect(suite).toMatchObject({ name: "Pembayaran", position: 0, activeCount: 0 });
      });
  });

  it("PATCH /projects/:slug/suites/:id mengganti nama suite (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("mengganti nama suite")
      .withRequest("PATCH", `${BASE}/suites/${SUITE_ID}`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ name: "Checkout v2" }))
      .willRespondWith(200, (b) => b.jsonBody({ ...suiteDtoBody(SUITE_ID, "Checkout v2", { active: 2 }), description: text("Alur bayar") }))
      .executeTest(async (server) => {
        const suite = await clientFor(server, true).manual.suites.update(PROJECT_SLUG, SUITE_ID, { name: "Checkout v2" });
        expect(suite).toMatchObject({ id: SUITE_ID, name: "Checkout v2" });
      });
  });

  it("PATCH /projects/:slug/suites/:id yang tidak ada -> 404 SUITE_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("mengubah suite yang tidak ada")
      .withRequest("PATCH", `${BASE}/suites/${MISSING_UUID}`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ name: "Apa saja" }))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("SUITE_NOT_FOUND", "Suite tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).manual.suites.update(PROJECT_SLUG, MISSING_UUID, { name: "Apa saja" }),
        ).rejects.toMatchObject({ status: 404, code: "SUITE_NOT_FOUND" });
      });
  });

  it("DELETE /projects/:slug/suites/:id menghapus suite kosong sebagai admin (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.emptySuite)
      .uponReceiving("menghapus suite kosong")
      .withRequest("DELETE", `${BASE}/suites/${EMPTY_SUITE_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).manual.suites.remove(PROJECT_SLUG, EMPTY_SUITE_ID)).resolves.toBeUndefined();
      });
  });

  it("DELETE /projects/:slug/suites/:id pada suite berisi case -> 409 SUITE_NOT_EMPTY", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("menghapus suite yang masih berisi case")
      .withRequest("DELETE", `${BASE}/suites/${SUITE_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(409, (b) =>
        b.jsonBody(errorBody("SUITE_NOT_EMPTY", "Pindahkan atau hapus case di suite ini terlebih dahulu.")),
      )
      .executeTest(async (server) => {
        await expect(clientFor(server, true).manual.suites.remove(PROJECT_SLUG, SUITE_ID)).rejects.toMatchObject({
          status: 409,
          code: "SUITE_NOT_EMPTY",
        });
      });
  });
});

describe("kontrak test manual: case", () => {
  it("GET /projects/:slug/cases mengembalikan satu halaman case beserta cakupan otomasi (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("daftar case")
      .withRequest("GET", `${BASE}/cases`, (b) => b.headers(COOKIE_HEADERS).query({ automated: "yes" }))
      .willRespondWith(200, (b) =>
        b.jsonBody({ items: eachLike(caseListItem), nextCursor: null, coverage: { active: integer(2), automated: integer(1) } }),
      )
      .executeTest(async (server) => {
        const page = await clientFor(server, true).manual.cases.list(PROJECT_SLUG, { automated: "yes" });
        expect(page.items.map((item) => item.number)).toEqual([1]);
        expect(page.coverage).toEqual({ active: 2, automated: 1 });
        expect(page.nextCursor).toBeNull();
      });
  });

  it("GET /projects/:slug/cases/labels mengembalikan label yang dipakai case (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("daftar label case")
      .withRequest("GET", `${BASE}/cases/labels`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(eachLike(text("ui"))))
      .executeTest(async (server) => {
        expect(await clientFor(server, true).manual.cases.labels(PROJECT_SLUG)).toEqual(["ui"]);
      });
  });

  it("GET /projects/:slug/cases/:number mengembalikan detail beserta test otomatis dan riwayat (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("detail case TC-1")
      .withRequest("GET", `${BASE}/cases/1`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(caseDetail(1)))
      .executeTest(async (server) => {
        const testCase = await clientFor(server, true).manual.cases.get(PROJECT_SLUG, 1);
        expect(testCase).toMatchObject({ number: 1, version: 1, labels: ["ui"] });
        expect(testCase.automatedTest?.id).toBe(TEST_CASE_ID);
        expect(testCase.recentResults[0]).toMatchObject({ runCaseId: RUN_CASE_ID, runNumber: 1, status: "untested" });
      });
  });

  it("GET /projects/:slug/cases/:number yang tidak ada -> 404 CASE_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("detail case yang tidak ada")
      .withRequest("GET", `${BASE}/cases/${MISSING_CASE_NUMBER}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("CASE_NOT_FOUND", "Case tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).manual.cases.get(PROJECT_SLUG, MISSING_CASE_NUMBER)).rejects.toMatchObject({
          status: 404,
          code: "CASE_NOT_FOUND",
        });
      });
  });

  it("POST /projects/:slug/cases membuat case dengan nomor berikutnya (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("membuat case")
      .withRequest("POST", `${BASE}/cases`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({
          suiteId: SUITE_ID,
          title: "Bayar dengan e-wallet",
          steps: [{ action: "Pilih e-wallet", expected: "Halaman e-wallet tampil" }],
        }),
      )
      .willRespondWith(201, (b) =>
        b.jsonBody({
          ...caseDetail(1),
          number: integer(3),
          title: text("Bayar dengan e-wallet"),
          preconditions: text(""),
          steps: [{ action: text("Pilih e-wallet"), expected: text("Halaman e-wallet tampil") }],
          priority: priority("medium"),
          labels: [],
          createdBy: budi,
          updatedBy: budi,
          automatedTest: null,
          recentResults: [],
        }),
      )
      .executeTest(async (server) => {
        const created = await clientFor(server, true).manual.cases.create(PROJECT_SLUG, {
          suiteId: SUITE_ID,
          title: "Bayar dengan e-wallet",
          steps: [{ action: "Pilih e-wallet", expected: "Halaman e-wallet tampil" }],
        });
        expect(created).toMatchObject({ number: 3, priority: "medium", labels: [], automatedTest: null, version: 1 });
      });
  });

  it("PATCH /projects/:slug/cases/:number mengubah prioritas dan menaikkan version (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("mengubah case")
      .withRequest("PATCH", `${BASE}/cases/1`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 1, priority: "urgent" }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({ ...caseDetail(2), priority: priority("urgent"), updatedBy: budi }),
      )
      .executeTest(async (server) => {
        const updated = await clientFor(server, true).manual.cases.update(PROJECT_SLUG, 1, { version: 1, priority: "urgent" });
        expect(updated).toMatchObject({ number: 1, version: 2, priority: "urgent" });
      });
  });

  it("PATCH /projects/:slug/cases/:number dengan versi usang -> 409 CASE_CONFLICT", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("mengubah case dengan versi usang")
      .withRequest("PATCH", `${BASE}/cases/1`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 99, priority: "low" }),
      )
      .willRespondWith(409, (b) =>
        b.jsonBody(errorBody("CASE_CONFLICT", "Case sudah diubah orang lain. Muat ulang untuk melihat versi terbaru")),
      )
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).manual.cases.update(PROJECT_SLUG, 1, { version: 99, priority: "low" }),
        ).rejects.toMatchObject({ status: 409, code: "CASE_CONFLICT" });
      });
  });

  it("PATCH /projects/:slug/cases/:number yang tidak ada -> 404 CASE_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("mengubah case yang tidak ada")
      .withRequest("PATCH", `${BASE}/cases/${MISSING_CASE_NUMBER}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 1, priority: "low" }),
      )
      .willRespondWith(404, (b) => b.jsonBody(errorBody("CASE_NOT_FOUND", "Case tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).manual.cases.update(PROJECT_SLUG, MISSING_CASE_NUMBER, { version: 1, priority: "low" }),
        ).rejects.toMatchObject({ status: 404, code: "CASE_NOT_FOUND" });
      });
  });

  it("DELETE /projects/:slug/cases/:number menghapus case sebagai admin (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("menghapus case")
      .withRequest("DELETE", `${BASE}/cases/2`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).manual.cases.remove(PROJECT_SLUG, 2)).resolves.toBeUndefined();
      });
  });

  it("DELETE /projects/:slug/cases/:number yang tidak ada -> 404 CASE_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("menghapus case yang tidak ada")
      .withRequest("DELETE", `${BASE}/cases/${MISSING_CASE_NUMBER}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("CASE_NOT_FOUND", "Case tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).manual.cases.remove(PROJECT_SLUG, MISSING_CASE_NUMBER)).rejects.toMatchObject({
          status: 404,
          code: "CASE_NOT_FOUND",
        });
      });
  });

  it("GET /projects/:slug/tests?q= mencari test otomatis berdasarkan nama (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.runSeeded)
      .uponReceiving("cari test otomatis")
      .withRequest("GET", `${BASE}/tests`, (b) => b.headers(COOKIE_HEADERS).query({ q: "goy" }))
      .willRespondWith(200, (b) =>
        b.jsonBody(eachLike({ id: uuidLike(TEST_CASE_ID), suite: text("login"), name: text("goyang") })),
      )
      .executeTest(async (server) => {
        const found = await clientFor(server, true).manual.searchTests(PROJECT_SLUG, "goy");
        expect(found).toEqual([{ id: TEST_CASE_ID, suite: "login", name: "goyang" }]);
      });
  });
});

describe("kontrak test manual: run manual", () => {
  it("GET /projects/:slug/manual-runs mengembalikan satu halaman run (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("daftar run manual")
      .withRequest("GET", `${BASE}/manual-runs`, (b) => b.headers(COOKIE_HEADERS).query({ status: "open" }))
      .willRespondWith(200, (b) =>
        b.jsonBody({ items: eachLike(runSummary(1, "Regresi 1.0.1", "v1.0.1", "open", 2)), nextCursor: null }),
      )
      .executeTest(async (server) => {
        const page = await clientFor(server, true).manual.runs.list(PROJECT_SLUG, { status: "open" });
        expect(page.items.map((run) => run.number)).toEqual([1]);
        expect(page.items[0]).toMatchObject({ total: 2, counts: { untested: 2 }, progress: 0 });
        expect(page.nextCursor).toBeNull();
      });
  });

  it("POST /projects/:slug/manual-runs membuat run dari nomor case (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("membuat run manual")
      .withRequest("POST", `${BASE}/manual-runs`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ name: "Regresi 1.0.2", appVersion: "v1.0.2", caseNumbers: [1] }),
      )
      .willRespondWith(201, (b) =>
        b.jsonBody({ ...runDetail(2, "Regresi 1.0.2", "v1.0.2", "open", 1, 1), createdBy: budi }),
      )
      .executeTest(async (server) => {
        const run = await clientFor(server, true).manual.runs.create(PROJECT_SLUG, {
          name: "Regresi 1.0.2",
          appVersion: "v1.0.2",
          caseNumbers: [1],
        });
        expect(run).toMatchObject({ number: 2, status: "open", total: 1, version: 1 });
      });
  });

  it("GET /projects/:slug/manual-runs/:number mengembalikan detail run (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("detail run manual TR-1")
      .withRequest("GET", `${BASE}/manual-runs/1`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(runDetail(1, "Regresi 1.0.1", "v1.0.1", "open", 2, 1)))
      .executeTest(async (server) => {
        const run = await clientFor(server, true).manual.runs.get(PROJECT_SLUG, 1);
        expect(run).toMatchObject({ number: 1, name: "Regresi 1.0.1", appVersion: "v1.0.1", status: "open", version: 1 });
      });
  });

  it("GET /projects/:slug/manual-runs/:number yang tidak ada -> 404 MANUAL_RUN_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("detail run manual yang tidak ada")
      .withRequest("GET", `${BASE}/manual-runs/${MISSING_RUN_NUMBER}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("MANUAL_RUN_NOT_FOUND", "Run manual tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).manual.runs.get(PROJECT_SLUG, MISSING_RUN_NUMBER)).rejects.toMatchObject({
          status: 404,
          code: "MANUAL_RUN_NOT_FOUND",
        });
      });
  });

  it("PATCH /projects/:slug/manual-runs/:number menyelesaikan run (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("menyelesaikan run manual")
      .withRequest("PATCH", `${BASE}/manual-runs/1`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 1, status: "completed" }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({ ...runDetail(1, "Regresi 1.0.1", "v1.0.1", "completed", 2, 2), completedBy: budi }),
      )
      .executeTest(async (server) => {
        const run = await clientFor(server, true).manual.runs.update(PROJECT_SLUG, 1, { version: 1, status: "completed" });
        expect(run).toMatchObject({ status: "completed", version: 2, completedBy: { id: BUDI_ID } });
      });
  });

  it("PATCH /projects/:slug/manual-runs/:number dengan versi usang -> 409 MANUAL_RUN_CONFLICT", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("mengubah run manual dengan versi usang")
      .withRequest("PATCH", `${BASE}/manual-runs/1`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 99, name: "Nama baru" }),
      )
      .willRespondWith(409, (b) =>
        b.jsonBody(errorBody("MANUAL_RUN_CONFLICT", "Data sudah diubah orang lain. Muat ulang untuk melihat versi terbaru")),
      )
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).manual.runs.update(PROJECT_SLUG, 1, { version: 99, name: "Nama baru" }),
        ).rejects.toMatchObject({ status: 409, code: "MANUAL_RUN_CONFLICT" });
      });
  });

  it("PATCH /projects/:slug/manual-runs/:number pada run selesai selain membuka ulang -> 409 RUN_COMPLETED", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualRunCompleted)
      .uponReceiving("mengganti nama run manual yang sudah selesai")
      .withRequest("PATCH", `${BASE}/manual-runs/1`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 1, name: "Nama baru" }),
      )
      .willRespondWith(409, (b) =>
        b.jsonBody(errorBody("RUN_COMPLETED", "Run sudah selesai. Buka ulang run untuk mengubah hasil")),
      )
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).manual.runs.update(PROJECT_SLUG, 1, { version: 1, name: "Nama baru" }),
        ).rejects.toMatchObject({ status: 409, code: "RUN_COMPLETED" });
      });
  });

  it("DELETE /projects/:slug/manual-runs/:number menghapus run sebagai admin (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("menghapus run manual")
      .withRequest("DELETE", `${BASE}/manual-runs/1`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).manual.runs.remove(PROJECT_SLUG, 1)).resolves.toBeUndefined();
      });
  });
});

describe("kontrak test manual: run case", () => {
  it("GET /projects/:slug/manual-runs/:number/cases mengembalikan run case urut posisi (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("daftar run case")
      .withRequest("GET", `${BASE}/manual-runs/1/cases`, (b) => b.headers(COOKIE_HEADERS).query({ status: "untested" }))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          items: [
            runCaseListItem(RUN_CASE_ID, 1, "Bayar dengan kartu", "untested"),
            runCaseListItem(RUN_CASE_2_ID, 2, "Bayar dengan transfer", "untested"),
          ],
          nextCursor: null,
        }),
      )
      .executeTest(async (server) => {
        const page = await clientFor(server, true).manual.runCases.list(PROJECT_SLUG, 1, { status: "untested" });
        expect(page.items.map((item) => [item.id, item.caseNumber])).toEqual([
          [RUN_CASE_ID, 1],
          [RUN_CASE_2_ID, 2],
        ]);
        expect(page.nextCursor).toBeNull();
      });
  });

  it("GET /projects/:slug/manual-runs/:number/cases/:id mengembalikan run case lengkap (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("detail run case")
      .withRequest("GET", `${BASE}/manual-runs/1/cases/${RUN_CASE_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(runCaseDetail({ status: "untested", version: 1, runState: "open" })))
      .executeTest(async (server) => {
        const runCase = await clientFor(server, true).manual.runCases.get(PROJECT_SLUG, 1, RUN_CASE_ID);
        expect(runCase).toMatchObject({ id: RUN_CASE_ID, status: "untested", version: 1, runStatus: "open", nextUntestedId: RUN_CASE_2_ID });
        expect(runCase.stepResults).toEqual([{ status: null, note: "" }, { status: null, note: "" }]);
      });
  });

  it("GET /projects/:slug/manual-runs/:number/cases/:id yang tidak ada -> 404 RUN_CASE_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("detail run case yang tidak ada")
      .withRequest("GET", `${BASE}/manual-runs/1/cases/${MISSING_UUID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("RUN_CASE_NOT_FOUND", "Case di run ini tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).manual.runCases.get(PROJECT_SLUG, 1, MISSING_UUID)).rejects.toMatchObject({
          status: 404,
          code: "RUN_CASE_NOT_FOUND",
        });
      });
  });

  it("PATCH /projects/:slug/manual-runs/:number/cases/:id mengisi hasil dan langkah (200)", async () => {
    const body = {
      version: 1,
      status: "passed" as const,
      stepResults: [
        { status: "passed" as const, note: "" },
        { status: "passed" as const, note: "" },
      ],
    };
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("mengisi hasil run case")
      .withRequest("PATCH", `${BASE}/manual-runs/1/cases/${RUN_CASE_ID}`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody(body))
      .willRespondWith(200, (b) => b.jsonBody(runCaseDetail({ status: "passed", version: 2, runState: "open" })))
      .executeTest(async (server) => {
        const runCase = await clientFor(server, true).manual.runCases.update(PROJECT_SLUG, 1, RUN_CASE_ID, body);
        expect(runCase).toMatchObject({ status: "passed", version: 2, executedBy: { id: BUDI_ID } });
        expect(runCase.executedAt).toEqual(expect.any(String));
      });
  });

  it("PATCH /projects/:slug/manual-runs/:number/cases/:id dengan versi usang -> 409 MANUAL_RUN_CONFLICT", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("mengisi hasil run case dengan versi usang")
      .withRequest("PATCH", `${BASE}/manual-runs/1/cases/${RUN_CASE_ID}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 99, status: "failed" }),
      )
      .willRespondWith(409, (b) =>
        b.jsonBody(errorBody("MANUAL_RUN_CONFLICT", "Data sudah diubah orang lain. Muat ulang untuk melihat versi terbaru")),
      )
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).manual.runCases.update(PROJECT_SLUG, 1, RUN_CASE_ID, { version: 99, status: "failed" }),
        ).rejects.toMatchObject({ status: 409, code: "MANUAL_RUN_CONFLICT" });
      });
  });

  it("PATCH /projects/:slug/manual-runs/:number/cases/:id pada run selesai -> 409 RUN_COMPLETED", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualRunCompleted)
      .uponReceiving("mengisi hasil run case pada run yang sudah selesai")
      .withRequest("PATCH", `${BASE}/manual-runs/1/cases/${RUN_CASE_ID}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 1, status: "passed" }),
      )
      .willRespondWith(409, (b) =>
        b.jsonBody(errorBody("RUN_COMPLETED", "Run sudah selesai. Buka ulang run untuk mengubah hasil")),
      )
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).manual.runCases.update(PROJECT_SLUG, 1, RUN_CASE_ID, { version: 1, status: "passed" }),
        ).rejects.toMatchObject({ status: 409, code: "RUN_COMPLETED" });
      });
  });
});

describe("kontrak test manual: ringkasan", () => {
  it("GET /projects/:slug/manual/summary mengembalikan run terbaru dan cakupan otomasi (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.manualSeeded)
      .uponReceiving("ringkasan test manual")
      .withRequest("GET", `${BASE}/manual/summary`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          latestRun: runSummary(1, "Regresi 1.0.1", "v1.0.1", "open", 2),
          coverage: { active: integer(2), automated: integer(1) },
        }),
      )
      .executeTest(async (server) => {
        const summary = await clientFor(server, true).manual.summary(PROJECT_SLUG);
        expect(summary.latestRun).toMatchObject({ number: 1, total: 2 });
        expect(summary.coverage).toEqual({ active: 2, automated: 1 });
      });
  });
});
