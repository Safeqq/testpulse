import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";
import {
  BUDI_ID,
  COOKIE_HEADERS,
  JSON_COOKIE_HEADERS,
  PROJECT_SLUG,
  STATE,
  TOKEN_ID,
  clientFor,
  createPact,
  dateTime,
  errorBody,
  text,
  uuidLike,
} from "./pact.js";

const pact = createPact();
const { regex } = MatchersV3;

const BASE = `/api/v1/projects/${PROJECT_SLUG}/tokens`;
const TOKEN_EXAMPLE = "tp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde";

describe("kontrak token CI", () => {
  it("GET /projects/:slug/tokens mengembalikan token aktif tanpa nilainya (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.tokenActive)
      .uponReceiving("daftar token CI aktif")
      .withRequest("GET", BASE, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) =>
        b.jsonBody(
          MatchersV3.eachLike({
            id: uuidLike(TOKEN_ID),
            name: text("Pact CI"),
            createdAt: dateTime(),
            lastUsedAt: null,
            createdBy: { id: uuidLike(BUDI_ID), name: text("Budi") },
          }),
        ),
      )
      .executeTest(async (server) => {
        const tokens = await clientFor(server, true).tokens.list(PROJECT_SLUG);
        expect(tokens.map((t) => t.id)).toEqual([TOKEN_ID]);
      });
  });

  it("POST /projects/:slug/tokens membuat token dan menampilkan nilainya sekali (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("membuat token CI")
      .withRequest("POST", BASE, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ name: "GitHub Actions" }))
      .willRespondWith(201, (b) =>
        b.jsonBody({
          id: uuidLike(TOKEN_ID),
          name: "GitHub Actions",
          token: regex(/^tp_[A-Za-z0-9_-]{43}$/, TOKEN_EXAMPLE),
          createdAt: dateTime(),
        }),
      )
      .executeTest(async (server) => {
        const created = await clientFor(server, true).tokens.create(PROJECT_SLUG, "GitHub Actions");
        expect(created.name).toBe("GitHub Actions");
        expect(created.token).toMatch(/^tp_/);
      });
  });

  it("POST /projects/:slug/tokens saat sudah 10 token aktif -> 409 TOKEN_LIMIT", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.tokenLimit)
      .uponReceiving("membuat token CI melebihi batas")
      .withRequest("POST", BASE, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ name: "Kelebihan" }))
      .willRespondWith(409, (b) =>
        b.jsonBody(errorBody("TOKEN_LIMIT", "Maksimal 10 token aktif per project")),
      )
      .executeTest(async (server) => {
        await expect(clientFor(server, true).tokens.create(PROJECT_SLUG, "Kelebihan")).rejects.toMatchObject({
          status: 409,
          code: "TOKEN_LIMIT",
        });
      });
  });

  it("DELETE /projects/:slug/tokens/:id mencabut token (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.tokenActive)
      .uponReceiving("mencabut token CI")
      .withRequest("DELETE", `${BASE}/${TOKEN_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).tokens.revoke(PROJECT_SLUG, TOKEN_ID)).resolves.toBeUndefined();
      });
  });
});
