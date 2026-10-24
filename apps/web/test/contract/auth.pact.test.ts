import { describe, expect, it } from "vitest";
import {
  BUDI_ID,
  COOKIE_HEADERS,
  JSON_HEADERS,
  STATE,
  clientFor,
  createPact,
  errorBody,
  uuidLike,
} from "./pact.js";

const pact = createPact();

const budi = { id: uuidLike(BUDI_ID), email: "budi@pact.dev", name: "Budi" };

describe("kontrak auth", () => {
  it("POST /auth/register mendaftarkan user baru (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.noUser)
      .uponReceiving("registrasi user baru")
      .withRequest("POST", "/api/v1/auth/register", (b) =>
        b.headers(JSON_HEADERS).jsonBody({ name: "Budi", email: "budi@pact.dev", password: "rahasia123" }),
      )
      .willRespondWith(201, (b) => b.jsonBody(budi))
      .executeTest(async (server) => {
        const user = await clientFor(server).auth.register({
          name: "Budi",
          email: "budi@pact.dev",
          password: "rahasia123",
        });
        expect(user.email).toBe("budi@pact.dev");
        expect(user.name).toBe("Budi");
      });
  });

  it("POST /auth/register dengan email terpakai -> 409 EMAIL_TAKEN", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiRegistered)
      .uponReceiving("registrasi dengan email yang sudah terdaftar")
      .withRequest("POST", "/api/v1/auth/register", (b) =>
        b.headers(JSON_HEADERS).jsonBody({ name: "Budi", email: "budi@pact.dev", password: "rahasia123" }),
      )
      .willRespondWith(409, (b) => b.jsonBody(errorBody("EMAIL_TAKEN", "Email sudah terdaftar")))
      .executeTest(async (server) => {
        await expect(
          clientFor(server).auth.register({ name: "Budi", email: "budi@pact.dev", password: "rahasia123" }),
        ).rejects.toMatchObject({ status: 409, code: "EMAIL_TAKEN" });
      });
  });

  it("POST /auth/register dengan password pendek -> 400 VALIDATION_ERROR", async () => {
    await pact
      .addInteraction()
      .given(STATE.noUser)
      .uponReceiving("registrasi dengan password terlalu pendek")
      .withRequest("POST", "/api/v1/auth/register", (b) =>
        b.headers(JSON_HEADERS).jsonBody({ name: "Budi", email: "budi@pact.dev", password: "pendek" }),
      )
      .willRespondWith(400, (b) =>
        b.jsonBody(errorBody("VALIDATION_ERROR", "Data tidak valid", { password: "Password minimal 8 karakter" })),
      )
      .executeTest(async (server) => {
        await expect(
          clientFor(server).auth.register({ name: "Budi", email: "budi@pact.dev", password: "pendek" }),
        ).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR", fields: { password: expect.any(String) } });
      });
  });

  it("POST /auth/login berhasil (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiRegistered)
      .uponReceiving("login dengan kredensial benar")
      .withRequest("POST", "/api/v1/auth/login", (b) =>
        b.headers(JSON_HEADERS).jsonBody({ email: "budi@pact.dev", password: "rahasia123" }),
      )
      .willRespondWith(200, (b) => b.jsonBody(budi))
      .executeTest(async (server) => {
        const user = await clientFor(server).auth.login({ email: "budi@pact.dev", password: "rahasia123" });
        expect(user.email).toBe("budi@pact.dev");
      });
  });

  it("POST /auth/login dengan password salah -> 401 INVALID_CREDENTIALS", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiRegistered)
      .uponReceiving("login dengan password salah")
      .withRequest("POST", "/api/v1/auth/login", (b) =>
        b.headers(JSON_HEADERS).jsonBody({ email: "budi@pact.dev", password: "salah-banget" }),
      )
      .willRespondWith(401, (b) => b.jsonBody(errorBody("INVALID_CREDENTIALS", "Email atau password salah")))
      .executeTest(async (server) => {
        await expect(
          clientFor(server).auth.login({ email: "budi@pact.dev", password: "salah-banget" }),
        ).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
      });
  });

  it("POST /auth/logout mengakhiri sesi (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiLoggedIn)
      .uponReceiving("logout")
      .withRequest("POST", "/api/v1/auth/logout", (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).auth.logout()).resolves.toBeUndefined();
      });
  });

  it("GET /auth/me mengembalikan user yang login (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiLoggedIn)
      .uponReceiving("profil user yang sedang login")
      .withRequest("GET", "/api/v1/auth/me", (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(budi))
      .executeTest(async (server) => {
        const user = await clientFor(server, true).auth.me();
        expect(user.email).toBe("budi@pact.dev");
      });
  });

  it("GET /auth/me tanpa sesi -> 401 UNAUTHENTICATED", async () => {
    await pact
      .addInteraction()
      .given(STATE.noUser)
      .uponReceiving("profil tanpa sesi")
      .withRequest("GET", "/api/v1/auth/me")
      .willRespondWith(401, (b) => b.jsonBody(errorBody("UNAUTHENTICATED", "Anda harus masuk terlebih dahulu")))
      .executeTest(async (server) => {
        await expect(clientFor(server).auth.me()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
      });
  });
});

