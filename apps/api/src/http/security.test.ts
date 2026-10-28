import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { registerErrorHandlers } from "./errors.js";
import { registerSecurity } from "./security.js";

const APP_ORIGIN = "http://localhost:5173";
const XML = `<testsuite name="s"><testcase name="a"/></testsuite>`;

/** Server tanpa DB: hanya penjaga keamanan + rute tiruan yang mengembalikan body yang diterima. */
async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandlers(app);
  await registerSecurity(app, { appOrigin: APP_ORIGIN } as AppConfig);
  const echo = async (req: { body: unknown }) => ({ type: typeof req.body, body: req.body ?? null });
  app.post("/api/v1/projects/:slug/runs", echo);
  app.put("/api/v1/projects/:slug/runs", echo);
  app.post("/api/v1/projects/:slug/tokens", echo);
  app.post("/api/v1/projects/:slug/runs/:id", echo);
  app.post("/api/v1/auth/login", echo);
  return app;
}

describe("registerSecurity: pengecualian body XML untuk upload JUnit", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (method: "POST" | "PUT", url: string, contentType: string, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { "content-type": contentType, ...headers }, payload: XML });

  it.each(["application/xml", "text/xml", "application/xml; charset=utf-8", "TEXT/XML;charset=UTF-8"])(
    "POST /api/v1/projects/:slug/runs dengan %s → body diteruskan sebagai string",
    async (contentType) => {
      const res = await send("POST", "/api/v1/projects/demo/runs?branch=main", contentType);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ type: "string", body: XML });
    },
  );

  it.each([
    ["rute lain di bawah project", "POST", "/api/v1/projects/demo/tokens"],
    ["sub-path dari runs", "POST", "/api/v1/projects/demo/runs/123"],
    ["rute auth", "POST", "/api/v1/auth/login"],
    ["metode selain POST", "PUT", "/api/v1/projects/demo/runs"],
  ] as const)("XML ke %s tetap ditolak 400 VALIDATION_ERROR", async (_name, method, url) => {
    const res = await send(method, url, "application/xml");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it.each(["application/xhtml+xml", "application/xml-dtd", "text/plain", "application/x-www-form-urlencoded"])(
    "media type %s ke path upload tidak dikecualikan → 400",
    async (contentType) => {
      const res = await send("POST", "/api/v1/projects/demo/runs", contentType);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    },
  );

  it("Origin asing pada upload XML tetap → 403 FORBIDDEN", async () => {
    const res = await send("POST", "/api/v1/projects/demo/runs", "application/xml", { origin: "https://evil.example" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("JSON ke rute lain tetap diproses seperti biasa", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "a@b.test" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ type: "object", body: { email: "a@b.test" } });
  });
});
