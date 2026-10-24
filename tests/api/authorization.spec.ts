import { randomUUID } from "node:crypto";
import type { Visibility } from "@testpulse/shared";
import type { TestApi } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { expectApiError } from "../support/http.js";
import { ACTORS, DEFAULT_ERROR_CODE, MATRIX, type Actor, type MatrixContext } from "./authorization-matrix.js";

/** Menyiapkan project segar dan aktor; `admin` adalah pembuat project (admin satu-satunya). */
async function setup(api: TestApi, actor: Actor, visibility: Visibility): Promise<MatrixContext> {
  const owner = await api.register();
  const project = await api.createProject(owner);
  if (visibility === "public") await api.setVisibility(owner, project.slug, "public");

  let http = owner.request;
  let actorId = owner.user.id;
  switch (actor) {
    case "anonymous":
      http = await api.anonymous();
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
  return {
    http,
    slug: project.slug,
    actorId,
    targetMemberId: () => (target ??= api.addMember(owner, project.slug, "tester").then((m) => m.user.id)),
    invitationId: () => (invitation ??= api.createInvitation(owner, project.slug, "viewer").then((i) => i.id)),
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

test.describe("Urutan pengecekan (spec §7)", () => {
  const loginRequired = MATRIX.filter((row) => row.name !== "GET project");

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
      };
      await expectApiError(await row.request(ctx), 401, "UNAUTHENTICATED");
    }
  });
});
