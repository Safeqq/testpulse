import { randomUUID } from "node:crypto";
import {
  activityPageDto,
  bugDto,
  bugsPageDto,
  commentDto,
  runDetailDto,
  type ActivityItemDto,
  type BugDto,
} from "@testpulse/shared";
import type { TestApi, TestUser } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { expectApiError, expectFieldError, parseBody } from "../support/http.js";
import { buildJUnit } from "../support/junit.js";

const API = "/api/v1";
/** `GET /bugs/labels` mengembalikan array string polos; tidak ada schema shared-nya. */
const labelsDto = {
  parse(data: unknown): string[] {
    expect(Array.isArray(data) && data.every((label) => typeof label === "string")).toBe(true);
    return data as string[];
  },
};

interface Project {
  owner: TestUser;
  slug: string;
  base: string;
}

async function setup(api: TestApi): Promise<Project> {
  const owner = await api.register();
  const { slug } = await api.createProject(owner);
  return { owner, slug, base: `${API}/projects/${slug}` };
}

/** Run dengan satu test gagal; mengembalikan id run dan id test-nya. */
async function failingRun(api: TestApi, { owner, slug, base }: Project): Promise<{ runId: string; testCaseId: string }> {
  const { token } = await api.createToken(owner, slug);
  const res = await api.uploadRun(token, slug, buildJUnit([{ suite: "checkout", name: "gagal", status: "failed", message: "boom" }]), {
    branch: "main",
  });
  expect(res.status(), await res.text()).toBe(201);
  const { runId } = (await res.json()) as { runId: string };
  const detail = await parseBody(await owner.request.get(`${base}/runs/${runId}?status=all`), 200, runDetailDto);
  return { runId, testCaseId: detail.results[0]!.testCaseId };
}

const fieldsOf = (items: ActivityItemDto[]) =>
  items.flatMap((item) => (item.kind === "event" ? [`${item.field}:${item.oldValue ?? ""}>${item.newValue ?? ""}`] : []));

test.describe("Bug lewat proxy: siklus hidup", () => {
  test("buat → daftar → ubah → transisi → komentar → hapus, semua respons sesuai schema shared", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    const { runId, testCaseId } = await failingRun(api, { owner, slug, base });
    const tester = await api.addMember(owner, slug, "tester");

    const created = await parseBody(
      await tester.request.post(`${base}/bugs`, {
        data: { title: "  Checkout gagal  ", labels: ["UI", " api "], links: [{ url: "https://ci.example.com/1", title: "CI" }], testCaseId, runId },
      }),
      201,
      bugDto,
    );
    expect(created).toMatchObject({
      number: 1,
      title: "Checkout gagal",
      status: "open",
      resolution: null,
      priority: "medium",
      severity: "major",
      version: 1,
      labels: ["api", "ui"],
      reporter: { id: tester.user.id },
      testCase: { id: testCaseId, suite: "checkout", name: "gagal" },
      runId,
    });
    expect(created.testHint).toMatchObject({ branch: "main", lastStatus: "failed", consecutivePasses: 0 });

    const second = await api.createBug(owner, slug, { title: "Bug kedua", priority: "urgent" });
    expect(second.number).toBe(2);

    // Daftar: aktif = open + in_progress; urutan "updated" terbaru dulu.
    const list = await parseBody(await owner.request.get(`${base}/bugs`), 200, bugsPageDto);
    expect(list.bugs.map((b) => b.number)).toEqual([2, 1]);
    expect(list.nextCursor).toBeNull();
    const byPriority = await parseBody(await owner.request.get(`${base}/bugs?sort=priority`), 200, bugsPageDto);
    expect(byPriority.bugs.map((b) => b.number)).toEqual([2, 1]);
    const byLabel = await parseBody(await owner.request.get(`${base}/bugs?label=UI`), 200, bugsPageDto);
    expect(byLabel.bugs.map((b) => b.number)).toEqual([1]);
    expect(await parseBody(await owner.request.get(`${base}/bugs/labels`), 200, labelsDto)).toEqual(["api", "ui"]);

    // Transisi: open → in_progress → resolved (butuh resolusi) → closed → open.
    let current: BugDto = await parseBody(
      await owner.request.patch(`${base}/bugs/1`, { data: { version: 1, status: "in_progress", assigneeId: owner.user.id } }),
      200,
      bugDto,
    );
    expect(current).toMatchObject({ status: "in_progress", version: 2, assignee: { id: owner.user.id } });
    current = await parseBody(
      await owner.request.patch(`${base}/bugs/1`, { data: { version: 2, status: "resolved", resolution: "fixed" } }),
      200,
      bugDto,
    );
    expect(current).toMatchObject({ status: "resolved", resolution: "fixed", version: 3 });
    expect(current.resolvedAt).toEqual(expect.any(String));
    current = await parseBody(await owner.request.patch(`${base}/bugs/1`, { data: { version: 3, status: "closed" } }), 200, bugDto);
    expect(current).toMatchObject({ status: "closed", resolution: "fixed", version: 4 });
    current = await parseBody(await owner.request.patch(`${base}/bugs/1`, { data: { version: 4, status: "open" } }), 200, bugDto);
    expect(current).toMatchObject({ status: "open", resolution: null, resolvedAt: null, closedAt: null, version: 5 });

    // Komentar: tulis (tester) → ubah (penulis) → hapus (penulis).
    const comment = await parseBody(
      await tester.request.post(`${base}/bugs/1/comments`, { data: { body: "  Sudah direproduksi  " } }),
      201,
      commentDto,
    );
    expect(comment).toMatchObject({ body: "Sudah direproduksi", author: { id: tester.user.id }, editedAt: null, deletedAt: null });
    const edited = await parseBody(
      await tester.request.patch(`${base}/bugs/1/comments/${comment.id}`, { data: { body: "Direproduksi di staging" } }),
      200,
      commentDto,
    );
    expect(edited).toMatchObject({ id: comment.id, body: "Direproduksi di staging" });
    expect(edited.editedAt).toEqual(expect.any(String));

    const activity = await parseBody(await owner.request.get(`${base}/bugs/1/activity`), 200, activityPageDto);
    expect(activity.nextCursor).toBeNull();
    expect(fieldsOf(activity.items)).toEqual(
      expect.arrayContaining(["status:open>in_progress", "status:in_progress>resolved", "status:resolved>closed", "status:closed>open"]),
    );
    expect(activity.items.some((item) => item.kind === "comment" && item.id === comment.id)).toBe(true);

    expect((await tester.request.delete(`${base}/bugs/1/comments/${comment.id}`)).status()).toBe(204);
    const afterDelete = await parseBody(await owner.request.get(`${base}/bugs/1/activity`), 200, activityPageDto);
    expect(afterDelete.items.find((item) => item.kind === "comment" && item.id === comment.id)).toMatchObject({
      body: null,
      deletedAt: expect.any(String),
    });

    // Hapus bug (admin): lalu tidak ditemukan; nomor tidak dipakai ulang.
    expect((await owner.request.delete(`${base}/bugs/1`)).status()).toBe(204);
    await expectApiError(await owner.request.get(`${base}/bugs/1`), 404, "BUG_NOT_FOUND");
    expect((await api.createBug(owner, slug, { title: "Bug ketiga" })).number).toBe(3);
  });

  test("project publik: anonim membaca bug, labels, dan aktivitas tetapi tidak menulis", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    await api.setVisibility(owner, slug, "public");
    const bug = await api.createBug(owner, slug, { title: "Bug publik", labels: ["ui"] });
    await api.addComment(owner, slug, bug.number, { body: "Terbuka" });
    const anon = await api.anonymous();

    expect((await parseBody(await anon.get(`${base}/bugs/1`), 200, bugDto)).title).toBe("Bug publik");
    expect((await parseBody(await anon.get(`${base}/bugs`), 200, bugsPageDto)).bugs).toHaveLength(1);
    expect(await parseBody(await anon.get(`${base}/bugs/labels`), 200, labelsDto)).toEqual(["ui"]);
    const activity = await parseBody(await anon.get(`${base}/bugs/1/activity`), 200, activityPageDto);
    expect(activity.items.some((item) => item.kind === "comment")).toBe(true);

    await expectApiError(await anon.post(`${base}/bugs`, { data: { title: "Tidak boleh" } }), 401, "UNAUTHENTICATED");
    await expectApiError(await anon.post(`${base}/bugs/1/comments`, { data: { body: "Tidak boleh" } }), 401, "UNAUTHENTICATED");
  });

  test("assignee=me untuk anonim di project publik → 200 daftar kosong (Ruling T4-a)", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    await api.setVisibility(owner, slug, "public");
    await api.createBug(owner, slug, { title: "Bug saya", assigneeId: owner.user.id });
    const anon = await api.anonymous();

    expect(await parseBody(await anon.get(`${base}/bugs?assignee=me`), 200, bugsPageDto)).toEqual({ bugs: [], nextCursor: null });
    const mine = await parseBody(await owner.request.get(`${base}/bugs?assignee=me`), 200, bugsPageDto);
    expect(mine.bugs.map((b) => b.number)).toEqual([1]);
  });

  test("komentar yang sudah dihapus: hapus ulang 204 (idempoten), ubah → 404 COMMENT_NOT_FOUND (Ruling T5-b)", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    await api.createBug(owner, slug, { title: "Bug komentar" });
    const comment = await api.addComment(owner, slug, 1, { body: "Akan dihapus" });
    const url = `${base}/bugs/1/comments/${comment.id}`;

    expect((await owner.request.delete(url)).status()).toBe(204);
    expect((await owner.request.delete(url)).status()).toBe(204);
    await expectApiError(await owner.request.patch(url, { data: { body: "Hidup lagi" } }), 404, "COMMENT_NOT_FOUND");
    await expectApiError(await owner.request.patch(`${base}/bugs/1/comments/${randomUUID()}`, { data: { body: "x" } }), 404, "COMMENT_NOT_FOUND");
    await expectApiError(await owner.request.patch(`${base}/bugs/99/comments/${comment.id}`, { data: { body: "x" } }), 404, "BUG_NOT_FOUND");
  });
});

test.describe("Bug lewat proxy: konflik dan transisi", () => {
  test("PATCH dengan versi usang → 409 BUG_CONFLICT dan bug tidak berubah", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    await api.createBug(owner, slug, { title: "Bug konflik" });
    await api.updateBug(owner, slug, 1, { version: 1, priority: "high" });

    const stale = await owner.request.patch(`${base}/bugs/1`, { data: { version: 1, priority: "low" } });
    await expectApiError(stale, 409, "BUG_CONFLICT");
    expect(await parseBody(await owner.request.get(`${base}/bugs/1`), 200, bugDto)).toMatchObject({ priority: "high", version: 2 });
  });

  test("dua tab: perubahan kedua dengan versi yang sama → 409 BUG_CONFLICT", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    const tester = await api.addMember(owner, slug, "tester");
    await api.createBug(owner, slug, { title: "Bug dua tab" });

    const first = await owner.request.patch(`${base}/bugs/1`, { data: { version: 1, title: "Judul dari A" } });
    expect(first.status()).toBe(200);
    await expectApiError(await tester.request.patch(`${base}/bugs/1`, { data: { version: 1, title: "Judul dari B" } }), 409, "BUG_CONFLICT");
  });

  test("transisi tidak diizinkan → 409 INVALID_TRANSITION (closed → resolved, closed → in_progress)", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    await api.createBug(owner, slug, { title: "Bug transisi" });
    await api.updateBug(owner, slug, 1, { version: 1, status: "closed", resolution: "wont_fix" });

    await expectApiError(
      await owner.request.patch(`${base}/bugs/1`, { data: { version: 2, status: "resolved", resolution: "fixed" } }),
      409,
      "INVALID_TRANSITION",
    );
    await expectApiError(await owner.request.patch(`${base}/bugs/1`, { data: { version: 2, status: "in_progress" } }), 409, "INVALID_TRANSITION");
    // Percobaan yang ditolak tidak mengubah status maupun versi.
    expect(await parseBody(await owner.request.get(`${base}/bugs/1`), 200, bugDto)).toMatchObject({
      status: "closed",
      resolution: "wont_fix",
      version: 2,
    });
  });

  test("resolved tanpa resolusi → 400 pada field resolution", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    await api.createBug(owner, slug, { title: "Bug resolusi" });
    await expectFieldError(await owner.request.patch(`${base}/bugs/1`, { data: { version: 1, status: "resolved" } }), "resolution");
  });
});

test.describe("Bug lewat proxy: validasi dan 404", () => {
  test("input tidak valid → 400 VALIDATION_ERROR dengan field", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    await expectFieldError(await owner.request.post(`${base}/bugs`, { data: { title: "ab" } }), "title");
    await expectFieldError(await owner.request.post(`${base}/bugs`, { data: { title: "Judul sah", labels: ["bukan valid!"] } }), "labels.0");
    await expectFieldError(await owner.request.post(`${base}/bugs`, { data: { title: "Judul sah", assigneeId: randomUUID() } }), "assigneeId");
    await expectFieldError(await owner.request.post(`${base}/bugs`, { data: { title: "Judul sah", testCaseId: randomUUID() } }), "testCaseId");
    await expectFieldError(await owner.request.get(`${base}/bugs?status=bukan`), "status");
    await api.createBug(owner, slug, { title: "Bug validasi" });
    await expectFieldError(await owner.request.post(`${base}/bugs/1/comments`, { data: { body: "   " } }), "body");
    await expectFieldError(await owner.request.patch(`${base}/bugs/1`, { data: { version: 1 } }), "body");
  });

  test("bug yang tidak ada → 404 BUG_NOT_FOUND di semua endpoint per-bug", async ({ api }) => {
    const { owner, base } = await setup(api);
    for (const number of ["99", "0", "abc", "1.5", "99999999999"]) {
      await expectApiError(await owner.request.get(`${base}/bugs/${number}`), 404, "BUG_NOT_FOUND");
    }
    await expectApiError(await owner.request.get(`${base}/bugs/99/activity`), 404, "BUG_NOT_FOUND");
    await expectApiError(await owner.request.patch(`${base}/bugs/99`, { data: { version: 1, priority: "low" } }), 404, "BUG_NOT_FOUND");
    await expectApiError(await owner.request.delete(`${base}/bugs/99`), 404, "BUG_NOT_FOUND");
    await expectApiError(await owner.request.post(`${base}/bugs/99/comments`, { data: { body: "x" } }), 404, "BUG_NOT_FOUND");
  });

  test("bug tidak lintas project: nomor yang sama di project lain tidak terbaca", async ({ api }) => {
    const a = await setup(api);
    const b = await setup(api);
    await api.createBug(a.owner, a.slug, { title: "Bug project A" });
    await expectApiError(await b.owner.request.get(`${b.base}/bugs/1`), 404, "BUG_NOT_FOUND");
    await expectApiError(await b.owner.request.get(`${a.base}/bugs/1`), 404, "PROJECT_NOT_FOUND");
  });
});

test.describe("Bug lewat proxy: token CI bukan kredensial", () => {
  test("Bearer token CI yang sah diabaikan di endpoint bug (anonim) bahkan untuk project publik", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    await api.setVisibility(owner, slug, "public");
    const { token } = await api.createToken(owner, slug);
    const ci = await api.anonymous({ authorization: `Bearer ${token}` });

    expect((await ci.get(`${base}/bugs`)).status()).toBe(200);
    await expectApiError(await ci.post(`${base}/bugs`, { data: { title: "Dari token CI" } }), 401, "UNAUTHENTICATED");
  });
});
