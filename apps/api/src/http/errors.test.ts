import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, registerErrorHandlers } from "./errors.js";
import { parseOrThrow } from "./validate.js";

function buildTestServer() {
  const app = Fastify({ logger: false });
  registerErrorHandlers(app);
  app.get("/app-error", () => {
    throw new AppError(409, "EMAIL_TAKEN", "Email sudah terdaftar");
  });
  app.get("/validation", () => {
    parseOrThrow(z.object({ user: z.object({ name: z.string().min(2, "Terlalu pendek") }), age: z.number() }), {
      user: { name: "a" },
      age: "x",
    });
  });
  app.get("/rate-limit", () => {
    throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
  });
  app.get("/client-error", () => {
    throw Object.assign(new Error("Payload too large"), { statusCode: 413 });
  });
  app.post("/small", { bodyLimit: 10 }, () => ({ ok: true }));
  // Postgres membatalkan statement karena statement_timeout (SQLSTATE 57014); drizzle membungkusnya sebagai `cause`.
  app.get("/statement-timeout", () => {
    throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
  });
  app.get("/statement-timeout-wrapped", () => {
    const cause = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    throw new Error("Failed query: select 1", { cause });
  });
  app.get("/boom", () => {
    throw new Error("detail rahasia: password=hunter2");
  });
  return app;
}

describe("error handler", () => {
  const app = buildTestServer();

  it("AppError → status dan kode miliknya, tanpa fields", async () => {
    const res = await app.inject({ method: "GET", url: "/app-error" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: "EMAIL_TAKEN", message: "Email sudah terdaftar" } });
  });

  it("parseOrThrow → 400 VALIDATION_ERROR dengan fields path bertitik", async () => {
    const res = await app.inject({ method: "GET", url: "/validation" });
    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.fields["user.name"]).toBe("Terlalu pendek");
    expect(typeof error.fields.age).toBe("string");
  });

  it("error berstatus 429 → 429 RATE_LIMITED", async () => {
    const res = await app.inject({ method: "GET", url: "/rate-limit" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("RATE_LIMITED");
  });

  it("error 4xx lain dari Fastify → 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({ method: "GET", url: "/client-error" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("body melebihi bodyLimit rute (FST_ERR_CTP_BODY_TOO_LARGE) → 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await app.inject({ method: "POST", url: "/small", payload: { name: "lebih dari sepuluh byte" } });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: { code: "PAYLOAD_TOO_LARGE", message: expect.any(String) } });
  });

  it.each(["/statement-timeout", "/statement-timeout-wrapped"])(
    "statement_timeout Postgres (57014) di %s → 503 INTERNAL_ERROR dengan pesan coba lagi",
    async (url) => {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        error: { code: "INTERNAL_ERROR", message: "Server sedang sibuk memproses data ini, coba lagi sebentar lagi" },
      });
    },
  );

  it("error tak terduga → 500 INTERNAL_ERROR tanpa membocorkan detail", async () => {
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");
    expect(res.body).not.toContain("hunter2");
  });

  it("rute tidak dikenal → 404 NOT_FOUND", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});
