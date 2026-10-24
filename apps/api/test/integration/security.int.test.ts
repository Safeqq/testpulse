import { faker } from "@faker-js/faker";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

const REGISTER = "/api/v1/auth/register";
const LOGIN = "/api/v1/auth/login";
const LOGOUT = "/api/v1/auth/logout";

describe("rate limit", () => {
  it("10 login gagal → 401, ke-11 → 429 RATE_LIMITED dengan bentuk error standar", async () => {
    const app = await createTestApp({ rateLimitMax: 10 });
    const attempt = () =>
      app.inject({ method: "POST", url: LOGIN, payload: { email: "tidak-ada@example.test", password: "salah-salah" } });

    for (let i = 0; i < 10; i++) {
      expect((await attempt()).statusCode).toBe(401);
    }
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({
      error: { code: "RATE_LIMITED", message: expect.any(String) },
    });
  });

  it("register juga dibatasi, dengan hitungan terpisah dari login", async () => {
    const app = await createTestApp({ rateLimitMax: 2 });
    const register = () =>
      app.inject({
        method: "POST",
        url: REGISTER,
        payload: { name: "Budi", email: `${faker.string.uuid()}@example.test`, password: "rahasia-123" },
      });
    expect((await register()).statusCode).toBe(201);
    expect((await register()).statusCode).toBe(201);
    expect((await register()).statusCode).toBe(429);
    const login = await app.inject({ method: "POST", url: LOGIN, payload: { email: "a@example.test", password: "x" } });
    expect(login.statusCode).toBe(401);
  });
});

describe("proteksi CSRF dan header", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  const registerPayload = () => ({
    name: "Budi",
    email: `${faker.string.uuid()}@example.test`,
    password: "rahasia-123",
  });

  it("Origin asing → 403 FORBIDDEN", async () => {
    const res = await app.inject({
      method: "POST",
      url: REGISTER,
      headers: { origin: "https://evil.example" },
      payload: registerPayload(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("Origin sama dengan APP_ORIGIN atau tanpa Origin → diproses normal", async () => {
    const same = await app.inject({
      method: "POST",
      url: REGISTER,
      headers: { origin: "http://localhost:5173" },
      payload: registerPayload(),
    });
    expect(same.statusCode).toBe(201);
    const none = await app.inject({ method: "POST", url: REGISTER, payload: registerPayload() });
    expect(none.statusCode).toBe(201);
  });

  it("Origin asing pada metode aman (GET) tidak diblokir", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "https://evil.example" } });
    expect(res.statusCode).toBe(200);
  });

  it("POST text/plain dengan body → 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "POST",
      url: REGISTER,
      headers: { "content-type": "text/plain" },
      payload: JSON.stringify(registerPayload()),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("form-urlencoded dengan body → 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "POST",
      url: LOGIN,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "email=a%40b.test&password=rahasia-123",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("POST tanpa body dan tanpa content-type diizinkan (logout → 401, bukan 400)", async () => {
    const res = await app.inject({ method: "POST", url: LOGOUT });
    expect(res.statusCode).toBe(401);
  });

  it("POST tanpa body tetapi content-type JSON tidak ditolak sebagai body rusak", async () => {
    const res = await app.inject({ method: "POST", url: LOGOUT, headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(401);
  });

  it("JSON rusak → 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "POST",
      url: LOGIN,
      headers: { "content-type": "application/json" },
      payload: "{bukan json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("respons memuat header keamanan helmet", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });
});
