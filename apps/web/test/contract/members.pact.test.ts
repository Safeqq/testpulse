import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";
import {
  BUDI_ID,
  COOKIE_HEADERS,
  JSON_COOKIE_HEADERS,
  PROJECT_SLUG,
  SARI_ID,
  STATE,
  clientFor,
  createPact,
  dateTime,
  errorBody,
  text,
  uuidLike,
} from "./pact.js";

const pact = createPact();

function memberBody(id: string, name: string, email: string, role: string) {
  return { userId: uuidLike(id), name: text(name), email: text(email), role, joinedAt: dateTime() };
}

describe("kontrak members", () => {
  it("GET /projects/:slug/members mengembalikan daftar anggota (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("daftar anggota project")
      .withRequest("GET", `/api/v1/projects/${PROJECT_SLUG}/members`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) =>
        b.jsonBody(MatchersV3.eachLike(memberBody(BUDI_ID, "Budi", "budi@pact.dev", "admin"))),
      )
      .executeTest(async (server) => {
        const members = await clientFor(server, true).members.list(PROJECT_SLUG);
        expect(members.map((m) => m.email)).toContain("budi@pact.dev");
      });
  });

  it("PATCH /projects/:slug/members/:userId mengubah role anggota (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.sariTester)
      .uponReceiving("mengubah role anggota menjadi viewer")
      .withRequest("PATCH", `/api/v1/projects/${PROJECT_SLUG}/members/${SARI_ID}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ role: "viewer" }),
      )
      .willRespondWith(200, (b) => b.jsonBody(memberBody(SARI_ID, "Sari", "sari@pact.dev", "viewer")))
      .executeTest(async (server) => {
        const member = await clientFor(server, true).members.updateRole(PROJECT_SLUG, SARI_ID, { role: "viewer" });
        expect(member.role).toBe("viewer");
      });
  });

  it("PATCH /projects/:slug/members/:userId menurunkan admin terakhir -> 409 LAST_ADMIN", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("menurunkan role admin terakhir")
      .withRequest("PATCH", `/api/v1/projects/${PROJECT_SLUG}/members/${BUDI_ID}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ role: "tester" }),
      )
      .willRespondWith(409, (b) => b.jsonBody(errorBody("LAST_ADMIN", "Project harus memiliki minimal satu admin")))
      .executeTest(async (server) => {
        await expect(
          clientFor(server, true).members.updateRole(PROJECT_SLUG, BUDI_ID, { role: "tester" }),
        ).rejects.toMatchObject({ status: 409, code: "LAST_ADMIN" });
      });
  });

  it("DELETE /projects/:slug/members/:userId mengeluarkan anggota (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.sariTester)
      .uponReceiving("mengeluarkan anggota dari project")
      .withRequest("DELETE", `/api/v1/projects/${PROJECT_SLUG}/members/${SARI_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).members.remove(PROJECT_SLUG, SARI_ID)).resolves.toBeUndefined();
      });
  });

  it("DELETE /projects/:slug/members/:userId mengeluarkan admin terakhir -> 409 LAST_ADMIN", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("admin terakhir keluar dari project")
      .withRequest("DELETE", `/api/v1/projects/${PROJECT_SLUG}/members/${BUDI_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(409, (b) => b.jsonBody(errorBody("LAST_ADMIN", "Project harus memiliki minimal satu admin")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).members.remove(PROJECT_SLUG, BUDI_ID)).rejects.toMatchObject({
          status: 409,
          code: "LAST_ADMIN",
        });
      });
  });
});
