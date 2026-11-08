import { faker } from "@faker-js/faker";
import {
  manualCaseDto,
  manualRunDto,
  manualRunsPageDto,
  runCaseDto,
  runCasesPageDto,
  suiteDto,
  type ManualRunDto,
  type ProjectDto,
  type RunCaseDto,
} from "@testpulse/shared";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { manualCases, manualRunCases, manualRuns, projects } from "../../src/db/schema.js";
import { addMember, createProject, createTestApp, registerUser, type RegisteredUser } from "./helpers.js";

describe("API run manual dan eksekusi run case", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  interface Fixture {
    admin: RegisteredUser;
    tester: RegisteredUser;
    viewer: RegisteredUser;
    project: ProjectDto;
  }

  async function setup(opts: { visibility?: "public" | "private" } = {}): Promise<Fixture> {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.cookie);
    const tester = await registerUser(app);
    const viewer = await registerUser(app);
    await addMember(app, project.id, tester.user.id, "tester");
    await addMember(app, project.id, viewer.user.id, "viewer");
    if (opts.visibility === "public") {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${project.slug}`,
        headers: { cookie: admin.cookie },
        payload: { visibility: "public" },
      });
      expect(res.statusCode).toBe(200);
    }
    return { admin, tester, viewer, project };
  }

  const request = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    fx: Fixture,
    path: string,
    cookie?: string | null,
    payload?: unknown,
  ) =>
    app.inject({
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

  async function createSuite(fx: Fixture, name = `Suite ${faker.string.alphanumeric(8)}`) {
    const res = await request("POST", fx, "/suites", fx.tester.cookie, { name });
    expect(res.statusCode, res.body).toBe(201);
    return suiteDto.parse(res.json());
  }

  const step = (n = 1) => ({ action: `Langkah ${n}`, expected: `Hasil ${n}` });

  async function createCase(fx: Fixture, suiteId: string, payload: Record<string, unknown> = {}) {
    const res = await request("POST", fx, "/cases", fx.tester.cookie, {
      suiteId,
      title: `Case ${faker.string.alphanumeric(8)}`,
      steps: [step(1), step(2)],
      ...payload,
    });
    expect(res.statusCode, res.body).toBe(201);
    return manualCaseDto.parse(res.json());
  }

  /** Menyisipkan `count` case aktif langsung ke DB (nomor lanjut dari `case_seq`). */
  async function seedCases(fx: Fixture, suiteId: string, count: number) {
    const [project] = await app.db
      .update(projects)
      .set({ caseSeq: sql`${projects.caseSeq} + ${count}` })
      .where(eq(projects.id, fx.project.id))
      .returning({ caseSeq: projects.caseSeq });
    const first = project!.caseSeq - count + 1;
    await app.db.insert(manualCases).values(
      Array.from({ length: count }, (_, i) => ({
        projectId: fx.project.id,
        number: first + i,
        suiteId,
        title: `Case massal ${first + i}`,
        steps: [step()],
        priority: "medium" as const,
        createdBy: fx.admin.user.id,
        updatedBy: fx.admin.user.id,
      })),
    );
  }

  const createRunRaw = (fx: Fixture, payload: Record<string, unknown>, cookie = fx.tester.cookie) =>
    request("POST", fx, "/manual-runs", cookie, { name: "Regresi rilis", ...payload });

  async function createRun(fx: Fixture, payload: Record<string, unknown>, cookie = fx.tester.cookie) {
    const res = await createRunRaw(fx, payload, cookie);
    expect(res.statusCode, res.body).toBe(201);
    return manualRunDto.parse(res.json());
  }

  async function getRun(fx: Fixture, number: number): Promise<ManualRunDto> {
    const res = await request("GET", fx, `/manual-runs/${number}`, fx.tester.cookie);
    expect(res.statusCode, res.body).toBe(200);
    return manualRunDto.parse(res.json());
  }

  const patchRun = (fx: Fixture, number: number, payload: Record<string, unknown>, cookie = fx.tester.cookie) =>
    request("PATCH", fx, `/manual-runs/${number}`, cookie, payload);

  async function listRunCases(fx: Fixture, runNumber: number, query = "", cookie: string | null = fx.tester.cookie) {
    const res = await request("GET", fx, `/manual-runs/${runNumber}/cases${query ? `?${query}` : ""}`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return runCasesPageDto.parse(res.json());
  }

  async function getRunCase(fx: Fixture, runNumber: number, id: string): Promise<RunCaseDto> {
    const res = await request("GET", fx, `/manual-runs/${runNumber}/cases/${id}`, fx.tester.cookie);
    expect(res.statusCode, res.body).toBe(200);
    return runCaseDto.parse(res.json());
  }

  const patchRunCase = (
    fx: Fixture,
    runNumber: number,
    id: string,
    payload: Record<string, unknown>,
    cookie = fx.tester.cookie,
  ) => request("PATCH", fx, `/manual-runs/${runNumber}/cases/${id}`, cookie, payload);

  async function patchRunCaseOk(fx: Fixture, runNumber: number, id: string, payload: Record<string, unknown>) {
    const res = await patchRunCase(fx, runNumber, id, payload);
    expect(res.statusCode, res.body).toBe(200);
    return runCaseDto.parse(res.json());
  }

  /** Run berisi `count` case dari satu suite baru; mengembalikan run dan id run case urut posisi. */
  async function runWithCases(fx: Fixture, count: number, payload: Record<string, unknown> = {}) {
    const suite = await createSuite(fx);
    for (let i = 0; i < count; i += 1) await createCase(fx, suite.id);
    const run = await createRun(fx, { suiteIds: [suite.id], ...payload });
    const ids = (await listRunCases(fx, run.number)).items.map((item) => item.id);
    return { run, ids, suite };
  }

  // ---------------------------------------------------------------------------------------------------------
  describe("buat run", () => {
    it("dari 1 suite + 1 case suite lain → snapshot urut posisi suite lalu nomor", async () => {
      const fx = await setup();
      const a = await createSuite(fx, "Autentikasi");
      const b = await createSuite(fx, "Checkout");
      const c1 = await createCase(fx, b.id, { title: "Bayar dengan kartu" });
      const c2 = await createCase(fx, a.id, { title: "Login sukses", priority: "high", preconditions: "Akun aktif" });
      const c3 = await createCase(fx, a.id, { title: "Login gagal" });
      await createCase(fx, b.id, { title: "Tidak dipilih" });

      const res = await createRunRaw(fx, { name: "  Regresi v0.4  ", appVersion: "v0.4.0", suiteIds: [a.id], caseNumbers: [c1.number] });
      expect(res.statusCode, res.body).toBe(201);
      const run = manualRunDto.parse(res.json());
      expect(run).toMatchObject({
        number: 1,
        name: "Regresi v0.4",
        appVersion: "v0.4.0",
        status: "open",
        total: 3,
        counts: { untested: 3, passed: 0, failed: 0, blocked: 0, skipped: 0 },
        progress: 0,
        createdBy: { id: fx.tester.user.id, name: fx.tester.user.name },
        completedAt: null,
        completedBy: null,
        version: 1,
      });
      expect(await getRun(fx, 1)).toEqual(run);

      const page = await listRunCases(fx, run.number);
      expect(page.nextCursor).toBeNull();
      expect(page.items.map((item) => [item.position, item.caseNumber, item.suiteName, item.title])).toEqual([
        [0, c2.number, "Autentikasi", "Login sukses"],
        [1, c3.number, "Autentikasi", "Login gagal"],
        [2, c1.number, "Checkout", "Bayar dengan kartu"],
      ]);
      expect(page.items[0]).toMatchObject({ priority: "high", status: "untested", assignee: null, executedAt: null, bugs: [] });

      const detail = await getRunCase(fx, run.number, page.items[0]!.id);
      expect(detail).toMatchObject({
        caseId: (await caseRowId(fx, c2.number)),
        preconditions: "Akun aktif",
        steps: [step(1), step(2)],
        stepResults: [
          { status: null, note: "" },
          { status: null, note: "" },
        ],
        note: "",
        executedBy: null,
        version: 1,
        runStatus: "open",
      });
    });

    it("Review Focus 2: seleksi tumpang tindih → satu salinan; suite berisi arsip saja → 400 fields.selection", async () => {
      const fx = await setup();
      const x = await createSuite(fx);
      const c1 = await createCase(fx, x.id);
      await createCase(fx, x.id);
      const run = await createRun(fx, { suiteIds: [x.id], caseNumbers: [c1.number] });
      expect(run.total).toBe(2);
      expect((await listRunCases(fx, run.number)).items.map((i) => i.caseNumber)).toEqual([1, 2]);

      const archivedOnly = await createSuite(fx);
      const c3 = await createCase(fx, archivedOnly.id);
      expect((await request("PATCH", fx, `/cases/${c3.number}`, fx.tester.cookie, { version: 1, archived: true })).statusCode).toBe(200);
      expectError(await createRunRaw(fx, { suiteIds: [archivedOnly.id] }), 400, "VALIDATION_ERROR", "selection");
      expect((await createRunRaw(fx, { suiteIds: [archivedOnly.id] })).json().error.fields.selection).toBe("Pilih 1–500 case aktif");
      // Arsip tidak ikut walau suite-nya dipilih bersama suite lain.
      const mixed = await createRun(fx, { suiteIds: [x.id, archivedOnly.id] });
      expect(mixed.total).toBe(2);
    });

    it("validasi seleksi: suite tak dikenal, nomor tak dikenal/diarsipkan, kosong, nama, appVersion", async () => {
      const fx = await setup();
      const other = await setup();
      const s = await createSuite(fx);
      const c = await createCase(fx, s.id);
      const foreign = await createSuite(other);
      const archived = await createCase(fx, s.id);
      await request("PATCH", fx, `/cases/${archived.number}`, fx.tester.cookie, { version: 1, archived: true });

      expectError(await createRunRaw(fx, { suiteIds: [foreign.id] }), 400, "VALIDATION_ERROR", "suiteIds");
      expectError(await createRunRaw(fx, { suiteIds: [faker.string.uuid()] }), 400, "VALIDATION_ERROR", "suiteIds");
      expectError(await createRunRaw(fx, { caseNumbers: [999] }), 400, "VALIDATION_ERROR", "caseNumbers");
      expectError(await createRunRaw(fx, { caseNumbers: [archived.number] }), 400, "VALIDATION_ERROR", "caseNumbers");
      expectError(await createRunRaw(fx, { suiteIds: [], caseNumbers: [] }), 400, "VALIDATION_ERROR", "selection");
      expectError(await createRunRaw(fx, { name: "ab", caseNumbers: [c.number] }), 400, "VALIDATION_ERROR", "name");
      expectError(await createRunRaw(fx, { appVersion: "v 1", caseNumbers: [c.number] }), 400, "VALIDATION_ERROR", "appVersion");
      // Penolakan tidak memakai nomor TR.
      expect((await createRun(fx, { caseNumbers: [c.number] })).number).toBe(1);
    });

    it("501 case aktif → 400 fields.selection; 500 → 201 dan run case dipaginasi 100 per halaman", async () => {
      const fx = await setup();
      const s = await createSuite(fx);
      await seedCases(fx, s.id, 501);
      expectError(await createRunRaw(fx, { suiteIds: [s.id] }), 400, "VALIDATION_ERROR", "selection");

      await app.db
        .update(manualCases)
        .set({ archivedAt: sql`now()` })
        .where(and(eq(manualCases.projectId, fx.project.id), eq(manualCases.number, 501)));
      const run = await createRun(fx, { suiteIds: [s.id] });
      expect(run).toMatchObject({ number: 1, total: 500 });

      const positions: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await listRunCases(fx, run.number, cursor ? `cursor=${cursor}` : "");
        expect(page.items.length).toBeLessThanOrEqual(100);
        positions.push(...page.items.map((i) => i.position));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor);
      expect(pages).toBe(5);
      expect(positions).toEqual(Array.from({ length: 500 }, (_, i) => i));
      expectError(await request("GET", fx, `/manual-runs/${run.number}/cases?cursor=rusak!`, fx.tester.cookie), 400, "VALIDATION_ERROR", "cursor");
    });

    it("10 run dibuat paralel → TR-1…10 unik", async () => {
      const fx = await setup();
      const s = await createSuite(fx);
      await createCase(fx, s.id);
      const results = await Promise.all(Array.from({ length: 10 }, () => createRunRaw(fx, { suiteIds: [s.id] })));
      expect(results.map((r) => r.statusCode)).toEqual(Array(10).fill(201));
      expect(results.map((r) => r.json().number).sort((x: number, y: number) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("snapshot", () => {
    it("edit langkah, pindah suite, arsip, lalu hapus case → run case tetap memakai snapshot; caseId null, hasil tetap", async () => {
      const fx = await setup();
      const a = await createSuite(fx, "Lama");
      const b = await createSuite(fx, "Baru");
      const c = await createCase(fx, a.id, { title: "Judul lama", steps: [step(1)], preconditions: "Prasyarat lama" });
      const run = await createRun(fx, { caseNumbers: [c.number] });
      const [item] = (await listRunCases(fx, run.number)).items;
      await patchRunCaseOk(fx, run.number, item!.id, {
        version: 1,
        status: "failed",
        stepResults: [{ status: "failed", note: "Tombol hilang" }],
        note: "Gagal di langkah 1",
      });

      let res = await request("PATCH", fx, `/cases/${c.number}`, fx.tester.cookie, {
        version: 1,
        title: "Judul baru",
        steps: [step(7), step(8)],
        preconditions: "Prasyarat baru",
        priority: "urgent",
        suiteId: b.id,
      });
      expect(res.statusCode, res.body).toBe(200);
      res = await request("PATCH", fx, `/suites/${a.id}`, fx.tester.cookie, { name: "Lama diganti" });
      expect(res.statusCode, res.body).toBe(200);
      res = await request("PATCH", fx, `/cases/${c.number}`, fx.tester.cookie, { version: 2, archived: true });
      expect(res.statusCode, res.body).toBe(200);

      const snapshot = {
        caseNumber: c.number,
        title: "Judul lama",
        suiteName: "Lama",
        preconditions: "Prasyarat lama",
        steps: [step(1)],
        priority: "medium",
      };
      expect(await getRunCase(fx, run.number, item!.id)).toMatchObject({ ...snapshot, caseId: await caseRowId(fx, c.number) });

      expect((await request("DELETE", fx, `/cases/${c.number}`, fx.admin.cookie)).statusCode).toBe(204);
      expect(await getRunCase(fx, run.number, item!.id)).toMatchObject({
        ...snapshot,
        caseId: null,
        status: "failed",
        stepResults: [{ status: "failed", note: "Tombol hilang" }],
        note: "Gagal di langkah 1",
      });
      expect((await getRun(fx, run.number)).counts.failed).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("eksekusi run case", () => {
    it("status passed mengisi executedBy/At; kembali ke untested mengosongkannya", async () => {
      const fx = await setup();
      const { run, ids } = await runWithCases(fx, 2);
      const passed = await patchRunCaseOk(fx, run.number, ids[0]!, {
        version: 1,
        status: "passed",
        stepResults: [
          { status: "passed", note: "" },
          { status: "skipped", note: "Tidak relevan" },
        ],
      });
      expect(passed).toMatchObject({
        status: "passed",
        executedBy: { id: fx.tester.user.id, name: fx.tester.user.name },
        version: 2,
        stepResults: [
          { status: "passed", note: "" },
          { status: "skipped", note: "Tidak relevan" },
        ],
      });
      expect(passed.executedAt).not.toBeNull();
      expect(await getRun(fx, run.number)).toMatchObject({
        total: 2,
        counts: { untested: 1, passed: 1 },
        progress: 0.5,
        version: 1,
      });

      // Ubah catatan saja: executedBy/At tidak berubah.
      const noted = await patchRunCaseOk(fx, run.number, ids[0]!, { version: 2, note: "**ok**" });
      expect(noted).toMatchObject({ note: "**ok**", executedAt: passed.executedAt, version: 3 });

      const back = await patchRunCaseOk(fx, run.number, ids[0]!, { version: 3, status: "untested" });
      expect(back).toMatchObject({ status: "untested", executedBy: null, executedAt: null, version: 4 });
      // Hasil langkah tidak dibuang saat status dikembalikan.
      expect(back.stepResults[1]).toEqual({ status: "skipped", note: "Tidak relevan" });
    });

    it("perubahan tanpa efek tidak menaikkan version", async () => {
      const fx = await setup();
      const { run, ids } = await runWithCases(fx, 1);
      const same = await patchRunCaseOk(fx, run.number, ids[0]!, { version: 1, status: "untested", note: "" });
      expect(same.version).toBe(1);
    });

    it("stepResults panjang salah → 400 fields.stepResults; assignee bukan anggota → 400 fields.assigneeId", async () => {
      const fx = await setup();
      const outsider = await registerUser(app);
      const { run, ids } = await runWithCases(fx, 1);
      expectError(
        await patchRunCase(fx, run.number, ids[0]!, { version: 1, stepResults: [{ status: "passed", note: "" }] }),
        400,
        "VALIDATION_ERROR",
        "stepResults",
      );
      expectError(
        await patchRunCase(fx, run.number, ids[0]!, { version: 1, stepResults: [{ status: "aneh", note: "" }, { status: null, note: "" }] }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(await patchRunCase(fx, run.number, ids[0]!, { version: 1, assigneeId: outsider.user.id }), 400, "VALIDATION_ERROR", "assigneeId");
      expectError(await patchRunCase(fx, run.number, ids[0]!, { version: 1 }), 400, "VALIDATION_ERROR");

      const assigned = await patchRunCaseOk(fx, run.number, ids[0]!, { version: 1, assigneeId: fx.viewer.user.id });
      expect(assigned.assignee).toEqual({ id: fx.viewer.user.id, name: fx.viewer.user.name });
      expect(assigned.status).toBe("untested");
      const unassigned = await patchRunCaseOk(fx, run.number, ids[0]!, { version: 2, assigneeId: null });
      expect(unassigned.assignee).toBeNull();
      // Penolakan tidak mengubah apa pun.
      expect((await getRunCase(fx, run.number, ids[0]!)).version).toBe(3);
    });

    it("version basi → 409 MANUAL_RUN_CONFLICT", async () => {
      const fx = await setup();
      const { run, ids } = await runWithCases(fx, 1);
      await patchRunCaseOk(fx, run.number, ids[0]!, { version: 1, status: "blocked" });
      expectError(await patchRunCase(fx, run.number, ids[0]!, { version: 1, status: "passed" }), 409, "MANUAL_RUN_CONFLICT");
      expect((await getRunCase(fx, run.number, ids[0]!)).status).toBe("blocked");
    });

    it("run tak dikenal → 404 MANUAL_RUN_NOT_FOUND; run case bukan uuid / run lain → 404 RUN_CASE_NOT_FOUND", async () => {
      const fx = await setup();
      const first = await runWithCases(fx, 1);
      const second = await runWithCases(fx, 1);
      for (const path of ["/manual-runs/99", "/manual-runs/abc", "/manual-runs/0", `/manual-runs/99/cases`, `/manual-runs/99/cases/${first.ids[0]}`]) {
        expectError(await request("GET", fx, path, fx.tester.cookie), 404, "MANUAL_RUN_NOT_FOUND");
      }
      expectError(await patchRun(fx, 99, { version: 1, name: "Nama baru" }), 404, "MANUAL_RUN_NOT_FOUND");
      expectError(await request("DELETE", fx, "/manual-runs/99", fx.admin.cookie), 404, "MANUAL_RUN_NOT_FOUND");
      expectError(await patchRunCase(fx, 99, first.ids[0]!, { version: 1, status: "passed" }), 404, "MANUAL_RUN_NOT_FOUND");

      for (const id of ["bukan-uuid", second.ids[0]!, faker.string.uuid()]) {
        expectError(await request("GET", fx, `/manual-runs/${first.run.number}/cases/${id}`, fx.tester.cookie), 404, "RUN_CASE_NOT_FOUND");
        expectError(await patchRunCase(fx, first.run.number, id, { version: 1, status: "passed" }), 404, "RUN_CASE_NOT_FOUND");
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("konkurensi & run selesai", () => {
    it("dua run case berbeda di-PATCH paralel → keduanya 200; run case sama dengan version sama → tepat satu 409", async () => {
      const fx = await setup();
      const { run, ids } = await runWithCases(fx, 2);
      const different = await Promise.all(ids.map((id) => patchRunCase(fx, run.number, id, { version: 1, status: "passed" })));
      expect(different.map((r) => r.statusCode)).toEqual([200, 200]);

      const same = await Promise.all(
        ["failed", "blocked"].map((status) => patchRunCase(fx, run.number, ids[0]!, { version: 2, status })),
      );
      expect(same.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(same.find((r) => r.statusCode === 409)!.json().error.code).toBe("MANUAL_RUN_CONFLICT");
      expect((await getRunCase(fx, run.number, ids[0]!)).version).toBe(3);
    });

    it("run diselesaikan → PATCH run case dan rename 409 RUN_COMPLETED; buka ulang → bisa menulis lagi", async () => {
      const fx = await setup();
      const { run, ids } = await runWithCases(fx, 2);
      await patchRunCaseOk(fx, run.number, ids[0]!, { version: 1, status: "passed" });

      const doneRes = await patchRun(fx, run.number, { version: 1, status: "completed" });
      expect(doneRes.statusCode, doneRes.body).toBe(200);
      const done = manualRunDto.parse(doneRes.json());
      expect(done).toMatchObject({ status: "completed", completedBy: { id: fx.tester.user.id }, version: 2 });
      expect(done.completedAt).not.toBeNull();
      expect((await getRunCase(fx, run.number, ids[1]!)).runStatus).toBe("completed");

      expectError(await patchRunCase(fx, run.number, ids[1]!, { version: 1, status: "failed" }), 409, "RUN_COMPLETED");
      expectError(await patchRunCase(fx, run.number, ids[1]!, { version: 1, assigneeId: null }), 409, "RUN_COMPLETED");
      expectError(await patchRun(fx, run.number, { version: 2, name: "Nama baru" }), 409, "RUN_COMPLETED");
      expectError(await patchRun(fx, run.number, { version: 2, appVersion: null }), 409, "RUN_COMPLETED");
      expectError(await patchRun(fx, run.number, { version: 2, status: "open", name: "Nama baru" }), 409, "RUN_COMPLETED");
      expectError(await patchRun(fx, run.number, { version: 1, status: "open" }), 409, "MANUAL_RUN_CONFLICT");

      const reopened = manualRunDto.parse((await patchRun(fx, run.number, { version: 2, status: "open" })).json());
      expect(reopened).toMatchObject({ status: "open", completedAt: null, completedBy: null, version: 3, name: run.name });
      await patchRunCaseOk(fx, run.number, ids[1]!, { version: 1, status: "failed" });
      const renamed = await patchRun(fx, run.number, { version: 3, name: "Nama baru" });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(renamed.json()).toMatchObject({ name: "Nama baru", version: 4 });
    });

    it("PATCH run: version basi → 409; appVersion bisa diubah dan dikosongkan selama open; validasi", async () => {
      const fx = await setup();
      const { run } = await runWithCases(fx, 1, { appVersion: "1.0.0" });
      expectError(await patchRun(fx, run.number, { version: 5, name: "Nama baru" }), 409, "MANUAL_RUN_CONFLICT");
      expectError(await patchRun(fx, run.number, { version: 1 }), 400, "VALIDATION_ERROR");
      expectError(await patchRun(fx, run.number, { version: 1, name: "x" }), 400, "VALIDATION_ERROR", "name");
      const changed = manualRunDto.parse((await patchRun(fx, run.number, { version: 1, appVersion: "1.1.0" })).json());
      expect(changed).toMatchObject({ appVersion: "1.1.0", version: 2 });
      const cleared = manualRunDto.parse((await patchRun(fx, run.number, { version: 2, appVersion: null })).json());
      expect(cleared).toMatchObject({ appVersion: null, version: 3 });
      const same = manualRunDto.parse((await patchRun(fx, run.number, { version: 3, appVersion: null })).json());
      expect(same.version).toBe(3);
    });

    it("penyelesaian run dan PATCH run case berulang paralel → tidak ada run case dengan updated_at > completed_at", async () => {
      const fx = await setup();
      for (let round = 0; round < 6; round += 1) {
        const { run, ids } = await runWithCases(fx, 4);
        const writes = ids.map((id) => patchRunCase(fx, run.number, id, { version: 1, status: "passed" }));
        const complete = patchRun(fx, run.number, { version: 1, status: "completed" });
        const [completeRes, ...writeRes] = await Promise.all([complete, ...writes]);
        expect(completeRes.statusCode, completeRes.body).toBe(200);
        for (const res of writeRes) {
          expect([200, 409], res.body).toContain(res.statusCode);
          if (res.statusCode === 409) expect(res.json().error.code).toBe("RUN_COMPLETED");
        }

        const late = await app.db
          .select({ id: manualRunCases.id })
          .from(manualRunCases)
          .innerJoin(manualRuns, eq(manualRuns.id, manualRunCases.runId))
          .where(
            and(
              eq(manualRuns.projectId, fx.project.id),
              eq(manualRuns.number, run.number),
              sql`${manualRunCases.updatedAt} > ${manualRuns.completedAt}`,
            ),
          );
        expect(late, `ronde ${round}`).toEqual([]);
        // Penulisan yang diterima memang tersimpan, yang ditolak tidak.
        const accepted = writeRes.filter((r) => r.statusCode === 200).length;
        expect((await getRun(fx, run.number)).counts.passed).toBe(accepted);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("navigasi nextUntestedId", () => {
    it("run case untested berikutnya setelah posisi ini, berputar ke awal; null bila semua sudah dites", async () => {
      const fx = await setup();
      const { run, ids } = await runWithCases(fx, 4);
      const [a, b, c, d] = ids as [string, string, string, string];
      const next = async (id: string) => (await getRunCase(fx, run.number, id)).nextUntestedId;

      expect(await next(b)).toBe(c);
      expect(await next(d)).toBe(a);
      await patchRunCaseOk(fx, run.number, c, { version: 1, status: "passed" });
      expect(await next(b)).toBe(d);
      await patchRunCaseOk(fx, run.number, d, { version: 1, status: "skipped" });
      expect(await next(b)).toBe(a);
      expect(await next(a)).toBe(b);
      await patchRunCaseOk(fx, run.number, a, { version: 1, status: "failed" });
      // Hanya b yang tersisa: case saat ini tidak dihitung.
      expect(await next(b)).toBeNull();
      expect(await next(a)).toBe(b);
      const last = await patchRunCaseOk(fx, run.number, b, { version: 1, status: "blocked" });
      expect(last.nextUntestedId).toBeNull();
      expect(await next(a)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("daftar & hapus", () => {
    it("daftar run: terbaru dulu, filter status & appVersion, 25 run → 20 + cursor → 5; cursor rusak → 400", async () => {
      const fx = await setup();
      const s = await createSuite(fx);
      await createCase(fx, s.id);
      for (let i = 1; i <= 25; i += 1) {
        await createRun(fx, { name: `Run ${i}`, suiteIds: [s.id], ...(i % 5 === 0 ? { appVersion: "2.0.0" } : {}) });
      }
      for (const number of [3, 7]) {
        const res = await patchRun(fx, number, { version: 1, status: "completed" });
        expect(res.statusCode, res.body).toBe(200);
      }

      const listRuns = async (query = "", cookie: string | null = fx.viewer.cookie) => {
        const res = await request("GET", fx, `/manual-runs${query ? `?${query}` : ""}`, cookie);
        expect(res.statusCode, res.body).toBe(200);
        return manualRunsPageDto.parse(res.json());
      };

      const first = await listRuns();
      expect(first.items.map((r) => r.number)).toEqual(Array.from({ length: 20 }, (_, i) => 25 - i));
      expect(first.items[0]).toMatchObject({ name: "Run 25", appVersion: "2.0.0", total: 1, progress: 0, status: "open" });
      expect(first.nextCursor).not.toBeNull();
      const second = await listRuns(`cursor=${first.nextCursor}`);
      expect(second.items.map((r) => r.number)).toEqual([5, 4, 3, 2, 1]);
      expect(second.nextCursor).toBeNull();
      expect(second.items.find((r) => r.number === 3)!.completedAt).not.toBeNull();

      expect((await listRuns("status=completed")).items.map((r) => r.number)).toEqual([7, 3]);
      expect((await listRuns("status=open")).items).toHaveLength(20);
      expect((await listRuns("status=all&appVersion=2.0.0")).items.map((r) => r.number)).toEqual([25, 20, 15, 10, 5]);
      expect((await listRuns("appVersion=9.9.9")).items).toEqual([]);
      expectError(await request("GET", fx, "/manual-runs?cursor=xyz", fx.viewer.cookie), 400, "VALIDATION_ERROR", "cursor");
      expectError(await request("GET", fx, "/manual-runs?status=aneh", fx.viewer.cookie), 400, "VALIDATION_ERROR");
    });

    it("daftar run case: filter status, assignee=me|none|uuid, suite", async () => {
      const fx = await setup();
      const login = await createSuite(fx, "Login");
      const bayar = await createSuite(fx, "Bayar");
      for (let i = 0; i < 2; i += 1) await createCase(fx, login.id);
      for (let i = 0; i < 2; i += 1) await createCase(fx, bayar.id);
      const run = await createRun(fx, { suiteIds: [login.id, bayar.id] });
      const ids = (await listRunCases(fx, run.number)).items.map((i) => i.id);
      await patchRunCaseOk(fx, run.number, ids[0]!, { version: 1, assigneeId: fx.tester.user.id, status: "passed" });
      await patchRunCaseOk(fx, run.number, ids[2]!, { version: 1, assigneeId: fx.viewer.user.id, status: "failed" });

      const pick = async (query: string, cookie: string | null = fx.tester.cookie) =>
        (await listRunCases(fx, run.number, query, cookie)).items.map((i) => i.id);
      expect(await pick("status=passed")).toEqual([ids[0]]);
      expect(await pick("status=untested")).toEqual([ids[1], ids[3]]);
      expect(await pick("assignee=me")).toEqual([ids[0]]);
      expect(await pick("assignee=me", fx.viewer.cookie)).toEqual([ids[2]]);
      expect(await pick("assignee=none")).toEqual([ids[1], ids[3]]);
      expect(await pick(`assignee=${fx.viewer.user.id}`)).toEqual([ids[2]]);
      expect(await pick("suite=Bayar")).toEqual([ids[2], ids[3]]);
      expect(await pick("suite=Bayar&status=failed&assignee=none")).toEqual([]);
      expect(await pick("suite=Tidak%20ada")).toEqual([]);
      const items = (await listRunCases(fx, run.number, "assignee=me")).items;
      expect(items[0]).toMatchObject({ assignee: { id: fx.tester.user.id, name: fx.tester.user.name }, status: "passed" });
      expect(items[0]!.executedAt).not.toBeNull();
      expectError(await request("GET", fx, `/manual-runs/${run.number}/cases?assignee=siapa`, fx.tester.cookie), 400, "VALIDATION_ERROR");
    });

    it("hapus run: admin 204, tester 403; sesudahnya 404 dan run case ikut terhapus", async () => {
      const fx = await setup();
      const { run, ids } = await runWithCases(fx, 2);
      expectError(await request("DELETE", fx, `/manual-runs/${run.number}`, fx.tester.cookie), 403, "FORBIDDEN");
      expect((await request("DELETE", fx, `/manual-runs/${run.number}`, fx.admin.cookie)).statusCode).toBe(204);
      expectError(await request("GET", fx, `/manual-runs/${run.number}`, fx.tester.cookie), 404, "MANUAL_RUN_NOT_FOUND");
      const left = await app.db.select({ id: manualRunCases.id }).from(manualRunCases).where(eq(manualRunCases.id, ids[0]!));
      expect(left).toEqual([]);
      // Nomor TR tidak dipakai ulang.
      const s = await createSuite(fx);
      await createCase(fx, s.id);
      expect((await createRun(fx, { suiteIds: [s.id] })).number).toBe(run.number + 1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("anggota dikeluarkan", () => {
    it("assignee run case-nya menjadi null (hanya di project itu)", async () => {
      const fx = await setup();
      const other = await setup();
      await addMember(app, other.project.id, fx.tester.user.id, "tester");
      const { run, ids } = await runWithCases(fx, 3);
      await patchRunCaseOk(fx, run.number, ids[0]!, { version: 1, assigneeId: fx.tester.user.id });
      await patchRunCaseOk(fx, run.number, ids[1]!, { version: 1, assigneeId: fx.viewer.user.id });
      const done = await patchRun(fx, run.number, { version: 1, status: "completed" });
      expect(done.statusCode).toBe(200);
      const otherRun = await runWithCases(other, 1);
      const otherRes = await patchRunCase(other, otherRun.run.number, otherRun.ids[0]!, { version: 1, assigneeId: fx.tester.user.id }, other.admin.cookie);
      expect(otherRes.statusCode, otherRes.body).toBe(200);

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/projects/${fx.project.slug}/members/${fx.tester.user.id}`,
        headers: { cookie: fx.admin.cookie },
      });
      expect(res.statusCode).toBe(204);

      const read = (f: Fixture, n: number, id: string) =>
        request("GET", f, `/manual-runs/${n}/cases/${id}`, f.admin.cookie).then((r) => runCaseDto.parse(r.json()));
      expect(await read(fx, run.number, ids[0]!)).toMatchObject({ assignee: null, version: 3 });
      expect((await read(fx, run.number, ids[1]!)).assignee?.id).toBe(fx.viewer.user.id);
      expect((await read(other, otherRun.run.number, otherRun.ids[0]!)).assignee?.id).toBe(fx.tester.user.id);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("otorisasi (spec §7.1)", () => {
    it("GET: anonim/non-anggota 404 di project privat, 200 di publik; tulis: 401/404/403, viewer 403", async () => {
      const priv = await setup();
      const pub = await setup({ visibility: "public" });
      const outsider = await registerUser(app);
      const p = await runWithCases(priv, 1);
      const q = await runWithCases(pub, 1);

      const reads = (n: number, id: string) => ["/manual-runs", `/manual-runs/${n}`, `/manual-runs/${n}/cases`, `/manual-runs/${n}/cases/${id}`];
      for (const path of reads(p.run.number, p.ids[0]!)) {
        expectError(await request("GET", priv, path, null), 404, "PROJECT_NOT_FOUND");
        expectError(await request("GET", priv, path, outsider.cookie), 404, "PROJECT_NOT_FOUND");
        expect((await request("GET", priv, path, priv.viewer.cookie)).statusCode, path).toBe(200);
      }
      for (const path of reads(q.run.number, q.ids[0]!)) {
        expect((await request("GET", pub, path, null)).statusCode, path).toBe(200);
        expect((await request("GET", pub, path, outsider.cookie)).statusCode, path).toBe(200);
      }

      type Call = (f: Fixture, w: { run: ManualRunDto; ids: string[]; suite: { id: string } }, cookie: string | null) => Promise<LightMyRequestResponse>;
      const writes: [string, Call][] = [
        ["POST /manual-runs", (f, w, ck) => request("POST", f, "/manual-runs", ck, { name: "Run baru", suiteIds: [w.suite.id] })],
        ["PATCH /manual-runs/:n", (f, w, ck) => request("PATCH", f, `/manual-runs/${w.run.number}`, ck, { version: 1, name: "Nama baru" })],
        ["PATCH run case", (f, w, ck) => request("PATCH", f, `/manual-runs/${w.run.number}/cases/${w.ids[0]}`, ck, { version: 1, status: "passed" })],
        ["DELETE /manual-runs/:n", (f, w, ck) => request("DELETE", f, `/manual-runs/${w.run.number}`, ck)],
      ];
      for (const [label, call] of writes) {
        expect((await call(priv, p, null)).statusCode, `${label} anonim`).toBe(401);
        expect((await call(priv, p, outsider.cookie)).statusCode, `${label} non-anggota privat`).toBe(404);
        expect((await call(pub, q, outsider.cookie)).statusCode, `${label} non-anggota publik`).toBe(403);
        expect((await call(priv, p, priv.viewer.cookie)).statusCode, `${label} viewer`).toBe(403);
      }
      expect((await getRun(priv, p.run.number)).version).toBe(1);
    });

    it("token CI diperlakukan anonim", async () => {
      const fx = await setup();
      const { run } = await runWithCases(fx, 1);
      const tokenRes = await request("POST", fx, "/tokens", fx.admin.cookie, { name: "CI" });
      const token = tokenRes.json().token as string;
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${fx.project.slug}/manual-runs/${run.number}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { version: 1, status: "completed" },
      });
      expectError(res, 401, "UNAUTHENTICATED");
    });
  });

  async function caseRowId(fx: Fixture, number: number) {
    const [row] = await app.db
      .select({ id: manualCases.id })
      .from(manualCases)
      .where(and(eq(manualCases.projectId, fx.project.id), eq(manualCases.number, number)));
    return row!.id;
  }
});
