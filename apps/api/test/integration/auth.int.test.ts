import { faker } from "@faker-js/faker";
import { userDto } from "@testpulse/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { hashToken } from "../../src/modules/auth/domain/tokens.js";
import { sessions, users } from "../../src/db/schema.js";
import { createTestApp, registerUser } from "./helpers.js";

const REGISTER = "/api/v1/auth/register";
const LOGIN = "/api/v1/auth/login";
const LOGOUT = "/api/v1/auth/logout";
const ME = "/api/v1/auth/me";

function uniqueEmail(): string {
  return `${faker.string.uuid()}@example.test`;
}

function setCookieOf(res: { headers: Record<string, unknown> }): string {
  const header = res.headers["set-cookie"];
  return Array.isArray(header) ? header.join("\n") : String(header);
}

describe("auth", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  describe("POST /auth/register", () => {
    it("201 dengan user dan cookie sesi beratribut aman", async () => {
      const email = uniqueEmail();
      const res = await app.inject({
        method: "POST",
        url: REGISTER,
        payload: { name: "  Budi  ", email, password: "rahasia-123" },
      });
      expect(res.statusCode).toBe(201);
      const user = userDto.parse(res.json());
      expect(user).toMatchObject({ email, name: "Budi" });
      expect(res.body).not.toContain("password");

      const cookie = setCookieOf(res);
      expect(cookie).toContain("tp_session=");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=1209600");
      expect(cookie).not.toContain("Secure");
    });

    it("menyimpan email ternormalisasi (trim + lowercase)", async () => {
      const email = uniqueEmail();
      const res = await app.inject({
        method: "POST",
        url: REGISTER,
        payload: { name: "Siti", email: `  ${email.toUpperCase()}  `, password: "rahasia-123" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().email).toBe(email);
      const [row] = await app.db.select().from(users).where(eq(users.email, email));
      expect(row?.email).toBe(email);
    });

    it("cookie memuat Secure saat cookieSecure true", async () => {
      const secureApp = await createTestApp({ cookieSecure: true });
      const res = await secureApp.inject({
        method: "POST",
        url: REGISTER,
        payload: { name: "Aman", email: uniqueEmail(), password: "rahasia-123" },
      });
      expect(res.statusCode).toBe(201);
      expect(setCookieOf(res)).toContain("Secure");
    });

    it("409 EMAIL_TAKEN meski beda huruf besar/kecil", async () => {
      const { user } = await registerUser(app);
      const res = await app.inject({
        method: "POST",
        url: REGISTER,
        payload: { name: "Lain", email: user.email.toUpperCase(), password: "rahasia-123" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("EMAIL_TAKEN");
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("400 VALIDATION_ERROR dengan fields.password untuk password 7 karakter", async () => {
      const res = await app.inject({
        method: "POST",
        url: REGISTER,
        payload: { name: "Budi", email: uniqueEmail(), password: "1234567" },
      });
      expect(res.statusCode).toBe(400);
      const { error } = res.json();
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.fields.password).toEqual(expect.any(String));
    });

    it("400 VALIDATION_ERROR untuk body kosong", async () => {
      const res = await app.inject({ method: "POST", url: REGISTER, payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields).toMatchObject({
        name: expect.any(String),
        email: expect.any(String),
        password: expect.any(String),
      });
    });
  });

  describe("POST /auth/login", () => {
    it("200 meski email diberi spasi dan huruf kapital (Review Focus 2)", async () => {
      const { user, password } = await registerUser(app);
      const res = await app.inject({
        method: "POST",
        url: LOGIN,
        payload: { email: "  " + user.email.toUpperCase() + " ", password },
      });
      expect(res.statusCode).toBe(200);
      expect(userDto.parse(res.json())).toEqual(user);
      expect(setCookieOf(res)).toContain("tp_session=");
    });

    it("login menghasilkan sesi yang bisa dipakai untuk me", async () => {
      const { user, password } = await registerUser(app);
      const login = await app.inject({ method: "POST", url: LOGIN, payload: { email: user.email, password } });
      const token = login.cookies.find((c) => c.name === "tp_session")?.value;
      const me = await app.inject({ method: "GET", url: ME, headers: { cookie: `tp_session=${token}` } });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toEqual(user);
    });

    it("password salah dan email tak terdaftar → 401 INVALID_CREDENTIALS dengan pesan identik", async () => {
      const { user } = await registerUser(app);
      const wrongPassword = await app.inject({
        method: "POST",
        url: LOGIN,
        payload: { email: user.email, password: "password-salah" },
      });
      const unknownEmail = await app.inject({
        method: "POST",
        url: LOGIN,
        payload: { email: uniqueEmail(), password: "password-salah" },
      });
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      expect(wrongPassword.json().error.code).toBe("INVALID_CREDENTIALS");
      expect(unknownEmail.json().error.code).toBe("INVALID_CREDENTIALS");
      expect(wrongPassword.json().error.message).toBe(unknownEmail.json().error.message);
      expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
    });

    it("400 VALIDATION_ERROR untuk format email tidak valid", async () => {
      const res = await app.inject({ method: "POST", url: LOGIN, payload: { email: "bukan-email", password: "x" } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields.email).toEqual(expect.any(String));
    });
  });

  describe("GET /auth/me", () => {
    it("200 dengan cookie sesi", async () => {
      const { user, cookie } = await registerUser(app);
      const res = await app.inject({ method: "GET", url: ME, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(user);
    });

    it("401 UNAUTHENTICATED tanpa cookie", async () => {
      const res = await app.inject({ method: "GET", url: ME });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHENTICATED");
    });

    it("401 untuk token yang tidak dikenal", async () => {
      const res = await app.inject({ method: "GET", url: ME, headers: { cookie: "tp_session=tidak-ada" } });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHENTICATED");
    });

    it("sesi kedaluwarsa → 401 dan barisnya dibersihkan (Review Focus 3)", async () => {
      const { cookie } = await registerUser(app);
      const token = cookie.slice("tp_session=".length);
      const id = hashToken(token);
      await app.db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(sessions.id, id));

      const res = await app.inject({ method: "GET", url: ME, headers: { cookie } });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHENTICATED");
      const rows = await app.db.select().from(sessions).where(eq(sessions.id, id));
      expect(rows).toHaveLength(0);
    });

    it("DB hanya menyimpan hash token, bukan token", async () => {
      const { cookie, user } = await registerUser(app);
      const token = cookie.slice("tp_session=".length);
      const rows = await app.db.select().from(sessions).where(eq(sessions.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).not.toBe(token);
      expect(rows[0]?.id).toBe(hashToken(token));
    });
  });

  describe("POST /auth/logout", () => {
    it("204, cookie dihapus, dan sesi lama tidak berlaku lagi", async () => {
      const { cookie, user } = await registerUser(app);
      const res = await app.inject({ method: "POST", url: LOGOUT, headers: { cookie } });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");
      const cleared = setCookieOf(res);
      expect(cleared).toContain("tp_session=;");
      expect(cleared).toContain("Max-Age=0");

      const me = await app.inject({ method: "GET", url: ME, headers: { cookie } });
      expect(me.statusCode).toBe(401);
      const rows = await app.db.select().from(sessions).where(eq(sessions.userId, user.id));
      expect(rows).toHaveLength(0);
    });

    it("401 UNAUTHENTICATED tanpa sesi", async () => {
      const res = await app.inject({ method: "POST", url: LOGOUT });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHENTICATED");
    });

    it("hanya mengakhiri sesi yang dipakai, sesi lain milik user yang sama tetap berlaku", async () => {
      const first = await registerUser(app);
      const login = await app.inject({
        method: "POST",
        url: LOGIN,
        payload: { email: first.user.email, password: first.password },
      });
      const secondCookie = `tp_session=${login.cookies.find((c) => c.name === "tp_session")?.value}`;

      await app.inject({ method: "POST", url: LOGOUT, headers: { cookie: first.cookie } });
      const me = await app.inject({ method: "GET", url: ME, headers: { cookie: secondCookie } });
      expect(me.statusCode).toBe(200);
    });
  });
});
