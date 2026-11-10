import { randomUUID } from "node:crypto";
import { runDetailDto, type CreatedTokenDto, type Visibility } from "@testpulse/shared";
import type { TestApi } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { expectApiError } from "../support/http.js";
import { buildJUnit } from "../support/junit.js";
import { ACTORS, DEFAULT_ERROR_CODE, MATRIX, type Actor, type MatrixContext } from "./authorization-matrix.js";

/**
 * Menyiapkan project segar dan aktor; `admin` adalah pembuat project (admin satu-satunya).
 * Dengan `bearer`, aktornya anonim yang membawa token CI sah milik project itu (token harus diabaikan di luar upload).
 */
async function setup(api: TestApi, actor: Actor, visibility: Visibility, bearer = false): Promise<MatrixContext> {
  const owner = await api.register();
  const project = await api.createProject(owner);
  if (visibility === "public") await api.setVisibility(owner, project.slug, "public");

  let ci: Promise<CreatedTokenDto> | undefined;
  const ciToken = () => (ci ??= api.createToken(owner, project.slug));

  let http = owner.request;
  let actorId = owner.user.id;
  switch (actor) {
    case "anonymous":
      http = await api.anonymous(bearer ? { authorization: `Bearer ${(await ciToken()).token}` } : undefined);
      actorId = randomUUID();
      break;
    case "nonMemberPrivate":
    case "nonMemberPublic": {
      const stranger = await api.register();
      http = stranger.request;
      actorId = stranger.user.id;
      break;
    }
    case "viewer":
    case "tester": {
      const member = await api.addMember(owner, project.slug, actor);
      http = member.request;
      actorId = member.user.id;
      break;
    }
    case "admin":
      break;
  }

  let target: Promise<string> | undefined;
  let invitation: Promise<string> | undefined;
  let run: Promise<{ runId: string; testCaseId: string }> | undefined;
  const seededRun = () =>
    (run ??= (async () => {
      const upload = await api.uploadRun((await ciToken()).token, project.slug, buildJUnit([{ name: "gagal", status: "failed" }]), {
        branch: "main",
      });
      const { runId } = (await upload.json()) as { runId: string };
      const detail = await owner.request.get(`/api/v1/projects/${project.slug}/runs/${runId}?status=all`);
      const parsed = runDetailDto.parse(await detail.json());
      const testCaseId = parsed.results[0]?.testCaseId;
      if (!testCaseId) throw new Error("run awal tidak memuat hasil test");
      return { runId, testCaseId };
    })());

  // Bug dibuat admin project; komentarnya ditulis tester khusus agar selalu "milik orang lain" bagi aktor mana pun.
  let bug: Promise<number> | undefined;
  const seededBug = () => (bug ??= api.createBug(owner, project.slug, { title: "Bug awal matriks" }).then((b) => b.number));
  let comment: Promise<string> | undefined;

  // Test manual: dibuat admin project. Suite untuk DELETE sengaja terpisah dari suite berisi case agar tetap kosong.
  let emptySuite: Promise<string> | undefined;
  let manualCase: Promise<number> | undefined;
  let manualRun: Promise<{ number: number; runCaseId: string }> | undefined;
  const seededCase = () =>
    (manualCase ??= (async () => {
      const suite = await api.createSuite(owner, project.slug, { name: "Suite berisi case" });
      return (await api.createCase(owner, project.slug, { suiteId: suite.id, title: "Case awal matriks", steps: [{ action: "Buka halaman", expected: "Tampil" }] })).number;
    })());
  const seededManualRun = () =>
    (manualRun ??= (async () => {
      const caseNumber = await seededCase();
      const created = await api.createManualRun(owner, project.slug, { name: "Run awal matriks", caseNumbers: [caseNumber] });
      const [first] = await api.listRunCases(owner, project.slug, created.number);
      if (!first) throw new Error("run manual awal tidak memuat run case");
      return { number: created.number, runCaseId: first.id };
    })());

  return {
    http,
    slug: project.slug,
    actorId,
    targetMemberId: () => (target ??= api.addMember(owner, project.slug, "tester").then((m) => m.user.id)),
    invitationId: () => (invitation ??= api.createInvitation(owner, project.slug, "viewer").then((i) => i.id)),
    runId: async () => (await seededRun()).runId,
    testCaseId: async () => (await seededRun()).testCaseId,
    tokenId: async () => (await ciToken()).id,
    bugNumber: seededBug,
    commentId: () =>
      (comment ??= (async () => {
        const number = await seededBug();
        const author = await api.addMember(owner, project.slug, "tester");
        return (await api.addComment(author, project.slug, number, { body: "Komentar orang lain" })).id;
      })()),
    suiteId: () => (emptySuite ??= api.createSuite(owner, project.slug, { name: "Suite kosong matriks" }).then((s) => s.id)),
    caseNumber: seededCase,
    manualRunNumber: async () => (await seededManualRun()).number,
    runCaseId: async () => (await seededManualRun()).runCaseId,
  };
}

function visibilityFor(actor: Actor): Visibility {
  return actor === "nonMemberPublic" ? "public" : "private";
}

test.describe("Matriks otorisasi (spec §7)", () => {
  for (const row of MATRIX) {
    for (const actor of ACTORS) {
      const status = row.expected[actor];
      test(`${row.name} sebagai ${actor} → ${status}`, async ({ api }) => {
        const ctx = await setup(api, actor, visibilityFor(actor));
        const res = await row.request(ctx);
        if (status >= 400) {
          await expectApiError(res, status, row.errorCodes?.[actor] ?? DEFAULT_ERROR_CODE[status]!);
        } else {
          expect(res.status(), await res.text()).toBe(status);
        }
      });
    }

    // Anonim terhadap project publik: hanya GET project yang boleh; endpoint lain tetap 401.
    const publicStatus = row.anonymousOnPublic ?? row.expected.anonymous;
    test(`${row.name} sebagai anonymous (project publik) → ${publicStatus}`, async ({ api }) => {
      const ctx = await setup(api, "anonymous", "public");
      const res = await row.request(ctx);
      if (publicStatus >= 400) {
        await expectApiError(res, publicStatus, DEFAULT_ERROR_CODE[publicStatus]!);
      } else {
        expect(res.status(), await res.text()).toBe(publicStatus);
      }
    });
  }
});

test.describe("Token CI di luar endpoint upload (spec §7.1)", () => {
  // Bearer yang sah diabaikan di semua endpoint selain upload: hasilnya sama persis dengan anonim tanpa token.
  for (const row of MATRIX.filter((r) => r.bearerIgnored !== false)) {
    for (const visibility of ["private", "public"] as const) {
      const status = visibility === "public" ? (row.anonymousOnPublic ?? row.expected.anonymous) : row.expected.anonymous;
      test(`${row.name} dengan token CI sah (project ${visibility}) diperlakukan anonim → ${status}`, async ({ api }) => {
        const ctx = await setup(api, "anonymous", visibility, true);
        const res = await row.request(ctx);
        if (status >= 400) {
          await expectApiError(res, status, DEFAULT_ERROR_CODE[status]!);
        } else {
          expect(res.status(), await res.text()).toBe(status);
        }
      });
    }
  }
});

test.describe("Urutan pengecekan (spec §7)", () => {
  // Endpoint yang mewajibkan login memberi 401 ke anonim sebelum project dicari (endpoint baca publik memberi 404).
  const loginRequired = MATRIX.filter((row) => row.expected.anonymous === 401);

  test("project yang tidak ada tidak bisa dibedakan dari project privat bagi bukan anggota", async ({ api }) => {
    const stranger = await api.register();
    const missing = await stranger.request.get("/api/v1/projects/tidak-ada-sama-sekali");
    await expectApiError(missing, 404, "PROJECT_NOT_FOUND");

    const owner = await api.register();
    const project = await api.createProject(owner);
    const hidden = await stranger.request.get(`/api/v1/projects/${project.slug}`);
    await expectApiError(hidden, 404, "PROJECT_NOT_FOUND");
    expect(await hidden.json()).toEqual(await missing.json());
  });

  test("anonim mendapat 401 di semua endpoint wajib login, juga untuk project yang tidak ada", async ({ api }) => {
    const anon = await api.anonymous();
    for (const row of loginRequired) {
      const ctx: MatrixContext = {
        http: anon,
        slug: "tidak-ada-sama-sekali",
        actorId: randomUUID(),
        targetMemberId: async () => randomUUID(),
        invitationId: async () => randomUUID(),
        runId: async () => randomUUID(),
        testCaseId: async () => randomUUID(),
        tokenId: async () => randomUUID(),
        bugNumber: async () => 1,
        commentId: async () => randomUUID(),
        suiteId: async () => randomUUID(),
        caseNumber: async () => 1,
        manualRunNumber: async () => 1,
        runCaseId: async () => randomUUID(),
      };
      await expectApiError(await row.request(ctx), 401, "UNAUTHENTICATED");
    }
  });
});
