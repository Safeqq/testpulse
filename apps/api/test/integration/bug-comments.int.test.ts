import { faker } from "@faker-js/faker";
import { activityPageDto, bugDto, bugsPageDto, commentDto, type CommentDto, type ProjectDto } from "@testpulse/shared";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { bugComments, bugEvents, bugs } from "../../src/db/schema.js";
import { addMember, createProject, createTestApp, registerUser, type RegisteredUser } from "./helpers.js";

const BASE_TIME = Date.parse("2026-10-01T00:00:00.000Z");

describe("API komentar & aktivitas bug", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  interface Fixture {
    admin: RegisteredUser;
    tester: RegisteredUser;
    other: RegisteredUser;
    viewer: RegisteredUser;
    project: ProjectDto;
  }

  async function setup(opts: { visibility?: "public" | "private" } = {}): Promise<Fixture> {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.cookie);
    const tester = await registerUser(app);
    const other = await registerUser(app);
    const viewer = await registerUser(app);
    await addMember(app, project.id, tester.user.id, "tester");
    await addMember(app, project.id, other.user.id, "tester");
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
    return { admin, tester, other, viewer, project };
  }

  const call = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    fx: Fixture,
    path: string,
    cookie?: string | null,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1/projects/${fx.project.slug}/bugs${path}`,
      headers: cookie ? { cookie } : {},
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  async function createBug(fx: Fixture): Promise<number> {
    const res = await call("POST", fx, "", fx.tester.cookie, { title: `Bug ${faker.string.alphanumeric(8)}` });
    expect(res.statusCode, res.body).toBe(201);
    return bugDto.parse(res.json()).number;
  }

  async function addComment(fx: Fixture, number: number, body: string, cookie = fx.tester.cookie): Promise<CommentDto> {
    const res = await call("POST", fx, `/${number}/comments`, cookie, { body });
    expect(res.statusCode, res.body).toBe(201);
    return commentDto.parse(res.json());
  }

  async function activity(fx: Fixture, number: number, cursor?: string, cookie: string | null = fx.tester.cookie) {
    const res = await call("GET", fx, `/${number}/activity${cursor ? `?cursor=${cursor}` : ""}`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return activityPageDto.parse(res.json());
  }

  function expectError(res: LightMyRequestResponse, status: number, code: string) {
    expect(res.statusCode, res.body).toBe(status);
    expect(res.json().error.code).toBe(code);
  }

  async function bugId(fx: Fixture, number: number): Promise<string> {
    const [row] = await app.db
      .select({ id: bugs.id })
      .from(bugs)
      .where(and(eq(bugs.projectId, fx.project.id), eq(bugs.number, number)));
    if (!row) throw new Error("bug tidak ada");
    return row.id;
  }

  describe("POST /bugs/:number/comments", () => {
    it("201: tester berkomentar, body di-trim, penulis = pembuat, tanpa email", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const res = await call("POST", fx, `/${number}/comments`, fx.tester.cookie, { body: "  **Sudah** kutelusuri  " });
      expect(res.statusCode, res.body).toBe(201);
      const comment = commentDto.parse(res.json());
      expect(comment).toMatchObject({
        body: "**Sudah** kutelusuri",
        author: { id: fx.tester.user.id, name: fx.tester.user.name },
        editedAt: null,
        deletedAt: null,
      });
      expect(res.body).not.toContain("@example.test");
    });

    it("403 untuk viewer, 401 anonim, 404 untuk non-anggota project privat", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const outsider = await registerUser(app);
      expectError(await call("POST", fx, `/${number}/comments`, fx.viewer.cookie, { body: "x" }), 403, "FORBIDDEN");
      expectError(await call("POST", fx, `/${number}/comments`, null, { body: "x" }), 401, "UNAUTHENTICATED");
      expectError(await call("POST", fx, `/${number}/comments`, outsider.cookie, { body: "x" }), 404, "PROJECT_NOT_FOUND");
    });

    it("403 untuk non-anggota project publik; izin diputuskan sebelum body divalidasi", async () => {
      const fx = await setup({ visibility: "public" });
      const number = await createBug(fx);
      const outsider = await registerUser(app);
      expectError(await call("POST", fx, `/${number}/comments`, outsider.cookie, { body: "x" }), 403, "FORBIDDEN");
      expectError(await call("POST", fx, `/${number}/comments`, fx.viewer.cookie, { body: "   " }), 403, "FORBIDDEN");
    });

    it("400: body hanya spasi, kosong, atau 10.001 karakter; 10.000 karakter diterima", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      for (const body of ["   \n ", "", "x".repeat(10_001)]) {
        const res = await call("POST", fx, `/${number}/comments`, fx.tester.cookie, { body });
        expectError(res, 400, "VALIDATION_ERROR");
        expect(res.json().error.fields.body).toBeTruthy();
      }
      expectError(await call("POST", fx, `/${number}/comments`, fx.tester.cookie, {}), 400, "VALIDATION_ERROR");
      await addComment(fx, number, "x".repeat(10_000));
    });

    it("komentar baru menaikkan updatedAt bug (tanpa version/event); sort=updated menaruhnya di atas", async () => {
      const fx = await setup();
      const first = await createBug(fx);
      const second = await createBug(fx);
      const listNumbers = async () => {
        const res = await call("GET", fx, "?sort=updated", fx.tester.cookie);
        return bugsPageDto.parse(res.json()).bugs.map((bug) => bug.number);
      };
      expect(await listNumbers()).toEqual([second, first]);

      const before = bugDto.parse((await call("GET", fx, `/${first}`, fx.tester.cookie)).json());
      await addComment(fx, first, "bangkitkan");
      const after = bugDto.parse((await call("GET", fx, `/${first}`, fx.tester.cookie)).json());
      expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
      expect(after.version).toBe(before.version);
      expect(await listNumbers()).toEqual([first, second]);
      const events = await app.db.select().from(bugEvents).where(eq(bugEvents.bugId, await bugId(fx, first)));
      expect(events).toHaveLength(0);

      // Edit dan hapus komentar tidak mengubah updatedAt.
      const comment = await addComment(fx, first, "lagi");
      const mid = bugDto.parse((await call("GET", fx, `/${first}`, fx.tester.cookie)).json());
      await call("PATCH", fx, `/${first}/comments/${comment.id}`, fx.tester.cookie, { body: "diubah" });
      await call("DELETE", fx, `/${first}/comments/${comment.id}`, fx.tester.cookie);
      const end = bugDto.parse((await call("GET", fx, `/${first}`, fx.tester.cookie)).json());
      expect(end.updatedAt).toBe(mid.updatedAt);
    });

    it.each(["halo\u0000dunia", "halo\u001bdunia", "\u0000"])("400: body dengan karakter kontrol %j, bukan 500", async (body) => {
      const fx = await setup();
      const number = await createBug(fx);
      const res = await call("POST", fx, `/${number}/comments`, fx.tester.cookie, { body });
      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.json().error.fields.body).toBeTruthy();
      const bad = await call("POST", fx, "", fx.tester.cookie, { title: "judul bug", description: "a\u0000b" });
      expectError(bad, 400, "VALIDATION_ERROR");
    });

    it("404 BUG_NOT_FOUND untuk nomor yang tidak ada atau bukan angka", async () => {
      const fx = await setup();
      for (const n of ["99", "abc", "0"]) {
        expectError(await call("POST", fx, `/${n}/comments`, fx.tester.cookie, { body: "x" }), 404, "BUG_NOT_FOUND");
      }
    });

    it("bug di project lain tidak bisa dikomentari lewat slug ini", async () => {
      const fx = await setup();
      const fx2 = await setup();
      const number = await createBug(fx2);
      // Nomor 1 ada di fx2 tetapi tidak ada di fx.
      expect(number).toBe(1);
      expectError(await call("POST", fx, `/${number}/comments`, fx.tester.cookie, { body: "x" }), 404, "BUG_NOT_FOUND");
    });
  });

  describe("PATCH /bugs/:number/comments/:id", () => {
    it("200: penulis mengedit → editedAt terisi, body di-trim; muncul di activity", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const comment = await addComment(fx, number, "awal");
      const res = await call("PATCH", fx, `/${number}/comments/${comment.id}`, fx.tester.cookie, { body: " revisi " });
      expect(res.statusCode, res.body).toBe(200);
      const edited = commentDto.parse(res.json());
      expect(edited).toMatchObject({ id: comment.id, body: "revisi", deletedAt: null });
      expect(edited.editedAt).not.toBeNull();
      const page = await activity(fx, number);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ kind: "comment", id: comment.id, body: "revisi", editedAt: edited.editedAt });
    });

    it("PATCH dengan isi (setelah trim) yang sama: tidak menulis, editedAt tetap, mengembalikan komentar saat ini", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const comment = await addComment(fx, number, "sama");
      const res = await call("PATCH", fx, `/${number}/comments/${comment.id}`, fx.tester.cookie, { body: "  sama \n" });
      expect(res.statusCode, res.body).toBe(200);
      expect(commentDto.parse(res.json())).toEqual(comment);
      const edited = await call("PATCH", fx, `/${number}/comments/${comment.id}`, fx.tester.cookie, { body: "beda" });
      const { editedAt } = commentDto.parse(edited.json());
      expect(editedAt).not.toBeNull();
      const again = await call("PATCH", fx, `/${number}/comments/${comment.id}`, fx.tester.cookie, { body: "beda " });
      expect(commentDto.parse(again.json()).editedAt).toBe(editedAt);
    });

    it("400: PATCH dengan karakter kontrol", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const comment = await addComment(fx, number, "awal");
      const res = await call("PATCH", fx, `/${number}/comments/${comment.id}`, fx.tester.cookie, { body: "a b" });
      expectError(res, 400, "VALIDATION_ERROR");
    });

    it("404: id komentar dari project lain dengan nomor bug yang sama", async () => {
      const fx = await setup();
      const fx2 = await setup();
      const number = await createBug(fx);
      const number2 = await createBug(fx2);
      expect(number2).toBe(number);
      const foreign = await addComment(fx2, number2, "milik project lain");
      expectError(await call("PATCH", fx, `/${number}/comments/${foreign.id}`, fx.tester.cookie, { body: "x" }), 404, "COMMENT_NOT_FOUND");
      expectError(await call("DELETE", fx, `/${number}/comments/${foreign.id}`, fx.admin.cookie), 404, "COMMENT_NOT_FOUND");
      const [row] = await app.db.select().from(bugComments).where(eq(bugComments.id, foreign.id));
      expect(row).toMatchObject({ body: "milik project lain", deletedAt: null, editedAt: null });
    });

    it("403: tester lain dan admin tidak boleh mengedit komentar orang lain", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const comment = await addComment(fx, number, "milik tester");
      for (const actor of [fx.other, fx.admin]) {
        expectError(await call("PATCH", fx, `/${number}/comments/${comment.id}`, actor.cookie, { body: "ubah" }), 403, "FORBIDDEN");
      }
      expectError(await call("PATCH", fx, `/${number}/comments/${comment.id}`, fx.viewer.cookie, { body: "ubah" }), 403, "FORBIDDEN");
      expectError(await call("PATCH", fx, `/${number}/comments/${comment.id}`, null, { body: "ubah" }), 401, "UNAUTHENTICATED");
      const page = await activity(fx, number);
      expect(page.items[0]).toMatchObject({ body: "milik tester", editedAt: null });
    });

    it("403: penulis yang turun menjadi viewer tidak bisa mengedit atau menghapus", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const comment = await addComment(fx, number, "dulu tester");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/projects/${fx.project.slug}/members/${fx.tester.user.id}`,
        headers: { cookie: fx.admin.cookie },
        payload: { role: "viewer" },
      });
      expect(res.statusCode, res.body).toBe(200);
      expectError(await call("PATCH", fx, `/${number}/comments/${comment.id}`, fx.tester.cookie, { body: "ubah" }), 403, "FORBIDDEN");
      expectError(await call("DELETE", fx, `/${number}/comments/${comment.id}`, fx.tester.cookie), 403, "FORBIDDEN");
    });

    it("404 COMMENT_NOT_FOUND: komentar terhapus, id tidak ada, bukan uuid, atau milik bug lain", async () => {
      const fx = await setup();
      const first = await createBug(fx);
      const second = await createBug(fx);
      const comment = await addComment(fx, first, "satu");
      const onSecond = await addComment(fx, second, "dua");

      expectError(await call("PATCH", fx, `/${second}/comments/${comment.id}`, fx.tester.cookie, { body: "x" }), 404, "COMMENT_NOT_FOUND");
      expectError(await call("DELETE", fx, `/${second}/comments/${comment.id}`, fx.admin.cookie), 404, "COMMENT_NOT_FOUND");
      const missing = "00000000-0000-4000-8000-000000000000";
      expectError(await call("PATCH", fx, `/${first}/comments/${missing}`, fx.tester.cookie, { body: "x" }), 404, "COMMENT_NOT_FOUND");
      expectError(await call("PATCH", fx, `/${first}/comments/bukan-uuid`, fx.tester.cookie, { body: "x" }), 404, "COMMENT_NOT_FOUND");
      expectError(await call("PATCH", fx, `/999/comments/${comment.id}`, fx.tester.cookie, { body: "x" }), 404, "BUG_NOT_FOUND");

      expect((await call("DELETE", fx, `/${first}/comments/${comment.id}`, fx.tester.cookie)).statusCode).toBe(204);
      expectError(await call("PATCH", fx, `/${first}/comments/${comment.id}`, fx.tester.cookie, { body: "x" }), 404, "COMMENT_NOT_FOUND");
      // Komentar bug lain tidak tersentuh.
      expect((await activity(fx, second)).items[0]).toMatchObject({ id: onSecond.id, body: "dua" });
    });

    it("400: body tidak valid", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const comment = await addComment(fx, number, "awal");
      const res = await call("PATCH", fx, `/${number}/comments/${comment.id}`, fx.tester.cookie, { body: "  " });
      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.json().error.fields.body).toBeTruthy();
    });
  });

  describe("DELETE /bugs/:number/comments/:id", () => {
    it("204: penulis menghapus komentarnya sendiri → soft delete, body dikosongkan di DB dan activity", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const comment = await addComment(fx, number, "rahasia");
      const res = await call("DELETE", fx, `/${number}/comments/${comment.id}`, fx.tester.cookie);
      expect(res.statusCode, res.body).toBe(204);
      const [row] = await app.db.select().from(bugComments).where(eq(bugComments.id, comment.id));
      expect(row?.body).toBe("");
      expect(row?.deletedAt).not.toBeNull();
      const page = await activity(fx, number);
      expect(page.items[0]).toMatchObject({ kind: "comment", id: comment.id, body: null });
      expect(page.items[0]).toHaveProperty("deletedAt", expect.any(String));
    });

    it("204: admin menghapus komentar orang lain; tester lain 403; viewer 403; anonim 401", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const comment = await addComment(fx, number, "milik tester");
      expectError(await call("DELETE", fx, `/${number}/comments/${comment.id}`, fx.other.cookie), 403, "FORBIDDEN");
      expectError(await call("DELETE", fx, `/${number}/comments/${comment.id}`, fx.viewer.cookie), 403, "FORBIDDEN");
      expectError(await call("DELETE", fx, `/${number}/comments/${comment.id}`, null), 401, "UNAUTHENTICATED");
      expect((await call("DELETE", fx, `/${number}/comments/${comment.id}`, fx.admin.cookie)).statusCode).toBe(204);
      const [item] = (await activity(fx, number)).items;
      expect(item).toMatchObject({ kind: "comment", body: null });
      expect(item?.kind === "comment" && item.deletedAt).toBeTruthy();
    });

    it("204 idempoten: menghapus ulang tidak mengubah deletedAt", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const comment = await addComment(fx, number, "x");
      expect((await call("DELETE", fx, `/${number}/comments/${comment.id}`, fx.tester.cookie)).statusCode).toBe(204);
      const [first] = await app.db.select().from(bugComments).where(eq(bugComments.id, comment.id));
      expect((await call("DELETE", fx, `/${number}/comments/${comment.id}`, fx.admin.cookie)).statusCode).toBe(204);
      const [second] = await app.db.select().from(bugComments).where(eq(bugComments.id, comment.id));
      expect(second?.deletedAt?.getTime()).toBe(first?.deletedAt?.getTime());
    });
  });

  describe("GET /bugs/:number/activity", () => {
    it("membaca kosong untuk bug tanpa aktivitas; 404 BUG_NOT_FOUND untuk bug yang tidak ada", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      expect(await activity(fx, number)).toEqual({ items: [], nextCursor: null });
      expectError(await call("GET", fx, "/999/activity", fx.tester.cookie), 404, "BUG_NOT_FOUND");
    });

    it("120 item campuran komentar & event → 50/50/20 dengan cursor, urut lama → baru, tanpa duplikat", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const id = await bugId(fx, number);
      // 60 komentar + 60 event; tiap 4 item berbagi satu waktu persis (komentar dulu, lalu event) untuk menguji
      // tie-break jenis; waktu bermikrodetik.
      for (let i = 0; i < 60; i++) {
        const at = new Date(BASE_TIME + Math.floor(i / 2) * 1000 + 7);
        await app.db
          .insert(bugComments)
          .values({ bugId: id, authorId: fx.tester.user.id, body: `komentar ${i}`, createdAt: at });
        await app.db
          .insert(bugEvents)
          .values({ bugId: id, actorId: fx.admin.user.id, field: "priority", oldValue: "low", newValue: "high", createdAt: at });
      }
      const page1 = await activity(fx, number);
      expect(page1.items).toHaveLength(50);
      expect(page1.nextCursor).toEqual(expect.any(String));
      const page2 = await activity(fx, number, page1.nextCursor!);
      expect(page2.items).toHaveLength(50);
      expect(page2.nextCursor).toEqual(expect.any(String));
      const page3 = await activity(fx, number, page2.nextCursor!);
      expect(page3.items).toHaveLength(20);
      expect(page3.nextCursor).toBeNull();

      const all = [...page1.items, ...page2.items, ...page3.items];
      expect(new Set(all.map((item) => `${item.kind}:${item.id}`)).size).toBe(120);
      expect(all.filter((item) => item.kind === "comment")).toHaveLength(60);
      expect(all.filter((item) => item.kind === "event")).toHaveLength(60);
      for (let i = 1; i < all.length; i++) {
        const prev = all[i - 1]!;
        const cur = all[i]!;
        const byTime = Date.parse(prev.createdAt) - Date.parse(cur.createdAt);
        expect(byTime).toBeLessThanOrEqual(0);
        if (byTime === 0 && prev.kind !== cur.kind) expect(prev.kind).toBe("comment");
        if (byTime === 0 && prev.kind === cur.kind && prev.kind === "event") {
          expect(BigInt(prev.id)).toBeLessThan(BigInt(cur.id));
        }
        if (byTime === 0 && prev.kind === cur.kind && prev.kind === "comment") {
          expect(prev.id < cur.id).toBe(true);
        }
      }
    });

    it("paging 51 item dengan mikrodetik berbeda di dalam satu milidetik: tanpa duplikat atau lompatan", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const id = await bugId(fx, number);
      const at = (n: number) => sql`timestamptz '2026-10-01 00:00:00.123+00' + ${n} * interval '1 microsecond'`;
      for (let n = 1; n <= 51; n++) {
        if (n % 2 === 0) {
          await app.db.execute(
            sql`insert into bug_events (bug_id, actor_id, field, old_value, new_value, created_at) values (${id}, ${fx.admin.user.id}, ${"n"}, ${String(n)}, ${String(n)}, ${at(n)})`,
          );
        } else {
          await app.db.execute(
            sql`insert into bug_comments (bug_id, author_id, body, created_at) values (${id}, ${fx.tester.user.id}, ${String(n)}, ${at(n)})`,
          );
        }
      }
      const page1 = await activity(fx, number);
      expect(page1.items).toHaveLength(50);
      const page2 = await activity(fx, number, page1.nextCursor!);
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
      const labels = [...page1.items, ...page2.items].map((item) => (item.kind === "comment" ? item.body : item.newValue));
      expect(labels).toEqual(Array.from({ length: 51 }, (_, i) => String(i + 1)));
    });

    it("event id numerik diurutkan sebagai angka (9 sebelum 10) dan cursor melewati batas halaman di tengah waktu sama", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const id = await bugId(fx, number);
      const at = new Date(BASE_TIME);
      const rows = Array.from({ length: 60 }, () => ({
        bugId: id,
        actorId: fx.admin.user.id,
        field: "title",
        oldValue: "a",
        newValue: "b",
        createdAt: at,
      }));
      await app.db.insert(bugEvents).values(rows);
      const page1 = await activity(fx, number);
      const page2 = await activity(fx, number, page1.nextCursor!);
      const ids = [...page1.items, ...page2.items].map((item) => BigInt(item.id));
      expect(ids).toHaveLength(60);
      expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      expect(page2.nextCursor).toBeNull();
    });

    it("event memuat aktor (id & nama), nilai lama/baru, id string", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const res = await call("PATCH", fx, `/${number}`, fx.admin.cookie, { version: 1, priority: "urgent" });
      expect(res.statusCode, res.body).toBe(200);
      const raw = await call("GET", fx, `/${number}/activity`, fx.viewer.cookie);
      expect(raw.body).not.toContain("@example.test");
      const [item] = activityPageDto.parse(raw.json()).items;
      expect(item).toMatchObject({
        kind: "event",
        field: "priority",
        oldValue: "medium",
        newValue: "urgent",
        actor: { id: fx.admin.user.id, name: fx.admin.user.name },
      });
      expect(typeof item?.id).toBe("string");
    });

    it("cursor rusak → 400 VALIDATION_ERROR (fields.cursor)", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      for (const cursor of ["###", "YWJj", Buffer.from("x|2026-10-01T00:00:00.000000Z|1").toString("base64url")]) {
        const res = await call("GET", fx, `/${number}/activity?cursor=${cursor}`, fx.tester.cookie);
        expectError(res, 400, "VALIDATION_ERROR");
        expect(res.json().error.fields.cursor).toBeTruthy();
      }
    });

    it("project publik: anonim membaca activity — nama penulis ada, email tidak pernah ada", async () => {
      const fx = await setup({ visibility: "public" });
      const number = await createBug(fx);
      await addComment(fx, number, "terlihat publik");
      const anon = await call("GET", fx, `/${number}/activity`, null);
      expect(anon.statusCode, anon.body).toBe(200);
      expect(anon.body).not.toContain("@example.test");
      const page = activityPageDto.parse(anon.json());
      expect(page.items[0]).toMatchObject({ kind: "comment", author: { name: fx.tester.user.name } });
      const outsider = await registerUser(app);
      expect((await call("GET", fx, `/${number}/activity`, outsider.cookie)).statusCode).toBe(200);
    });

    it("project privat: anonim & non-anggota 404", async () => {
      const fx = await setup();
      const number = await createBug(fx);
      const outsider = await registerUser(app);
      expectError(await call("GET", fx, `/${number}/activity`, null), 404, "PROJECT_NOT_FOUND");
      expectError(await call("GET", fx, `/${number}/activity`, outsider.cookie), 404, "PROJECT_NOT_FOUND");
    });
  });
});
