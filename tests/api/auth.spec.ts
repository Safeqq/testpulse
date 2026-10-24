import { faker } from "@faker-js/faker";
import { userDto } from "@testpulse/shared";
import { newUserData } from "../support/data.js";
import { expect, test } from "../support/fixtures.js";
import { expectApiError, expectFieldError, expectSecurityHeaders, parseBody } from "../support/http.js";

const REGISTER = "/api/v1/auth/register";
const LOGIN = "/api/v1/auth/login";
const LOGOUT = "/api/v1/auth/logout";
const ME = "/api/v1/auth/me";

test.describe("GET /api/health", () => {
  test("200 {status:ok} dengan header keamanan", async ({ api }) => {
    const res = await (await api.anonymous()).get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expectSecurityHeaders(res);
  });
});

test.describe("POST /auth/register", () => {
  test("201 mengembalikan user (schema shared), tanpa password, dengan cookie sesi aman", async ({ api }) => {
    const data = newUserData();
    const res = await (await api.anonymous()).post(REGISTER, { data: { ...data, name: `  ${data.name}  ` } });
    const user = await parseBody(res, 201, userDto);
    expect(user).toMatchObject({ name: data.name, email: data.email.toLowerCase() });
    expect(await res.text()).not.toContain("password");

    const cookie = res.headers()["set-cookie"] ?? "";
    expect(cookie).toContain("tp_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=1209600");
    expectSecurityHeaders(res);
  });

  test("email disimpan lowercase dan di-trim; email sama beda huruf → 409 EMAIL_TAKEN tanpa cookie", async ({ api }) => {
    const data = newUserData();
    const first = await (await api.anonymous()).post(REGISTER, { data: { ...data, email: `  ${data.email.toUpperCase()} ` } });
    expect((await parseBody(first, 201, userDto)).email).toBe(data.email.toLowerCase());

    const dup = await (await api.anonymous()).post(REGISTER, { data });
    await expectApiError(dup, 409, "EMAIL_TAKEN");
    expect(dup.headers()["set-cookie"]).toBeUndefined();
  });

  test.describe("boundary nama (1–80 setelah trim)", () => {
    for (const length of [1, 80]) {
      test(`nama ${length} karakter → 201`, async ({ api }) => {
        const res = await (await api.anonymous()).post(REGISTER, {
          data: { ...newUserData(), name: faker.string.alpha(length) },
        });
        expect((await parseBody(res, 201, userDto)).name).toHaveLength(length);
      });
    }

    test("nama 80 karakter dengan spasi di tepi → 201 (trim dulu)", async ({ api }) => {
      const res = await (await api.anonymous()).post(REGISTER, {
        data: { ...newUserData(), name: `  ${faker.string.alpha(80)}  ` },
      });
      expect((await parseBody(res, 201, userDto)).name).toHaveLength(80);
    });

    test("nama 81 karakter → 400 fields.name", async ({ api }) => {
      const res = await (await api.anonymous()).post(REGISTER, { data: { ...newUserData(), name: faker.string.alpha(81) } });
      await expectFieldError(res, "name");
    });

    for (const [label, name] of [["kosong", ""], ["hanya spasi", "    "]] as const) {
      test(`nama ${label} → 400 fields.name`, async ({ api }) => {
        const res = await (await api.anonymous()).post(REGISTER, { data: { ...newUserData(), name } });
        await expectFieldError(res, "name");
      });
    }
  });

  test.describe("boundary password (8–128)", () => {
    for (const length of [8, 128]) {
      test(`password ${length} karakter → 201`, async ({ api }) => {
        const res = await (await api.anonymous()).post(REGISTER, {
          data: { ...newUserData(), password: faker.string.alphanumeric(length) },
        });
        await parseBody(res, 201, userDto);
      });
    }

    for (const length of [7, 129]) {
      test(`password ${length} karakter → 400 fields.password`, async ({ api }) => {
        const res = await (await api.anonymous()).post(REGISTER, {
          data: { ...newUserData(), password: faker.string.alphanumeric(length) },
        });
        await expectFieldError(res, "password");
      });
    }
  });

  test("email tidak valid → 400 fields.email; body kosong → 400 dengan semua field", async ({ api }) => {
    const anon = await api.anonymous();
    await expectFieldError(await anon.post(REGISTER, { data: { ...newUserData(), email: "bukan-email" } }), "email");

    const empty = await expectApiError(await anon.post(REGISTER, { data: {} }), 400, "VALIDATION_ERROR");
    expect(Object.keys(empty.fields ?? {}).sort()).toEqual(["email", "name", "password"]);
  });
});

test.describe("POST /auth/login", () => {
  test("200 mengembalikan user dan cookie sesi; email huruf besar + spasi tetap berhasil", async ({ api }) => {
    const { user, password } = await api.register();
    const anon = await api.anonymous();
    const res = await anon.post(LOGIN, { data: { email: `  ${user.email.toUpperCase()} `, password } });
    expect(await parseBody(res, 200, userDto)).toEqual(user);
    expect(res.headers()["set-cookie"]).toContain("tp_session=");

    const me = await anon.get(ME);
    expect(await parseBody(me, 200, userDto)).toEqual(user);
  });

  test("password salah dan email tak terdaftar → 401 INVALID_CREDENTIALS dengan pesan identik", async ({ api }) => {
    const { user } = await api.register();
    const anon = await api.anonymous();
    const wrongPassword = await anon.post(LOGIN, { data: { email: user.email, password: "password-salah" } });
    const unknownEmail = await anon.post(LOGIN, { data: { email: newUserData().email, password: "password-salah" } });

    const a = await expectApiError(wrongPassword, 401, "INVALID_CREDENTIALS");
    const b = await expectApiError(unknownEmail, 401, "INVALID_CREDENTIALS");
    expect(a.message).toBe(b.message);
    expect(wrongPassword.headers()["set-cookie"]).toBeUndefined();
  });

  test("format email salah → 400 fields.email; password 129 karakter → 400 fields.password", async ({ api }) => {
    const anon = await api.anonymous();
    await expectFieldError(await anon.post(LOGIN, { data: { email: "bukan-email", password: "x" } }), "email");
    await expectFieldError(
      await anon.post(LOGIN, { data: { email: newUserData().email, password: faker.string.alphanumeric(129) } }),
      "password",
    );
  });
});

test.describe("GET /auth/me dan POST /auth/logout", () => {
  test("me tanpa sesi → 401 UNAUTHENTICATED; token acak → 401", async ({ api }) => {
    const anon = await api.anonymous();
    await expectApiError(await anon.get(ME), 401, "UNAUTHENTICATED");
    await expectApiError(await anon.get(ME, { headers: { cookie: "tp_session=tidak-ada" } }), 401, "UNAUTHENTICATED");
  });

  test("logout → 204, token lama tidak berlaku lagi di server", async ({ api }) => {
    const alice = await api.register();
    const token = (await alice.request.storageState()).cookies.find((c) => c.name === "tp_session")?.value;
    expect(token).toBeTruthy();

    const out = await alice.request.post(LOGOUT);
    expect(out.status()).toBe(204);
    expectSecurityHeaders(out);

    // Cookie lama dikirim manual: harus ditolak karena baris sesinya sudah dihapus.
    const replay = await (await api.anonymous()).get(ME, { headers: { cookie: `tp_session=${token}` } });
    await expectApiError(replay, 401, "UNAUTHENTICATED");
  });

  test("logout tanpa sesi → 401 UNAUTHENTICATED", async ({ api }) => {
    await expectApiError(await (await api.anonymous()).post(LOGOUT), 401, "UNAUTHENTICATED");
  });
});

test.describe("Proteksi CSRF dan format request", () => {
  test("Origin asing pada request pengubah data → 403 FORBIDDEN", async ({ api }) => {
    const res = await (await api.anonymous()).post(REGISTER, {
      data: newUserData(),
      headers: { origin: "https://evil.example" },
    });
    await expectApiError(res, 403, "FORBIDDEN");
  });

  test("Origin asing pada GET tidak diblokir", async ({ api }) => {
    const res = await (await api.anonymous()).get("/api/health", { headers: { origin: "https://evil.example" } });
    expect(res.status()).toBe(200);
  });

  test("body bukan application/json → 400 VALIDATION_ERROR", async ({ api }) => {
    const res = await (await api.anonymous()).post(REGISTER, {
      headers: { "content-type": "text/plain" },
      data: JSON.stringify(newUserData()),
    });
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  test("JSON rusak → 400 VALIDATION_ERROR", async ({ api }) => {
    const res = await (await api.anonymous()).post(LOGIN, {
      headers: { "content-type": "application/json" },
      data: "{bukan json",
    });
    await expectApiError(res, 400, "VALIDATION_ERROR");
  });

  test("rute tidak dikenal → 404 NOT_FOUND dengan bentuk error standar", async ({ api }) => {
    await expectApiError(await (await api.anonymous()).get("/api/v1/tidak-ada"), 404, "NOT_FOUND");
  });
});
