import { faker } from "@faker-js/faker";
import { bugDto, bugsPageDto, createdTokenDto, type BugDto, type ProjectDto, type ResultStatus } from "@testpulse/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { bugEvents, bugs, projects, testCases } from "../../src/db/schema.js";
import { insertRun } from "../../src/modules/results/repository.js";
import { addMember, createProject, createTestApp, registerUser, type RegisteredUser } from "./helpers.js";

const BASE_TIME = Date.parse("2026-10-01T00:00:00.000Z");

describe("API bug tracker", () => {
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
    cookie?: string,
    payload?: unknown,
  ) => {
    const slug = "project" in fx ? fx.project.slug : fx.slug;
    return app.inject({
      method,
      url: `/api/v1/projects/${slug}/bugs${path}`,
      headers: cookie ? { cookie } : {},
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  };

  async function createBug(fx: Fixture, payload: Record<string, unknown> = {}, cookie = fx.tester.cookie) {
    const res = await request("POST", fx, "", cookie, { title: `Bug ${faker.string.alphanumeric(8)}`, ...payload });
    expect(res.statusCode, res.body).toBe(201);
    return bugDto.parse(res.json());
  }

  const patchBug = (fx: Fixture, number: number, payload: Record<string, unknown>, cookie = fx.tester.cookie) =>
    request("PATCH", fx, `/${number}`, cookie, payload);

  /** `cookie`: default tester; `null` = anonim. */
  const listBugs = (fx: Fixture, query = "", cookie: string | null = fx.tester.cookie) =>
    request("GET", fx, query ? `?${query}` : "", cookie ?? undefined);

  async function listPage(fx: Fixture, query = "", cookie: string | null = fx.tester.cookie) {
    const res = await listBugs(fx, query, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return bugsPageDto.parse(res.json());
  }

  async function bugRow(projectId: string, number: number) {
    const [row] = await app.db
      .select()
      .from(bugs)
      .where(and(eq(bugs.projectId, projectId), eq(bugs.number, number)));
    if (!row) throw new Error(`bug #${number} tidak ada`);
    return row;
  }

  async function eventsOf(projectId: string, number: number) {
    const bug = await bugRow(projectId, number);
    return app.db
      .select({
        actorId: bugEvents.actorId,
        field: bugEvents.field,
        oldValue: bugEvents.oldValue,
        newValue: bugEvents.newValue,
      })
      .from(bugEvents)
      .where(eq(bugEvents.bugId, bug.id))
      .orderBy(asc(bugEvents.id));
  }

  /** Menetapkan kolom bug langsung di DB (menyiapkan status/waktu tanpa melewati API). */
  async function setBug(projectId: string, number: number, changes: Partial<typeof bugs.$inferInsert>) {
    await app.db
      .update(bugs)
      .set(changes)
      .where(and(eq(bugs.projectId, projectId), eq(bugs.number, number)));
  }

  function expectError(res: LightMyRequestResponse, status: number, code: string) {
    expect(res.statusCode, res.body).toBe(status);
    expect(res.json().error.code).toBe(code);
  }

  /** Run nyata (jalur upload) dengan hasil untuk test bernama `names`; mengembalikan id run dan id test case. */
  async function seedRun(fx: Fixture, names: string[], status: ResultStatus = "failed") {
    const tokenRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${fx.project.slug}/tokens`,
      headers: { cookie: fx.admin.cookie },
      payload: { name: `CI ${faker.string.alphanumeric(6)}` },
    });
    expect(tokenRes.statusCode).toBe(201);
    const { runId } = await insertRun(app.db, {
      projectId: fx.project.id,
      tokenId: createdTokenDto.parse(tokenRes.json()).id,
      query: { branch: "main" },
      report: {
        durationMs: 100,
        results: names.map((name) => ({
          suite: "checkout",
          name,
          status,
          flakyInRun: false,
          retries: 0,
          durationMs: 10,
          message: status === "failed" ? `${name} gagal` : null,
        })),
      },
    });
    const cases = await app.db
      .select({ id: testCases.id, name: testCases.name })
      .from(testCases)
      .where(eq(testCases.projectId, fx.project.id));
    const ids = Object.fromEntries(cases.map((c) => [c.name, c.id]));
    return { runId, testCaseIds: ids };
  }

  describe("POST /bugs", () => {
    it("201: bug pertama bernomor 1 dengan nilai default, reporter = pembuat, tanpa email di respons", async () => {
      const fx = await setup();
      const res = await request("POST", fx, "", fx.tester.cookie, { title: "  Checkout gagal  " });
      expect(res.statusCode, res.body).toBe(201);
      const bug = bugDto.parse(res.json());
      expect(bug).toMatchObject({
        number: 1,
        title: "Checkout gagal",
        description: "",
        status: "open",
        resolution: null,
        priority: "medium",
        severity: "major",
        assignee: null,
        labels: [],
        links: [],
        testCase: null,
        runId: null,
        version: 1,
        resolvedAt: null,
        closedAt: null,
        testHint: null,
        reporter: { id: fx.tester.user.id, name: fx.tester.user.name },
      });
      expect(bug.createdAt).toBe(bug.updatedAt);
      expect(res.body).not.toContain("@example.test");
    });

    it("201: semua field — label dinormalisasi & diurutkan, urutan link dipertahankan, assignee & test asal", async () => {
      const fx = await setup();
      const { runId, testCaseIds } = await seedRun(fx, ["bayar"]);
      const bug = await createBug(fx, {
        title: "Pembayaran gagal",
        description: "**langkah**",
        priority: "urgent",
        severity: "blocker",
        assigneeId: fx.viewer.user.id,
        labels: ["UI ", "backend"],
        links: [
          { url: "https://example.com/z", title: "Z" },
          { url: "https://example.com/a", title: "  " },
        ],
        testCaseId: testCaseIds.bayar,
        runId,
      });
      expect(bug).toMatchObject({
        description: "**langkah**",
        priority: "urgent",
        severity: "blocker",
        assignee: { id: fx.viewer.user.id, name: fx.viewer.user.name },
        labels: ["backend", "ui"],
        links: [
          { url: "https://example.com/z", title: "Z" },
          { url: "https://example.com/a", title: null },
        ],
        testCase: { id: testCaseIds.bayar, suite: "checkout", name: "bayar" },
        runId,
      });
      const detail = await request("GET", fx, `/${bug.number}`, fx.viewer.cookie);
      expect(bugDto.parse(detail.json())).toEqual(bug);
    });

    it("20 bug paralel → nomor 1–20 unik; nomor tidak dipakai ulang setelah #20 dihapus", async () => {
      const fx = await setup();
      const created = await Promise.all(Array.from({ length: 20 }, (_, i) => createBug(fx, { title: `Paralel ${i}` })));
      expect(created.map((b) => b.number).toSorted((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

      expect((await request("DELETE", fx, "/20", fx.admin.cookie)).statusCode).toBe(204);
      const next = await createBug(fx);
      expect(next.number).toBe(21);
    });

    it("400 fields.assigneeId: assignee bukan anggota project (atau user tak dikenal); tidak ada bug tersimpan", async () => {
      const fx = await setup();
      const outsider = await registerUser(app);
      for (const assigneeId of [outsider.user.id, faker.string.uuid()]) {
        const res = await request("POST", fx, "", fx.tester.cookie, { title: "Bug", assigneeId });
        expectError(res, 400, "VALIDATION_ERROR");
        expect(res.json().error.fields).toHaveProperty("assigneeId");
      }
      const [project] = await app.db.select().from(projects).where(eq(projects.id, fx.project.id));
      expect(project?.bugSeq).toBe(0);
    });

    it("400: test milik project lain → fields.testCaseId; run tanpa hasil test itu / run project lain → fields.runId", async () => {
      const fx = await setup();
      const other = await setup();
      const { runId, testCaseIds } = await seedRun(fx, ["a", "b"]);
      const { runId: otherRunId, testCaseIds: otherCases } = await seedRun(other, ["a"]);
      // Run kedua di project yang sama, tanpa test "b".
      const tokenRes = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${fx.project.slug}/tokens`,
        headers: { cookie: fx.admin.cookie },
        payload: { name: "CI-2" },
      });
      const { runId: runWithoutB } = await insertRun(app.db, {
        projectId: fx.project.id,
        tokenId: createdTokenDto.parse(tokenRes.json()).id,
        query: { branch: "main" },
        report: {
          durationMs: 1,
          results: [{ suite: "checkout", name: "a", status: "passed", flakyInRun: false, retries: 0, durationMs: 1, message: null }],
        },
      });

      const cases: [Record<string, unknown>, string][] = [
        [{ testCaseId: otherCases.a }, "testCaseId"],
        [{ testCaseId: faker.string.uuid() }, "testCaseId"],
        [{ testCaseId: testCaseIds.b, runId: runWithoutB }, "runId"],
        [{ testCaseId: testCaseIds.a, runId: otherRunId }, "runId"],
        [{ runId }, "runId"],
      ];
      for (const [payload, field] of cases) {
        const res = await request("POST", fx, "", fx.tester.cookie, { title: "Bug", ...payload });
        expectError(res, 400, "VALIDATION_ERROR");
        expect(res.json().error.fields, JSON.stringify(payload)).toHaveProperty(field);
      }
      // Test tanpa run boleh.
      expect((await createBug(fx, { testCaseId: testCaseIds.b })).testCase?.name).toBe("b");
    });

    it("otorisasi: viewer 403, anonim 401, token CI = anonim 401, bukan anggota 404 (privat) / 403 (publik)", async () => {
      const fx = await setup();
      const pub = await setup({ visibility: "public" });
      const outsider = await registerUser(app);
      const body = { title: "Bug" };
      expectError(await request("POST", fx, "", fx.viewer.cookie, body), 403, "FORBIDDEN");
      expectError(await request("POST", fx, "", undefined, body), 401, "UNAUTHENTICATED");
      const tokenRes = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${fx.project.slug}/tokens`,
        headers: { cookie: fx.admin.cookie },
        payload: { name: "CI" },
      });
      const token = createdTokenDto.parse(tokenRes.json()).token;
      const bearer = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${fx.project.slug}/bugs`,
        headers: { authorization: `Bearer ${token}` },
        payload: body,
      });
      expectError(bearer, 401, "UNAUTHENTICATED");
      expectError(await request("POST", fx, "", outsider.cookie, body), 404, "PROJECT_NOT_FOUND");
      expectError(await request("POST", pub, "", outsider.cookie, body), 403, "FORBIDDEN");
      expect((await request("POST", fx, "", fx.admin.cookie, body)).statusCode).toBe(201);
    });
  });

  describe("GET /bugs", () => {
    it("filter status: default active; done; all; satu status", async () => {
      const fx = await setup();
      for (const title of ["satu", "dua", "tiga", "empat"]) await createBug(fx, { title });
      await setBug(fx.project.id, 2, { status: "in_progress" });
      await setBug(fx.project.id, 3, { status: "resolved", resolution: "fixed" });
      await setBug(fx.project.id, 4, { status: "closed", resolution: "wont_fix" });

      const numbers = async (query: string) =>
        (await listPage(fx, query)).bugs.map((b) => b.number).toSorted((a, b) => a - b);
      expect(await numbers("")).toEqual([1, 2]);
      expect(await numbers("status=active")).toEqual([1, 2]);
      expect(await numbers("status=done")).toEqual([3, 4]);
      expect(await numbers("status=all")).toEqual([1, 2, 3, 4]);
      expect(await numbers("status=resolved")).toEqual([3]);
      expectError(await listBugs(fx, "status=bogus"), 400, "VALIDATION_ERROR");
    });

    it("filter assignee me/none/uuid; anonim dengan assignee=me di project publik → daftar kosong", async () => {
      const fx = await setup({ visibility: "public" });
      await createBug(fx, { title: "milik tester", assigneeId: fx.tester.user.id });
      await createBug(fx, { title: "milik viewer", assigneeId: fx.viewer.user.id });
      await createBug(fx, { title: "tanpa assignee" });

      const titles = async (query: string, cookie: string | null) =>
        (await listPage(fx, query, cookie)).bugs.map((b) => b.title).toSorted();
      expect(await titles("assignee=me", fx.tester.cookie)).toEqual(["milik tester"]);
      expect(await titles("assignee=me", fx.viewer.cookie)).toEqual(["milik viewer"]);
      expect(await titles("assignee=none", fx.tester.cookie)).toEqual(["tanpa assignee"]);
      expect(await titles(`assignee=${fx.viewer.user.id}`, fx.tester.cookie)).toEqual(["milik viewer"]);
      expect(await titles("assignee=me", null)).toEqual([]);
      expect(await titles("", null)).toHaveLength(3);
      expectError(await listBugs(fx, "assignee=bukan-uuid"), 400, "VALIDATION_ERROR");

      const page = await listPage(fx, "assignee=me", fx.tester.cookie);
      expect(page.bugs[0]?.assignee).toEqual({ id: fx.tester.user.id, name: fx.tester.user.name });
    });

    it("filter priority & severity", async () => {
      const fx = await setup();
      await createBug(fx, { title: "bug a", priority: "high", severity: "minor" });
      await createBug(fx, { title: "bug b", priority: "high", severity: "critical" });
      await createBug(fx, { title: "bug c", priority: "low", severity: "critical" });
      const titles = async (query: string) => (await listPage(fx, query)).bugs.map((b) => b.title).toSorted();
      expect(await titles("priority=high")).toEqual(["bug a", "bug b"]);
      expect(await titles("severity=critical")).toEqual(["bug b", "bug c"]);
      expect(await titles("priority=high&severity=critical")).toEqual(["bug b"]);
    });

    it('Review Focus 1: bug berlabel ["UI "] ditemukan dengan label=ui, label=UI, dan label=%20UI%20', async () => {
      const fx = await setup();
      await createBug(fx, { title: "label ui", labels: ["UI "] });
      await createBug(fx, { title: "label lain", labels: ["backend"] });
      for (const label of ["ui", "UI", "%20UI%20"]) {
        const page = await listPage(fx, `label=${label}`);
        expect(page.bugs.map((b) => b.title), label).toEqual(["label ui"]);
        expect(page.bugs[0]?.labels).toEqual(["ui"]);
      }
      expect((await listPage(fx, "label=tidak-ada")).bugs).toEqual([]);
    });

    it("q: cari judul tanpa peka huruf; %, _ dan \\ dicocokkan literal", async () => {
      const fx = await setup();
      for (const title of ["Diskon 100% gagal", "Diskon 1000 gagal", "nama_user kosong", "namaXuser kosong", "path C:\\temp"]) {
        await createBug(fx, { title });
      }
      const titles = async (q: string) =>
        (await listPage(fx, `q=${encodeURIComponent(q)}`)).bugs.map((b) => b.title).toSorted();
      expect(await titles("100%")).toEqual(["Diskon 100% gagal"]);
      expect(await titles("nama_user")).toEqual(["nama_user kosong"]);
      expect(await titles("\\")).toEqual(["path C:\\temp"]);
      expect(await titles("DISKON")).toEqual(["Diskon 100% gagal", "Diskon 1000 gagal"]);
      expect(await titles("   ")).toHaveLength(5);
      expectError(await listBugs(fx, `q=${"a".repeat(101)}`), 400, "VALIDATION_ERROR");
    });

    it("sort: updated (default), created, priority (urgent dulu, lalu updated_at desc)", async () => {
      const fx = await setup();
      const spec: [string, string, number][] = [
        ["low-baru", "low", 50],
        ["urgent-lama", "urgent", 10],
        ["urgent-baru", "urgent", 40],
        ["medium", "medium", 30],
        ["high", "high", 20],
      ];
      for (const [i, [title, priority, minute]] of spec.entries()) {
        await createBug(fx, { title, priority });
        await setBug(fx.project.id, i + 1, {
          updatedAt: new Date(BASE_TIME + minute * 60_000),
          createdAt: new Date(BASE_TIME + (100 - minute) * 60_000),
        });
      }
      const titles = async (query: string) => (await listPage(fx, query)).bugs.map((b) => b.title);
      expect(await titles("")).toEqual(["low-baru", "urgent-baru", "medium", "high", "urgent-lama"]);
      expect(await titles("sort=created")).toEqual(["urgent-lama", "high", "medium", "urgent-baru", "low-baru"]);
      expect(await titles("sort=priority")).toEqual(["urgent-baru", "urgent-lama", "high", "medium", "low-baru"]);
      expectError(await listBugs(fx, "sort=bogus"), 400, "VALIDATION_ERROR");
    });

    it("30 bug → halaman 25 + cursor → 5 untuk setiap urutan, tanpa duplikat/terlewat (termasuk waktu sama & selisih mikrodetik)", async () => {
      const fx = await setup();
      const priorities = ["low", "medium", "high", "urgent"];
      for (let i = 0; i < 30; i += 1) await createBug(fx, { title: `bug ${i}`, priority: priorities[i % 4] });
      // 10 bug dengan updated_at identik, 10 berselisih 1 µs (milidetik sama), 10 berselisih menit.
      await app.db.execute(sql`
        update bugs set
          updated_at = case
            when number <= 10 then ${new Date(BASE_TIME).toISOString()}::timestamptz
            when number <= 20 then ${new Date(BASE_TIME).toISOString()}::timestamptz + (number * interval '1 microsecond')
            else ${new Date(BASE_TIME).toISOString()}::timestamptz + (number * interval '1 minute')
          end,
          created_at = ${new Date(BASE_TIME).toISOString()}::timestamptz + ((number % 7) * interval '1 microsecond')
        where project_id = ${fx.project.id}`);

      for (const sort of ["updated", "created", "priority"]) {
        const first = await listPage(fx, `sort=${sort}`);
        expect(first.bugs).toHaveLength(25);
        expect(first.nextCursor).not.toBeNull();
        const second = await listPage(fx, `sort=${sort}&cursor=${first.nextCursor}`);
        expect(second.bugs).toHaveLength(5);
        expect(second.nextCursor).toBeNull();
        const numbers = [...first.bugs, ...second.bugs].map((b) => b.number);
        expect(new Set(numbers).size, sort).toBe(30);

        // Urutan gabungan = urutan satu query tanpa paginasi (dibandingkan dengan SQL acuan).
        const order =
          sort === "updated"
            ? sql`updated_at desc, id desc`
            : sort === "created"
              ? sql`created_at desc, id desc`
              : sql`case priority when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc, updated_at desc, id desc`;
        const expected = await app.db.execute(
          sql`select number from bugs where project_id = ${fx.project.id} order by ${order}`,
        );
        expect(numbers, sort).toEqual(expected.rows.map((r) => Number((r as { number: number }).number)));
      }
    });

    it("cursor rusak atau dari urutan lain → 400 fields.cursor", async () => {
      const fx = await setup();
      for (let i = 0; i < 26; i += 1) await createBug(fx, { title: `bug ${i}` });
      const { nextCursor } = await listPage(fx, "");
      for (const query of ["cursor=sampah", "cursor=abc$def", `sort=priority&cursor=${nextCursor}`, `sort=created&cursor=${nextCursor}`]) {
        const res = await listBugs(fx, query);
        expectError(res, 400, "VALIDATION_ERROR");
        expect(res.json().error.fields).toHaveProperty("cursor");
      }
    });

    it("hak baca: anonim & bukan anggota 200 di project publik, 404 di privat; tanpa email di respons", async () => {
      const priv = await setup();
      const pub = await setup({ visibility: "public" });
      const outsider = await registerUser(app);
      await createBug(pub, { assigneeId: pub.tester.user.id });
      expect((await listPage(pub, "", null)).bugs).toHaveLength(1);
      const res = await listBugs(pub, "", outsider.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("@example.test");
      expectError(await listBugs(priv, "", null), 404, "PROJECT_NOT_FOUND");
      expectError(await listBugs(priv, "", outsider.cookie), 404, "PROJECT_NOT_FOUND");
      expect((await listBugs(priv, "", priv.viewer.cookie)).statusCode).toBe(200);
    });
  });

  describe("GET /bugs/:number", () => {
    it("404 BUG_NOT_FOUND: nomor tak dikenal, bukan angka, di luar int4, atau bug milik project lain", async () => {
      const fx = await setup();
      const other = await setup();
      await createBug(fx);
      await createBug(other);
      await createBug(other);
      for (const number of ["2", "0", "-1", "abc", "1.5", "99999999999", "01"]) {
        expectError(await request("GET", fx, `/${number}`, fx.tester.cookie), 404, "BUG_NOT_FOUND");
      }
      expect((await request("GET", fx, "/1", fx.tester.cookie)).statusCode).toBe(200);
    });

    it("hak baca: anonim publik 200 tanpa email, privat 404", async () => {
      const pub = await setup({ visibility: "public" });
      const priv = await setup();
      await createBug(pub, { assigneeId: pub.viewer.user.id });
      await createBug(priv);
      const res = await request("GET", pub, "/1");
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("@example.test");
      expectError(await request("GET", priv, "/1"), 404, "PROJECT_NOT_FOUND");
    });
  });

  describe("GET /bugs/labels", () => {
    it("label unik, urut abjad, hanya project ini", async () => {
      const fx = await setup();
      const other = await setup();
      await createBug(fx, { labels: ["ui", "backend"] });
      await createBug(fx, { labels: ["UI", "api"] });
      await createBug(other, { labels: ["rahasia"] });
      const res = await request("GET", fx, "/labels", fx.viewer.cookie);
      expect(res.statusCode).toBe(200);
      expect(z.array(z.string()).parse(res.json())).toEqual(["api", "backend", "ui"]);
      expectError(await request("GET", fx, "/labels"), 404, "PROJECT_NOT_FOUND");
    });
  });

  describe("PATCH /bugs/:number", () => {
    it("field biasa: satu event per field (deskripsi tanpa nilai), version naik 1, updatedAt berubah", async () => {
      const fx = await setup();
      const bug = await createBug(fx, {
        title: "Judul lama",
        description: "lama",
        labels: ["a"],
        links: [{ url: "https://example.com/1" }],
      });
      const res = await patchBug(fx, 1, {
        version: 1,
        title: "Judul baru",
        description: "baru",
        priority: "high",
        severity: "critical",
        assigneeId: fx.viewer.user.id,
        labels: ["b", "a"],
        links: [{ url: "https://example.com/2", title: "dua" }],
      });
      expect(res.statusCode, res.body).toBe(200);
      const updated = bugDto.parse(res.json());
      expect(updated).toMatchObject({
        title: "Judul baru",
        description: "baru",
        priority: "high",
        severity: "critical",
        assignee: { id: fx.viewer.user.id, name: fx.viewer.user.name },
        labels: ["a", "b"],
        links: [{ url: "https://example.com/2", title: "dua" }],
        version: 2,
      });
      expect(updated.createdAt).toBe(bug.createdAt);
      const [moved] = (
        await app.db.execute(
          sql`select updated_at > created_at as moved from bugs where project_id = ${fx.project.id} and number = 1`,
        )
      ).rows as { moved: boolean }[];
      expect(moved?.moved).toBe(true);

      const events = await eventsOf(fx.project.id, 1);
      expect(events.every((e) => e.actorId === fx.tester.user.id)).toBe(true);
      expect(events.map(({ field, oldValue, newValue }) => ({ field, oldValue, newValue })).toSorted((a, b) =>
        a.field.localeCompare(b.field),
      )).toEqual([
        { field: "assignee", oldValue: null, newValue: fx.viewer.user.name },
        { field: "description", oldValue: null, newValue: null },
        { field: "labels", oldValue: "a", newValue: "a, b" },
        { field: "links", oldValue: null, newValue: null },
        { field: "priority", oldValue: "medium", newValue: "high" },
        { field: "severity", oldValue: "major", newValue: "critical" },
        { field: "title", oldValue: "Judul lama", newValue: "Judul baru" },
      ]);
    });

    it("nilai sama dengan sekarang → 200, version tetap, tanpa event (label beda urutan/huruf, link sama)", async () => {
      const fx = await setup();
      const bug = await createBug(fx, {
        title: "Sama",
        labels: ["ui", "api"],
        links: [{ url: "https://example.com/1", title: "satu" }],
        assigneeId: fx.tester.user.id,
      });
      const res = await patchBug(fx, 1, {
        version: 1,
        title: "  Sama ",
        priority: "medium",
        status: "open",
        resolution: null,
        assigneeId: fx.tester.user.id,
        labels: ["API", "ui"],
        links: [{ url: "https://example.com/1", title: "satu" }],
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(bugDto.parse(res.json())).toEqual(bug);
      expect(await eventsOf(fx.project.id, 1)).toEqual([]);
      expect((await bugRow(fx.project.id, 1)).version).toBe(1);
    });

    it("version basi → 409 BUG_CONFLICT tanpa perubahan apa pun", async () => {
      const fx = await setup();
      await createBug(fx, { title: "Awal" });
      expect((await patchBug(fx, 1, { version: 1, title: "Kedua" })).statusCode).toBe(200);
      const res = await patchBug(fx, 1, { version: 1, title: "Ketiga", priority: "low" });
      expectError(res, 409, "BUG_CONFLICT");
      const row = await bugRow(fx.project.id, 1);
      expect(row).toMatchObject({ title: "Kedua", priority: "medium", version: 2 });
      expect(await eventsOf(fx.project.id, 1)).toHaveLength(1);
      // Version di masa depan juga konflik.
      expectError(await patchBug(fx, 1, { version: 99, title: "Masa depan" }), 409, "BUG_CONFLICT");
    });

    it("alur status: kerjakan → resolved (resolusi wajib) → closed (resolusi lama) → buka ulang mengosongkan resolusi & tanggal", async () => {
      const fx = await setup();
      await createBug(fx);
      let res = await patchBug(fx, 1, { version: 1, status: "in_progress" });
      expect(bugDto.parse(res.json())).toMatchObject({ status: "in_progress", version: 2, resolvedAt: null });

      res = await patchBug(fx, 1, { version: 2, status: "resolved" });
      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.json().error.fields).toHaveProperty("resolution");

      res = await patchBug(fx, 1, { version: 2, status: "resolved", resolution: "fixed" });
      let bug = bugDto.parse(res.json());
      expect(bug).toMatchObject({ status: "resolved", resolution: "fixed", version: 3, closedAt: null });
      expect(bug.resolvedAt).not.toBeNull();

      res = await patchBug(fx, 1, { version: 3, status: "closed" });
      bug = bugDto.parse(res.json());
      expect(bug).toMatchObject({ status: "closed", resolution: "fixed", version: 4 });
      expect(bug.resolvedAt).not.toBeNull();
      expect(bug.closedAt).not.toBeNull();

      expectError(await patchBug(fx, 1, { version: 4, status: "resolved", resolution: "fixed" }), 409, "INVALID_TRANSITION");
      expectError(await patchBug(fx, 1, { version: 4, status: "in_progress" }), 409, "INVALID_TRANSITION");

      res = await patchBug(fx, 1, { version: 4, status: "open" });
      expect(bugDto.parse(res.json())).toMatchObject({
        status: "open",
        resolution: null,
        resolvedAt: null,
        closedAt: null,
        version: 5,
      });

      const events = await eventsOf(fx.project.id, 1);
      expect(events.map(({ field, oldValue, newValue }) => [field, oldValue, newValue])).toEqual([
        ["status", "open", "in_progress"],
        ["status", "in_progress", "resolved"],
        ["resolution", null, "fixed"],
        ["status", "resolved", "closed"],
        ["status", "closed", "open"],
        ["resolution", "fixed", null],
      ]);
    });

    it("resolusi: open → closed langsung wajib resolusi; resolved → closed boleh mengganti; resolusi tanpa status hanya untuk resolved/closed", async () => {
      const fx = await setup();
      await createBug(fx);
      const res = await patchBug(fx, 1, { version: 1, status: "closed", resolution: null });
      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.json().error.fields).toHaveProperty("resolution");

      const onOpen = await patchBug(fx, 1, { version: 1, resolution: "fixed" });
      expectError(onOpen, 400, "VALIDATION_ERROR");
      expect(onOpen.json().error.fields).toHaveProperty("resolution");

      expect((await patchBug(fx, 1, { version: 1, status: "resolved", resolution: "fixed" })).statusCode).toBe(200);
      const changed = await patchBug(fx, 1, { version: 2, resolution: "duplicate" });
      expect(bugDto.parse(changed.json())).toMatchObject({ status: "resolved", resolution: "duplicate", version: 3 });

      const cleared = await patchBug(fx, 1, { version: 3, resolution: null });
      expectError(cleared, 400, "VALIDATION_ERROR");
      expect(cleared.json().error.fields).toHaveProperty("resolution");

      const closed = await patchBug(fx, 1, { version: 3, status: "closed", resolution: "wont_fix" });
      expect(bugDto.parse(closed.json())).toMatchObject({ status: "closed", resolution: "wont_fix", version: 4 });
      const events = (await eventsOf(fx.project.id, 1)).map(({ field, oldValue, newValue }) => [field, oldValue, newValue]);
      expect(events.slice(2)).toEqual([
        ["resolution", "fixed", "duplicate"],
        ["status", "resolved", "closed"],
        ["resolution", "duplicate", "wont_fix"],
      ]);
    });

    it("assignee: bukan anggota → 400 fields.assigneeId; null mengosongkan dengan event", async () => {
      const fx = await setup();
      const outsider = await registerUser(app);
      await createBug(fx, { assigneeId: fx.admin.user.id });
      const res = await patchBug(fx, 1, { version: 1, assigneeId: outsider.user.id });
      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.json().error.fields).toHaveProperty("assigneeId");

      const cleared = await patchBug(fx, 1, { version: 1, assigneeId: null });
      expect(bugDto.parse(cleared.json())).toMatchObject({ assignee: null, version: 2 });
      expect(await eventsOf(fx.project.id, 1)).toEqual([
        { actorId: fx.tester.user.id, field: "assignee", oldValue: fx.admin.user.name, newValue: null },
      ]);
    });

    it("update gagal di tengah (error dipaksa) → 500, bug tidak berubah, tidak ada event tertulis", async () => {
      const fx = await setup();
      await createBug(fx, { title: "Stabil", labels: ["a"] });
      await app.db.execute(sql`
        create or replace function bugs_test_force_fail() returns trigger language plpgsql as $$
        begin
          if new.new_value = 'GAGAL-PAKSA' then raise exception 'gagal dipaksa test'; end if;
          return new;
        end $$`);
      await app.db.execute(
        sql`create trigger bugs_test_force_fail before insert on bug_events for each row execute function bugs_test_force_fail()`,
      );
      try {
        const res = await patchBug(fx, 1, { version: 1, priority: "urgent", labels: ["b"], title: "GAGAL-PAKSA" });
        expect(res.statusCode).toBe(500);
      } finally {
        await app.db.execute(sql`drop trigger bugs_test_force_fail on bug_events`);
        await app.db.execute(sql`drop function bugs_test_force_fail()`);
      }
      const detail = bugDto.parse((await request("GET", fx, "/1", fx.tester.cookie)).json());
      expect(detail).toMatchObject({ title: "Stabil", priority: "medium", labels: ["a"], version: 1 });
      expect(await eventsOf(fx.project.id, 1)).toEqual([]);
    });

    it("validasi & otorisasi: hanya version → 400; viewer 403; anonim 401; nomor tak dikenal 404", async () => {
      const fx = await setup();
      await createBug(fx);
      expectError(await patchBug(fx, 1, { version: 1 }), 400, "VALIDATION_ERROR");
      expectError(await patchBug(fx, 1, { title: "Tanpa versi" }), 400, "VALIDATION_ERROR");
      expectError(await patchBug(fx, 1, { version: 1, title: "x" }, fx.viewer.cookie), 403, "FORBIDDEN");
      expectError(await request("PATCH", fx, "/1", undefined, { version: 1, title: "abc" }), 401, "UNAUTHENTICATED");
      expectError(await patchBug(fx, 2, { version: 1, title: "abc" }), 404, "BUG_NOT_FOUND");
      expect((await patchBug(fx, 1, { version: 1, title: "abc" }, fx.admin.cookie)).statusCode).toBe(200);
    });
  });

  describe("DELETE /bugs/:number", () => {
    it("admin 204, tester & viewer 403; GET sesudahnya 404 BUG_NOT_FOUND; nomor tak dikenal / project lain 404", async () => {
      const fx = await setup();
      const other = await setup();
      await createBug(fx);
      await createBug(other);
      await createBug(other);
      expectError(await request("DELETE", fx, "/1", fx.tester.cookie), 403, "FORBIDDEN");
      expectError(await request("DELETE", fx, "/1", fx.viewer.cookie), 403, "FORBIDDEN");
      expectError(await request("DELETE", fx, "/1"), 401, "UNAUTHENTICATED");
      expect((await request("DELETE", fx, "/1", fx.admin.cookie)).statusCode).toBe(204);
      expectError(await request("GET", fx, "/1", fx.admin.cookie), 404, "BUG_NOT_FOUND");
      expectError(await request("DELETE", fx, "/1", fx.admin.cookie), 404, "BUG_NOT_FOUND");
      expectError(await request("DELETE", fx, "/2", fx.admin.cookie), 404, "BUG_NOT_FOUND");
      expectError(await request("DELETE", fx, "/abc", fx.admin.cookie), 404, "BUG_NOT_FOUND");
      expect((await request("GET", other, "/2", other.admin.cookie)).statusCode).toBe(200);
    });
  });

  describe("pengosongan assignee & run asal", () => {
    it("admin mengeluarkan anggota → bug project itu yang di-assign ke dia dikosongkan + event (actor = admin)", async () => {
      const fx = await setup();
      const other = await setup();
      await addMember(app, other.project.id, fx.tester.user.id, "tester");
      await createBug(fx, { assigneeId: fx.tester.user.id });
      await createBug(fx, { assigneeId: fx.tester.user.id });
      await createBug(fx, { assigneeId: fx.viewer.user.id });
      await createBug(other, { assigneeId: fx.tester.user.id });

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/projects/${fx.project.slug}/members/${fx.tester.user.id}`,
        headers: { cookie: fx.admin.cookie },
      });
      expect(res.statusCode).toBe(204);

      for (const number of [1, 2]) {
        expect(await bugRow(fx.project.id, number)).toMatchObject({ assigneeId: null, version: 2 });
        expect(await eventsOf(fx.project.id, number)).toEqual([
          { actorId: fx.admin.user.id, field: "assignee", oldValue: fx.tester.user.name, newValue: null },
        ]);
      }
      expect(await bugRow(fx.project.id, 3)).toMatchObject({ assigneeId: fx.viewer.user.id, version: 1 });
      expect(await eventsOf(fx.project.id, 3)).toEqual([]);
      expect(await bugRow(other.project.id, 1)).toMatchObject({ assigneeId: fx.tester.user.id });
    });

    it("keluar sendiri → assignee dikosongkan dengan event (actor = orang itu sendiri)", async () => {
      const fx = await setup();
      await createBug(fx, { assigneeId: fx.viewer.user.id });
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/projects/${fx.project.slug}/members/${fx.viewer.user.id}`,
        headers: { cookie: fx.viewer.cookie },
      });
      expect(res.statusCode).toBe(204);
      expect((await bugRow(fx.project.id, 1)).assigneeId).toBeNull();
      expect(await eventsOf(fx.project.id, 1)).toEqual([
        { actorId: fx.viewer.user.id, field: "assignee", oldValue: fx.viewer.user.name, newValue: null },
      ]);
    });

    it("mengubah role tidak menyentuh assignee", async () => {
      const fx = await setup();
      await createBug(fx, { assigneeId: fx.tester.user.id });
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${fx.project.slug}/members/${fx.tester.user.id}`,
        headers: { cookie: fx.admin.cookie },
        payload: { role: "viewer" },
      });
      expect(res.statusCode).toBe(200);
      expect(await bugRow(fx.project.id, 1)).toMatchObject({ assigneeId: fx.tester.user.id, version: 1 });
    });

    it("run asal dihapus (DELETE run) → runId null, test asal tetap", async () => {
      const fx = await setup();
      const { runId, testCaseIds } = await seedRun(fx, ["a"]);
      await createBug(fx, { testCaseId: testCaseIds.a, runId });
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/projects/${fx.project.slug}/runs/${runId}`,
        headers: { cookie: fx.admin.cookie },
      });
      expect(res.statusCode).toBe(204);
      const bug: BugDto = bugDto.parse((await request("GET", fx, "/1", fx.tester.cookie)).json());
      expect(bug.runId).toBeNull();
      expect(bug.testCase?.id).toBe(testCaseIds.a);
    });
  });
});
