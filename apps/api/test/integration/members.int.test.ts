import { memberDto, type Role } from "@testpulse/shared";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { memberships } from "../../src/db/schema.js";
import { addMember, createProject, createTestApp, registerUser, type RegisteredUser } from "./helpers.js";

const PROJECTS = "/api/v1/projects";
const UNKNOWN_USER_ID = "11111111-1111-4111-8111-111111111111";

describe("members", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  /** Project baru dengan pembuat sebagai admin; anggota lain ditambahkan sesuai `roles`. */
  async function setup(roles: Role[] = []) {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.cookie);
    const others: RegisteredUser[] = [];
    for (const role of roles) {
      const user = await registerUser(app);
      await addMember(app, project.id, user.user.id, role);
      others.push(user);
    }
    return { admin, project, others };
  }

  const membersUrl = (slug: string) => `${PROJECTS}/${slug}/members`;
  const memberUrl = (slug: string, userId: string) => `${PROJECTS}/${slug}/members/${userId}`;

  function patchRole(slug: string, userId: string, role: unknown, cookie?: string) {
    return app.inject({
      method: "PATCH",
      url: memberUrl(slug, userId),
      headers: cookie ? { cookie } : {},
      payload: { role },
    });
  }

  function deleteMember(slug: string, userId: string, cookie?: string) {
    return app.inject({ method: "DELETE", url: memberUrl(slug, userId), headers: cookie ? { cookie } : {} });
  }

  async function roleOf(projectId: string, userId: string): Promise<string | undefined> {
    const [row] = await app.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.projectId, projectId), eq(memberships.userId, userId)));
    return row?.role;
  }

  async function adminCount(projectId: string): Promise<number> {
    const rows = await app.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.projectId, projectId), eq(memberships.role, "admin")));
    return rows.length;
  }

  /**
   * Menjalankan `fire` (dua request atau lebih) sementara baris admin project dikunci oleh transaksi lain,
   * lalu melepas kunci setelah SEMUA request tertahan di kunci tersebut. Dengan begitu setiap request sudah
   * lolos pengecekan akses sebelum salah satunya commit, sehingga hanya `FOR UPDATE` yang menyerialkan mereka.
   * Tanpa kunci baris di `changeMemberRole`, request tidak akan tertahan dan keduanya sukses.
   */
  async function withAdminRowsLocked<T>(projectId: string, expectedWaiters: number, fire: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });

    const holder = app.db.transaction(async (tx) => {
      await tx.execute(
        sql`select user_id from memberships where project_id = ${projectId} and role = 'admin' for update`,
      );
      locked();
      await released;
    });
    await lockTaken;

    const pending = fire();
    // Tunggu sampai semua request benar-benar menunggu kunci; jika tidak (mis. kunci hilang), lepas setelah batas waktu.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await app.db.execute(
        sql`select count(*)::int as n from pg_stat_activity
            where wait_event_type = 'Lock' and query ilike '%from "memberships"%for update%'`,
      );
      if (Number((result.rows[0] as { n: number }).n) >= expectedWaiters) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    release();
    await holder;
    return pending;
  }

  describe("GET /projects/:slug/members", () => {
    it("200: viewer melihat daftar anggota yang lolos memberDto", async () => {
      const { admin, project, others } = await setup(["tester", "viewer"]);
      const [, viewer] = others;
      const res = await app.inject({
        method: "GET",
        url: membersUrl(project.slug),
        headers: { cookie: viewer!.cookie },
      });
      expect(res.statusCode).toBe(200);
      const list = z.array(memberDto).parse(res.json());
      expect(list).toHaveLength(3);
      expect(list.map((m) => m.userId).sort()).toEqual(
        [admin.user.id, ...others.map((o) => o.user.id)].sort(),
      );
      const adminRow = list.find((m) => m.userId === admin.user.id);
      expect(adminRow).toMatchObject({ role: "admin", name: admin.user.name, email: admin.user.email });
      expect(Number.isNaN(Date.parse(adminRow!.joinedAt))).toBe(false);
    });

    it("403: bukan anggota project publik", async () => {
      const { admin, project } = await setup();
      await app.inject({
        method: "PATCH",
        url: `${PROJECTS}/${project.slug}`,
        headers: { cookie: admin.cookie },
        payload: { visibility: "public" },
      });
      const outsider = await registerUser(app);
      const res = await app.inject({
        method: "GET",
        url: membersUrl(project.slug),
        headers: { cookie: outsider.cookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    });

    it("404: bukan anggota project privat", async () => {
      const { project } = await setup();
      const outsider = await registerUser(app);
      const res = await app.inject({
        method: "GET",
        url: membersUrl(project.slug),
        headers: { cookie: outsider.cookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("401: anonim", async () => {
      const { project } = await setup();
      const res = await app.inject({ method: "GET", url: membersUrl(project.slug) });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("PATCH /projects/:slug/members/:userId", () => {
    it("200: admin mengubah tester menjadi viewer", async () => {
      const { admin, project, others } = await setup(["tester"]);
      const tester = others[0]!;
      const res = await patchRole(project.slug, tester.user.id, "viewer", admin.cookie);
      expect(res.statusCode).toBe(200);
      expect(memberDto.parse(res.json())).toMatchObject({
        userId: tester.user.id,
        name: tester.user.name,
        email: tester.user.email,
        role: "viewer",
      });
      expect(await roleOf(project.id, tester.user.id)).toBe("viewer");
    });

    it("403: tester tidak boleh mengubah role", async () => {
      const { project, others } = await setup(["tester", "viewer"]);
      const [tester, viewer] = others;
      const res = await patchRole(project.slug, viewer!.user.id, "admin", tester!.cookie);
      expect(res.statusCode).toBe(403);
      expect(await roleOf(project.id, viewer!.user.id)).toBe("viewer");
    });

    it("401 untuk anonim dan 404 PROJECT_NOT_FOUND untuk bukan anggota project privat", async () => {
      const { admin, project } = await setup();
      const anon = await patchRole(project.slug, admin.user.id, "viewer");
      expect(anon.statusCode).toBe(401);
      const outsider = await registerUser(app);
      const res = await patchRole(project.slug, admin.user.id, "viewer", outsider.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("akses dicek sebelum body: bukan anggota tidak mendapat 400 meski body salah", async () => {
      const { admin, project } = await setup();
      const outsider = await registerUser(app);
      const res = await patchRole(project.slug, admin.user.id, "superuser", outsider.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("400 VALIDATION_ERROR untuk role tidak valid dari admin", async () => {
      const { admin, project, others } = await setup(["tester"]);
      const res = await patchRole(project.slug, others[0]!.user.id, "superuser", admin.cookie);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(res.json().error.fields.role).toBeTypeOf("string");
    });

    it("404 MEMBER_NOT_FOUND: userId bukan anggota, tidak dikenal, atau bukan uuid", async () => {
      const { admin, project } = await setup();
      const stranger = await registerUser(app);
      for (const userId of [stranger.user.id, UNKNOWN_USER_ID, "bukan-uuid"]) {
        const res = await patchRole(project.slug, userId, "viewer", admin.cookie);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("MEMBER_NOT_FOUND");
      }
    });

    it("409 LAST_ADMIN: admin satu-satunya tidak bisa menurunkan diri", async () => {
      const { admin, project } = await setup(["tester"]);
      const res = await patchRole(project.slug, admin.user.id, "viewer", admin.cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("LAST_ADMIN");
      expect(await roleOf(project.id, admin.user.id)).toBe("admin");
    });

    it("200: dengan dua admin, admin A boleh menurunkan diri; admin sisanya tidak bisa menyusul", async () => {
      const { admin: adminA, project, others } = await setup(["admin"]);
      const adminB = others[0]!;
      const first = await patchRole(project.slug, adminA.user.id, "viewer", adminA.cookie);
      expect(first.statusCode).toBe(200);
      expect(await roleOf(project.id, adminA.user.id)).toBe("viewer");
      expect(await adminCount(project.id)).toBe(1);

      const second = await patchRole(project.slug, adminB.user.id, "tester", adminB.cookie);
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe("LAST_ADMIN");
    });

    it("200: menjadikan admin tidak dianggap menurunkan admin (admin ke admin)", async () => {
      const { admin, project } = await setup();
      const res = await patchRole(project.slug, admin.user.id, "admin", admin.cookie);
      expect(res.statusCode).toBe(200);
      expect(await adminCount(project.id)).toBe(1);
    });

    it("paralel: dua admin saling menurunkan, tepat satu berhasil dan satu admin tersisa", async () => {
      const { admin: adminA, project, others } = await setup(["admin"]);
      const adminB = others[0]!;

      const [resA, resB] = await Promise.all([
        patchRole(project.slug, adminB.user.id, "viewer", adminA.cookie),
        patchRole(project.slug, adminA.user.id, "viewer", adminB.cookie),
      ]);

      // Yang kalah balapan ditolak oleh aturan admin terakhir (409) atau, jika baru dicek setelah
      // lawannya commit, karena sudah bukan admin (403).
      const statuses = [resA.statusCode, resB.statusCode];
      expect(statuses.filter((c) => c === 200)).toHaveLength(1);
      expect(statuses.filter((c) => c === 409 || c === 403)).toHaveLength(1);
      expect(await adminCount(project.id)).toBe(1);
    });

    it("paralel terkunci: kedua request lolos akses lalu diserialkan oleh FOR UPDATE, tepat satu 200 dan satu 409 LAST_ADMIN", async () => {
      const { admin: adminA, project, others } = await setup(["admin"]);
      const adminB = others[0]!;

      const [resA, resB] = await withAdminRowsLocked(project.id, 2, () =>
        Promise.all([
          patchRole(project.slug, adminB.user.id, "viewer", adminA.cookie),
          patchRole(project.slug, adminA.user.id, "viewer", adminB.cookie),
        ]),
      );

      expect([resA.statusCode, resB.statusCode].sort()).toEqual([200, 409]);
      const failed = resA.statusCode === 409 ? resA : resB;
      expect(failed.json().error.code).toBe("LAST_ADMIN");
      expect(await adminCount(project.id)).toBe(1);
    });
  });

  describe("DELETE /projects/:slug/members/:userId", () => {
    it("204: admin mengeluarkan tester", async () => {
      const { admin, project, others } = await setup(["tester"]);
      const tester = others[0]!;
      const res = await deleteMember(project.slug, tester.user.id, admin.cookie);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");
      expect(await roleOf(project.id, tester.user.id)).toBeUndefined();
    });

    it("403: tester tidak boleh mengeluarkan orang lain", async () => {
      const { project, others } = await setup(["tester", "viewer"]);
      const [tester, viewer] = others;
      const res = await deleteMember(project.slug, viewer!.user.id, tester!.cookie);
      expect(res.statusCode).toBe(403);
      expect(await roleOf(project.id, viewer!.user.id)).toBe("viewer");
    });

    it("401 untuk anonim dan 404 PROJECT_NOT_FOUND untuk bukan anggota project privat", async () => {
      const { project, others } = await setup(["viewer"]);
      const anon = await deleteMember(project.slug, others[0]!.user.id);
      expect(anon.statusCode).toBe(401);
      const outsider = await registerUser(app);
      const res = await deleteMember(project.slug, others[0]!.user.id, outsider.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("404 MEMBER_NOT_FOUND: admin mengeluarkan userId yang bukan anggota atau bukan uuid", async () => {
      const { admin, project } = await setup();
      const stranger = await registerUser(app);
      for (const userId of [stranger.user.id, UNKNOWN_USER_ID, "bukan-uuid"]) {
        const res = await deleteMember(project.slug, userId, admin.cookie);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("MEMBER_NOT_FOUND");
      }
    });

    it("204: viewer keluar sendiri", async () => {
      const { project, others } = await setup(["viewer"]);
      const viewer = others[0]!;
      const res = await deleteMember(project.slug, viewer.user.id, viewer.cookie);
      expect(res.statusCode).toBe(204);
      expect(await roleOf(project.id, viewer.user.id)).toBeUndefined();
    });

    it("204: tester keluar sendiri", async () => {
      const { project, others } = await setup(["tester"]);
      const tester = others[0]!;
      const res = await deleteMember(project.slug, tester.user.id, tester.cookie);
      expect(res.statusCode).toBe(204);
    });

    it("409 LAST_ADMIN: admin terakhir tidak bisa keluar sendiri", async () => {
      const { admin, project } = await setup(["viewer"]);
      const res = await deleteMember(project.slug, admin.user.id, admin.cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("LAST_ADMIN");
      expect(await roleOf(project.id, admin.user.id)).toBe("admin");
    });

    it("204: admin boleh keluar sendiri jika masih ada admin lain", async () => {
      const { admin, project, others } = await setup(["admin"]);
      const res = await deleteMember(project.slug, admin.user.id, admin.cookie);
      expect(res.statusCode).toBe(204);
      expect(await adminCount(project.id)).toBe(1);
      expect(await roleOf(project.id, others[0]!.user.id)).toBe("admin");
    });

    it("409 LAST_ADMIN: setelah admin lain keluar, admin yang tersisa terlindungi", async () => {
      const { admin, project, others } = await setup(["admin"]);
      const adminB = others[0]!;
      // Admin B keluar (boleh karena ada A), lalu A tidak bisa keluar.
      expect((await deleteMember(project.slug, adminB.user.id, adminB.cookie)).statusCode).toBe(204);
      const res = await deleteMember(project.slug, admin.user.id, admin.cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("LAST_ADMIN");
    });

    it("404 MEMBER_NOT_FOUND: bukan anggota project publik mencoba keluar", async () => {
      const { admin, project } = await setup();
      await app.inject({
        method: "PATCH",
        url: `${PROJECTS}/${project.slug}`,
        headers: { cookie: admin.cookie },
        payload: { visibility: "public" },
      });
      const outsider = await registerUser(app);
      const res = await deleteMember(project.slug, outsider.user.id, outsider.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("MEMBER_NOT_FOUND");
    });

    it("404 PROJECT_NOT_FOUND: bukan anggota project privat mencoba keluar", async () => {
      const { project } = await setup();
      const outsider = await registerUser(app);
      const res = await deleteMember(project.slug, outsider.user.id, outsider.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("paralel terkunci: dua admin saling mengeluarkan, tepat satu 204 dan satu 409 LAST_ADMIN", async () => {
      const { admin: adminA, project, others } = await setup(["admin"]);
      const adminB = others[0]!;

      const [resA, resB] = await withAdminRowsLocked(project.id, 2, () =>
        Promise.all([
          deleteMember(project.slug, adminB.user.id, adminA.cookie),
          deleteMember(project.slug, adminA.user.id, adminB.cookie),
        ]),
      );

      expect([resA.statusCode, resB.statusCode].sort()).toEqual([204, 409]);
      const failed = resA.statusCode === 409 ? resA : resB;
      expect(failed.json().error.code).toBe("LAST_ADMIN");
      expect(await adminCount(project.id)).toBe(1);
    });
  });
});
