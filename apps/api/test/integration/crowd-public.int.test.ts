import {
  crowdMeDto,
  cycleDirectoryPageDto,
  knownIssuesPageDto,
  leaderboardDto,
  publicCycleDto,
  testerProfileDto,
} from "@testpulse/shared";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registerUser, type RegisteredUser } from "./helpers.js";
import {
  createCycle,
  expectError,
  expectNoEmail,
  insertParticipant,
  insertReport,
  setupCrowdProject,
  teamRequest,
  type CrowdFixture,
} from "./crowd-helpers.js";

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("API publik crowdtesting", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  const pub = (
    method: "GET" | "POST" | "DELETE",
    path: string,
    user?: RegisteredUser | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> =>
    app.inject({
      method,
      url: `/api/v1/crowd${path}`,
      headers: { ...(user ? { cookie: user.cookie } : {}), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  const join = (cycleId: string, user: RegisteredUser) => pub("POST", `/cycles/${cycleId}/join`, user, { acceptRules: true });

  /** Project unik dengan judul cycle bertanda, agar pencarian direktori hanya menemukan data test ini. */
  async function taggedCycles(fx: CrowdFixture, tag: string, specs: Array<{ open?: boolean; endsAt?: string; close?: boolean }>) {
    const cycles = [];
    for (const [i, spec] of specs.entries()) {
      let cycle = await createCycle(app, fx, {
        open: spec.open ?? false,
        body: { title: `${tag} ${i}`, summary: `ringkasan ${tag}`, ...(spec.endsAt ? { endsAt: spec.endsAt } : {}) },
      });
      if (spec.close) {
        const res = await teamRequest(app, "PATCH", fx, `/cycles/${cycle.number}`, fx.admin.cookie, {
          version: cycle.version,
          status: "closed",
        });
        cycle = res.json();
      }
      cycles.push(cycle);
    }
    return cycles;
  }

  describe("direktori", () => {
    it("tab open: berakhir terdekat dulu, lalu dibuka terbaru; draft tidak tampil; endsAt lewat pindah ke closed", async () => {
      const fx = await setupCrowdProject(app);
      const tag = `dir${randomUUID().slice(0, 8)}`;
      const [noEnd, late, soon, draft, expired, closed] = await taggedCycles(fx, tag, [
        { open: true },
        { open: true, endsAt: inDays(9) },
        { open: true, endsAt: inDays(2) },
        {},
        { open: true, endsAt: inDays(1) },
        { open: true, close: true },
      ]);
      await app.db.execute(`update crowd_cycles set ends_at = now() - interval '1 minute' where id = '${expired!.id}'`);

      const open = cycleDirectoryPageDto.parse((await pub("GET", `/cycles?q=${tag}`)).json());
      expect(open.items.map((c) => c.id)).toEqual([soon!.id, late!.id, noEnd!.id]);
      expect(open.items.every((c) => c.id !== draft!.id)).toBe(true);

      const done = cycleDirectoryPageDto.parse((await pub("GET", `/cycles?status=closed&q=${tag}`)).json());
      expect(done.items.map((c) => c.id).toSorted()).toEqual([expired!.id, closed!.id].toSorted());
    });

    it("q dengan % dan _ dicocokkan literal; 25 cycle → 20 + cursor", async () => {
      const fx = await setupCrowdProject(app);
      const tag = `pg${randomUUID().slice(0, 6)}`;
      await createCycle(app, fx, { open: true, body: { title: `${tag} 100% beres` } });
      await createCycle(app, fx, { open: true, body: { title: `${tag} 1000 beres` } });
      const literal = cycleDirectoryPageDto.parse((await pub("GET", `/cycles?q=${encodeURIComponent(`${tag} 100%`)}`)).json());
      expect(literal.items.map((c) => c.title)).toEqual([`${tag} 100% beres`]);

      const tag2 = `pg${randomUUID().slice(0, 6)}`;
      for (let i = 0; i < 25; i++) await createCycle(app, fx, { open: true, body: { title: `${tag2} ${i}` } });
      const first = cycleDirectoryPageDto.parse((await pub("GET", `/cycles?q=${tag2}`)).json());
      expect(first.items).toHaveLength(20);
      const second = cycleDirectoryPageDto.parse((await pub("GET", `/cycles?q=${tag2}&cursor=${first.nextCursor}`)).json());
      expect(second.items).toHaveLength(5);
      expect(new Set([...first.items, ...second.items].map((c) => c.id)).size).toBe(25);
      expectError(await pub("GET", "/cycles?cursor=rusak!"), 400, "VALIDATION_ERROR", "cursor");
    });

    it("kartu memuat project (slug null untuk privat), peserta aktif, dan laporan diterima", async () => {
      const fx = await setupCrowdProject(app);
      const tag = `card${randomUUID().slice(0, 6)}`;
      const [cycle] = await taggedCycles(fx, tag, [{ open: true }]);
      const crowd = await registerUser(app);
      await insertParticipant(app, cycle!.id, crowd.user.id);
      await insertReport(app, { projectId: fx.project.id, cycleId: cycle!.id, reporterId: crowd.user.id, status: "accepted", points: 3 });
      const res = await pub("GET", `/cycles?q=${tag}`);
      const item = cycleDirectoryPageDto.parse(res.json()).items[0]!;
      expect(item).toMatchObject({ project: { name: fx.project.name, slug: null }, participants: 1, accepted: 1 });
      expect(res.body).not.toContain(fx.project.slug);
    });
  });

  describe("detail cycle dan me.state", () => {
    it("state untuk setiap aktor", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      const [active, left, removed, fresh] = [await registerUser(app), await registerUser(app), await registerUser(app), await registerUser(app)];
      await insertParticipant(app, cycle.id, active.user.id);
      await insertParticipant(app, cycle.id, left.user.id, "left");
      await insertParticipant(app, cycle.id, removed.user.id, "removed");

      const state = async (user?: RegisteredUser) => publicCycleDto.parse((await pub("GET", `/cycles/${cycle.id}`, user)).json()).me;
      expect(await state()).toEqual({ state: "anonymous", participantStatus: null });
      expect(await state(fresh)).toEqual({ state: "can_join", participantStatus: null });
      expect(await state(active)).toEqual({ state: "joined", participantStatus: "active" });
      expect(await state(left)).toEqual({ state: "left", participantStatus: "left" });
      expect(await state(removed)).toEqual({ state: "removed", participantStatus: "removed" });
      expect(await state(fx.tester)).toEqual({ state: "member", participantStatus: null });

      await teamRequest(app, "PATCH", fx, `/cycles/${cycle.number}`, fx.admin.cookie, { version: cycle.version, status: "closed" });
      expect(await state(active)).toEqual({ state: "closed", participantStatus: "active" });
    });

    it("isi cycle, statistik, dan project privat tanpa slug (Review Focus 5)", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, {
        open: true,
        body: { instructions: "Coba **login**", inScope: "Login", outOfScope: "DoS", environments: ["Chrome"], appVersion: "0.5.0" },
      });
      const res = await pub("GET", `/cycles/${cycle.id}`);
      expect(res.statusCode, res.body).toBe(200);
      const body = publicCycleDto.parse(res.json());
      expect(body).toMatchObject({
        title: cycle.title,
        instructions: "Coba **login**",
        inScope: "Login",
        outOfScope: "DoS",
        environments: ["Chrome"],
        appVersion: "0.5.0",
        status: "open",
        project: { name: fx.project.name, slug: null },
        stats: { participants: 0, accepted: 0 },
      });
      expect(res.body).not.toContain(fx.project.slug);
      expect(res.body).not.toContain(fx.project.id);
      expectNoEmail(res);
    });

    it("project publik menyertakan slug", async () => {
      const fx = await setupCrowdProject(app, { visibility: "public" });
      const cycle = await createCycle(app, fx, { open: true });
      expect(publicCycleDto.parse((await pub("GET", `/cycles/${cycle.id}`)).json()).project.slug).toBe(fx.project.slug);
    });

    it("draft, id tak dikenal, dan id bukan uuid → 404 CYCLE_NOT_FOUND", async () => {
      const fx = await setupCrowdProject(app);
      const draft = await createCycle(app, fx);
      expectError(await pub("GET", `/cycles/${draft.id}`, fx.admin), 404, "CYCLE_NOT_FOUND");
      expectError(await pub("GET", `/cycles/${randomUUID()}`), 404, "CYCLE_NOT_FOUND");
      expectError(await pub("GET", `/cycles/bukan-uuid`), 404, "CYCLE_NOT_FOUND");
    });
  });

  describe("bergabung dan keluar", () => {
    it("join butuh acceptRules; idempoten walau paralel", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      const crowd = await registerUser(app);
      expectError(await pub("POST", `/cycles/${cycle.id}/join`, crowd, { acceptRules: false }), 400, "VALIDATION_ERROR");

      const results = await Promise.all(Array.from({ length: 5 }, () => join(cycle.id, crowd)));
      for (const r of results) expect(r.statusCode, r.body).toBe(200);
      expect(results[0]!.json()).toEqual({ state: "joined", participantStatus: "active" });
      const rows = await app.db.execute(`select count(*)::int as n from crowd_participants where cycle_id = '${cycle.id}'`);
      expect(rows.rows[0]).toEqual({ n: 1 });
    });

    it("anonim 401; anggota 403; closed / endsAt lewat 409; draft 404", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true, body: { endsAt: inDays(1) } });
      expectError(await pub("POST", `/cycles/${cycle.id}/join`, null, { acceptRules: true }), 401, "UNAUTHENTICATED");
      expectError(await join(cycle.id, fx.viewer), 403, "MEMBER_CANNOT_JOIN");

      await app.db.execute(`update crowd_cycles set ends_at = now() - interval '1 minute' where id = '${cycle.id}'`);
      expectError(await join(cycle.id, await registerUser(app)), 409, "CYCLE_NOT_OPEN");

      const draft = await createCycle(app, fx);
      expectError(await join(draft.id, await registerUser(app)), 404, "CYCLE_NOT_FOUND");
    });

    it("keluar → left; ikut lagi → active", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      const crowd = await registerUser(app);
      await join(cycle.id, crowd);
      expect((await pub("DELETE", `/cycles/${cycle.id}/join`, crowd)).statusCode).toBe(204);
      expect(publicCycleDto.parse((await pub("GET", `/cycles/${cycle.id}`, crowd)).json()).me.state).toBe("left");
      expect((await join(cycle.id, crowd)).json()).toEqual({ state: "joined", participantStatus: "active" });
    });

    it("keluar tanpa pernah ikut → 403 NOT_PARTICIPANT", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      expectError(await pub("DELETE", `/cycles/${cycle.id}/join`, await registerUser(app)), 403, "NOT_PARTICIPANT");
    });

    // Review Focus 2.
    it("dikeluarkan → keluar → ikut lagi tetap ditolak; status tetap removed", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      const crowd = await registerUser(app);
      await join(cycle.id, crowd);
      await teamRequest(app, "POST", fx, `/cycles/${cycle.number}/participants/${crowd.user.id}/remove`, fx.tester.cookie, {});

      expect((await pub("DELETE", `/cycles/${cycle.id}/join`, crowd)).statusCode).toBe(204);
      expectError(await join(cycle.id, crowd), 403, "PARTICIPANT_REMOVED");
      expect(publicCycleDto.parse((await pub("GET", `/cycles/${cycle.id}`, crowd)).json()).me).toEqual({
        state: "removed",
        participantStatus: "removed",
      });
    });

    it("token CI di endpoint yang butuh login → 401", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      const res = await pub("POST", `/cycles/${cycle.id}/join`, null, { acceptRules: true }, { authorization: "Bearer tp_ci_x" });
      expectError(res, 401, "UNAUTHENTICATED");
      expectError(await pub("GET", "/me", null, undefined, { authorization: "Bearer tp_ci_x" }), 401, "UNAUTHENTICATED");
    });
  });

  describe("masalah diketahui dan leaderboard", () => {
    it("hanya laporan accepted yang tidak disembunyikan, terbaru dulu", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      const crowd = await registerUser(app);
      await insertParticipant(app, cycle.id, crowd.user.id);
      const base = { projectId: fx.project.id, cycleId: cycle.id, reporterId: crowd.user.id };
      await insertReport(app, { ...base, title: "Lama", status: "accepted", points: 1, severity: "minor", triagedAt: new Date(Date.now() - 60_000) });
      await insertReport(app, { ...base, title: "Baru", status: "accepted", points: 5, severity: "critical" });
      await insertReport(app, { ...base, title: "Rahasia", status: "accepted", points: 8, severity: "blocker", hide: true });
      await insertReport(app, { ...base, title: "Belum", status: "submitted" });
      await insertReport(app, { ...base, title: "Ditolak", status: "rejected" });

      const res = await pub("GET", `/cycles/${cycle.id}/known-issues`);
      const page = knownIssuesPageDto.parse(res.json());
      expect(page.items.map((i) => [i.title, i.severity])).toEqual([
        ["Baru", "critical"],
        ["Lama", "minor"],
      ]);
      expectNoEmail(res);
    });

    it("leaderboard cycle publik dan global gabungan semua cycle non-draft", async () => {
      const fx = await setupCrowdProject(app);
      const [c1, c2] = [await createCycle(app, fx, { open: true }), await createCycle(app, fx, { open: true })];
      const crowd = await registerUser(app);
      for (const c of [c1, c2]) await insertParticipant(app, c.id, crowd.user.id);
      await insertReport(app, { projectId: fx.project.id, cycleId: c1.id, reporterId: crowd.user.id, status: "accepted", points: 500 });
      await insertReport(app, { projectId: fx.project.id, cycleId: c2.id, reporterId: crowd.user.id, status: "accepted", points: 400 });

      const cycleBoard = leaderboardDto.parse((await pub("GET", `/cycles/${c1.id}/leaderboard`)).json());
      expect(cycleBoard.entries[0]).toMatchObject({ user: { id: crowd.user.id }, points: 500, accepted: 1 });

      // Cache global memakai TTL; app khusus dengan TTL 0 membaca data terbaru.
      const fresh = await createTestApp({}, { crowdLeaderboardTtlMs: 0 });
      const res = await fresh.inject({ method: "GET", url: "/api/v1/crowd/leaderboard", headers: { cookie: crowd.cookie } });
      const global = leaderboardDto.parse(res.json());
      expect(global.me).toMatchObject({ user: { id: crowd.user.id }, points: 900, accepted: 2 });
      expect(global.entries[0]?.user.id).toBe(crowd.user.id);
      expectNoEmail(res);
    });

    it("cache leaderboard global: entri sama selama TTL, bagian me tetap segar", async () => {
      const cached = await createTestApp({}, { crowdLeaderboardTtlMs: 60_000 });
      const fx = await setupCrowdProject(cached);
      const cycle = await createCycle(cached, fx, { open: true });
      const crowd = await registerUser(cached);
      await insertParticipant(cached, cycle.id, crowd.user.id);
      const get = async () =>
        leaderboardDto.parse(
          (await cached.inject({ method: "GET", url: "/api/v1/crowd/leaderboard", headers: { cookie: crowd.cookie } })).json(),
        );

      const before = await get();
      await insertReport(cached, { projectId: fx.project.id, cycleId: cycle.id, reporterId: crowd.user.id, status: "accepted", points: 1000 });
      const after = await get();
      expect(after.entries).toEqual(before.entries);
      expect(after.me).toMatchObject({ user: { id: crowd.user.id }, points: 1000 });
    });
  });

  describe("profil dan me", () => {
    it("profil: poin, tingkat penerimaan, cycle, 10 laporan diterima terbaru tanpa yang disembunyikan", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      const crowd = await registerUser(app);
      await insertParticipant(app, cycle.id, crowd.user.id);
      const base = { projectId: fx.project.id, cycleId: cycle.id, reporterId: crowd.user.id };
      for (let i = 0; i < 11; i++) {
        await insertReport(app, { ...base, title: `Diterima ${i}`, status: "accepted", points: 1, severity: "minor", triagedAt: new Date(Date.now() - (20 - i) * 1000) });
      }
      await insertReport(app, { ...base, title: "Tersembunyi", status: "accepted", points: 3, hide: true });
      await insertReport(app, { ...base, status: "rejected" });
      await insertReport(app, { ...base, status: "withdrawn" });

      const res = await pub("GET", `/testers/${crowd.user.id}`);
      expect(res.statusCode, res.body).toBe(200);
      const profile = testerProfileDto.parse(res.json());
      expect(profile).toMatchObject({ user: { id: crowd.user.id, name: crowd.user.name }, points: 14, cycles: 1 });
      expect(profile.acceptanceRate).toBeCloseTo(12 / 13);
      expect(profile.recentAccepted).toHaveLength(10);
      expect(profile.recentAccepted[0]?.title).toBe("Diterima 10");
      expect(profile.recentAccepted.every((r) => r.title !== "Tersembunyi")).toBe(true);
      expectNoEmail(res);
    });

    it("pengguna tanpa laporan → profil kosong; uuid tak dikenal → 404", async () => {
      const crowd = await registerUser(app);
      const profile = testerProfileDto.parse((await pub("GET", `/testers/${crowd.user.id}`)).json());
      expect(profile).toMatchObject({ points: 0, acceptanceRate: null, cycles: 0, recentAccepted: [] });
      expect((await pub("GET", `/testers/${randomUUID()}`)).statusCode).toBe(404);
      expect((await pub("GET", `/testers/bukan-uuid`)).statusCode).toBe(404);
    });

    it("/me butuh login dan merangkum cycle yang diikuti", async () => {
      expectError(await pub("GET", "/me"), 401, "UNAUTHENTICATED");
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      const crowd = await registerUser(app);
      await join(cycle.id, crowd);
      await insertReport(app, { projectId: fx.project.id, cycleId: cycle.id, reporterId: crowd.user.id, status: "accepted", points: 5 });
      await insertReport(app, { projectId: fx.project.id, cycleId: cycle.id, reporterId: crowd.user.id });
      const res = await pub("GET", "/me", crowd);
      const me = crowdMeDto.parse(res.json());
      expect(me.points).toBe(5);
      expect(me.acceptanceRate).toBe(1);
      expect(me.cycles).toHaveLength(1);
      expect(me.cycles[0]).toMatchObject({
        cycle: { id: cycle.id, title: cycle.title, status: "open" },
        status: "active",
        points: 5,
        reportCounts: { submitted: 1, accepted: 1 },
      });
      expectNoEmail(res);
    });
  });
});
