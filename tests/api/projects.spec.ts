import { faker } from "@faker-js/faker";
import { RESERVED_SLUGS, memberDto, projectDto, slugify } from "@testpulse/shared";
import type { TestApi, TestUser } from "../support/api-client.js";
import { expect, test } from "../support/fixtures.js";
import { expectApiError, expectFieldError, parseBody, tokenFromUrl } from "../support/http.js";

const PROJECTS = "/api/v1/projects";

function randomName(length: number): string {
  return faker.string.alpha({ length, casing: "lower" });
}

/** Slug acak dengan panjang tertentu; diawali huruf agar selalu lolos pola. */
function randomSlug(length: number): string {
  return faker.string.alpha({ length: 1, casing: "lower" }) + faker.string.alphanumeric({ length: length - 1, casing: "lower" });
}

/** Menghapus project uji agar slug pendek tidak menumpuk di database bersama. */
async function cleanup(owner: TestUser, slug: string): Promise<void> {
  await owner.request.delete(`${PROJECTS}/${slug}`, { data: { confirmSlug: slug } });
}

test.describe("POST /projects", () => {
  test("201: slug dibuat dari nama, pembuat menjadi admin, default privat (schema shared)", async ({ api }) => {
    const owner = await api.register();
    const name = `Proyek Uji ${randomName(8)}`;
    const project = await parseBody(await owner.request.post(PROJECTS, { data: { name: `  ${name}  ` } }), 201, projectDto);
    expect(project).toMatchObject({ name, slug: slugify(name), visibility: "private", myRole: "admin" });
  });

  test("201: slug eksplisit dipakai apa adanya", async ({ api }) => {
    const owner = await api.register();
    const slug = `slug-${randomName(10)}`;
    const project = await parseBody(await owner.request.post(PROJECTS, { data: { name: "Nama Bebas", slug } }), 201, projectDto);
    expect(project.slug).toBe(slug);
  });

  test("tanpa login → 401 UNAUTHENTICATED", async ({ api }) => {
    const res = await (await api.anonymous()).post(PROJECTS, { data: { name: "Tanpa Login" } });
    await expectApiError(res, 401, "UNAUTHENTICATED");
  });

  test.describe("boundary nama (1–80 setelah trim)", () => {
    for (const length of [1, 80]) {
      test(`nama ${length} karakter → 201`, async ({ api }) => {
        const owner = await api.register();
        // Slug eksplisit agar nama 1 karakter (slug otomatis < 3) tetap valid.
        const slug = randomSlug(12);
        const res = await owner.request.post(PROJECTS, { data: { name: randomName(length), slug } });
        expect((await parseBody(res, 201, projectDto)).name).toHaveLength(length);
      });
    }

    test("nama 80 karakter dengan spasi di tepi → 201 (trim dulu)", async ({ api }) => {
      const owner = await api.register();
      const res = await owner.request.post(PROJECTS, { data: { name: `  ${randomName(80)}  `, slug: randomSlug(12) } });
      expect((await parseBody(res, 201, projectDto)).name).toHaveLength(80);
    });

    test("nama 81 karakter → 400 fields.name", async ({ api }) => {
      const owner = await api.register();
      await expectFieldError(await owner.request.post(PROJECTS, { data: { name: randomName(81) } }), "name");
    });

    for (const [label, name] of [["kosong", ""], ["hanya spasi", "   "]] as const) {
      test(`nama ${label} → 400 fields.name`, async ({ api }) => {
        const owner = await api.register();
        await expectFieldError(await owner.request.post(PROJECTS, { data: { name } }), "name");
      });
    }
  });

  test.describe("boundary slug (3–40)", () => {
    for (const length of [3, 40]) {
      test(`slug ${length} karakter → 201`, async ({ api }) => {
        const owner = await api.register();
        const slug = randomSlug(length);
        const project = await parseBody(await owner.request.post(PROJECTS, { data: { name: "Boundary", slug } }), 201, projectDto);
        expect(project.slug).toBe(slug);
        await cleanup(owner, slug);
      });
    }

    for (const length of [2, 41]) {
      test(`slug ${length} karakter → 400 fields.slug`, async ({ api }) => {
        const owner = await api.register();
        const res = await owner.request.post(PROJECTS, { data: { name: "Boundary", slug: randomSlug(length) } });
        await expectFieldError(res, "slug");
      });
    }

    for (const reserved of RESERVED_SLUGS) {
      test(`slug cadangan "${reserved}" → 400 fields.slug`, async ({ api }) => {
        const owner = await api.register();
        await expectFieldError(await owner.request.post(PROJECTS, { data: { name: "Cadangan", slug: reserved } }), "slug");
      });
    }

    for (const slug of ["Huruf-Besar", "-awal", "akhir-", "dua--hyphen", "ada spasi", "garis_bawah"]) {
      test(`pola slug salah "${slug}" → 400 fields.slug`, async ({ api }) => {
        const owner = await api.register();
        await expectFieldError(await owner.request.post(PROJECTS, { data: { name: "Pola Salah", slug } }), "slug");
      });
    }
  });

  test.describe("slug otomatis yang tidak valid (R1)", () => {
    for (const name of ["测试", "!!", "ab", "API"]) {
      test(`nama "${name}" → 400 fields.slug`, async ({ api }) => {
        const owner = await api.register();
        await expectFieldError(await owner.request.post(PROJECTS, { data: { name } }), "slug");
      });
    }
  });

  test("slug sudah dipakai (oleh user lain) → 409 SLUG_TAKEN", async ({ api }) => {
    const alice = await api.register();
    const bob = await api.register();
    const project = await api.createProject(alice);
    const res = await bob.request.post(PROJECTS, { data: { name: "Bentrok", slug: project.slug } });
    await expectApiError(res, 409, "SLUG_TAKEN");
  });
});

test.describe("GET /projects", () => {
  test("memuat project milik/ikut saya dengan role, bukan project publik orang lain", async ({ api }) => {
    const owner = await api.register();
    const mine = await api.createProject(owner);
    const stranger = await api.register();
    const theirs = await api.createProject(stranger);
    await api.setVisibility(stranger, theirs.slug, "public");
    const joined = await api.createProject(stranger);
    const asTester = await api.addMember(stranger, joined.slug, "tester");

    const list = (await parseBody(await owner.request.get(PROJECTS), 200, projectDto.array()));
    expect(list.map((p) => p.slug)).toEqual([mine.slug]);
    expect(list[0]?.myRole).toBe("admin");

    const testerList = await parseBody(await asTester.request.get(PROJECTS), 200, projectDto.array());
    expect(testerList).toEqual([expect.objectContaining({ slug: joined.slug, myRole: "tester" })]);
  });

  test("tanpa login → 401", async ({ api }) => {
    await expectApiError(await (await api.anonymous()).get(PROJECTS), 401, "UNAUTHENTICATED");
  });
});

test.describe("GET /projects/:slug", () => {
  test("anggota melihat role-nya; pengunjung anonim project publik melihat myRole null", async ({ api }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    await api.setVisibility(owner, project.slug, "public");

    const asAdmin = await parseBody(await owner.request.get(`${PROJECTS}/${project.slug}`), 200, projectDto);
    expect(asAdmin).toMatchObject({ slug: project.slug, visibility: "public", myRole: "admin" });

    const asAnon = await parseBody(await (await api.anonymous()).get(`${PROJECTS}/${project.slug}`), 200, projectDto);
    expect(asAnon).toMatchObject({ slug: project.slug, myRole: null });
  });

  test("dijadikan privat lagi → pengunjung anonim mendapat 404", async ({ api }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    await api.setVisibility(owner, project.slug, "public");
    await api.setVisibility(owner, project.slug, "private");
    await expectApiError(await (await api.anonymous()).get(`${PROJECTS}/${project.slug}`), 404, "PROJECT_NOT_FOUND");
  });
});

test.describe("PATCH /projects/:slug", () => {
  test("admin mengubah nama dan visibilitas", async ({ api }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const res = await owner.request.patch(`${PROJECTS}/${project.slug}`, { data: { name: "Nama Baru", visibility: "public" } });
    expect(await parseBody(res, 200, projectDto)).toMatchObject({ slug: project.slug, name: "Nama Baru", visibility: "public" });
  });

  test("nama 80 karakter → 200; 81 karakter → 400 fields.name", async ({ api }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const ok = await owner.request.patch(`${PROJECTS}/${project.slug}`, { data: { name: randomName(80) } });
    expect((await parseBody(ok, 200, projectDto)).name).toHaveLength(80);
    await expectFieldError(await owner.request.patch(`${PROJECTS}/${project.slug}`, { data: { name: randomName(81) } }), "name");
  });

  test("body kosong dan visibilitas tidak dikenal → 400 VALIDATION_ERROR", async ({ api }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    await expectApiError(await owner.request.patch(`${PROJECTS}/${project.slug}`, { data: {} }), 400, "VALIDATION_ERROR");
    await expectFieldError(await owner.request.patch(`${PROJECTS}/${project.slug}`, { data: { visibility: "rahasia" } }), "visibility");
  });
});

test.describe("DELETE /projects/:slug", () => {
  test("confirmSlug salah → 400 CONFIRMATION_MISMATCH dan project tetap ada", async ({ api }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const res = await owner.request.delete(`${PROJECTS}/${project.slug}`, { data: { confirmSlug: "salah" } });
    await expectApiError(res, 400, "CONFIRMATION_MISMATCH");
    expect((await owner.request.get(`${PROJECTS}/${project.slug}`)).status()).toBe(200);
  });

  test("tanpa confirmSlug → 400 VALIDATION_ERROR", async ({ api }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    await expectApiError(await owner.request.delete(`${PROJECTS}/${project.slug}`, { data: {} }), 400, "VALIDATION_ERROR");
  });

  test("204 menghapus project beserta anggota dan undangannya", async ({ api }) => {
    const owner = await api.register();
    const project = await api.createProject(owner);
    const member = await api.addMember(owner, project.slug, "viewer");
    const invitation = await api.createInvitation(owner, project.slug, "tester");
    const token = tokenFromUrl(invitation.url);

    const res = await owner.request.delete(`${PROJECTS}/${project.slug}`, { data: { confirmSlug: project.slug } });
    expect(res.status()).toBe(204);

    await expectApiError(await owner.request.get(`${PROJECTS}/${project.slug}`), 404, "PROJECT_NOT_FOUND");
    await expectApiError(await member.request.get(`${PROJECTS}/${project.slug}`), 404, "PROJECT_NOT_FOUND");
    await expectApiError(await (await api.anonymous()).get(`/api/v1/invitations/${token}`), 404, "INVITATION_NOT_FOUND");
    const remaining = await parseBody(await member.request.get(PROJECTS), 200, projectDto.array());
    expect(remaining).toEqual([]);
  });
});

test.describe("anggota project", () => {
  async function setup(api: TestApi) {
    const owner = await api.register();
    const project = await api.createProject(owner);
    return { owner, slug: project.slug, members: `${PROJECTS}/${project.slug}/members` };
  }

  test("GET members memuat daftar sesuai schema dengan role masing-masing", async ({ api }) => {
    const { owner, slug, members } = await setup(api);
    const viewer = await api.addMember(owner, slug, "viewer");

    const list = await parseBody(await owner.request.get(members), 200, memberDto.array());
    expect(list).toHaveLength(2);
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: owner.user.id, email: owner.user.email, role: "admin" }),
        expect.objectContaining({ userId: viewer.user.id, email: viewer.user.email, role: "viewer" }),
      ]),
    );
  });

  test("PATCH role: admin menaikkan anggota lalu menurunkannya; role tidak dikenal → 400", async ({ api }) => {
    const { owner, slug, members } = await setup(api);
    const member = await api.addMember(owner, slug, "viewer");
    const url = `${members}/${member.user.id}`;

    const up = await owner.request.patch(url, { data: { role: "tester" } });
    expect(await parseBody(up, 200, memberDto)).toMatchObject({ userId: member.user.id, role: "tester" });
    await expectFieldError(await owner.request.patch(url, { data: { role: "superuser" } }), "role");
  });

  test("PATCH role: user yang bukan anggota atau ID rusak → 404 MEMBER_NOT_FOUND", async ({ api }) => {
    const { owner, members } = await setup(api);
    const stranger = await api.register();
    await expectApiError(await owner.request.patch(`${members}/${stranger.user.id}`, { data: { role: "viewer" } }), 404, "MEMBER_NOT_FOUND");
    await expectApiError(await owner.request.patch(`${members}/bukan-uuid`, { data: { role: "viewer" } }), 404, "MEMBER_NOT_FOUND");
  });

  test("admin terakhir tidak bisa diturunkan (409 LAST_ADMIN); setelah ada admin lain bisa", async ({ api }) => {
    const { owner, slug, members } = await setup(api);
    const own = `${members}/${owner.user.id}`;
    await expectApiError(await owner.request.patch(own, { data: { role: "viewer" } }), 409, "LAST_ADMIN");

    const second = await api.addMember(owner, slug, "admin");
    const demoted = await owner.request.patch(own, { data: { role: "viewer" } });
    expect(await parseBody(demoted, 200, memberDto)).toMatchObject({ userId: owner.user.id, role: "viewer" });
    // Admin tersisa kini admin terakhir.
    await expectApiError(await second.request.patch(`${members}/${second.user.id}`, { data: { role: "tester" } }), 409, "LAST_ADMIN");
  });

  test("keluar sendiri: anggota 204 dan kehilangan akses; admin terakhir 409 LAST_ADMIN", async ({ api }) => {
    const { owner, slug, members } = await setup(api);
    const tester = await api.addMember(owner, slug, "tester");

    expect((await tester.request.delete(`${members}/${tester.user.id}`)).status()).toBe(204);
    await expectApiError(await tester.request.get(`${PROJECTS}/${slug}`), 404, "PROJECT_NOT_FOUND");

    await expectApiError(await owner.request.delete(`${members}/${owner.user.id}`), 409, "LAST_ADMIN");
  });

  test("admin mengeluarkan anggota lain: 204, lalu mengeluarkan lagi → 404 MEMBER_NOT_FOUND", async ({ api }) => {
    const { owner, slug, members } = await setup(api);
    const viewer = await api.addMember(owner, slug, "viewer");
    const url = `${members}/${viewer.user.id}`;

    expect((await owner.request.delete(url)).status()).toBe(204);
    await expectApiError(await owner.request.delete(url), 404, "MEMBER_NOT_FOUND");
    const list = await parseBody(await owner.request.get(members), 200, memberDto.array());
    expect(list.map((m) => m.userId)).toEqual([owner.user.id]);
  });
});
