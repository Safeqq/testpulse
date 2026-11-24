import {
  crowdSummaryDto,
  leaderboardDto,
  participantsPageDto,
  teamCycleDto,
  teamCyclesPageDto,
} from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registerUser } from "./helpers.js";
import {
  createCycle,
  cycleBody,
  expectError,
  expectNoEmail,
  insertParticipant,
  insertReport,
  setupCrowdProject,
  teamRequest,
} from "./crowd-helpers.js";

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("API tim crowdtesting: cycle, peserta, leaderboard, ringkasan", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  describe("membuat cycle", () => {
    it("admin membuat CY-1 berstatus draft dengan link, lingkungan, dan default", async () => {
      const fx = await setupCrowdProject(app);
      const res = await teamRequest(app, "POST", fx, "/cycles", fx.admin.cookie, {
        ...cycleBody({ title: "Uji rilis" }),
        environments: ["Chrome", "Android"],
        appVersion: "0.5.0",
        endsAt: inDays(7),
      });
      expect(res.statusCode, res.body).toBe(201);
      const cycle = teamCycleDto.parse(res.json());
      expect(cycle).toMatchObject({
        number: 1,
        title: "Uji rilis",
        status: "draft",
        effectiveStatus: "draft",
        environments: ["Chrome", "Android"],
        appVersion: "0.5.0",
        openedAt: null,
        version: 1,
        participants: 0,
        reportCounts: { submitted: 0, accepted: 0, rejected: 0, duplicate: 0, withdrawn: 0 },
      });
      expect(cycle.links).toEqual([{ url: "https://app.example.com", label: "Web" }]);
    });

    it("tester dan viewer tidak boleh membuat cycle", async () => {
      const fx = await setupCrowdProject(app);
      expectError(await teamRequest(app, "POST", fx, "/cycles", fx.tester.cookie, cycleBody()), 403, "FORBIDDEN");
      expectError(await teamRequest(app, "POST", fx, "/cycles", fx.viewer.cookie, cycleBody()), 403, "FORBIDDEN");
    });

    it("10 cycle dibuat paralel → CY-1…10 unik", async () => {
      const fx = await setupCrowdProject(app);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => teamRequest(app, "POST", fx, "/cycles", fx.admin.cookie, cycleBody())),
      );
      const numbers = results.map((r) => teamCycleDto.parse(r.json()).number).toSorted((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it("endsAt di masa lalu → 400 fields.endsAt", async () => {
      const fx = await setupCrowdProject(app);
      const res = await teamRequest(app, "POST", fx, "/cycles", fx.admin.cookie, cycleBody({ endsAt: inDays(-1) }));
      expectError(res, 400, "VALIDATION_ERROR", "endsAt");
    });
  });

  describe("transisi dan konkurensi", () => {
    it("draft→open mengisi openedAt; open→closed; closed→open", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      expect(cycle.status).toBe("open");
      expect(cycle.openedAt).not.toBeNull();

      const closed = teamCycleDto.parse(
        (await teamRequest(app, "PATCH", fx, `/cycles/1`, fx.admin.cookie, { version: cycle.version, status: "closed" })).json(),
      );
      expect(closed).toMatchObject({ status: "closed", effectiveStatus: "closed" });
      expect(closed.closedAt).not.toBeNull();

      const reopened = await teamRequest(app, "PATCH", fx, `/cycles/1`, fx.admin.cookie, { version: closed.version, status: "open" });
      expect(reopened.statusCode, reopened.body).toBe(200);
      const body = teamCycleDto.parse(reopened.json());
      expect(body.status).toBe("open");
      // `openedAt` tetap waktu pembukaan pertama.
      expect(body.openedAt).toBe(cycle.openedAt);
    });

    it("open→draft → 409 INVALID_TRANSITION", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      const res = await teamRequest(app, "PATCH", fx, `/cycles/1`, fx.admin.cookie, { version: cycle.version, status: "draft" });
      expectError(res, 409, "INVALID_TRANSITION");
    });

    it("membuka ulang cycle yang endsAt-nya sudah lewat → 400 fields.endsAt; mengganti endsAt sekaligus → 200", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true, body: { endsAt: inDays(1) } });
      const closed = teamCycleDto.parse(
        (await teamRequest(app, "PATCH", fx, `/cycles/1`, fx.admin.cookie, { version: cycle.version, status: "closed" })).json(),
      );
      // Majukan batas akhir ke masa lalu langsung di DB (validasi API menolak nilai lampau).
      await app.db.execute(`update crowd_cycles set ends_at = now() - interval '1 hour' where id = '${closed.id}'`);
      expectError(
        await teamRequest(app, "PATCH", fx, `/cycles/1`, fx.admin.cookie, { version: closed.version, status: "open" }),
        400,
        "VALIDATION_ERROR",
        "endsAt",
      );
      const ok = await teamRequest(app, "PATCH", fx, `/cycles/1`, fx.admin.cookie, {
        version: closed.version,
        status: "open",
        endsAt: inDays(3),
      });
      expect(ok.statusCode, ok.body).toBe(200);
    });

    // Final review Important 1: mengedit isi cycle yang sudah lewat endsAt tidak boleh ditolak karena endsAt yang tidak diubah.
    it("mengubah isi cycle yang endsAt-nya sudah lewat dengan endsAt yang sama → 200, endsAt dan status efektif tetap", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true, body: { endsAt: inDays(1) } });
      await app.db.execute(`update crowd_cycles set ends_at = now() - interval '1 hour' where id = '${cycle.id}'`);
      const expired = teamCycleDto.parse((await teamRequest(app, "GET", fx, "/cycles/1", fx.admin.cookie)).json());
      const res = await teamRequest(app, "PATCH", fx, "/cycles/1", fx.admin.cookie, {
        version: expired.version,
        title: "Judul diperbaiki",
        endsAt: expired.endsAt,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(teamCycleDto.parse(res.json())).toMatchObject({ title: "Judul diperbaiki", endsAt: expired.endsAt, effectiveStatus: "closed" });
      // Nilai lampau yang berbeda tetap ditolak.
      expectError(
        await teamRequest(app, "PATCH", fx, "/cycles/1", fx.admin.cookie, {
          version: expired.version + 1,
          endsAt: new Date(Date.parse(expired.endsAt!) - 60_000).toISOString(),
        }),
        400,
        "VALIDATION_ERROR",
        "endsAt",
      );
    });

    it("status efektif: open dengan endsAt lewat dibaca sebagai closed", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true, body: { endsAt: inDays(1) } });
      await app.db.execute(`update crowd_cycles set ends_at = now() - interval '1 minute' where id = '${cycle.id}'`);
      const res = teamCycleDto.parse((await teamRequest(app, "GET", fx, "/cycles/1", fx.viewer.cookie)).json());
      expect(res).toMatchObject({ status: "open", effectiveStatus: "closed" });
    });

    it("version basi → 409 CYCLE_CONFLICT tanpa perubahan", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx);
      const first = await teamRequest(app, "PATCH", fx, "/cycles/1", fx.admin.cookie, { version: cycle.version, title: "Satu" });
      expect(first.statusCode).toBe(200);
      expectError(
        await teamRequest(app, "PATCH", fx, "/cycles/1", fx.admin.cookie, { version: cycle.version, title: "Dua" }),
        409,
        "CYCLE_CONFLICT",
      );
      const now = teamCycleDto.parse((await teamRequest(app, "GET", fx, "/cycles/1", fx.admin.cookie)).json());
      expect(now.title).toBe("Satu");
    });

    it("mengganti link dan lingkungan mengganti seluruh daftar", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { body: { environments: ["Chrome"] } });
      const res = await teamRequest(app, "PATCH", fx, "/cycles/1", fx.admin.cookie, {
        version: cycle.version,
        links: [
          { url: "https://a.example.com", label: "A" },
          { url: "https://b.example.com", label: "B" },
        ],
        environments: ["Firefox", "Safari"],
      });
      const body = teamCycleDto.parse(res.json());
      expect(body.links.map((l) => l.label)).toEqual(["A", "B"]);
      expect(body.environments).toEqual(["Firefox", "Safari"]);
    });

    it("tester tidak boleh mengubah cycle", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx);
      expectError(
        await teamRequest(app, "PATCH", fx, "/cycles/1", fx.tester.cookie, { version: cycle.version, title: "x y z" }),
        403,
        "FORBIDDEN",
      );
    });
  });

  describe("hapus cycle", () => {
    it("tanpa laporan → 204; dengan laporan → 409 CYCLE_HAS_REPORTS", async () => {
      const fx = await setupCrowdProject(app);
      await createCycle(app, fx);
      const used = await createCycle(app, fx, { open: true });
      const crowd = await registerUser(app);
      await insertParticipant(app, used.id, crowd.user.id);
      await insertReport(app, { projectId: fx.project.id, cycleId: used.id, reporterId: crowd.user.id });

      expect((await teamRequest(app, "DELETE", fx, "/cycles/1", fx.admin.cookie)).statusCode).toBe(204);
      expectError(await teamRequest(app, "GET", fx, "/cycles/1", fx.admin.cookie), 404, "CYCLE_NOT_FOUND");
      expectError(await teamRequest(app, "DELETE", fx, "/cycles/2", fx.admin.cookie), 409, "CYCLE_HAS_REPORTS");
      expectError(await teamRequest(app, "DELETE", fx, "/cycles/2", fx.tester.cookie), 403, "FORBIDDEN");
    });

    it("nomor tak dikenal atau bukan angka → 404 CYCLE_NOT_FOUND", async () => {
      const fx = await setupCrowdProject(app);
      expectError(await teamRequest(app, "GET", fx, "/cycles/99", fx.admin.cookie), 404, "CYCLE_NOT_FOUND");
      expectError(await teamRequest(app, "GET", fx, "/cycles/abc", fx.admin.cookie), 404, "CYCLE_NOT_FOUND");
    });
  });

  describe("daftar dan visibilitas", () => {
    it("anggota melihat semua termasuk draft; bukan anggota di project publik hanya non-draft", async () => {
      const fx = await setupCrowdProject(app, { visibility: "public" });
      await createCycle(app, fx);
      await createCycle(app, fx, { open: true });
      const outsider = await registerUser(app);

      const member = teamCyclesPageDto.parse((await teamRequest(app, "GET", fx, "/cycles", fx.viewer.cookie)).json());
      expect(member.items.map((c) => c.number)).toEqual([2, 1]);

      const anon = teamCyclesPageDto.parse((await teamRequest(app, "GET", fx, "/cycles")).json());
      expect(anon.items.map((c) => c.number)).toEqual([2]);
      const other = teamCyclesPageDto.parse((await teamRequest(app, "GET", fx, "/cycles", outsider.cookie)).json());
      expect(other.items.map((c) => c.number)).toEqual([2]);

      expectError(await teamRequest(app, "GET", fx, "/cycles/1", outsider.cookie), 404, "CYCLE_NOT_FOUND");
      expectError(await teamRequest(app, "GET", fx, "/cycles/1"), 404, "CYCLE_NOT_FOUND");
      expect((await teamRequest(app, "GET", fx, "/cycles/2")).statusCode).toBe(200);
    });

    it("filter status dan paginasi 20 per halaman dengan cursor", async () => {
      const fx = await setupCrowdProject(app);
      for (let i = 0; i < 22; i++) await createCycle(app, fx);
      await createCycle(app, fx, { open: true });

      const first = teamCyclesPageDto.parse((await teamRequest(app, "GET", fx, "/cycles?status=draft", fx.admin.cookie)).json());
      expect(first.items).toHaveLength(20);
      expect(first.items[0]?.number).toBe(22);
      expect(first.nextCursor).not.toBeNull();
      const second = teamCyclesPageDto.parse(
        (await teamRequest(app, "GET", fx, `/cycles?status=draft&cursor=${first.nextCursor}`, fx.admin.cookie)).json(),
      );
      expect(second.items.map((c) => c.number)).toEqual([2, 1]);
      expect(second.nextCursor).toBeNull();

      const open = teamCyclesPageDto.parse((await teamRequest(app, "GET", fx, "/cycles?status=open", fx.admin.cookie)).json());
      expect(open.items.map((c) => c.number)).toEqual([23]);
      expectError(await teamRequest(app, "GET", fx, "/cycles?cursor=rusak!", fx.admin.cookie), 400, "VALIDATION_ERROR", "cursor");
    });

    it("hitungan laporan per status dan peserta aktif ada di daftar & detail", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      const [a, b] = [await registerUser(app), await registerUser(app)];
      await insertParticipant(app, cycle.id, a.user.id);
      await insertParticipant(app, cycle.id, b.user.id, "left");
      await insertReport(app, { projectId: fx.project.id, cycleId: cycle.id, reporterId: a.user.id });
      await insertReport(app, { projectId: fx.project.id, cycleId: cycle.id, reporterId: a.user.id, status: "accepted", points: 3 });
      await insertReport(app, { projectId: fx.project.id, cycleId: cycle.id, reporterId: b.user.id, status: "rejected" });

      const detail = teamCycleDto.parse((await teamRequest(app, "GET", fx, "/cycles/1", fx.admin.cookie)).json());
      expect(detail.participants).toBe(1);
      expect(detail.reportCounts).toEqual({ submitted: 1, accepted: 1, rejected: 1, duplicate: 0, withdrawn: 0 });
      const list = teamCyclesPageDto.parse((await teamRequest(app, "GET", fx, "/cycles", fx.admin.cookie)).json());
      expect(list.items[0]?.reportCounts.submitted).toBe(1);
    });
  });

  describe("peserta", () => {
    it("hanya anggota yang melihat daftar peserta; tanpa email", async () => {
      const fx = await setupCrowdProject(app, { visibility: "public" });
      const cycle = await createCycle(app, fx, { open: true });
      const crowd = await registerUser(app);
      await insertParticipant(app, cycle.id, crowd.user.id);
      await insertReport(app, { projectId: fx.project.id, cycleId: cycle.id, reporterId: crowd.user.id });

      const res = await teamRequest(app, "GET", fx, "/cycles/1/participants", fx.viewer.cookie);
      expect(res.statusCode, res.body).toBe(200);
      const page = participantsPageDto.parse(res.json());
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ user: { id: crowd.user.id, name: crowd.user.name }, status: "active" });
      expect(page.items[0]?.reportCounts.submitted).toBe(1);
      expectNoEmail(res);

      const outsider = await registerUser(app);
      expectError(await teamRequest(app, "GET", fx, "/cycles/1/participants", outsider.cookie), 403, "FORBIDDEN");
      expectError(await teamRequest(app, "GET", fx, "/cycles/1/participants"), 401, "UNAUTHENTICATED");
    });

    it("tester mengeluarkan peserta dengan alasan; viewer tidak boleh", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      const crowd = await registerUser(app);
      await insertParticipant(app, cycle.id, crowd.user.id);

      const path = `/cycles/1/participants/${crowd.user.id}/remove`;
      expectError(await teamRequest(app, "POST", fx, path, fx.viewer.cookie, {}), 403, "FORBIDDEN");
      expect((await teamRequest(app, "POST", fx, path, fx.tester.cookie, { reason: "Spam" })).statusCode).toBe(204);

      const page = participantsPageDto.parse((await teamRequest(app, "GET", fx, "/cycles/1/participants", fx.admin.cookie)).json());
      expect(page.items[0]?.status).toBe("removed");
      const row = await app.db.execute(
        `select removal_reason, removed_by from crowd_participants where cycle_id = '${cycle.id}' and user_id = '${crowd.user.id}'`,
      );
      expect(row.rows[0]).toEqual({ removal_reason: "Spam", removed_by: fx.tester.user.id });

      // Bukan peserta → 404.
      const stranger = await registerUser(app);
      expect((await teamRequest(app, "POST", fx, `/cycles/1/participants/${stranger.user.id}/remove`, fx.admin.cookie, {})).statusCode).toBe(404);
    });

    it("50 per halaman dengan cursor", async () => {
      const fx = await setupCrowdProject(app);
      const cycle = await createCycle(app, fx, { open: true });
      for (let i = 0; i < 52; i++) {
        const user = await registerUser(app);
        await insertParticipant(app, cycle.id, user.user.id);
      }
      const first = participantsPageDto.parse((await teamRequest(app, "GET", fx, "/cycles/1/participants", fx.admin.cookie)).json());
      expect(first.items).toHaveLength(50);
      const second = participantsPageDto.parse(
        (await teamRequest(app, "GET", fx, `/cycles/1/participants?cursor=${first.nextCursor}`, fx.admin.cookie)).json(),
      );
      expect(second.items).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      const ids = new Set([...first.items, ...second.items].map((p) => p.user.id));
      expect(ids.size).toBe(52);
    });
  });

  describe("leaderboard cycle", () => {
    it("urut poin lalu jumlah diterima; posisi saya; tanpa email", async () => {
      const fx = await setupCrowdProject(app, { visibility: "public" });
      const cycle = await createCycle(app, fx, { open: true });
      const [a, b, c] = [await registerUser(app), await registerUser(app), await registerUser(app)];
      for (const u of [a, b, c]) await insertParticipant(app, cycle.id, u.user.id);
      const base = { projectId: fx.project.id, cycleId: cycle.id };
      await insertReport(app, { ...base, reporterId: a.user.id, status: "accepted", points: 5, severity: "critical" });
      await insertReport(app, { ...base, reporterId: b.user.id, status: "accepted", points: 3 });
      await insertReport(app, { ...base, reporterId: b.user.id, status: "accepted", points: 2 });
      await insertReport(app, { ...base, reporterId: c.user.id, status: "rejected" });

      const res = await teamRequest(app, "GET", fx, "/cycles/1/leaderboard", b.cookie);
      expect(res.statusCode, res.body).toBe(200);
      const board = leaderboardDto.parse(res.json());
      expect(board.entries.map((e) => [e.rank, e.user.id, e.points, e.accepted])).toEqual([
        [1, b.user.id, 5, 2],
        [2, a.user.id, 5, 1],
      ]);
      expect(board.me).toMatchObject({ rank: 1, user: { id: b.user.id } });
      expectNoEmail(res);

      const anon = leaderboardDto.parse((await teamRequest(app, "GET", fx, "/cycles/1/leaderboard")).json());
      expect(anon.me).toBeNull();
    });
  });

  describe("ringkasan crowd untuk dashboard", () => {
    it("null tanpa cycle; dengan data menghitung cycle terbuka, menunggu triase, diterima 30 hari", async () => {
      const fx = await setupCrowdProject(app);
      const empty = await teamRequest(app, "GET", fx, "/crowd/summary", fx.viewer.cookie);
      expect(empty.statusCode, empty.body).toBe(200);
      expect(crowdSummaryDto.parse(empty.json())).toBeNull();

      const open = await createCycle(app, fx, { open: true });
      await createCycle(app, fx);
      const crowd = await registerUser(app);
      await insertParticipant(app, open.id, crowd.user.id);
      const base = { projectId: fx.project.id, cycleId: open.id, reporterId: crowd.user.id };
      await insertReport(app, base);
      await insertReport(app, base);
      await insertReport(app, { ...base, status: "accepted", points: 1 });
      await insertReport(app, { ...base, status: "accepted", points: 1, triagedAt: new Date(Date.now() - 40 * 86_400_000) });

      const summary = crowdSummaryDto.parse((await teamRequest(app, "GET", fx, "/crowd/summary", fx.viewer.cookie)).json());
      expect(summary).toEqual({ openCycles: 1, awaitingTriage: 2, accepted30d: 1 });
    });

    it("hanya anggota", async () => {
      const fx = await setupCrowdProject(app, { visibility: "public" });
      expectError(await teamRequest(app, "GET", fx, "/crowd/summary"), 401, "UNAUTHENTICATED");
    });
  });
});
