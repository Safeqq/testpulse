import {
  acceptInvitationDto,
  createdInvitationDto,
  invitationDto,
  invitationPreviewDto,
  memberDto,
} from "@testpulse/shared";
import type { TestApi } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { expectApiError, expectFieldError, parseBody, tokenFromUrl } from "../support/http.js";

const API = "/api/v1";

async function setup(api: TestApi) {
  const owner = await api.register();
  const project = await api.createProject(owner);
  return { owner, slug: project.slug, base: `${API}/projects/${project.slug}/invitations` };
}

test.describe("POST /projects/:slug/invitations", () => {
  for (const role of ["tester", "viewer"] as const) {
    test(`admin membuat undangan ${role} → 201 sesuai schema, berlaku 7 hari`, async ({ api }) => {
      const { owner, base } = await setup(api);
      const before = Date.now();
      const created = await parseBody(await owner.request.post(base, { data: { role } }), 201, createdInvitationDto);

      expect(created.role).toBe(role);
      expect(tokenFromUrl(created.url)).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(created.url).toContain("/invite/");
      const days = (Date.parse(created.expiresAt) - before) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThan(7.01);
    });
  }

  test("role admin atau tidak dikenal → 400 fields.role", async ({ api }) => {
    const { owner, base } = await setup(api);
    await expectFieldError(await owner.request.post(base, { data: { role: "admin" } }), "role");
    await expectFieldError(await owner.request.post(base, { data: { role: "superuser" } }), "role");
    await expectApiError(await owner.request.post(base, { data: {} }), 400, "VALIDATION_ERROR");
  });
});

test.describe("GET /projects/:slug/invitations", () => {
  test("memuat undangan aktif sesuai schema tanpa membocorkan token", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    const created = await api.createInvitation(owner, slug, "viewer");

    const res = await owner.request.get(base);
    const list = await parseBody(res, 200, invitationDto.array());
    expect(list).toEqual([expect.objectContaining({ id: created.id, role: "viewer" })]);
    expect(list[0]?.createdBy).toEqual({ id: owner.user.id, name: owner.user.name });
    expect(await res.text()).not.toContain(tokenFromUrl(created.url));
  });
});

test.describe("GET /invitations/:token (pratinjau publik)", () => {
  test("anonim melihat nama project, role, dan kedaluwarsa", async ({ api }) => {
    const { owner, slug } = await setup(api);
    const created = await api.createInvitation(owner, slug, "tester");

    const res = await (await api.anonymous()).get(`${API}/invitations/${tokenFromUrl(created.url)}`);
    const preview = await parseBody(res, 200, invitationPreviewDto);
    expect(preview).toMatchObject({ projectSlug: slug, role: "tester", expiresAt: created.expiresAt });
  });

  test("token tidak dikenal → 404 INVITATION_NOT_FOUND", async ({ api }) => {
    const res = await (await api.anonymous()).get(`${API}/invitations/token-yang-tidak-ada`);
    await expectApiError(res, 404, "INVITATION_NOT_FOUND");
  });
});

test.describe("POST /invitations/:token/accept", () => {
  test("alur lengkap: terima → jadi anggota dengan role undangan → undangan terpakai (410)", async ({ api }) => {
    const { owner, slug } = await setup(api);
    const created = await api.createInvitation(owner, slug, "tester");
    const token = tokenFromUrl(created.url);
    const guest = await api.register();

    const accepted = await guest.request.post(`${API}/invitations/${token}/accept`);
    expect(await parseBody(accepted, 200, acceptInvitationDto)).toEqual({ projectSlug: slug, role: "tester" });

    const members = await parseBody(await owner.request.get(`${API}/projects/${slug}/members`), 200, memberDto.array());
    expect(members).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: guest.user.id, role: "tester" })]),
    );

    // Sekali pakai: pengguna lain mendapat 410, begitu pula pratinjau dan daftar undangan aktif.
    const other = await api.register();
    await expectApiError(await other.request.post(`${API}/invitations/${token}/accept`), 410, "INVITATION_USED");
    await expectApiError(await (await api.anonymous()).get(`${API}/invitations/${token}`), 410, "INVITATION_USED");
    const active = await parseBody(await owner.request.get(`${API}/projects/${slug}/invitations`), 200, invitationDto.array());
    expect(active).toEqual([]);
  });

  test("tanpa login → 401 UNAUTHENTICATED", async ({ api }) => {
    const { owner, slug } = await setup(api);
    const created = await api.createInvitation(owner, slug, "viewer");
    const res = await (await api.anonymous()).post(`${API}/invitations/${tokenFromUrl(created.url)}/accept`);
    await expectApiError(res, 401, "UNAUTHENTICATED");
  });

  test("token tidak dikenal → 404 INVITATION_NOT_FOUND", async ({ api }) => {
    const guest = await api.register();
    await expectApiError(await guest.request.post(`${API}/invitations/token-yang-tidak-ada/accept`), 404, "INVITATION_NOT_FOUND");
  });

  test("sudah menjadi anggota → 409 ALREADY_MEMBER, undangan tidak terpakai, role lama utuh", async ({ api }) => {
    const { owner, slug } = await setup(api);
    const created = await api.createInvitation(owner, slug, "viewer");
    const token = tokenFromUrl(created.url);

    // Admin menerima undangan project-nya sendiri.
    await expectApiError(await owner.request.post(`${API}/invitations/${token}/accept`), 409, "ALREADY_MEMBER");

    const mine = await owner.request.get(`${API}/projects/${slug}`);
    expect((await mine.json()).myRole).toBe("admin");

    // Undangan masih bisa dipakai orang lain.
    const guest = await api.register();
    await api.acceptInvitation(guest, token);
  });
});

test.describe("DELETE /projects/:slug/invitations/:id", () => {
  test("admin mencabut → 204; pratinjau 404, hilang dari daftar, tidak bisa diterima", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    const created = await api.createInvitation(owner, slug, "viewer");
    const token = tokenFromUrl(created.url);

    expect((await owner.request.delete(`${base}/${created.id}`)).status()).toBe(204);

    await expectApiError(await (await api.anonymous()).get(`${API}/invitations/${token}`), 404, "INVITATION_NOT_FOUND");
    const guest = await api.register();
    await expectApiError(await guest.request.post(`${API}/invitations/${token}/accept`), 404, "INVITATION_NOT_FOUND");
    expect(await parseBody(await owner.request.get(base), 200, invitationDto.array())).toEqual([]);
  });

  test("mencabut dua kali atau dengan ID rusak → 404 INVITATION_NOT_FOUND", async ({ api }) => {
    const { owner, slug, base } = await setup(api);
    const created = await api.createInvitation(owner, slug, "viewer");
    await owner.request.delete(`${base}/${created.id}`);

    await expectApiError(await owner.request.delete(`${base}/${created.id}`), 404, "INVITATION_NOT_FOUND");
    await expectApiError(await owner.request.delete(`${base}/bukan-uuid`), 404, "INVITATION_NOT_FOUND");
  });

  test("undangan milik project lain tidak bisa dicabut lewat project ini", async ({ api }) => {
    const first = await setup(api);
    const second = await setup(api);
    const foreign = await api.createInvitation(second.owner, second.slug, "viewer");

    await expectApiError(await first.owner.request.delete(`${first.base}/${foreign.id}`), 404, "INVITATION_NOT_FOUND");
    // Undangan asli masih aktif.
    const res = await (await api.anonymous()).get(`${API}/invitations/${tokenFromUrl(foreign.url)}`);
    expect(res.status()).toBe(200);
  });
});
