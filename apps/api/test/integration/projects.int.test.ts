import { faker } from "@faker-js/faker";
import { projectDto } from "@testpulse/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { invitations, memberships, projects } from "../../src/db/schema.js";
import { addMember, createProject, createTestApp, registerUser } from "./helpers.js";

const PROJECTS = "/api/v1/projects";

function uniqueName(prefix = "Proyek"): string {
  return `${prefix} ${faker.string.alphanumeric(10)}`;
}

describe("projects", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  async function getProject(slug: string, cookie?: string) {
    return app.inject({ method: "GET", url: `${PROJECTS}/${slug}`, headers: cookie ? { cookie } : {} });
  }

  describe("POST /projects", () => {
    it("201: slug otomatis dari nama, privat, pembuat menjadi admin", async () => {
      const owner = await registerUser(app);
      const suffix = faker.string.alphanumeric(8).toLowerCase();
      const res = await app.inject({
        method: "POST",
        url: PROJECTS,
        headers: { cookie: owner.cookie },
        payload: { name: `  Proyek QA ${suffix}  ` },
      });
      expect(res.statusCode).toBe(201);
      const dto = projectDto.parse(res.json());
      expect(dto).toMatchObject({
        name: `Proyek QA ${suffix}`,
        slug: `proyek-qa-${suffix}`,
        visibility: "private",
        myRole: "admin",
      });
      expect(Number.isNaN(Date.parse(dto.createdAt))).toBe(false);

      const [member] = await app.db.select().from(memberships).where(eq(memberships.projectId, dto.id));
      expect(member).toMatchObject({ userId: owner.user.id, role: "admin" });
    });

    it("slug eksplisit dipakai apa adanya", async () => {
      const owner = await registerUser(app);
      const slug = `kustom-${faker.string.alphanumeric(8).toLowerCase()}`;
      const dto = await createProject(app, owner.cookie, { name: "Nama Lain", slug });
      expect(dto.slug).toBe(slug);
    });

    it("409 SLUG_TAKEN jika slug sudah dipakai", async () => {
      const owner = await registerUser(app);
      const first = await createProject(app, owner.cookie);
      const res = await app.inject({
        method: "POST",
        url: PROJECTS,
        headers: { cookie: owner.cookie },
        payload: { name: "Lain", slug: first.slug },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("SLUG_TAKEN");
    });

    it("409 SLUG_TAKEN jika slug otomatis bertabrakan", async () => {
      const owner = await registerUser(app);
      const name = uniqueName();
      await createProject(app, owner.cookie, { name });
      const res = await app.inject({ method: "POST", url: PROJECTS, headers: { cookie: owner.cookie }, payload: { name } });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("SLUG_TAKEN");
    });

    it("pembuatan serentak dengan slug sama: tepat satu 201, sisanya 409 (tanpa 500)", async () => {
      const owner = await registerUser(app);
      const slug = `serentak-${faker.string.alphanumeric(8).toLowerCase()}`;
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          app.inject({ method: "POST", url: PROJECTS, headers: { cookie: owner.cookie }, payload: { name: "Serentak", slug } }),
        ),
      );
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([201, 409, 409, 409, 409]);
      const rows = await app.db.select().from(projects).where(eq(projects.slug, slug));
      expect(rows).toHaveLength(1);
    });

    it("400 fields.slug untuk slug cadangan", async () => {
      const owner = await registerUser(app);
      const res = await app.inject({
        method: "POST",
        url: PROJECTS,
        headers: { cookie: owner.cookie },
        payload: { name: "Apa Saja", slug: "api" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(res.json().error.fields.slug).toBeTypeOf("string");
    });

    it.each([["测试"], ["!!"], ["ab"], ["api"]])(
      "400 VALIDATION_ERROR fields.slug (isi slug secara manual) untuk nama %j tanpa slug",
      async (name) => {
        const owner = await registerUser(app);
        const res = await app.inject({ method: "POST", url: PROJECTS, headers: { cookie: owner.cookie }, payload: { name } });
        expect(res.statusCode).toBe(400);
        const { error } = res.json();
        expect(error.code).toBe("VALIDATION_ERROR");
        expect(error.fields.slug).toContain("isi slug secara manual");
      },
    );

    it("nama tanpa slug tetap bisa dengan slug manual", async () => {
      const owner = await registerUser(app);
      const slug = `manual-${faker.string.alphanumeric(8).toLowerCase()}`;
      const dto = await createProject(app, owner.cookie, { name: "测试", slug });
      expect(dto).toMatchObject({ name: "测试", slug });
    });

    it("400 untuk nama kosong, 401 untuk anonim", async () => {
      const owner = await registerUser(app);
      const bad = await app.inject({ method: "POST", url: PROJECTS, headers: { cookie: owner.cookie }, payload: { name: "   " } });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.fields.name).toBeTypeOf("string");

      const anon = await app.inject({ method: "POST", url: PROJECTS, payload: { name: "Anon" } });
      expect(anon.statusCode).toBe(401);
      expect(anon.json().error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("GET /projects", () => {
    it("hanya berisi project tempat user menjadi anggota", async () => {
      const alice = await registerUser(app);
      const bob = await registerUser(app);
      const mine = await createProject(app, alice.cookie);
      const bobPublic = await createProject(app, bob.cookie);
      await app.inject({
        method: "PATCH",
        url: `${PROJECTS}/${bobPublic.slug}`,
        headers: { cookie: bob.cookie },
        payload: { visibility: "public" },
      });
      const joined = await createProject(app, bob.cookie);
      await addMember(app, joined.id, alice.user.id, "viewer");

      const res = await app.inject({ method: "GET", url: PROJECTS, headers: { cookie: alice.cookie } });
      expect(res.statusCode).toBe(200);
      const list = projectDto.array().parse(res.json());
      expect(list.map((p) => p.slug).sort()).toEqual([mine.slug, joined.slug].sort());
      expect(list.find((p) => p.slug === joined.slug)?.myRole).toBe("viewer");
      expect(list.find((p) => p.slug === mine.slug)?.myRole).toBe("admin");
    });

    it("401 untuk anonim", async () => {
      const res = await app.inject({ method: "GET", url: PROJECTS });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /projects/:slug", () => {
    it("anggota: 200 dengan myRole", async () => {
      const owner = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      const res = await getProject(project.slug, owner.cookie);
      expect(res.statusCode).toBe(200);
      expect(projectDto.parse(res.json())).toMatchObject({ id: project.id, myRole: "admin" });
    });

    it("bukan anggota, project privat: 404 PROJECT_NOT_FOUND", async () => {
      const owner = await registerUser(app);
      const outsider = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      const res = await getProject(project.slug, outsider.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("slug tidak ada: respons identik dengan project privat", async () => {
      const owner = await registerUser(app);
      const outsider = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      const priv = await getProject(project.slug, outsider.cookie);
      const missing = await getProject(`tidak-ada-${faker.string.alphanumeric(8).toLowerCase()}`, outsider.cookie);
      expect(missing.statusCode).toBe(priv.statusCode);
      expect(missing.json()).toEqual(priv.json());

      const privAnon = await getProject(project.slug);
      const missingAnon = await getProject("tidak-ada-sama-sekali");
      expect(privAnon.statusCode).toBe(404);
      expect(missingAnon.statusCode).toBe(404);
      expect(missingAnon.json()).toEqual(privAnon.json());
    });

    it("anonim: privat 404, publik 200 dengan myRole null", async () => {
      const owner = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      expect((await getProject(project.slug)).statusCode).toBe(404);

      await app.inject({
        method: "PATCH",
        url: `${PROJECTS}/${project.slug}`,
        headers: { cookie: owner.cookie },
        payload: { visibility: "public" },
      });
      const res = await getProject(project.slug);
      expect(res.statusCode).toBe(200);
      expect(projectDto.parse(res.json())).toMatchObject({ slug: project.slug, visibility: "public", myRole: null });
    });

    it("bukan anggota, project publik: 200 dengan myRole null", async () => {
      const owner = await registerUser(app);
      const outsider = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      await app.inject({
        method: "PATCH",
        url: `${PROJECTS}/${project.slug}`,
        headers: { cookie: owner.cookie },
        payload: { visibility: "public" },
      });
      const res = await getProject(project.slug, outsider.cookie);
      expect(res.statusCode).toBe(200);
      expect(projectDto.parse(res.json()).myRole).toBeNull();
    });
  });

  describe("PATCH /projects/:slug", () => {
    it("admin mengubah visibilitas dan nama: 200", async () => {
      const owner = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      const res = await app.inject({
        method: "PATCH",
        url: `${PROJECTS}/${project.slug}`,
        headers: { cookie: owner.cookie },
        payload: { visibility: "public", name: "  Nama Baru  " },
      });
      expect(res.statusCode).toBe(200);
      expect(projectDto.parse(res.json())).toMatchObject({
        slug: project.slug,
        name: "Nama Baru",
        visibility: "public",
        myRole: "admin",
      });
      const after = await getProject(project.slug, owner.cookie);
      expect(after.json()).toMatchObject({ name: "Nama Baru", visibility: "public" });
    });

    it("tester dan viewer: 403 FORBIDDEN", async () => {
      const owner = await registerUser(app);
      const tester = await registerUser(app);
      const viewer = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      await addMember(app, project.id, tester.user.id, "tester");
      await addMember(app, project.id, viewer.user.id, "viewer");
      for (const who of [tester, viewer]) {
        const res = await app.inject({
          method: "PATCH",
          url: `${PROJECTS}/${project.slug}`,
          headers: { cookie: who.cookie },
          payload: { visibility: "public" },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe("FORBIDDEN");
      }
      const after = await getProject(project.slug, owner.cookie);
      expect(after.json().visibility).toBe("private");
    });

    it("bukan anggota privat: 404; bukan anggota publik: 403", async () => {
      const owner = await registerUser(app);
      const outsider = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      const priv = await app.inject({
        method: "PATCH",
        url: `${PROJECTS}/${project.slug}`,
        headers: { cookie: outsider.cookie },
        payload: { name: "X" },
      });
      expect(priv.statusCode).toBe(404);
      expect(priv.json().error.code).toBe("PROJECT_NOT_FOUND");

      await app.db.update(projects).set({ visibility: "public" }).where(eq(projects.id, project.id));
      const pub = await app.inject({
        method: "PATCH",
        url: `${PROJECTS}/${project.slug}`,
        headers: { cookie: outsider.cookie },
        payload: { name: "X" },
      });
      expect(pub.statusCode).toBe(403);
    });

    it("anonim: 401 (juga untuk slug yang tidak ada)", async () => {
      const owner = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      const real = await app.inject({ method: "PATCH", url: `${PROJECTS}/${project.slug}`, payload: { visibility: "public" } });
      const missing = await app.inject({ method: "PATCH", url: `${PROJECTS}/tidak-ada-slug`, payload: { visibility: "public" } });
      expect(real.statusCode).toBe(401);
      expect(missing.statusCode).toBe(401);
      expect(missing.json()).toEqual(real.json());
    });

    it("body kosong atau tidak valid: 400 VALIDATION_ERROR", async () => {
      const owner = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      for (const payload of [{}, { visibility: "rahasia" }, { name: "" }]) {
        const res = await app.inject({
          method: "PATCH",
          url: `${PROJECTS}/${project.slug}`,
          headers: { cookie: owner.cookie },
          payload,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("slug tidak bisa diubah lewat PATCH", async () => {
      const owner = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      const res = await app.inject({
        method: "PATCH",
        url: `${PROJECTS}/${project.slug}`,
        headers: { cookie: owner.cookie },
        payload: { name: "Baru", slug: "slug-baru-diam-diam" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().slug).toBe(project.slug);
    });
  });

  describe("DELETE /projects/:slug", () => {
    it("confirmSlug salah: 400 CONFIRMATION_MISMATCH; benar: 204 dan data terkait ikut terhapus", async () => {
      const owner = await registerUser(app);
      const tester = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      await addMember(app, project.id, tester.user.id, "tester");
      await app.db.insert(invitations).values({
        projectId: project.id,
        tokenHash: faker.string.hexadecimal({ length: 64, prefix: "" }),
        role: "viewer",
        createdBy: owner.user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      const wrong = await app.inject({
        method: "DELETE",
        url: `${PROJECTS}/${project.slug}`,
        headers: { cookie: owner.cookie },
        payload: { confirmSlug: "salah" },
      });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error.code).toBe("CONFIRMATION_MISMATCH");
      expect((await getProject(project.slug, owner.cookie)).statusCode).toBe(200);

      const ok = await app.inject({
        method: "DELETE",
        url: `${PROJECTS}/${project.slug}`,
        headers: { cookie: owner.cookie },
        payload: { confirmSlug: project.slug },
      });
      expect(ok.statusCode).toBe(204);
      expect(ok.body).toBe("");

      const after = await getProject(project.slug, owner.cookie);
      expect(after.statusCode).toBe(404);
      expect(await app.db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(0);
      expect(await app.db.select().from(memberships).where(eq(memberships.projectId, project.id))).toHaveLength(0);
      expect(await app.db.select().from(invitations).where(eq(invitations.projectId, project.id))).toHaveLength(0);
    });

    it("body tidak valid: 400 VALIDATION_ERROR", async () => {
      const owner = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      const res = await app.inject({
        method: "DELETE",
        url: `${PROJECTS}/${project.slug}`,
        headers: { cookie: owner.cookie },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("non-admin 403, bukan anggota privat 404, anonim 401", async () => {
      const owner = await registerUser(app);
      const viewer = await registerUser(app);
      const outsider = await registerUser(app);
      const project = await createProject(app, owner.cookie);
      await addMember(app, project.id, viewer.user.id, "viewer");
      const del = (cookie?: string) =>
        app.inject({
          method: "DELETE",
          url: `${PROJECTS}/${project.slug}`,
          headers: cookie ? { cookie } : {},
          payload: { confirmSlug: project.slug },
        });
      expect((await del(viewer.cookie)).statusCode).toBe(403);
      expect((await del(outsider.cookie)).statusCode).toBe(404);
      expect((await del()).statusCode).toBe(401);
      expect((await getProject(project.slug, owner.cookie)).statusCode).toBe(200);
    });
  });
});
