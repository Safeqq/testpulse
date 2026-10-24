import {
  acceptInvitationDto,
  createdInvitationDto,
  invitationDto,
  invitationPreviewDto,
  type InvitableRole,
} from "@testpulse/shared";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { invitations, memberships } from "../../src/db/schema.js";
import { hashToken } from "../../src/modules/auth/domain/tokens.js";
import { addMember, createProject, createTestApp, registerUser, type RegisteredUser } from "./helpers.js";

const APP_ORIGIN = "http://localhost:5173";
const INVITE_PREFIX = `${APP_ORIGIN}/invite/`;
const UNKNOWN_ID = "11111111-1111-4111-8111-111111111111";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("invitations", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp({ appOrigin: APP_ORIGIN });
  });

  async function setup() {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.cookie);
    return { admin, project };
  }

  async function invite(slug: string, cookie: string | undefined, role: unknown) {
    return app.inject({
      method: "POST",
      url: `/api/v1/projects/${slug}/invitations`,
      headers: cookie ? { cookie } : {},
      payload: { role },
    });
  }

  /** Membuat undangan lewat API dan mengembalikan token mentah dari URL-nya. */
  async function createInvitation(slug: string, cookie: string, role: InvitableRole = "tester") {
    const res = await invite(slug, cookie, role);
    expect(res.statusCode).toBe(201);
    const created = createdInvitationDto.parse(res.json());
    return { ...created, token: created.url.slice(INVITE_PREFIX.length) };
  }

  const listInvitations = (slug: string, cookie?: string) =>
    app.inject({ method: "GET", url: `/api/v1/projects/${slug}/invitations`, headers: cookie ? { cookie } : {} });
  const revoke = (slug: string, id: string, cookie?: string) =>
    app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${slug}/invitations/${id}`,
      headers: cookie ? { cookie } : {},
    });
  const preview = (token: string) => app.inject({ method: "GET", url: `/api/v1/invitations/${token}` });
  const accept = (token: string, cookie?: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/accept`,
      headers: cookie ? { cookie } : {},
    });

  async function expireInvitation(id: string) {
    await app.db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(invitations.id, id));
  }

  async function roleOf(projectId: string, userId: string) {
    const [row] = await app.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.projectId, projectId), eq(memberships.userId, userId)));
    return row?.role;
  }

  describe("POST /projects/:slug/invitations", () => {
    it("201: admin membuat undangan; lolos createdInvitationDto, berlaku 7 hari, token tidak tersimpan mentah", async () => {
      const { admin, project } = await setup();
      const before = Date.now();
      const res = await invite(project.slug, admin.cookie, "tester");

      expect(res.statusCode).toBe(201);
      const created = createdInvitationDto.parse(res.json());
      expect(created.role).toBe("tester");
      expect(created.url.startsWith(INVITE_PREFIX)).toBe(true);
      const token = created.url.slice(INVITE_PREFIX.length);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const expiresAt = new Date(created.expiresAt).getTime();
      expect(Math.abs(expiresAt - (before + 7 * DAY_MS))).toBeLessThan(60_000);

      const [row] = await app.db.select().from(invitations).where(eq(invitations.id, created.id));
      expect(row?.tokenHash).toBe(hashToken(token));
      expect(row?.tokenHash).not.toBe(token);
      const raw = await app.db.execute(sql`select count(*)::int as n from invitations where token_hash = ${token}`);
      expect(Number((raw.rows[0] as { n: number }).n)).toBe(0);
      expect(row?.createdBy).toBe(admin.user.id);
    });

    it("201: role viewer diterima", async () => {
      const { admin, project } = await setup();
      const created = await createInvitation(project.slug, admin.cookie, "viewer");
      expect(created.role).toBe("viewer");
    });

    it("400 VALIDATION_ERROR untuk role admin, role tak dikenal, dan body kosong", async () => {
      const { admin, project } = await setup();
      for (const role of ["admin", "owner", undefined]) {
        const res = await invite(project.slug, admin.cookie, role);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");
        expect(res.json().error.fields.role).toBeTypeOf("string");
      }
    });

    it("403 untuk viewer dan tester", async () => {
      const { project } = await setup();
      for (const role of ["viewer", "tester"] as const) {
        const member = await registerUser(app);
        await addMember(app, project.id, member.user.id, role);
        const res = await invite(project.slug, member.cookie, "tester");
        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe("FORBIDDEN");
      }
    });

    it("401 anonim, 404 PROJECT_NOT_FOUND untuk bukan anggota; akses dicek sebelum body divalidasi", async () => {
      const { project } = await setup();
      expect((await invite(project.slug, undefined, "tester")).statusCode).toBe(401);

      const outsider = await registerUser(app);
      const res = await invite(project.slug, outsider.cookie, "admin");
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
    });
  });

  describe("GET /projects/:slug/invitations", () => {
    it("hanya menampilkan undangan aktif; dicabut, terpakai, dan kedaluwarsa tidak ikut", async () => {
      const { admin, project } = await setup();
      const active = await createInvitation(project.slug, admin.cookie, "viewer");
      const revoked = await createInvitation(project.slug, admin.cookie);
      const used = await createInvitation(project.slug, admin.cookie);
      const expired = await createInvitation(project.slug, admin.cookie);

      expect((await revoke(project.slug, revoked.id, admin.cookie)).statusCode).toBe(204);
      const taker = await registerUser(app);
      expect((await accept(used.token, taker.cookie)).statusCode).toBe(200);
      await expireInvitation(expired.id);

      const res = await listInvitations(project.slug, admin.cookie);
      expect(res.statusCode).toBe(200);
      const list = z.array(invitationDto).parse(res.json());
      expect(list.map((i) => i.id)).toEqual([active.id]);
      expect(list[0]).toMatchObject({
        role: "viewer",
        createdBy: { id: admin.user.id, name: admin.user.name },
      });
      expect(JSON.stringify(res.json())).not.toContain(active.token);
    });

    it("403 untuk non-admin, 401 anonim, 404 bukan anggota", async () => {
      const { project } = await setup();
      const viewer = await registerUser(app);
      await addMember(app, project.id, viewer.user.id, "viewer");
      expect((await listInvitations(project.slug, viewer.cookie)).statusCode).toBe(403);
      expect((await listInvitations(project.slug)).statusCode).toBe(401);
      const outsider = await registerUser(app);
      expect((await listInvitations(project.slug, outsider.cookie)).statusCode).toBe(404);
    });
  });

  describe("DELETE /projects/:slug/invitations/:id", () => {
    it("204: admin mencabut undangan aktif; setelah itu pratinjau & accept 404", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie);

      const res = await revoke(project.slug, inv.id, admin.cookie);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");

      const prev = await preview(inv.token);
      expect(prev.statusCode).toBe(404);
      expect(prev.json().error.code).toBe("INVITATION_NOT_FOUND");

      const taker = await registerUser(app);
      const acc = await accept(inv.token, taker.cookie);
      expect(acc.statusCode).toBe(404);
      expect(acc.json().error.code).toBe("INVITATION_NOT_FOUND");
      expect(await roleOf(project.id, taker.user.id)).toBeUndefined();
    });

    it("404 INVITATION_NOT_FOUND untuk id tak dikenal dan id yang bukan UUID", async () => {
      const { admin, project } = await setup();
      for (const id of [UNKNOWN_ID, "bukan-uuid"]) {
        const res = await revoke(project.slug, id, admin.cookie);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("INVITATION_NOT_FOUND");
      }
    });

    it("404 INVITATION_NOT_FOUND untuk undangan milik project lain", async () => {
      const a = await setup();
      const b = await setup();
      const inv = await createInvitation(b.project.slug, b.admin.cookie);
      const res = await revoke(a.project.slug, inv.id, a.admin.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("INVITATION_NOT_FOUND");
      expect((await preview(inv.token)).statusCode).toBe(200);
    });

    it("404 untuk undangan yang sudah dicabut, terpakai, atau kedaluwarsa (hanya yang aktif bisa dicabut)", async () => {
      const { admin, project } = await setup();
      const revoked = await createInvitation(project.slug, admin.cookie);
      const used = await createInvitation(project.slug, admin.cookie);
      const expired = await createInvitation(project.slug, admin.cookie);
      expect((await revoke(project.slug, revoked.id, admin.cookie)).statusCode).toBe(204);
      expect((await accept(used.token, (await registerUser(app)).cookie)).statusCode).toBe(200);
      await expireInvitation(expired.id);

      for (const inv of [revoked, used, expired]) {
        const res = await revoke(project.slug, inv.id, admin.cookie);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("INVITATION_NOT_FOUND");
      }
      // Undangan terpakai tetap terpakai (tidak berubah jadi dicabut).
      const prev = await preview(used.token);
      expect(prev.statusCode).toBe(410);
      expect(prev.json().error.code).toBe("INVITATION_USED");
    });

    it("403 untuk non-admin, 401 anonim, 404 PROJECT_NOT_FOUND bukan anggota", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie);
      const tester = await registerUser(app);
      await addMember(app, project.id, tester.user.id, "tester");
      expect((await revoke(project.slug, inv.id, tester.cookie)).statusCode).toBe(403);
      expect((await revoke(project.slug, inv.id)).statusCode).toBe(401);
      const outsider = await registerUser(app);
      const res = await revoke(project.slug, inv.id, outsider.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("PROJECT_NOT_FOUND");
      expect((await preview(inv.token)).statusCode).toBe(200);
    });
  });

  describe("GET /invitations/:token (pratinjau publik)", () => {
    it("200 tanpa login: {projectName, projectSlug, role, expiresAt}", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie, "viewer");

      const res = await preview(inv.token);
      expect(res.statusCode).toBe(200);
      expect(invitationPreviewDto.parse(res.json())).toEqual({
        projectName: project.name,
        projectSlug: project.slug,
        role: "viewer",
        expiresAt: inv.expiresAt,
      });
    });

    it("pratinjau tidak memakai undangan", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie);
      await preview(inv.token);
      await preview(inv.token);
      expect((await accept(inv.token, (await registerUser(app)).cookie)).statusCode).toBe(200);
    });

    it("404 INVITATION_NOT_FOUND untuk token acak yang tidak dikenal", async () => {
      const res = await preview("tokentakdikenal-0123456789abcdefghijklmnopqrstuv");
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("INVITATION_NOT_FOUND");
    });

    it("410 INVITATION_USED setelah dipakai", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie);
      await accept(inv.token, (await registerUser(app)).cookie);
      const res = await preview(inv.token);
      expect(res.statusCode).toBe(410);
      expect(res.json().error.code).toBe("INVITATION_USED");
    });

    it("410 INVITATION_EXPIRED jika expires_at sudah lampau", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie);
      await expireInvitation(inv.id);
      const res = await preview(inv.token);
      expect(res.statusCode).toBe(410);
      expect(res.json().error.code).toBe("INVITATION_EXPIRED");
    });

    it("404 INVITATION_NOT_FOUND setelah project dihapus", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie);
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/projects/${project.slug}`,
        headers: { cookie: admin.cookie },
        payload: { confirmSlug: project.slug },
      });
      expect(del.statusCode).toBe(204);

      const prev = await preview(inv.token);
      expect(prev.statusCode).toBe(404);
      expect(prev.json().error.code).toBe("INVITATION_NOT_FOUND");
      const acc = await accept(inv.token, (await registerUser(app)).cookie);
      expect(acc.statusCode).toBe(404);
      expect(acc.json().error.code).toBe("INVITATION_NOT_FOUND");
    });
  });

  describe("POST /invitations/:token/accept", () => {
    it("200: user lain menerima; jadi anggota dengan role undangan, myRole berubah, undangan terpakai", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie, "tester");
      const taker = await registerUser(app);

      const res = await accept(inv.token, taker.cookie);
      expect(res.statusCode).toBe(200);
      expect(acceptInvitationDto.parse(res.json())).toEqual({ projectSlug: project.slug, role: "tester" });

      const get = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${project.slug}`,
        headers: { cookie: taker.cookie },
      });
      expect(get.statusCode).toBe(200);
      expect(get.json().myRole).toBe("tester");

      const [row] = await app.db.select().from(invitations).where(eq(invitations.id, inv.id));
      expect(row?.acceptedBy).toBe(taker.user.id);
      expect(row?.acceptedAt).toBeInstanceOf(Date);
    });

    it("410 INVITATION_USED: accept kedua oleh user lain; user kedua tidak menjadi anggota", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie);
      const first = await registerUser(app);
      const second = await registerUser(app);

      expect((await accept(inv.token, first.cookie)).statusCode).toBe(200);
      const res = await accept(inv.token, second.cookie);
      expect(res.statusCode).toBe(410);
      expect(res.json().error.code).toBe("INVITATION_USED");
      expect(await roleOf(project.id, second.user.id)).toBeUndefined();
    });

    it("410 INVITATION_EXPIRED: undangan kedaluwarsa; tidak menjadi anggota", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie);
      await expireInvitation(inv.id);
      const taker = await registerUser(app);

      const res = await accept(inv.token, taker.cookie);
      expect(res.statusCode).toBe(410);
      expect(res.json().error.code).toBe("INVITATION_EXPIRED");
      expect(await roleOf(project.id, taker.user.id)).toBeUndefined();
    });

    it("409 ALREADY_MEMBER: anggota (apa pun rolenya) menerima; undangan tetap aktif dan bisa dipakai user lain", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie, "viewer");

      const res = await accept(inv.token, admin.cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("ALREADY_MEMBER");
      expect(await roleOf(project.id, admin.user.id)).toBe("admin");

      const [row] = await app.db.select().from(invitations).where(eq(invitations.id, inv.id));
      expect(row?.acceptedAt).toBeNull();
      expect(row?.acceptedBy).toBeNull();
      const list = z.array(invitationDto).parse((await listInvitations(project.slug, admin.cookie)).json());
      expect(list.map((i) => i.id)).toContain(inv.id);

      const other = await registerUser(app);
      const ok = await accept(inv.token, other.cookie);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().role).toBe("viewer");
    });

    it("401 tanpa login, dan undangan tidak terpakai", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie);
      const res = await accept(inv.token);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHENTICATED");
      expect((await preview(inv.token)).statusCode).toBe(200);
    });

    it("404 INVITATION_NOT_FOUND untuk token acak yang tidak dikenal", async () => {
      const taker = await registerUser(app);
      const res = await accept("tokentakdikenal-0123456789abcdefghijklmnopqrstuv", taker.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("INVITATION_NOT_FOUND");
    });
  });

  describe("accept serentak", () => {
    /**
     * Menahan kunci baris undangan di transaksi lain, menembakkan request, menunggu semuanya benar-benar
     * menunggu kunci `FOR UPDATE` pada tabel invitations, lalu melepas kunci. Tanpa ini, dua request
     * paralel bisa selesai berurutan dan tidak membuktikan apa pun tentang kunci baris.
     */
    async function withInvitationLocked<T>(invitationId: string, expectedWaiters: number, fire: () => Promise<T>): Promise<T> {
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => {
        locked = resolve;
      });

      const holder = app.db.transaction(async (tx) => {
        await tx.execute(sql`select id from invitations where id = ${invitationId} for update`);
        locked();
        await released;
      });
      await lockTaken;

      const pending = fire();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const result = await app.db.execute(
          sql`select count(*)::int as n from pg_stat_activity
              where wait_event_type = 'Lock' and query ilike '%from "invitations"%for update%'`,
        );
        if (Number((result.rows[0] as { n: number }).n) >= expectedWaiters) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      release();
      await holder;
      return pending;
    }

    it("dua user berbeda menerima bersamaan: tepat satu 200, satu 410 INVITATION_USED", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie, "tester");
      const takers: RegisteredUser[] = [await registerUser(app), await registerUser(app)];

      const results = await withInvitationLocked(inv.id, 2, () =>
        Promise.all(takers.map((t) => accept(inv.token, t.cookie))),
      );

      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 410]);
      const failed = results.find((r) => r.statusCode === 410)!;
      expect(failed.json().error.code).toBe("INVITATION_USED");

      const roles = await Promise.all(takers.map((t) => roleOf(project.id, t.user.id)));
      expect(roles.filter((r) => r === "tester")).toHaveLength(1);
      expect(roles.filter((r) => r === undefined)).toHaveLength(1);
      const [row] = await app.db.select().from(invitations).where(eq(invitations.id, inv.id));
      expect(takers.map((t) => t.user.id)).toContain(row?.acceptedBy);
    });

    it("cabut dan accept bersamaan: hasilnya konsisten (accept sukses -> cabut 404, atau sebaliknya)", async () => {
      const { admin, project } = await setup();
      const inv = await createInvitation(project.slug, admin.cookie);
      const taker = await registerUser(app);

      const [acc, rev] = await withInvitationLocked(inv.id, 2, () =>
        Promise.all([accept(inv.token, taker.cookie), revoke(project.slug, inv.id, admin.cookie)]),
      );

      const accepted = acc.statusCode === 200;
      expect(rev.statusCode).toBe(accepted ? 404 : 204);
      if (!accepted) expect(acc.statusCode).toBe(404);
      expect(await roleOf(project.id, taker.user.id)).toBe(accepted ? "tester" : undefined);
    });
  });
});
