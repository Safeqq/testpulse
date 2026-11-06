import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";
import {
  BUDI_ID,
  BUG_NUMBER,
  CLOSED_BUG_NUMBER,
  COMMENT_ID,
  COOKIE_HEADERS,
  JSON_COOKIE_HEADERS,
  MISSING_BUG_NUMBER,
  MISSING_COMMENT_ID,
  OWNER_ID,
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
const { eachLike, integer, regex } = MatchersV3;

const BASE = `/api/v1/projects/${PROJECT_SLUG}`;

const oneOf = <T extends string>(values: readonly T[], example: T) =>
  regex(new RegExp(`^(${values.join("|")})$`), example);
const bugStatus = (example: "open" | "in_progress" | "resolved" | "closed") =>
  oneOf(["open", "in_progress", "resolved", "closed"], example);
const priority = (example: "low" | "medium" | "high" | "urgent") => oneOf(["low", "medium", "high", "urgent"], example);
const severity = (example: "minor" | "major" | "critical" | "blocker") =>
  oneOf(["minor", "major", "critical", "blocker"], example);

const owner = { id: uuidLike(OWNER_ID), name: text("Pemilik") };
const budi = { id: uuidLike(BUDI_ID), name: text("Budi") };

/** BugSummaryDto bug #1 dari state `bugSeeded` (prioritas high, belum di-assign, label "ui"). */
const bugSummary = {
  number: integer(BUG_NUMBER),
  title: text("Tombol bayar error"),
  status: bugStatus("open"),
  resolution: null,
  priority: priority("high"),
  severity: severity("major"),
  assignee: null,
  labels: eachLike(text("ui")),
  updatedAt: dateTime(),
  createdAt: dateTime(),
};

/** BugDto bug #1: tertaut ke test "goyang" pada run `RUN_ID`, sehingga petunjuk test terisi. */
const bugDetail = {
  ...bugSummary,
  description: text("Tombol bayar tidak merespons."),
  reporter: owner,
  links: eachLike({ url: text("https://ci.example.com/builds/1"), title: text("Build CI") }),
  testCase: { id: uuidLike(TEST_CASE_ID), suite: text("login"), name: text("goyang") },
  runId: uuidLike(RUN_ID),
  version: integer(1),
  resolvedAt: null,
  closedAt: null,
  testHint: {
    branch: text("main"),
    results: eachLike({
      runId: uuidLike(RUN_ID),
      createdAt: dateTime(),
      status: oneOf(["passed", "failed", "skipped"], "passed"),
    }),
    consecutivePasses: integer(1),
    lastStatus: oneOf(["passed", "failed", "skipped"], "passed"),
  },
};

const commentBody = (author: typeof budi, body: string) => ({
  id: uuidLike(COMMENT_ID),
  author,
  body: text(body),
  createdAt: dateTime(),
  editedAt: null,
  deletedAt: null,
});

describe("kontrak bug tracker: bug", () => {
  it("GET /projects/:slug/bugs mengembalikan satu halaman bug (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.bugSeeded)
      .uponReceiving("daftar bug aktif")
      .withRequest("GET", `${BASE}/bugs`, (b) => b.headers(COOKIE_HEADERS).query({ status: "active", sort: "updated" }))
      .willRespondWith(200, (b) => b.jsonBody({ bugs: eachLike(bugSummary), nextCursor: null }))
      .executeTest(async (server) => {
        const page = await clientFor(server, true).bugs.list(PROJECT_SLUG, { status: "active", sort: "updated" });
        expect(page.bugs.map((bug) => bug.number)).toEqual([BUG_NUMBER]);
        expect(page.nextCursor).toBeNull();
      });
  });

  it("GET /projects/:slug/bugs/labels mengembalikan daftar label (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.bugSeeded)
      .uponReceiving("daftar label bug")
      .withRequest("GET", `${BASE}/bugs/labels`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(eachLike(text("ui"))))
      .executeTest(async (server) => {
        expect(await clientFor(server, true).bugs.labels(PROJECT_SLUG)).toEqual(["ui"]);
      });
  });

  it("GET /projects/:slug/bugs/:number mengembalikan detail bug beserta petunjuk test (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.bugSeeded)
      .uponReceiving("detail bug #1")
      .withRequest("GET", `${BASE}/bugs/${BUG_NUMBER}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(bugDetail))
      .executeTest(async (server) => {
        const bug = await clientFor(server, true).bugs.get(PROJECT_SLUG, BUG_NUMBER);
        expect(bug).toMatchObject({ number: BUG_NUMBER, version: 1, runId: RUN_ID, labels: ["ui"] });
        expect(bug.testCase?.id).toBe(TEST_CASE_ID);
        expect(bug.testHint?.consecutivePasses).toBe(1);
      });
  });

  it("GET /projects/:slug/bugs/:number yang tidak ada -> 404 BUG_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("detail bug yang tidak ada")
      .withRequest("GET", `${BASE}/bugs/${MISSING_BUG_NUMBER}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("BUG_NOT_FOUND", "Bug tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).bugs.get(PROJECT_SLUG, MISSING_BUG_NUMBER)).rejects.toMatchObject({
          status: 404,
          code: "BUG_NOT_FOUND",
        });
      });
  });

  it("POST /projects/:slug/bugs membuat bug dengan nomor pertama (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("membuat bug baru")
      .withRequest("POST", `${BASE}/bugs`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ title: "Tombol bayar error", priority: "high", labels: ["ui"] }),
      )
      .willRespondWith(201, (b) =>
        b.jsonBody({
          ...bugDetail,
          reporter: budi,
          description: text(""),
          links: [],
          testCase: null,
          runId: null,
          testHint: null,
        }),
      )
      .executeTest(async (server) => {
        const bug = await clientFor(server, true).bugs.create(PROJECT_SLUG, {
          title: "Tombol bayar error",
          priority: "high",
          labels: ["ui"],
        });
        expect(bug).toMatchObject({ number: 1, status: "open", version: 1, testCase: null, testHint: null });
      });
  });

  it("PATCH /projects/:slug/bugs/:number mengubah status bug (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.bugSeeded)
      .uponReceiving("mengubah status bug menjadi in_progress")
      .withRequest("PATCH", `${BASE}/bugs/${BUG_NUMBER}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 1, status: "in_progress" }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({ ...bugDetail, status: bugStatus("in_progress"), version: integer(2) }),
      )
      .executeTest(async (server) => {
        const bug = await clientFor(server, true).bugs.update(PROJECT_SLUG, BUG_NUMBER, {
          version: 1,
          status: "in_progress",
        });
        expect(bug).toMatchObject({ status: "in_progress", version: 2 });
      });
  });

  it("PATCH /projects/:slug/bugs/:number dengan versi usang -> 409 BUG_CONFLICT", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.bugSeeded)
      .uponReceiving("mengubah bug dengan versi usang")
      .withRequest("PATCH", `${BASE}/bugs/${BUG_NUMBER}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 99, priority: "low" }),
      )
      .willRespondWith(409, (b) =>
        b.jsonBody(errorBody("BUG_CONFLICT", "Bug sudah diubah orang lain. Muat ulang untuk melihat versi terbaru")),
      )
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).bugs.update(PROJECT_SLUG, BUG_NUMBER, { version: 99, priority: "low" }),
        ).rejects.toMatchObject({ status: 409, code: "BUG_CONFLICT" });
      });
  });

  it("PATCH /projects/:slug/bugs/:number pada bug closed ke in_progress -> 409 INVALID_TRANSITION", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.closedBugSeeded)
      .uponReceiving("transisi status yang tidak diizinkan")
      .withRequest("PATCH", `${BASE}/bugs/${CLOSED_BUG_NUMBER}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 1, status: "in_progress" }),
      )
      .willRespondWith(409, (b) =>
        b.jsonBody(errorBody("INVALID_TRANSITION", "Perubahan status ini tidak diizinkan")),
      )
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).bugs.update(PROJECT_SLUG, CLOSED_BUG_NUMBER, { version: 1, status: "in_progress" }),
        ).rejects.toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
      });
  });

  it("DELETE /projects/:slug/bugs/:number menghapus bug sebagai admin (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.bugSeeded)
      .uponReceiving("menghapus bug")
      .withRequest("DELETE", `${BASE}/bugs/${BUG_NUMBER}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).bugs.remove(PROJECT_SLUG, BUG_NUMBER)).resolves.toBeUndefined();
      });
  });

  it("DELETE /projects/:slug/bugs/:number yang tidak ada -> 404 BUG_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("menghapus bug yang tidak ada")
      .withRequest("DELETE", `${BASE}/bugs/${MISSING_BUG_NUMBER}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("BUG_NOT_FOUND", "Bug tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).bugs.remove(PROJECT_SLUG, MISSING_BUG_NUMBER)).rejects.toMatchObject({
          status: 404,
          code: "BUG_NOT_FOUND",
        });
      });
  });
});

describe("kontrak bug tracker: aktivitas dan komentar", () => {
  it("GET /projects/:slug/bugs/:number/activity mengembalikan event lalu komentar (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.bugSeeded)
      .uponReceiving("aktivitas bug #1")
      .withRequest("GET", `${BASE}/bugs/${BUG_NUMBER}/activity`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          items: [
            {
              kind: "event",
              id: text("1"),
              actor: owner,
              field: text("priority"),
              oldValue: text("medium"),
              newValue: text("high"),
              createdAt: dateTime(),
            },
            { kind: "comment", ...commentBody(budi, "Sudah direproduksi") },
          ],
          nextCursor: null,
        }),
      )
      .executeTest(async (server) => {
        const page = await clientFor(server, true).bugs.activity(PROJECT_SLUG, BUG_NUMBER);
        expect(page.items.map((item) => item.kind)).toEqual(["event", "comment"]);
        expect(page.nextCursor).toBeNull();
      });
  });

  it("GET /projects/:slug/bugs/:number/activity pada bug yang tidak ada -> 404 BUG_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("aktivitas bug yang tidak ada")
      .withRequest("GET", `${BASE}/bugs/${MISSING_BUG_NUMBER}/activity`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("BUG_NOT_FOUND", "Bug tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).bugs.activity(PROJECT_SLUG, MISSING_BUG_NUMBER)).rejects.toMatchObject({
          status: 404,
          code: "BUG_NOT_FOUND",
        });
      });
  });

  it("POST /projects/:slug/bugs/:number/comments menambah komentar (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.bugSeeded)
      .uponReceiving("menambah komentar")
      .withRequest("POST", `${BASE}/bugs/${BUG_NUMBER}/comments`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ body: "Terjadi juga di staging" }),
      )
      .willRespondWith(201, (b) => b.jsonBody(commentBody(budi, "Terjadi juga di staging")))
      .executeTest(async (server) => {
        const comment = await clientFor(server, true).comments.create(PROJECT_SLUG, BUG_NUMBER, {
          body: "Terjadi juga di staging",
        });
        expect(comment).toMatchObject({ body: "Terjadi juga di staging", editedAt: null, deletedAt: null });
      });
  });

  it("PATCH /projects/:slug/bugs/:number/comments/:id mengubah komentar sendiri (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.bugSeeded)
      .uponReceiving("mengubah komentar sendiri")
      .withRequest("PATCH", `${BASE}/bugs/${BUG_NUMBER}/comments/${COMMENT_ID}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ body: "Direproduksi di staging" }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({ ...commentBody(budi, "Direproduksi di staging"), editedAt: dateTime() }),
      )
      .executeTest(async (server) => {
        const comment = await clientFor(server, true).comments.update(PROJECT_SLUG, BUG_NUMBER, COMMENT_ID, {
          body: "Direproduksi di staging",
        });
        expect(comment).toMatchObject({ id: COMMENT_ID, body: "Direproduksi di staging" });
        expect(comment.editedAt).not.toBeNull();
      });
  });

  it("PATCH /projects/:slug/bugs/:number/comments/:id yang tidak ada -> 404 COMMENT_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.bugSeeded)
      .uponReceiving("mengubah komentar yang tidak ada")
      .withRequest("PATCH", `${BASE}/bugs/${BUG_NUMBER}/comments/${MISSING_COMMENT_ID}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ body: "Tidak ada" }),
      )
      .willRespondWith(404, (b) => b.jsonBody(errorBody("COMMENT_NOT_FOUND", "Komentar tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).comments.update(PROJECT_SLUG, BUG_NUMBER, MISSING_COMMENT_ID, { body: "Tidak ada" }),
        ).rejects.toMatchObject({ status: 404, code: "COMMENT_NOT_FOUND" });
      });
  });

  it("DELETE /projects/:slug/bugs/:number/comments/:id menghapus komentar (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.bugSeeded)
      .uponReceiving("menghapus komentar")
      .withRequest("DELETE", `${BASE}/bugs/${BUG_NUMBER}/comments/${COMMENT_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).comments.remove(PROJECT_SLUG, BUG_NUMBER, COMMENT_ID),
        ).resolves.toBeUndefined();
      });
  });
});
