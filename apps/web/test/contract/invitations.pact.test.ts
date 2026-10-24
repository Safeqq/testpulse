import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";
import {
  BUDI_ID,
  COOKIE_HEADERS,
  EXPIRED_INVITE_TOKEN,
  INVITATION_ID,
  INVITE_TOKEN,
  JSON_COOKIE_HEADERS,
  PROJECT_SLUG,
  STATE,
  clientFor,
  createPact,
  dateTime,
  errorBody,
  slugLike,
  text,
  uuidLike,
} from "./pact.js";

const pact = createPact();
const { regex } = MatchersV3;

describe("kontrak invitations", () => {
  it("GET /projects/:slug/invitations mengembalikan undangan aktif (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.invitation)
      .uponReceiving("daftar undangan aktif")
      .withRequest("GET", `/api/v1/projects/${PROJECT_SLUG}/invitations`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) =>
        b.jsonBody(
          MatchersV3.eachLike({
            id: uuidLike(INVITATION_ID),
            role: "tester",
            expiresAt: dateTime(),
            createdAt: dateTime(),
            createdBy: { id: uuidLike(BUDI_ID), name: text("Budi") },
          }),
        ),
      )
      .executeTest(async (server) => {
        const list = await clientFor(server, true).invitations.list(PROJECT_SLUG);
        expect(list.length).toBeGreaterThan(0);
        expect(list[0]?.role).toBe("tester");
      });
  });

  it("POST /projects/:slug/invitations membuat undangan (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("membuat undangan role tester")
      .withRequest("POST", `/api/v1/projects/${PROJECT_SLUG}/invitations`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ role: "tester" }),
      )
      .willRespondWith(201, (b) =>
        b.jsonBody({
          id: uuidLike(INVITATION_ID),
          url: regex(/^https?:\/\/.+\/invite\/[A-Za-z0-9_-]+$/, "http://localhost:5173/invite/abc123"),
          role: "tester",
          expiresAt: dateTime(),
        }),
      )
      .executeTest(async (server) => {
        const created = await clientFor(server, true).invitations.create(PROJECT_SLUG, { role: "tester" });
        expect(created.url).toContain("/invite/");
        expect(created.role).toBe("tester");
      });
  });

  it("DELETE /projects/:slug/invitations/:id mencabut undangan (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.invitation)
      .uponReceiving("mencabut undangan")
      .withRequest("DELETE", `/api/v1/projects/${PROJECT_SLUG}/invitations/${INVITATION_ID}`, (b) =>
        b.headers(COOKIE_HEADERS),
      )
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).invitations.revoke(PROJECT_SLUG, INVITATION_ID)).resolves.toBeUndefined();
      });
  });

  it("GET /invitations/:token menampilkan pratinjau undangan (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.invitation)
      .uponReceiving("pratinjau undangan aktif tanpa login")
      .withRequest("GET", `/api/v1/invitations/${INVITE_TOKEN}`)
      .willRespondWith(200, (b) =>
        b.jsonBody({
          projectName: text("Pact Project"),
          projectSlug: slugLike(PROJECT_SLUG),
          role: "tester",
          expiresAt: dateTime(),
        }),
      )
      .executeTest(async (server) => {
        const preview = await clientFor(server).invitations.preview(INVITE_TOKEN);
        expect(preview.projectSlug).toBe(PROJECT_SLUG);
      });
  });

  it("GET /invitations/:token kedaluwarsa -> 410 INVITATION_EXPIRED", async () => {
    await pact
      .addInteraction()
      .given(STATE.expiredInvitation)
      .uponReceiving("pratinjau undangan kedaluwarsa")
      .withRequest("GET", `/api/v1/invitations/${EXPIRED_INVITE_TOKEN}`)
      .willRespondWith(410, (b) => b.jsonBody(errorBody("INVITATION_EXPIRED", "Undangan sudah kedaluwarsa")))
      .executeTest(async (server) => {
        await expect(clientFor(server).invitations.preview(EXPIRED_INVITE_TOKEN)).rejects.toMatchObject({
          status: 410,
          code: "INVITATION_EXPIRED",
        });
      });
  });

  it("POST /invitations/:token/accept menerima undangan (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiLoggedIn)
      .given(STATE.invitation)
      .uponReceiving("menerima undangan")
      .withRequest("POST", `/api/v1/invitations/${INVITE_TOKEN}/accept`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody({ projectSlug: slugLike(PROJECT_SLUG), role: "tester" }))
      .executeTest(async (server) => {
        const accepted = await clientFor(server, true).invitations.accept(INVITE_TOKEN);
        expect(accepted).toEqual({ projectSlug: PROJECT_SLUG, role: "tester" });
      });
  });
});
