import { faker } from "@faker-js/faker";
import {
  casesPageDto,
  manualCaseDto,
  suiteDto,
  testSearchItemDto,
  type ProjectDto,
  type SuiteDto,
} from "@testpulse/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import pg from "pg";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { caseSuites, manualCaseLabels, manualCases, projects, testCases } from "../../src/db/schema.js";
import { addMember, createProject, createTestApp, registerUser, type RegisteredUser } from "./helpers.js";

describe("API suite dan test case manual", () => {
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
    fx: Fixture | ProjectDto,
    path: string,
    cookie?: string | null,
    payload?: unknown,
  ) => {
    const slug = "project" in fx ? fx.project.slug : fx.slug;
    return app.inject({
      method,
      url: `/api/v1/projects/${slug}${path}`,
      headers: cookie ? { cookie } : {},
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  };

  function expectError(res: LightMyRequestResponse, status: number, code: string, field?: string) {
    expect(res.statusCode, res.body).toBe(status);
    expect(res.json().error.code).toBe(code);
    if (field !== undefined) expect(Object.keys(res.json().error.fields ?? {}), res.body).toContain(field);
  }

  async function createSuite(fx: Fixture, name = `Suite ${faker.string.alphanumeric(8)}`, cookie = fx.tester.cookie) {
    const res = await request("POST", fx, "/suites", cookie, { name });
    expect(res.statusCode, res.body).toBe(201);
    return suiteDto.parse(res.json());
  }

  async function listSuites(fx: Fixture, cookie: string | null = fx.tester.cookie): Promise<SuiteDto[]> {
    const res = await request("GET", fx, "/suites", cookie);
    expect(res.statusCode, res.body).toBe(200);
    return z.array(suiteDto).parse(res.json());
  }

  const step = (n = 1) => ({ action: `Langkah ${n}`, expected: `Hasil ${n}` });

  async function createCase(fx: Fixture, suiteId: string, payload: Record<string, unknown> = {}, cookie = fx.tester.cookie) {
    const res = await request("POST", fx, "/cases", cookie, {
      suiteId,
      title: `Case ${faker.string.alphanumeric(8)}`,
      steps: [step()],
      ...payload,
    });
    expect(res.statusCode, res.body).toBe(201);
    return manualCaseDto.parse(res.json());
  }

  const patchCase = (fx: Fixture, number: number | string, payload: Record<string, unknown>, cookie = fx.tester.cookie) =>
    request("PATCH", fx, `/cases/${number}`, cookie, payload);

  async function listPage(fx: Fixture, query = "", cookie: string | null = fx.tester.cookie) {
    const res = await request("GET", fx, `/cases${query ? `?${query}` : ""}`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return casesPageDto.parse(res.json());
  }

  async function seedTest(projectId: string, suite: string, name: string) {
    const [row] = await app.db.insert(testCases).values({ projectId, suite, name }).returning({ id: testCases.id });
    return row!.id;
  }

  async function caseRowId(projectId: string, number: number) {
    const [row] = await app.db
      .select({ id: manualCases.id })
      .from(manualCases)
      .where(and(eq(manualCases.projectId, projectId), eq(manualCases.number, number)));
    if (!row) throw new Error(`case ${number} tidak ada`);
    return row.id;
  }

  async function dbLabels(projectId: string, number: number) {
    const rows = await app.db
      .select({ label: manualCaseLabels.label })
      .from(manualCaseLabels)
      .where(eq(manualCaseLabels.caseId, await caseRowId(projectId, number)));
    return rows.map((r) => r.label).sort();
  }

  // ---------------------------------------------------------------------------------------------------------
  describe("suite", () => {
    it("membuat suite di posisi terakhir dan mengembalikan jumlah case", async () => {
      const fx = await setup();
      const a = await createSuite(fx, "Login");
      const b = await createSuite(fx, "Checkout");
      expect(a).toEqual({ id: a.id, name: "Login", description: "", position: 0, activeCount: 0, archivedCount: 0 });
      expect(b.position).toBe(1);

      const res = await request("POST", fx, "/suites", fx.tester.cookie, { name: "  Profil  ", description: "Halaman profil" });
      expect(res.statusCode).toBe(201);
      expect(suiteDto.parse(res.json())).toMatchObject({ name: "Profil", description: "Halaman profil", position: 2 });
      expect((await listSuites(fx)).map((s) => s.name)).toEqual(["Login", "Checkout", "Profil"]);
    });

    it("menghitung case aktif dan arsip per suite", async () => {
      const fx = await setup();
      const s = await createSuite(fx);
      const other = await createSuite(fx);
      await createCase(fx, s.id);
      await createCase(fx, s.id);
      const archived = await createCase(fx, s.id);
      expect((await patchCase(fx, archived.number, { version: 1, archived: true })).statusCode).toBe(200);

      const suites = await listSuites(fx);
      expect(suites.find((x) => x.id === s.id)).toMatchObject({ activeCount: 2, archivedCount: 1 });
      expect(suites.find((x) => x.id === other.id)).toMatchObject({ activeCount: 0, archivedCount: 0 });
    });

    it("menolak input tidak valid", async () => {
      const fx = await setup();
      expectError(await request("POST", fx, "/suites", fx.tester.cookie, { name: "   " }), 400, "VALIDATION_ERROR", "name");
      expectError(
        await request("POST", fx, "/suites", fx.tester.cookie, { name: "x".repeat(101) }),
        400,
        "VALIDATION_ERROR",
        "name",
      );
      expectError(
        await request("POST", fx, "/suites", fx.tester.cookie, { name: "ok", description: "x".repeat(2001) }),
        400,
        "VALIDATION_ERROR",
        "description",
      );
    });

    it("Review Focus 1: ganti huruf besar/kecil nama sendiri diterima, nama suite lain yang sama ditolak", async () => {
      const fx = await setup();
      const login = await createSuite(fx, "login");
      const other = await createSuite(fx, "Checkout");

      const rename = await request("PATCH", fx, `/suites/${login.id}`, fx.tester.cookie, { name: "Login" });
      expect(rename.statusCode, rename.body).toBe(200);
      expect(suiteDto.parse(rename.json()).name).toBe("Login");

      const clash = await request("PATCH", fx, `/suites/${other.id}`, fx.tester.cookie, { name: "LOGIN" });
      expectError(clash, 400, "VALIDATION_ERROR", "name");
      expect(clash.json().error.fields.name).toBe("Nama suite sudah dipakai");

      const dup = await request("POST", fx, "/suites", fx.tester.cookie, { name: "lOgIn" });
      expectError(dup, 400, "VALIDATION_ERROR", "name");
      expect(dup.json().error.fields.name).toBe("Nama suite sudah dipakai");

      // Project lain boleh memakai nama yang sama.
      const fx2 = await setup();
      await createSuite(fx2, "Login");
    });

    it("pembuatan paralel dengan nama sama: satu berhasil, sisanya 400 fields.name", async () => {
      const fx = await setup();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => request("POST", fx, "/suites", fx.tester.cookie, { name: "Paralel" })),
      );
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
      for (const r of results.filter((x) => x.statusCode !== 201)) expectError(r, 400, "VALIDATION_ERROR", "name");
    });

    it("suite ke-201 ditolak 400", async () => {
      const fx = await setup();
      await app.db.insert(caseSuites).values(
        Array.from({ length: 200 }, (_, i) => ({ projectId: fx.project.id, name: `S${i}`, position: i })),
      );
      const res = await request("POST", fx, "/suites", fx.tester.cookie, { name: "Terlalu banyak" });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(await listSuites(fx)).toHaveLength(200);
    });

    it("mengubah deskripsi dan menolak PATCH kosong", async () => {
      const fx = await setup();
      const s = await createSuite(fx);
      const res = await request("PATCH", fx, `/suites/${s.id}`, fx.tester.cookie, { description: "Baru" });
      expect(suiteDto.parse(res.json())).toMatchObject({ name: s.name, description: "Baru" });
      expectError(await request("PATCH", fx, `/suites/${s.id}`, fx.tester.cookie, {}), 400, "VALIDATION_ERROR");
    });

    it("memindah posisi 0 ↔ akhir menomori ulang semua suite tanpa celah; position 99 dibatasi", async () => {
      const fx = await setup();
      const [a, b, , d] = [
        await createSuite(fx, "A"),
        await createSuite(fx, "B"),
        await createSuite(fx, "C"),
        await createSuite(fx, "D"),
      ] as [SuiteDto, SuiteDto, SuiteDto, SuiteDto];

      let res = await request("PATCH", fx, `/suites/${a.id}`, fx.tester.cookie, { position: 3 });
      expect(res.statusCode, res.body).toBe(200);
      expect(suiteDto.parse(res.json()).position).toBe(3);
      let suites = await listSuites(fx);
      expect(suites.map((s) => [s.name, s.position])).toEqual([["B", 0], ["C", 1], ["D", 2], ["A", 3]]);

      res = await request("PATCH", fx, `/suites/${a.id}`, fx.tester.cookie, { position: 0 });
      expect(res.statusCode).toBe(200);
      suites = await listSuites(fx);
      expect(suites.map((s) => [s.name, s.position])).toEqual([["A", 0], ["B", 1], ["C", 2], ["D", 3]]);

      // position di luar rentang dibatasi ke akhir.
      res = await request("PATCH", fx, `/suites/${b.id}`, fx.tester.cookie, { position: 99 });
      expect(res.statusCode, res.body).toBe(200);
      expect(suiteDto.parse(res.json()).position).toBe(3);
      suites = await listSuites(fx);
      expect(suites.map((s) => [s.name, s.position])).toEqual([["A", 0], ["C", 1], ["D", 2], ["B", 3]]);

      // nama dan posisi sekaligus.
      res = await request("PATCH", fx, `/suites/${d.id}`, fx.tester.cookie, { name: "D2", position: 0 });
      expect(suiteDto.parse(res.json())).toMatchObject({ name: "D2", position: 0 });
      expect((await listSuites(fx)).map((s) => s.position)).toEqual([0, 1, 2, 3]);
    });

    it("pemindahan paralel tetap menghasilkan posisi 0..n-1 tanpa duplikat", async () => {
      const fx = await setup();
      const created: SuiteDto[] = [];
      for (let i = 0; i < 5; i += 1) created.push(await createSuite(fx, `P${i}`));
      const targets = [4, 0, 2, 3, 1];
      const responses = await Promise.all(
        created.map((s, i) => request("PATCH", fx, `/suites/${s.id}`, fx.tester.cookie, { position: targets[i] })),
      );
      for (const r of responses) expect(r.statusCode, r.body).toBe(200);
      expect((await listSuites(fx)).map((s) => s.position)).toEqual([0, 1, 2, 3, 4]);
    });

    it("menghapus suite kosong → 204; suite berisi case (termasuk arsip) → 409 SUITE_NOT_EMPTY", async () => {
      const fx = await setup();
      const empty = await createSuite(fx);
      const full = await createSuite(fx);
      const c = await createCase(fx, full.id);
      expect((await patchCase(fx, c.number, { version: 1, archived: true })).statusCode).toBe(200);

      const blocked = await request("DELETE", fx, `/suites/${full.id}`, fx.admin.cookie);
      expectError(blocked, 409, "SUITE_NOT_EMPTY");
      expect(blocked.json().error.message).toBe("Pindahkan atau hapus case di suite ini terlebih dahulu.");

      expect((await request("DELETE", fx, `/suites/${empty.id}`, fx.admin.cookie)).statusCode).toBe(204);
      expect((await listSuites(fx)).map((s) => s.id)).toEqual([full.id]);
      expectError(await request("DELETE", fx, `/suites/${empty.id}`, fx.admin.cookie), 404, "SUITE_NOT_FOUND");
    });

    it("suite project lain → 404 SUITE_NOT_FOUND; id bukan uuid → 404", async () => {
      const fx = await setup();
      const other = await setup();
      const foreign = await createSuite(other);
      expectError(
        await request("PATCH", fx, `/suites/${foreign.id}`, fx.tester.cookie, { name: "X" }),
        404,
        "SUITE_NOT_FOUND",
      );
      expectError(await request("DELETE", fx, `/suites/${foreign.id}`, fx.admin.cookie), 404, "SUITE_NOT_FOUND");
      expectError(await request("PATCH", fx, "/suites/abc", fx.tester.cookie, { name: "X" }), 404, "SUITE_NOT_FOUND");
      expectError(await request("DELETE", fx, "/suites/abc", fx.admin.cookie), 404, "SUITE_NOT_FOUND");
      expect((await listSuites(other)).map((s) => s.id)).toEqual([foreign.id]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("case: buat & ubah", () => {
    it("membuat case TC-1 dengan default medium", async () => {
      const fx = await setup();
      const suite = await createSuite(fx, "Login");
      const res = await request("POST", fx, "/cases", fx.tester.cookie, {
        suiteId: suite.id,
        title: "  Login berhasil  ",
        steps: [{ action: "  Buka halaman login  ", expected: "" }, step(2)],
        labels: ["UI", " smoke "],
      });
      expect(res.statusCode, res.body).toBe(201);
      const c = manualCaseDto.parse(res.json());
      expect(c).toMatchObject({
        number: 1,
        title: "Login berhasil",
        preconditions: "",
        priority: "medium",
        labels: ["smoke", "ui"],
        archivedAt: null,
        version: 1,
        suite: { id: suite.id, name: "Login" },
        createdBy: { id: fx.tester.user.id },
        updatedBy: { id: fx.tester.user.id },
        automatedTest: null,
        recentResults: [],
      });
      expect(c.steps).toEqual([{ action: "Buka halaman login", expected: "" }, step(2)]);
    });

    it("20 case dibuat paralel → nomor 1–20 unik; hapus TC-20 lalu case baru → TC-21", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          request("POST", fx, "/cases", fx.tester.cookie, { suiteId: suite.id, title: `Paralel ${i}`, steps: [step()] }),
        ),
      );
      for (const r of responses) expect(r.statusCode, r.body).toBe(201);
      const numbers = responses.map((r) => manualCaseDto.parse(r.json()).number).sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

      expect((await request("DELETE", fx, "/cases/20", fx.admin.cookie)).statusCode).toBe(204);
      expect((await createCase(fx, suite.id)).number).toBe(21);
    });

    it("validasi: judul, langkah, label, prioritas; error langkah memakai steps.<i>.action", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      const post = (payload: Record<string, unknown>) =>
        request("POST", fx, "/cases", fx.tester.cookie, { suiteId: suite.id, title: "Judul valid", steps: [step()], ...payload });

      expectError(await post({ title: "ab" }), 400, "VALIDATION_ERROR", "title");
      expectError(await post({ steps: [] }), 400, "VALIDATION_ERROR", "steps");
      expectError(await post({ steps: [step(), { action: "   ", expected: "x" }] }), 400, "VALIDATION_ERROR", "steps.1.action");
      expectError(await post({ steps: Array.from({ length: 51 }, (_, i) => step(i)) }), 400, "VALIDATION_ERROR", "steps");
      expectError(await post({ priority: "critical" }), 400, "VALIDATION_ERROR", "priority");
      expectError(await post({ labels: ["a", "A"] }), 400, "VALIDATION_ERROR", "labels");
      expectError(await post({ labels: ["bad label"] }), 400, "VALIDATION_ERROR", "labels.0");
      expectError(await post({ suiteId: "bukan-uuid" }), 400, "VALIDATION_ERROR", "suiteId");
      // Penolakan tidak menaikkan nomor.
      expect((await createCase(fx, suite.id)).number).toBe(1);
    });

    it("suiteId dan automatedTestId project lain → 400 pada field-nya", async () => {
      const fx = await setup();
      const other = await setup();
      const suite = await createSuite(fx);
      const foreignSuite = await createSuite(other);
      const foreignTest = await seedTest(other.project.id, "checkout", "bayar");
      const ownTest = await seedTest(fx.project.id, "checkout", "bayar");

      const post = (payload: Record<string, unknown>) =>
        request("POST", fx, "/cases", fx.tester.cookie, { suiteId: suite.id, title: "Judul valid", steps: [step()], ...payload });
      expectError(await post({ suiteId: foreignSuite.id }), 400, "VALIDATION_ERROR", "suiteId");
      expectError(await post({ suiteId: faker.string.uuid() }), 400, "VALIDATION_ERROR", "suiteId");
      expectError(await post({ automatedTestId: foreignTest }), 400, "VALIDATION_ERROR", "automatedTestId");
      expectError(await post({ automatedTestId: faker.string.uuid() }), 400, "VALIDATION_ERROR", "automatedTestId");

      const c = await createCase(fx, suite.id);
      expectError(
        await patchCase(fx, c.number, { version: 1, suiteId: foreignSuite.id }),
        400,
        "VALIDATION_ERROR",
        "suiteId",
      );
      expectError(
        await patchCase(fx, c.number, { version: 1, automatedTestId: foreignTest }),
        400,
        "VALIDATION_ERROR",
        "automatedTestId",
      );

      const linked = await createCase(fx, suite.id, { automatedTestId: ownTest });
      expect(linked.automatedTest).toEqual({ id: ownTest, suite: "checkout", name: "bayar", lastResult: null });
      expect(linked.recentResults).toEqual([]);
      // Nomor tidak terbuang oleh penolakan di atas: case pertama TC-1, kedua TC-2.
      expect([c.number, linked.number]).toEqual([1, 2]);
    });

    it("version basi → 409 CASE_CONFLICT tanpa perubahan; version cocok menaikkan version", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      const c = await createCase(fx, suite.id, { title: "Judul awal" });

      const ok = await patchCase(fx, c.number, { version: 1, title: "Judul kedua" });
      expect(ok.statusCode, ok.body).toBe(200);
      const updated = manualCaseDto.parse(ok.json());
      expect(updated).toMatchObject({ title: "Judul kedua", version: 2, updatedBy: { id: fx.tester.user.id } });

      const stale = await patchCase(fx, c.number, { version: 1, title: "Judul basi" }, fx.admin.cookie);
      expectError(stale, 409, "CASE_CONFLICT");
      const after = manualCaseDto.parse((await request("GET", fx, `/cases/${c.number}`, fx.tester.cookie)).json());
      expect(after).toMatchObject({ title: "Judul kedua", version: 2 });
    });

    it("perubahan tanpa efek tidak menaikkan version; PATCH tanpa field → 400", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      const c = await createCase(fx, suite.id, { title: "Judul tetap", labels: ["a"] });
      const same = await patchCase(fx, c.number, { version: 1, title: "Judul tetap", labels: ["a"], archived: false });
      expect(manualCaseDto.parse(same.json()).version).toBe(1);
      expectError(await patchCase(fx, c.number, { version: 1 }), 400, "VALIDATION_ERROR");
    });

    it("pindah suite, arsip & pulihkan, steps/labels mengganti seluruh daftar, lepas tautan otomasi", async () => {
      const fx = await setup();
      const s1 = await createSuite(fx, "Satu");
      const s2 = await createSuite(fx, "Dua");
      const testId = await seedTest(fx.project.id, "auth", "login ok");
      const c = await createCase(fx, s1.id, {
        steps: [step(1), step(2), step(3)],
        labels: ["a", "b"],
        automatedTestId: testId,
      });

      let res = await patchCase(fx, c.number, { version: 1, suiteId: s2.id });
      expect(manualCaseDto.parse(res.json())).toMatchObject({ suite: { id: s2.id, name: "Dua" }, version: 2 });

      res = await patchCase(fx, c.number, { version: 2, steps: [step(9)], labels: ["z"], priority: "urgent", preconditions: "Sudah login" });
      let now = manualCaseDto.parse(res.json());
      expect(now.steps).toEqual([step(9)]);
      expect(now).toMatchObject({ labels: ["z"], priority: "urgent", preconditions: "Sudah login", version: 3 });
      expect(await dbLabels(fx.project.id, c.number)).toEqual(["z"]);

      res = await patchCase(fx, c.number, { version: 3, archived: true });
      now = manualCaseDto.parse(res.json());
      expect(now.archivedAt).not.toBeNull();
      const archivedAt = now.archivedAt;
      // Mengarsipkan lagi tidak mengubah apa pun.
      res = await patchCase(fx, c.number, { version: 4, archived: true });
      expect(manualCaseDto.parse(res.json())).toMatchObject({ archivedAt, version: 4 });

      res = await patchCase(fx, c.number, { version: 4, archived: false });
      expect(manualCaseDto.parse(res.json())).toMatchObject({ archivedAt: null, version: 5 });

      res = await patchCase(fx, c.number, { version: 5, automatedTestId: null, labels: [] });
      now = manualCaseDto.parse(res.json());
      expect(now).toMatchObject({ automatedTest: null, labels: [], version: 6 });
    });

    it("PATCH paralel dengan version sama: satu menang, sisanya 409", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      const c = await createCase(fx, suite.id);
      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, i) => patchCase(fx, c.number, { version: 1, title: `Judul ${i} baru` })),
      );
      expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(1);
      for (const r of responses.filter((x) => x.statusCode !== 200)) expectError(r, 409, "CASE_CONFLICT");
    });

    it("nomor tidak valid atau tidak ada → 404 CASE_NOT_FOUND", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      await createCase(fx, suite.id);
      for (const bad of ["0", "abc", "-1", "1.5", "99999999999", "999"]) {
        expectError(await request("GET", fx, `/cases/${bad}`, fx.tester.cookie), 404, "CASE_NOT_FOUND");
        expectError(await patchCase(fx, bad, { version: 1, title: "Judul valid" }), 404, "CASE_NOT_FOUND");
        expectError(await request("DELETE", fx, `/cases/${bad}`, fx.admin.cookie), 404, "CASE_NOT_FOUND");
      }
    });

    it("menghapus suite lain tidak mengubah case; memindah ke suite yang dihapus → 400", async () => {
      const fx = await setup();
      const s1 = await createSuite(fx);
      const s2 = await createSuite(fx);
      const c = await createCase(fx, s1.id);
      expect((await request("DELETE", fx, `/suites/${s2.id}`, fx.admin.cookie)).statusCode).toBe(204);
      expectError(await patchCase(fx, c.number, { version: 1, suiteId: s2.id }), 400, "VALIDATION_ERROR", "suiteId");
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("case: daftar & cari", () => {
    it("urut posisi suite lalu nomor; item sesuai DTO", async () => {
      const fx = await setup();
      const s1 = await createSuite(fx, "Satu");
      const s2 = await createSuite(fx, "Dua");
      const a = await createCase(fx, s2.id, { title: "Di suite dua" });
      const b = await createCase(fx, s1.id, { title: "Di suite satu", labels: ["x"], steps: [step(1), step(2)] });
      const c = await createCase(fx, s2.id, { title: "Lagi di dua" });

      const page = await listPage(fx);
      expect(page.items.map((i) => i.number)).toEqual([b.number, a.number, c.number]);
      expect(page.nextCursor).toBeNull();
      expect(page.items[0]).toMatchObject({
        number: b.number,
        title: "Di suite satu",
        suite: { id: s1.id, name: "Satu" },
        priority: "medium",
        labels: ["x"],
        stepCount: 2,
        automated: false,
        archived: false,
      });

      // Urutan mengikuti posisi suite setelah suite dipindah.
      await request("PATCH", fx, `/suites/${s2.id}`, fx.tester.cookie, { position: 0 });
      expect((await listPage(fx)).items.map((i) => i.number)).toEqual([a.number, c.number, b.number]);
    });

    it("filter suite, priority, label (UI cocok dengan ui), automated, archived", async () => {
      const fx = await setup();
      const s1 = await createSuite(fx, "Satu");
      const s2 = await createSuite(fx, "Dua");
      const testId = await seedTest(fx.project.id, "auth", "login");
      const c1 = await createCase(fx, s1.id, { priority: "high", labels: ["ui", "smoke"] });
      const c2 = await createCase(fx, s2.id, { priority: "low", labels: ["api"], automatedTestId: testId });
      const c3 = await createCase(fx, s2.id, { priority: "high", labels: ["ui"] });
      await patchCase(fx, c3.number, { version: 1, archived: true });
      const nums = async (query: string) => (await listPage(fx, query)).items.map((i) => i.number);

      expect(await nums(`suite=${s2.id}`)).toEqual([c2.number]);
      expect(await nums("priority=high")).toEqual([c1.number]);
      expect(await nums("label=UI")).toEqual([c1.number]);
      expect(await nums("label=ui&archived=true")).toEqual([c3.number]);
      expect(await nums("automated=yes")).toEqual([c2.number]);
      expect(await nums("automated=no")).toEqual([c1.number]);
      expect(await nums("archived=true")).toEqual([c3.number]);
      expect(await nums("archived=false")).toEqual([c1.number, c2.number]);
      expect(await nums(`suite=${s1.id}&priority=low`)).toEqual([]);
      expect((await listPage(fx, "automated=yes")).items[0]).toMatchObject({ automated: true });
      expect((await listPage(fx, "archived=true")).items[0]).toMatchObject({ archived: true });
    });

    it("q mencocokkan judul literal (% dan _), tidak peka huruf besar/kecil", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      const pct = await createCase(fx, suite.id, { title: "Diskon 100% berlaku" });
      const und = await createCase(fx, suite.id, { title: "Nama user_name valid" });
      const plain = await createCase(fx, suite.id, { title: "Diskon 100 persen" });
      const back = await createCase(fx, suite.id, { title: "Path C:\\temp" });
      const nums = async (q: string) => (await listPage(fx, `q=${encodeURIComponent(q)}`)).items.map((i) => i.number);

      expect(await nums("100%")).toEqual([pct.number]);
      expect(await nums("r_n")).toEqual([und.number]);
      expect(await nums("%")).toEqual([pct.number]);
      expect(await nums("_")).toEqual([und.number]);
      expect(await nums("DISKON")).toEqual([pct.number, plain.number]);
      expect(await nums("c:\\t")).toEqual([back.number]);
      expect(await nums("tidak ada")).toEqual([]);
      expectError(await request("GET", fx, `/cases?q=${"x".repeat(101)}`, fx.tester.cookie), 400, "VALIDATION_ERROR", "q");
    });

    it("60 case → 50 + cursor → 10; cursor rusak → 400", async () => {
      const fx = await setup();
      const s1 = await createSuite(fx);
      const s2 = await createSuite(fx);
      const rows = Array.from({ length: 60 }, (_, i) => ({
        projectId: fx.project.id,
        number: i + 1,
        suiteId: i % 2 === 0 ? s2.id : s1.id,
        title: `Bulk ${i + 1}`,
        steps: [step()],
        createdBy: fx.tester.user.id,
        updatedBy: fx.tester.user.id,
      }));
      await app.db.insert(manualCases).values(rows);
      await app.db.update(projects).set({ caseSeq: 60 }).where(eq(projects.id, fx.project.id));

      const page1 = await listPage(fx);
      expect(page1.items).toHaveLength(50);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await listPage(fx, `cursor=${encodeURIComponent(page1.nextCursor!)}`);
      expect(page2.items).toHaveLength(10);
      expect(page2.nextCursor).toBeNull();

      const all = [...page1.items, ...page2.items].map((i) => i.number);
      expect(new Set(all).size).toBe(60);
      // s1 (posisi 0) memuat nomor genap, lalu s2 memuat nomor ganjil; masing-masing menaik.
      const evens = Array.from({ length: 30 }, (_, i) => (i + 1) * 2);
      const odds = Array.from({ length: 30 }, (_, i) => i * 2 + 1);
      expect(all).toEqual([...evens, ...odds]);

      for (const bad of ["abc$", "Zm9vYmFy", ""]) {
        expectError(await request("GET", fx, `/cases?cursor=${encodeURIComponent(bad)}`, fx.tester.cookie), 400, "VALIDATION_ERROR");
      }
    });

    it("coverage dihitung dari seluruh case aktif, tidak ikut filter", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      const t1 = await seedTest(fx.project.id, "a", "satu");
      const t2 = await seedTest(fx.project.id, "a", "dua");
      await createCase(fx, suite.id, { automatedTestId: t1, priority: "high" });
      await createCase(fx, suite.id, { automatedTestId: t2 });
      await createCase(fx, suite.id);
      const arch = await createCase(fx, suite.id, { automatedTestId: t1 });
      await patchCase(fx, arch.number, { version: 1, archived: true });

      expect((await listPage(fx)).coverage).toEqual({ active: 3, automated: 2 });
      expect((await listPage(fx, "priority=high")).coverage).toEqual({ active: 3, automated: 2 });
      expect((await listPage(fx, "archived=true")).coverage).toEqual({ active: 3, automated: 2 });
      expect((await listPage(fx, "automated=no&q=zzz")).coverage).toEqual({ active: 3, automated: 2 });
      const empty = await setup();
      expect((await listPage(empty)).coverage).toEqual({ active: 0, automated: 0 });
    });

    it("menghapus automated test melepas tautan case (coverage turun)", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      const t = await seedTest(fx.project.id, "a", "satu");
      const c = await createCase(fx, suite.id, { automatedTestId: t });
      await app.db.delete(testCases).where(eq(testCases.id, t));
      const detail = manualCaseDto.parse((await request("GET", fx, `/cases/${c.number}`, fx.tester.cookie)).json());
      expect(detail.automatedTest).toBeNull();
      expect((await listPage(fx)).coverage).toEqual({ active: 1, automated: 0 });
    });

    it("daftar case (termasuk cakupan) melewati batas waktu baca → 503 INTERNAL_ERROR; tanpa hambatan → 200", async () => {
      const slowApp = await createTestApp({}, { readStatementTimeoutMs: 200 });
      const fx = await setup();
      const s = await createSuite(fx);
      await createCase(fx, s.id);
      const get = () =>
        slowApp.inject({ method: "GET", url: `/api/v1/projects/${fx.project.slug}/cases`, headers: { cookie: fx.tester.cookie } });

      // Koneksi lain mengunci tabel `manual_cases` sehingga query daftar menunggu sampai statement_timeout membatalkannya.
      const locker = new pg.Client({ connectionString: inject("databaseUrl") });
      await locker.connect();
      try {
        await locker.query("begin");
        await locker.query("lock table manual_cases in access exclusive mode");
        const res = await get();
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: expect.any(String) } });
      } finally {
        await locker.query("rollback");
        await locker.end();
      }
      const ok = await get();
      expect(ok.statusCode, ok.body).toBe(200);
      expect(casesPageDto.parse(ok.json()).items).toHaveLength(1);
      await slowApp.close();
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("label, pencarian test, hapus", () => {
    it("labels unik dan urut abjad, hanya project ini", async () => {
      const fx = await setup();
      const other = await setup();
      const suite = await createSuite(fx);
      const otherSuite = await createSuite(other);
      await createCase(fx, suite.id, { labels: ["zeta", "alpha"] });
      await createCase(fx, suite.id, { labels: ["alpha", "mid-1"] });
      await createCase(other, otherSuite.id, { labels: ["asing"] });

      const res = await request("GET", fx, "/cases/labels", fx.viewer.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(["alpha", "mid-1", "zeta"]);
      expect((await request("GET", other, "/cases/labels", other.tester.cookie)).json()).toEqual(["asing"]);
    });

    it("labels dibatasi 200", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      const c = await createCase(fx, suite.id);
      const caseId = await caseRowId(fx.project.id, c.number);
      await app.db.insert(manualCaseLabels).values(
        Array.from({ length: 250 }, (_, i) => ({
          caseId,
          label: `l${String(i).padStart(3, "0")}`,
        })),
      );
      const res = await request("GET", fx, "/cases/labels", fx.tester.cookie);
      expect(res.json()).toHaveLength(200);
    });

    it("GET /tests?q= mencari nama atau suite, maks 20, hanya project ini", async () => {
      const fx = await setup();
      const other = await setup();
      await seedTest(fx.project.id, "login", "masuk dengan email");
      await seedTest(fx.project.id, "checkout", "Lokasi pengiriman");
      await seedTest(fx.project.id, "profil", "ubah avatar");
      await seedTest(other.project.id, "login", "milik project lain");
      for (let i = 0; i < 25; i += 1) await seedTest(fx.project.id, "bulk", `lo item ${String(i).padStart(2, "0")}`);

      const get = async (q: string, f: Fixture = fx) => request("GET", f, `/tests?q=${encodeURIComponent(q)}`, f.viewer.cookie ?? f.tester.cookie);

      const byName = await get("avatar");
      expect(byName.statusCode).toBe(200);
      expect(z.array(testSearchItemDto).parse(byName.json()).map((t) => [t.suite, t.name])).toEqual([["profil", "ubah avatar"]]);

      const bySuite = z.array(testSearchItemDto).parse((await get("CHECK")).json());
      expect(bySuite.map((t) => t.name)).toEqual(["Lokasi pengiriman"]);

      const lo = z.array(testSearchItemDto).parse((await get("lo")).json());
      expect(lo).toHaveLength(20);
      expect(lo.every((t) => /lo/i.test(t.suite) || /lo/i.test(t.name))).toBe(true);
      expect(lo.map((t) => t.name)).not.toContain("milik project lain");

      expect((await get("%%")).json()).toEqual([]);
      expect((await get("l_")).json()).toEqual([]);
      expectError(await get("l"), 400, "VALIDATION_ERROR", "q");
      expectError(await get(""), 400, "VALIDATION_ERROR", "q");
      expectError(await request("GET", fx, "/tests", fx.tester.cookie), 400, "VALIDATION_ERROR", "q");
      expectError(await get("x".repeat(101)), 400, "VALIDATION_ERROR", "q");
    });

    it("hapus case: admin 204, tester 403, sesudahnya 404 CASE_NOT_FOUND; label ikut terhapus", async () => {
      const fx = await setup();
      const suite = await createSuite(fx);
      const c = await createCase(fx, suite.id, { labels: ["a", "b"] });
      const rowId = await caseRowId(fx.project.id, c.number);

      expectError(await request("DELETE", fx, `/cases/${c.number}`, fx.tester.cookie), 403, "FORBIDDEN");
      expectError(await request("DELETE", fx, `/cases/${c.number}`, fx.viewer.cookie), 403, "FORBIDDEN");
      expectError(await request("DELETE", fx, `/cases/${c.number}`, null), 401, "UNAUTHENTICATED");

      expect((await request("DELETE", fx, `/cases/${c.number}`, fx.admin.cookie)).statusCode).toBe(204);
      expectError(await request("GET", fx, `/cases/${c.number}`, fx.tester.cookie), 404, "CASE_NOT_FOUND");
      expectError(await request("DELETE", fx, `/cases/${c.number}`, fx.admin.cookie), 404, "CASE_NOT_FOUND");
      expect(await app.db.select().from(manualCaseLabels).where(eq(manualCaseLabels.caseId, rowId))).toEqual([]);
      // Suite kini kosong dan bisa dihapus.
      expect((await request("DELETE", fx, `/suites/${suite.id}`, fx.admin.cookie)).statusCode).toBe(204);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe("otorisasi (spec §7.1)", () => {
    it("GET: anonim/non-anggota 404 di project privat, 200 di publik; viewer 200", async () => {
      const priv = await setup();
      const pub = await setup({ visibility: "public" });
      const outsider = await registerUser(app);
      const s = await createSuite(priv);
      const c = await createCase(priv, s.id);
      const ps = await createSuite(pub);
      const pc = await createCase(pub, ps.id);

      const paths = ["/suites", "/cases", "/cases/labels", `/cases/${c.number}`, "/tests?q=ab"];
      for (const path of paths) {
        expectError(await request("GET", priv, path, null), 404, "PROJECT_NOT_FOUND");
        expectError(await request("GET", priv, path, outsider.cookie), 404, "PROJECT_NOT_FOUND");
        expect((await request("GET", priv, path, priv.viewer.cookie)).statusCode, path).toBe(200);
      }
      for (const path of ["/suites", "/cases", "/cases/labels", `/cases/${pc.number}`, "/tests?q=ab"]) {
        expect((await request("GET", pub, path, null)).statusCode, path).toBe(200);
        expect((await request("GET", pub, path, outsider.cookie)).statusCode, path).toBe(200);
      }
    });

    it("tulis: anonim 401, non-anggota 404 (privat) / 403 (publik), viewer 403, tester 2xx", async () => {
      const priv = await setup();
      const pub = await setup({ visibility: "public" });
      const outsider = await registerUser(app);
      const s = await createSuite(priv);
      const c = await createCase(priv, s.id);
      const ps = await createSuite(pub);
      const pc = await createCase(pub, ps.id);

      const writes: [string, (f: Fixture, suiteId: string, caseNumber: number, cookie: string | null) => Promise<LightMyRequestResponse>][] = [
        ["POST /suites", (f, _s, _c, ck) => request("POST", f, "/suites", ck, { name: "Baru" })],
        ["PATCH /suites/:id", (f, sid, _c, ck) => request("PATCH", f, `/suites/${sid}`, ck, { description: "d" })],
        ["POST /cases", (f, sid, _c, ck) => request("POST", f, "/cases", ck, { suiteId: sid, title: "Judul valid", steps: [step()] })],
        ["PATCH /cases/:n", (f, _s, n, ck) => request("PATCH", f, `/cases/${n}`, ck, { version: 1, title: "Judul valid" })],
        ["DELETE /suites/:id", (f, sid, _c, ck) => request("DELETE", f, `/suites/${sid}`, ck)],
        ["DELETE /cases/:n", (f, _s, n, ck) => request("DELETE", f, `/cases/${n}`, ck)],
      ];
      for (const [label, call] of writes) {
        expect((await call(priv, s.id, c.number, null)).statusCode, `${label} anonim`).toBe(401);
        expect((await call(priv, s.id, c.number, outsider.cookie)).statusCode, `${label} non-anggota privat`).toBe(404);
        expect((await call(pub, ps.id, pc.number, outsider.cookie)).statusCode, `${label} non-anggota publik`).toBe(403);
        expect((await call(priv, s.id, c.number, priv.viewer.cookie)).statusCode, `${label} viewer`).toBe(403);
      }
      // Tester: tulis diterima, hapus ditolak.
      expect((await request("PATCH", priv, `/suites/${s.id}`, priv.tester.cookie, { description: "d" })).statusCode).toBe(200);
      expectError(await request("DELETE", priv, `/suites/${s.id}`, priv.tester.cookie), 403, "FORBIDDEN");
      expectError(await request("DELETE", priv, `/cases/${c.number}`, priv.tester.cookie), 403, "FORBIDDEN");
      // Tidak ada yang berubah akibat penolakan.
      expect((await listSuites(priv, priv.admin.cookie)).map((x) => x.id)).toEqual([s.id]);
    });

    it("token CI diperlakukan anonim di endpoint baru", async () => {
      const fx = await setup();
      const tokenRes = await request("POST", fx, "/tokens", fx.admin.cookie, { name: "CI" });
      expect(tokenRes.statusCode).toBe(201);
      const token = tokenRes.json().token as string;
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${fx.project.slug}/suites`,
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Lewat token" },
      });
      expectError(res, 401, "UNAUTHENTICATED");
      const read = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${fx.project.slug}/suites`,
        headers: { authorization: `Bearer ${token}` },
      });
      expectError(read, 404, "PROJECT_NOT_FOUND");
    });
  });
});
