import {
  bugDto,
  casesPageDto,
  manualCaseDto,
  manualRunDto,
  manualRunsPageDto,
  manualSummaryDto,
  runCaseDto,
  runCasesPageDto,
  suiteDto,
  testSearchItemDto,
  versionDto,
  type RunCaseDto,
  type SuiteDto,
} from "@testpulse/shared";
import type { TestApi, TestUser } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { expectApiError, expectFieldError, parseBody } from "../support/http.js";
import { buildJUnit } from "../support/junit.js";

const API = "/api/v1";
/** `GET /cases/labels` mengembalikan array string polos; tidak ada schema shared-nya. */
const labelsDto = {
  parse(data: unknown): string[] {
    expect(Array.isArray(data) && data.every((label) => typeof label === "string")).toBe(true);
    return data as string[];
  },
};

interface Project {
  owner: TestUser;
  tester: TestUser;
  slug: string;
  base: string;
}

async function setup(api: TestApi): Promise<Project> {
  const owner = await api.register();
  const { slug } = await api.createProject(owner);
  const tester = await api.addMember(owner, slug, "tester");
  return { owner, tester, slug, base: `${API}/projects/${slug}` };
}

const step = (n: number) => ({ action: `Langkah ${n}`, expected: `Hasil ${n}` });

/** Satu suite berisi satu case, dan run manual yang memilih case itu; mengembalikan run case pertamanya. */
async function seededRun(api: TestApi, { tester, slug }: Project) {
  const suite = await api.createSuite(tester, slug, { name: "Checkout" });
  const testCase = await api.createCase(tester, slug, { suiteId: suite.id, title: "Bayar dengan kartu", steps: [step(1), step(2)] });
  const run = await api.createManualRun(tester, slug, { name: "Regresi 0.4.0", appVersion: "v0.4.0", caseNumbers: [testCase.number] });
  const [runCase] = await api.listRunCases(tester, slug, run.number);
  if (!runCase) throw new Error("run manual tidak memuat run case");
  return { suite, testCase, run, runCaseId: runCase.id };
}

test.describe("Test manual lewat proxy: siklus hidup", () => {
  test("suite → case → cari test → run → eksekusi → bug → versi → ringkasan → hapus, semua respons sesuai schema shared", async ({ api }) => {
    const { owner, tester, slug, base } = await setup(api);

    // Suite
    const suite = await parseBody(await tester.request.post(`${base}/suites`, { data: { name: "  Checkout  ", description: "Alur bayar" } }), 201, suiteDto);
    expect(suite).toMatchObject({ name: "Checkout", description: "Alur bayar", position: 0, activeCount: 0, archivedCount: 0 });
    const renamed = await parseBody(await tester.request.patch(`${base}/suites/${suite.id}`, { data: { name: "Checkout v2" } }), 200, suiteDto);
    expect(renamed.name).toBe("Checkout v2");

    // Automated test Tahap 2 yang bisa ditautkan ke case
    const { token } = await api.createToken(owner, slug);
    const upload = await api.uploadRun(token, slug, buildJUnit([{ suite: "checkout", name: "bayar kartu" }]), { branch: "main", version: "0.4.0" });
    expect(upload.status(), await upload.text()).toBe(201);
    const found = await parseBody(await tester.request.get(`${base}/tests?q=bayar`), 200, testSearchItemDto.array());
    expect(found).toEqual([expect.objectContaining({ suite: "checkout", name: "bayar kartu" })]);

    // Case
    const created = await parseBody(
      await tester.request.post(`${base}/cases`, {
        data: {
          suiteId: suite.id,
          title: "  Bayar dengan kartu  ",
          preconditions: "Keranjang berisi satu barang",
          steps: [step(1), step(2)],
          priority: "high",
          labels: ["UI", " Pembayaran "],
          automatedTestId: found[0]!.id,
        },
      }),
      201,
      manualCaseDto,
    );
    expect(created).toMatchObject({ number: 1, title: "Bayar dengan kartu", priority: "high", labels: ["pembayaran", "ui"], version: 1 });
    expect(created.automatedTest).toMatchObject({ id: found[0]!.id, name: "bayar kartu" });
    const second = await api.createCase(tester, slug, { suiteId: suite.id, title: "Bayar dengan transfer", steps: [step(1)] });
    expect(second.number).toBe(2);

    const updated = await parseBody(
      await tester.request.patch(`${base}/cases/1`, { data: { version: 1, title: "Bayar dengan kartu kredit" } }),
      200,
      manualCaseDto,
    );
    expect(updated).toMatchObject({ title: "Bayar dengan kartu kredit", version: 2 });

    const page = await parseBody(await tester.request.get(`${base}/cases?q=kartu&automated=yes`), 200, casesPageDto);
    expect(page.items.map((item) => item.number)).toEqual([1]);
    expect(page.coverage).toEqual({ active: 2, automated: 1 });
    expect(await parseBody(await tester.request.get(`${base}/cases/labels`), 200, labelsDto)).toEqual(["pembayaran", "ui"]);
    const detail = await parseBody(await tester.request.get(`${base}/cases/1`), 200, manualCaseDto);
    expect(detail.recentResults).toEqual([]);
    const suites = await parseBody(await tester.request.get(`${base}/suites`), 200, suiteDto.array());
    expect(suites).toEqual([expect.objectContaining({ id: suite.id, activeCount: 2, archivedCount: 0 })]);

    // Run manual dari suite
    const run = await parseBody(
      await tester.request.post(`${base}/manual-runs`, { data: { name: "Regresi 0.4.0", appVersion: "0.4.0", suiteIds: [suite.id] } }),
      201,
      manualRunDto,
    );
    expect(run).toMatchObject({ number: 1, status: "open", total: 2, progress: 0, version: 1 });
    expect(run.counts).toEqual({ untested: 2, passed: 0, failed: 0, blocked: 0, skipped: 0 });

    const runCases = await parseBody(await tester.request.get(`${base}/manual-runs/1/cases`), 200, runCasesPageDto);
    expect(runCases.items.map((item) => item.caseNumber)).toEqual([1, 2]);
    const first = runCases.items[0]!;
    const runCase = await parseBody(await tester.request.get(`${base}/manual-runs/1/cases/${first.id}`), 200, runCaseDto);
    expect(runCase).toMatchObject({ status: "untested", runStatus: "open", caseId: expect.any(String), nextUntestedId: runCases.items[1]!.id });

    // Eksekusi: gagal di langkah kedua, lalu bug dari run case
    const failed = await parseBody(
      await tester.request.patch(`${base}/manual-runs/1/cases/${first.id}`, {
        data: { version: 1, status: "failed", stepResults: [{ status: "passed", note: "" }, { status: "failed", note: "Tombol tidak merespons" }], note: "Gagal di langkah 2" },
      }),
      200,
      runCaseDto,
    );
    expect(failed).toMatchObject({ status: "failed", version: 2, executedBy: expect.objectContaining({ id: tester.user.id }) });
    const bug = await parseBody(
      await tester.request.post(`${base}/bugs`, { data: { title: "Tombol bayar tidak merespons", manualRunCaseId: first.id } }),
      201,
      bugDto,
    );
    expect(bug.manualOrigin).toEqual({ runNumber: 1, runName: "Regresi 0.4.0", caseNumber: 1, caseTitle: "Bayar dengan kartu kredit", runCaseId: first.id });
    const withBug = await parseBody(await tester.request.get(`${base}/manual-runs/1/cases`), 200, runCasesPageDto);
    expect(withBug.items[0]!.bugs).toEqual([expect.objectContaining({ number: bug.number, status: "open" })]);

    // Riwayat case, daftar run, versi, ringkasan
    const afterRun = await parseBody(await tester.request.get(`${base}/cases/1`), 200, manualCaseDto);
    expect(afterRun.recentResults).toEqual([expect.objectContaining({ runNumber: 1, status: "failed", runCaseId: first.id })]);
    const runs = await parseBody(await tester.request.get(`${base}/manual-runs?status=open`), 200, manualRunsPageDto);
    expect(runs.items.map((item) => item.number)).toEqual([1]);
    expect((await parseBody(await tester.request.get(`${base}/manual-runs/1`), 200, manualRunDto)).counts).toMatchObject({ failed: 1, untested: 1 });
    const versions = await parseBody(await tester.request.get(`${base}/versions`), 200, versionDto.array());
    expect(versions).toEqual([expect.objectContaining({ version: "0.4.0", manual: expect.objectContaining({ number: 1, total: 2 }) })]);
    const summary = await parseBody(await tester.request.get(`${base}/manual/summary`), 200, manualSummaryDto);
    expect(summary).toMatchObject({ latestRun: { number: 1, name: "Regresi 0.4.0" }, coverage: { active: 2, automated: 1 } });

    // Selesaikan, buka ulang, ubah nama
    const done = await parseBody(await tester.request.patch(`${base}/manual-runs/1`, { data: { version: 1, status: "completed" } }), 200, manualRunDto);
    expect(done).toMatchObject({ status: "completed", version: 2, completedBy: expect.objectContaining({ id: tester.user.id }) });
    const reopened = await parseBody(await tester.request.patch(`${base}/manual-runs/1`, { data: { version: 2, status: "open" } }), 200, manualRunDto);
    expect(reopened).toMatchObject({ status: "open", completedAt: null });

    // Hapus: tester ditolak, admin berhasil; nomor tidak dipakai ulang
    await expectApiError(await tester.request.delete(`${base}/manual-runs/1`), 403, "FORBIDDEN");
    expect((await owner.request.delete(`${base}/manual-runs/1`)).status()).toBe(204);
    await expectApiError(await owner.request.get(`${base}/manual-runs/1`), 404, "MANUAL_RUN_NOT_FOUND");
    expect((await owner.request.delete(`${base}/cases/1`)).status()).toBe(204);
    await expectApiError(await owner.request.get(`${base}/cases/1`), 404, "CASE_NOT_FOUND");
    expect((await owner.request.delete(`${base}/cases/2`)).status()).toBe(204);
    expect((await owner.request.delete(`${base}/suites/${suite.id}`)).status()).toBe(204);
    const next = await api.createCase(tester, slug, {
      suiteId: (await api.createSuite(tester, slug, { name: "Baru" })).id,
      title: "Case sesudah hapus",
      steps: [step(1)],
    });
    expect(next.number).toBe(3);
  });
});

test.describe("Test manual lewat proxy: konflik dan penolakan", () => {
  test("409 CASE_CONFLICT: PATCH case dengan version basi", async ({ api }) => {
    const project = await setup(api);
    const { testCase } = await seededRun(api, project);
    await api.updateCase(project.tester, project.slug, testCase.number, { version: 1, priority: "low" });
    const res = await project.tester.request.patch(`${project.base}/cases/${testCase.number}`, { data: { version: 1, priority: "urgent" } });
    await expectApiError(res, 409, "CASE_CONFLICT");
  });

  test("409 MANUAL_RUN_CONFLICT: PATCH run dan run case dengan version basi", async ({ api }) => {
    const project = await setup(api);
    const { run, runCaseId } = await seededRun(api, project);
    const runPath = `${project.base}/manual-runs/${run.number}`;
    expect((await project.tester.request.patch(runPath, { data: { version: 1, name: "Nama baru" } })).status()).toBe(200);
    await expectApiError(await project.tester.request.patch(runPath, { data: { version: 1, name: "Nama lain" } }), 409, "MANUAL_RUN_CONFLICT");

    await api.updateRunCase(project.tester, project.slug, run.number, runCaseId, { version: 1, status: "passed" });
    await expectApiError(
      await project.tester.request.patch(`${runPath}/cases/${runCaseId}`, { data: { version: 1, status: "failed" } }),
      409,
      "MANUAL_RUN_CONFLICT",
    );
  });

  test("409 RUN_COMPLETED: run selesai menolak isi hasil dan ubah nama, tetapi bisa dibuka ulang", async ({ api }) => {
    const project = await setup(api);
    const { run, runCaseId } = await seededRun(api, project);
    const runPath = `${project.base}/manual-runs/${run.number}`;
    const completed = await parseBody(await project.tester.request.patch(runPath, { data: { version: 1, status: "completed" } }), 200, manualRunDto);

    await expectApiError(
      await project.tester.request.patch(`${runPath}/cases/${runCaseId}`, { data: { version: 1, status: "passed" } }),
      409,
      "RUN_COMPLETED",
    );
    await expectApiError(await project.tester.request.patch(runPath, { data: { version: completed.version, name: "Nama baru" } }), 409, "RUN_COMPLETED");

    const reopened = await parseBody(await project.tester.request.patch(runPath, { data: { version: completed.version, status: "open" } }), 200, manualRunDto);
    expect(reopened.status).toBe("open");
    const result: RunCaseDto = await parseBody(
      await project.tester.request.patch(`${runPath}/cases/${runCaseId}`, { data: { version: 1, status: "passed" } }),
      200,
      runCaseDto,
    );
    expect(result.status).toBe("passed");
  });

  test("409 SUITE_NOT_EMPTY: suite berisi case (juga yang diarsipkan) tidak bisa dihapus", async ({ api }) => {
    const project = await setup(api);
    const { suite, testCase } = await seededRun(api, project);
    await expectApiError(await project.owner.request.delete(`${project.base}/suites/${suite.id}`), 409, "SUITE_NOT_EMPTY");
    await api.updateCase(project.tester, project.slug, testCase.number, { version: 1, archived: true });
    await expectApiError(await project.owner.request.delete(`${project.base}/suites/${suite.id}`), 409, "SUITE_NOT_EMPTY");
    expect((await project.owner.request.delete(`${project.base}/cases/${testCase.number}`)).status()).toBe(204);
    expect((await project.owner.request.delete(`${project.base}/suites/${suite.id}`)).status()).toBe(204);
  });

  test("404: suite, case, run, dan run case yang tidak ada", async ({ api }) => {
    const project = await setup(api);
    const { run } = await seededRun(api, project);
    const missingUuid = "00000000-0000-4000-8000-000000000000";
    const { tester, base } = project;

    await expectApiError(await tester.request.patch(`${base}/suites/${missingUuid}`, { data: { name: "X" } }), 404, "SUITE_NOT_FOUND");
    await expectApiError(await project.owner.request.delete(`${base}/suites/${missingUuid}`), 404, "SUITE_NOT_FOUND");
    await expectApiError(await tester.request.get(`${base}/cases/99`), 404, "CASE_NOT_FOUND");
    await expectApiError(await tester.request.patch(`${base}/cases/99`, { data: { version: 1, priority: "low" } }), 404, "CASE_NOT_FOUND");
    await expectApiError(await tester.request.get(`${base}/manual-runs/99`), 404, "MANUAL_RUN_NOT_FOUND");
    await expectApiError(await tester.request.get(`${base}/manual-runs/99/cases`), 404, "MANUAL_RUN_NOT_FOUND");
    await expectApiError(await tester.request.get(`${base}/manual-runs/${run.number}/cases/${missingUuid}`), 404, "RUN_CASE_NOT_FOUND");
    await expectApiError(await tester.request.get(`${base}/manual-runs/${run.number}/cases/bukan-uuid`), 404, "RUN_CASE_NOT_FOUND");
  });

  test("validasi: nama suite ganda tanpa peka huruf besar/kecil, seleksi kosong, pencarian terlalu pendek, cursor rusak", async ({ api }) => {
    const { tester, slug, base } = await setup(api);
    await api.createSuite(tester, slug, { name: "Login" });
    await expectFieldError(await tester.request.post(`${base}/suites`, { data: { name: "LOGIN" } }), "name");
    await expectFieldError(await tester.request.post(`${base}/manual-runs`, { data: { name: "Run kosong" } }), "selection");
    await expectFieldError(await tester.request.get(`${base}/tests?q=a`), "q");
    await expectFieldError(await tester.request.get(`${base}/cases?cursor=rusak!`), "cursor");
    await expectFieldError(await tester.request.get(`${base}/manual-runs?cursor=rusak!`), "cursor");
  });

  test("hasil langkah tidak mengubah status run case dengan sendirinya (saran status tidak pernah disimpan otomatis)", async ({ api }) => {
    const project = await setup(api);
    const { run, runCaseId } = await seededRun(api, project);
    const updated: RunCaseDto = await api.updateRunCase(project.tester, project.slug, run.number, runCaseId, {
      version: 1,
      stepResults: [{ status: "failed", note: "Rusak" }, { status: null, note: "" }],
    });
    expect(updated.status).toBe("untested");
  });
});

test.describe("Test manual lewat proxy: token CI dan anonim", () => {
  test("token CI yang sah tidak membuka endpoint test manual; project publik terbaca anonim, tulis tetap 401", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    const { token } = await api.createToken(owner, slug);
    const bearer = await api.anonymous({ authorization: `Bearer ${token}` });
    await expectApiError(await bearer.get(`${base}/suites`), 404, "PROJECT_NOT_FOUND");
    await expectApiError(await bearer.post(`${base}/suites`, { data: { name: "X" } }), 401, "UNAUTHENTICATED");

    await api.setVisibility(owner, slug, "public");
    const anon = await api.anonymous();
    const suites: SuiteDto[] = await parseBody(await anon.get(`${base}/suites`), 200, suiteDto.array());
    expect(suites).toEqual([]);
    const summary = await parseBody(await anon.get(`${base}/manual/summary`), 200, manualSummaryDto);
    expect(summary.latestRun).toBeNull();
    await expectApiError(await anon.post(`${base}/suites`, { data: { name: "X" } }), 401, "UNAUTHENTICATED");
  });
});
