import pg from "pg";
import { inject, it, expect } from "vitest";
import { createTestApp } from "./helpers.js";

it("GET /api/health → 200 saat DB terjangkau", async () => {
  const app = await createTestApp();
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "ok", commit: null });
});

it("GET /api/health menyertakan commit yang sedang berjalan jika dikonfigurasi", async () => {
  const app = await createTestApp({ gitCommit: "0123456789abcdef0123456789abcdef01234567" });
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "ok", commit: "0123456789abcdef0123456789abcdef01234567" });
});

it("GET /api/health → 503 saat DB tidak terjangkau", async () => {
  const app = await createTestApp({ databaseUrl: "postgres://x:x@127.0.0.1:1/none" });
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(503);
  expect(res.json()).toEqual({ status: "error" });
});

it("rute tidak dikenal → 404 NOT_FOUND dengan bentuk error standar", async () => {
  const res = await (await createTestApp()).inject({ method: "GET", url: "/api/v1/tidak-ada" });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ error: { code: "NOT_FOUND", message: expect.any(String) } });
});

it("migrasi membuat kelima tabel", async () => {
  const pool = new pg.Pool({ connectionString: inject("databaseUrl") });
  try {
    const { rows } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(["users", "sessions", "projects", "memberships", "invitations"]),
    );
  } finally {
    await pool.end();
  }
});
