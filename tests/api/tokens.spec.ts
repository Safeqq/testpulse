import { createdTokenDto, tokenDto } from "@testpulse/shared";
import type { TestApi } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { expectApiError, expectFieldError, parseBody } from "../support/http.js";
import { buildJUnit } from "../support/junit.js";

const API = "/api/v1";
const MAX_ACTIVE_TOKENS = 10;

async function setup(api: TestApi) {
  const owner = await api.register();
  const { slug } = await api.createProject(owner);
  return { owner, slug, base: `${API}/projects/${slug}/tokens` };
}

test.describe("token CI (admin)", () => {
  test("POST membuat token sekali tampil: tp_ + 43 karakter base64url, daftar tidak memuat nilainya", async ({ api }) => {
    const { owner, base } = await setup(api);
    const created = await parseBody(await owner.request.post(base, { data: { name: "  CI utama  " } }), 201, createdTokenDto);
    expect(created.name).toBe("CI utama");
    expect(created.token).toMatch(/^tp_[A-Za-z0-9_-]{43}$/);

    const res = await owner.request.get(base);
    const list = await parseBody(res, 200, tokenDto.array());
    expect(list).toEqual([
      expect.objectContaining({ id: created.id, name: "CI utama", lastUsedAt: null, createdBy: { id: owner.user.id, name: owner.user.name } }),
    ]);
    expect(await res.text()).not.toContain(created.token);
  });

  test("nama kosong atau lebih dari 60 karakter → 400 fields.name", async ({ api }) => {
    const { owner, base } = await setup(api);
    await expectFieldError(await owner.request.post(base, { data: { name: "   " } }), "name");
    await expectFieldError(await owner.request.post(base, { data: { name: "n".repeat(61) } }), "name");
  });

  test("DELETE mencabut token: tidak lagi di daftar, upload dengannya 401, run lama tetap ada", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    const token = await api.createToken(owner, slug);
    expect((await api.uploadRun(token.token, slug, buildJUnit([{ name: "a" }]), { branch: "main" })).status()).toBe(201);

    expect((await owner.request.delete(`${base}/${token.id}`)).status()).toBe(204);
    expect(await parseBody(await owner.request.get(base), 200, tokenDto.array())).toEqual([]);
    const rejected = await api.uploadRun(token.token, slug, buildJUnit([{ name: "b" }]), { branch: "main" });
    await expectApiError(rejected, 401, "UNAUTHENTICATED");

    const runs = await owner.request.get(`${API}/projects/${slug}/runs`);
    expect(((await runs.json()) as { runs: unknown[] }).runs).toHaveLength(1);
  });

  test("DELETE token yang sudah dicabut, milik project lain, atau bukan UUID → 404 TOKEN_NOT_FOUND", async ({ api }) => {
    const mine = await setup(api);
    const other = await setup(api);
    const revoked = await api.createToken(mine.owner, mine.slug);
    const foreign = await api.createToken(other.owner, other.slug);
    expect((await mine.owner.request.delete(`${mine.base}/${revoked.id}`)).status()).toBe(204);

    await expectApiError(await mine.owner.request.delete(`${mine.base}/${revoked.id}`), 404, "TOKEN_NOT_FOUND");
    await expectApiError(await mine.owner.request.delete(`${mine.base}/${foreign.id}`), 404, "TOKEN_NOT_FOUND");
    await expectApiError(await mine.owner.request.delete(`${mine.base}/bukan-uuid`), 404, "TOKEN_NOT_FOUND");
    // Token project lain tetap aktif.
    expect(await parseBody(await other.owner.request.get(other.base), 200, tokenDto.array())).toHaveLength(1);
  });

  test("token ke-11 → 409 TOKEN_LIMIT; mencabut satu membuka slot lagi", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    const created = [];
    for (let i = 0; i < MAX_ACTIVE_TOKENS; i++) created.push(await api.createToken(owner, slug, `token ${i}`));

    await expectApiError(await owner.request.post(base, { data: { name: "kelebihan" } }), 409, "TOKEN_LIMIT");

    expect((await owner.request.delete(`${base}/${created[0]!.id}`)).status()).toBe(204);
    await parseBody(await owner.request.post(base, { data: { name: "pengganti" } }), 201, createdTokenDto);
  });
});
