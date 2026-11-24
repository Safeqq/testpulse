import {
  crowdCommentDto,
  crowdCommentsPageDto,
  crowdReportDto,
  crowdReportsPageDto,
  myCrowdReportsDto,
  teamCrowdReportDto,
  type CrowdReportDto,
  type TeamCycleDto,
} from "@testpulse/shared";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestApp, registerUser, type RegisteredUser } from "./helpers.js";
import {
  createCycle,
  expectError,
  expectNoEmail,
  insertReport,
  setupCrowdProject,
  teamRequest,
  type CrowdFixture,
} from "./crowd-helpers.js";

const reportBody = (over: Record<string, unknown> = {}) => ({
  title: "Tombol simpan error",
  steps: "1. Buka form\n2. Klik **Simpan**",
  expected: "Data tersimpan",
  actual: "Muncul error 500",
  environment: "Chrome 130 / Windows 11",
  suggestedSeverity: "major",
  links: [{ url: "https://evidence.example.com/v/1" }],
  ...over,
});

describe("API laporan crowd", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  const pub = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, user?: RegisteredUser | null, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1/crowd${path}`,
      headers: user ? { cookie: user.cookie } : {},
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  async function joined(fx: CrowdFixture, cycle: TeamCycleDto): Promise<RegisteredUser> {
    const user = await registerUser(app);
    const res = await pub("POST", `/cycles/${cycle.id}/join`, user, { acceptRules: true });
    expect(res.statusCode, res.body).toBe(200);
    return user;
  }

  async function submit(cycle: TeamCycleDto, user: RegisteredUser, over: Record<string, unknown> = {}): Promise<CrowdReportDto> {
    const res = await pub("POST", `/cycles/${cycle.id}/reports`, user, reportBody(over));
    expect(res.statusCode, res.body).toBe(201);
    return crowdReportDto.parse(res.json());
  }

  async function openCycle() {
    const fx = await setupCrowdProject(app);
    const cycle = await createCycle(app, fx, { open: true });
    return { fx, cycle };
  }

  describe("mengirim laporan", () => {
    it("peserta mengirim → CR-1 submitted + event; link bukti tersimpan; tanpa email", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      const res = await pub("POST", `/cycles/${cycle.id}/reports`, crowd, reportBody());
      expect(res.statusCode, res.body).toBe(201);
      const report = crowdReportDto.parse(res.json());
      expect(report).toMatchObject({
        number: 1,
        status: "submitted",
        title: "Tombol simpan error",
        suggestedSeverity: "major",
        finalSeverity: null,
        points: 0,
        version: 1,
        cycle: { id: cycle.id, title: cycle.title },
        links: [{ url: "https://evidence.example.com/v/1", title: null }],
      });
      expect(report.events).toHaveLength(1);
      expect(report.events[0]).toMatchObject({ fromStatus: null, toStatus: "submitted", actor: { id: crowd.user.id } });
      expectNoEmail(res);
    });

    it("bukan peserta 403 NOT_PARTICIPANT; dikeluarkan 403 PARTICIPANT_REMOVED; anonim 401", async () => {
      const { fx, cycle } = await openCycle();
      expectError(await pub("POST", `/cycles/${cycle.id}/reports`, await registerUser(app), reportBody()), 403, "NOT_PARTICIPANT");
      expectError(await pub("POST", `/cycles/${cycle.id}/reports`, null, reportBody()), 401, "UNAUTHENTICATED");
      const crowd = await joined(fx, cycle);
      await teamRequest(app, "POST", fx, `/cycles/${cycle.number}/participants/${crowd.user.id}/remove`, fx.admin.cookie, {});
      expectError(await pub("POST", `/cycles/${cycle.id}/reports`, crowd, reportBody()), 403, "PARTICIPANT_REMOVED");
    });

    it("peserta yang kemudian menjadi anggota project → 403 MEMBER_CANNOT_JOIN", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      await addMember(app, fx.project.id, crowd.user.id, "viewer");
      expectError(await pub("POST", `/cycles/${cycle.id}/reports`, crowd, reportBody()), 403, "MEMBER_CANNOT_JOIN");
    });

    // Review Focus 3.
    it("cycle ditutup atau endsAt lewat → 409 CYCLE_NOT_OPEN", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      await app.db.execute(`update crowd_cycles set ends_at = now() - interval '1 minute' where id = '${cycle.id}'`);
      expectError(await pub("POST", `/cycles/${cycle.id}/reports`, crowd, reportBody()), 409, "CYCLE_NOT_OPEN");

      const other = await createCycle(app, fx, { open: true });
      const tester = await joined(fx, other);
      await teamRequest(app, "PATCH", fx, `/cycles/${other.number}`, fx.admin.cookie, { version: other.version, status: "closed" });
      expectError(await pub("POST", `/cycles/${other.id}/reports`, tester, reportBody()), 409, "CYCLE_NOT_OPEN");
    });

    it("validasi field → 400 dengan field yang tepat", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      expectError(await pub("POST", `/cycles/${cycle.id}/reports`, crowd, reportBody({ steps: "pendek" })), 400, "VALIDATION_ERROR", "steps");
    });
  });

  describe("anti-spam", () => {
    it("9 submitted + 5 kiriman paralel → tepat 1 lolos, 4 → 429 menyebut batas", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      for (let i = 0; i < 9; i++) await insertReport(app, { projectId: fx.project.id, cycleId: cycle.id, reporterId: crowd.user.id });
      const results = await Promise.all(
        Array.from({ length: 5 }, () => pub("POST", `/cycles/${cycle.id}/reports`, crowd, reportBody())),
      );
      const codes = results.map((r) => r.statusCode).toSorted();
      expect(codes).toEqual([201, 429, 429, 429, 429]);
      const limited = results.find((r) => r.statusCode === 429)!;
      expect(limited.json().error.code).toBe("RATE_LIMITED");
      expect(limited.json().error.message).toContain("10");
    });

    it("total 50 per cycle termasuk yang ditarik → 429", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      for (let i = 0; i < 50; i++) {
        await insertReport(app, {
          projectId: fx.project.id,
          cycleId: cycle.id,
          reporterId: crowd.user.id,
          status: i < 45 ? "withdrawn" : "rejected",
          submittedAt: new Date(Date.now() - 3 * 86_400_000),
        });
      }
      const res = await pub("POST", `/cycles/${cycle.id}/reports`, crowd, reportBody());
      expectError(res, 429, "RATE_LIMITED");
      expect(res.json().error.message).toContain("50");
    });

    it("30 laporan dalam 24 jam di dua cycle → 429 harian; laporan > 24 jam tidak dihitung", async () => {
      const fx = await setupCrowdProject(app);
      const [a, b] = [await createCycle(app, fx, { open: true }), await createCycle(app, fx, { open: true })];
      const crowd = await registerUser(app);
      for (const c of [a, b]) await pub("POST", `/cycles/${c.id}/join`, crowd, { acceptRules: true });
      const old = new Date(Date.now() - 25 * 3_600_000);
      for (let i = 0; i < 5; i++) {
        await insertReport(app, { projectId: fx.project.id, cycleId: a.id, reporterId: crowd.user.id, status: "rejected", submittedAt: old });
      }
      for (let i = 0; i < 15; i++) {
        await insertReport(app, { projectId: fx.project.id, cycleId: a.id, reporterId: crowd.user.id, status: "rejected" });
        await insertReport(app, { projectId: fx.project.id, cycleId: b.id, reporterId: crowd.user.id, status: "rejected" });
      }
      const res = await pub("POST", `/cycles/${b.id}/reports`, crowd, reportBody());
      expectError(res, 429, "RATE_LIMITED");
      expect(res.json().error.message).toContain("24 jam");
    });

    it("rate limit per IP pada POST laporan", async () => {
      // Batas per rute: 4 juga cukup untuk 4 pendaftaran user di setup (rute register punya hitungannya sendiri).
      const limited = await createTestApp({ rateLimitMax: 4 });
      const fx = await setupCrowdProject(limited);
      const cycle = await createCycle(limited, fx, { open: true });
      const crowd = await registerUser(limited);
      await limited.inject({ method: "POST", url: `/api/v1/crowd/cycles/${cycle.id}/join`, headers: { cookie: crowd.cookie }, payload: { acceptRules: true } });
      const post = () =>
        limited.inject({ method: "POST", url: `/api/v1/crowd/cycles/${cycle.id}/reports`, headers: { cookie: crowd.cookie }, payload: reportBody() });
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await post()).statusCode);
      expect(statuses).toEqual([201, 201, 201, 201, 429]);
    });
  });

  describe("laporan saya", () => {
    it("daftar laporan saya di cycle; laporan orang lain → 404 (privasi)", async () => {
      const { fx, cycle } = await openCycle();
      const [me, other] = [await joined(fx, cycle), await joined(fx, cycle)];
      const mine = await submit(cycle, me, { title: "Laporan saya" });
      const theirs = await submit(cycle, other, { title: "Laporan orang lain" });

      const list = myCrowdReportsDto.parse((await pub("GET", `/cycles/${cycle.id}/reports`, me)).json());
      expect(list.items.map((r) => r.title)).toEqual(["Laporan saya"]);

      expect((await pub("GET", `/reports/${mine.id}`, me)).statusCode).toBe(200);
      expectError(await pub("GET", `/reports/${theirs.id}`, me), 404, "REPORT_NOT_FOUND");
      expectError(await pub("GET", `/reports/${randomUUID()}`, me), 404, "REPORT_NOT_FOUND");
      expectError(await pub("GET", `/reports/bukan-uuid`, me), 404, "REPORT_NOT_FOUND");
      expectError(await pub("GET", `/reports/${mine.id}`), 401, "UNAUTHENTICATED");
      expectError(await pub("GET", `/cycles/${cycle.id}/reports`, await registerUser(app)), 403, "NOT_PARTICIPANT");
    });

    it("edit saat submitted menaikkan version; version basi → 409 REPORT_CONFLICT", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      const report = await submit(cycle, crowd);
      const edited = await pub("PATCH", `/reports/${report.id}`, crowd, { version: 1, title: "Judul baru", links: [] });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(crowdReportDto.parse(edited.json())).toMatchObject({ title: "Judul baru", version: 2, links: [] });
      expectError(await pub("PATCH", `/reports/${report.id}`, crowd, { version: 1, title: "Lagi lagi" }), 409, "REPORT_CONFLICT");
    });

    it("tarik → withdrawn + event; edit/tarik sesudahnya → 409 INVALID_TRIAGE", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      const report = await submit(cycle, crowd);
      const res = await pub("DELETE", `/reports/${report.id}`, crowd);
      expect(res.statusCode, res.body).toBe(200);
      const withdrawn = crowdReportDto.parse(res.json());
      expect(withdrawn.status).toBe("withdrawn");
      expect(withdrawn.events.map((e) => e.toStatus)).toEqual(["submitted", "withdrawn"]);
      expectError(await pub("PATCH", `/reports/${report.id}`, crowd, { version: withdrawn.version, title: "Coba lagi" }), 409, "INVALID_TRIAGE");
      expectError(await pub("DELETE", `/reports/${report.id}`, crowd), 409, "INVALID_TRIAGE");
    });

    it("peserta yang dikeluarkan masih bisa membaca, tetapi tidak mengedit atau menarik", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      const report = await submit(cycle, crowd);
      await teamRequest(app, "POST", fx, `/cycles/${cycle.number}/participants/${crowd.user.id}/remove`, fx.admin.cookie, {});
      expect((await pub("GET", `/reports/${report.id}`, crowd)).statusCode).toBe(200);
      expectError(await pub("PATCH", `/reports/${report.id}`, crowd, { version: 1, title: "Judul lain" }), 403, "PARTICIPANT_REMOVED");
      expectError(await pub("DELETE", `/reports/${report.id}`, crowd), 403, "PARTICIPANT_REMOVED");
    });
  });

  describe("komentar", () => {
    it("pelapor dan tester menulis di thread yang sama; viewer membaca saja; hapus milik sendiri", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      const report = await submit(cycle, crowd);

      const mine = await pub("POST", `/reports/${report.id}/comments`, crowd, { body: "Bisa direproduksi tiap kali" });
      expect(mine.statusCode, mine.body).toBe(201);
      const team = await teamRequest(app, "POST", fx, `/crowd-reports/${report.number}/comments`, fx.tester.cookie, { body: "Terima kasih" });
      expect(team.statusCode, team.body).toBe(201);
      expectError(await teamRequest(app, "POST", fx, `/crowd-reports/${report.number}/comments`, fx.viewer.cookie, { body: "x" }), 403, "FORBIDDEN");

      const thread = crowdCommentsPageDto.parse((await pub("GET", `/reports/${report.id}/comments`, crowd)).json());
      expect(thread.items.map((c) => c.body)).toEqual(["Bisa direproduksi tiap kali", "Terima kasih"]);
      const teamThread = await teamRequest(app, "GET", fx, `/crowd-reports/${report.number}/comments`, fx.viewer.cookie);
      expect(crowdCommentsPageDto.parse(teamThread.json()).items).toHaveLength(2);
      expectNoEmail(teamThread);

      const myComment = crowdCommentDto.parse(mine.json());
      const teamComment = crowdCommentDto.parse(team.json());
      expect((await pub("DELETE", `/reports/${report.id}/comments/${teamComment.id}`, crowd)).statusCode).toBe(403);
      expect((await pub("DELETE", `/reports/${report.id}/comments/${myComment.id}`, crowd)).statusCode).toBe(204);
      const after = crowdCommentsPageDto.parse((await pub("GET", `/reports/${report.id}/comments`, crowd)).json());
      expect(after.items[0]).toMatchObject({ id: myComment.id, body: null });
      expect(after.items[0]?.deletedAt).not.toBeNull();
    });

    it("pelapor lain tidak bisa membaca thread laporan orang lain", async () => {
      const { fx, cycle } = await openCycle();
      const [a, b] = [await joined(fx, cycle), await joined(fx, cycle)];
      const report = await submit(cycle, a);
      expectError(await pub("GET", `/reports/${report.id}/comments`, b), 404, "REPORT_NOT_FOUND");
      expectError(await pub("POST", `/reports/${report.id}/comments`, b, { body: "x" }), 404, "REPORT_NOT_FOUND");
    });
  });

  describe("antrian dan detail tim", () => {
    it("default submitted, terlama dulu; filter severity dan q; status lain terbaru dulu", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      const base = { projectId: fx.project.id, cycleId: cycle.id, reporterId: crowd.user.id };
      const r1 = await insertReport(app, { ...base, title: "Pertama 50% beres", submittedAt: new Date(Date.now() - 3000) });
      const r2 = await insertReport(app, { ...base, title: "Kedua", severity: "critical", submittedAt: new Date(Date.now() - 2000) });
      await insertReport(app, { ...base, title: "Ditolak lama", status: "rejected", submittedAt: new Date(Date.now() - 5000) });
      await insertReport(app, { ...base, title: "Ditolak baru", status: "rejected", submittedAt: new Date(Date.now() - 1000) });

      const queue = crowdReportsPageDto.parse((await teamRequest(app, "GET", fx, `/cycles/${cycle.number}/reports`, fx.viewer.cookie)).json());
      expect(queue.items.map((r) => r.number)).toEqual([r1.number, r2.number]);
      expect(queue.items[0]?.reporter).toEqual({ id: crowd.user.id, name: crowd.user.name });

      const critical = crowdReportsPageDto.parse(
        (await teamRequest(app, "GET", fx, `/cycles/${cycle.number}/reports?severity=critical`, fx.viewer.cookie)).json(),
      );
      expect(critical.items.map((r) => r.number)).toEqual([r2.number]);
      const literal = crowdReportsPageDto.parse(
        (await teamRequest(app, "GET", fx, `/cycles/${cycle.number}/reports?q=${encodeURIComponent("50%")}`, fx.viewer.cookie)).json(),
      );
      expect(literal.items.map((r) => r.number)).toEqual([r1.number]);
      const rejected = crowdReportsPageDto.parse(
        (await teamRequest(app, "GET", fx, `/cycles/${cycle.number}/reports?status=rejected`, fx.viewer.cookie)).json(),
      );
      expect(rejected.items.map((r) => r.title)).toEqual(["Ditolak baru", "Ditolak lama"]);
    });

    it("50 per halaman dengan cursor; cursor rusak → 400", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      for (let i = 0; i < 52; i++) await insertReport(app, { projectId: fx.project.id, cycleId: cycle.id, reporterId: crowd.user.id });
      const first = crowdReportsPageDto.parse((await teamRequest(app, "GET", fx, `/cycles/${cycle.number}/reports`, fx.admin.cookie)).json());
      expect(first.items).toHaveLength(50);
      const second = crowdReportsPageDto.parse(
        (await teamRequest(app, "GET", fx, `/cycles/${cycle.number}/reports?cursor=${first.nextCursor}`, fx.admin.cookie)).json(),
      );
      expect(second.items).toHaveLength(2);
      expect(new Set([...first.items, ...second.items].map((r) => r.number)).size).toBe(52);
      expectError(await teamRequest(app, "GET", fx, `/cycles/${cycle.number}/reports?cursor=rusak!`, fx.admin.cookie), 400, "VALIDATION_ERROR", "cursor");
    });

    it("detail tim: pelapor tanpa email, event, nextSubmittedNumber berputar", async () => {
      const { fx, cycle } = await openCycle();
      const crowd = await joined(fx, cycle);
      const a = await submit(cycle, crowd, { title: "A laporan" });
      const b = await submit(cycle, crowd, { title: "B laporan" });
      const c = await submit(cycle, crowd, { title: "C laporan" });

      const res = await teamRequest(app, "GET", fx, `/crowd-reports/${b.number}`, fx.viewer.cookie);
      expect(res.statusCode, res.body).toBe(200);
      const detail = teamCrowdReportDto.parse(res.json());
      expect(detail).toMatchObject({
        number: b.number,
        reporter: { id: crowd.user.id, name: crowd.user.name },
        cycle: { number: cycle.number, title: cycle.title },
        bug: null,
        duplicateOf: null,
        hideFromKnownIssues: false,
        triagedBy: null,
        nextSubmittedNumber: c.number,
      });
      expectNoEmail(res);
      const last = teamCrowdReportDto.parse((await teamRequest(app, "GET", fx, `/crowd-reports/${c.number}`, fx.viewer.cookie)).json());
      expect(last.nextSubmittedNumber).toBe(a.number);

      await pub("DELETE", `/reports/${a.id}`, crowd);
      await pub("DELETE", `/reports/${c.id}`, crowd);
      const only = teamCrowdReportDto.parse((await teamRequest(app, "GET", fx, `/crowd-reports/${b.number}`, fx.viewer.cookie)).json());
      expect(only.nextSubmittedNumber).toBeNull();
    });

    it("hanya anggota; nomor tak dikenal → 404 REPORT_NOT_FOUND", async () => {
      const fx = await setupCrowdProject(app, { visibility: "public" });
      const cycle = await createCycle(app, fx, { open: true });
      const crowd = await joined(fx, cycle);
      const report = await submit(cycle, crowd);
      expectError(await teamRequest(app, "GET", fx, `/crowd-reports/${report.number}`), 401, "UNAUTHENTICATED");
      expectError(await teamRequest(app, "GET", fx, `/crowd-reports/${report.number}`, crowd.cookie), 403, "FORBIDDEN");
      expectError(await teamRequest(app, "GET", fx, `/cycles/${cycle.number}/reports`, crowd.cookie), 403, "FORBIDDEN");
      expectError(await teamRequest(app, "GET", fx, `/crowd-reports/999`, fx.admin.cookie), 404, "REPORT_NOT_FOUND");
    });
  });
});

