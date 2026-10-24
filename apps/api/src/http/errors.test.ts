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
