import { bugDto, crowdReportDto, knownIssuesPageDto, leaderboardDto, teamCrowdReportDto, testerProfileDto, type CrowdReportDto, type TeamCycleDto } from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildCrowdBugDescription } from "../../src/modules/crowd/domain/bug-description.js";
import { createTestApp, registerUser, type RegisteredUser } from "./helpers.js";
import { createCycle, expectError, expectNoEmail, setupCrowdProject, teamRequest, type CrowdFixture } from "./crowd-helpers.js";

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

describe("API triase laporan crowd", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp({}, { crowdLeaderboardTtlMs: 0 });
  });

  const pub = (method: "GET" | "POST" | "DELETE", path: string, user?: RegisteredUser | null, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1/crowd${path}`,
      headers: user ? { cookie: user.cookie } : {},
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  interface Setup {
    fx: CrowdFixture;
    cycle: TeamCycleDto;
    crowd: RegisteredUser;
    report: CrowdReportDto;
  }

  async function setup(over: Record<string, unknown> = {}, visibility: "public" | "private" = "private"): Promise<Setup> {
    const fx = await setupCrowdProject(app, { visibility });
    const cycle = await createCycle(app, fx, { open: true });
    const crowd = await registerUser(app);
    await pub("POST", `/cycles/${cycle.id}/join`, crowd, { acceptRules: true });
    const res = await pub("POST", `/cycles/${cycle.id}/reports`, crowd, reportBody(over));
    expect(res.statusCode, res.body).toBe(201);
    return { fx, cycle, crowd, report: crowdReportDto.parse(res.json()) };
  }

  async function submitAnother(s: Setup, over: Record<string, unknown> = {}) {
    const res = await pub("POST", `/cycles/${s.cycle.id}/reports`, s.crowd, reportBody(over));
    expect(res.statusCode, res.body).toBe(201);
    return crowdReportDto.parse(res.json());
  }

  const triage = (s: Setup, number: number, body: Record<string, unknown>, cookie = s.fx.tester.cookie) =>
    teamRequest(app, "POST", s.fx, `/crowd-reports/${number}/triage`, cookie, body);

  describe("terima", () => {
    it("severity diubah → poin terkunci, bug berlabel crowd dengan asal & deskripsi server, tautan dua arah", async () => {
      const s = await setup();
      const res = await triage(s, s.report.number, { version: 1, decision: "accept", severity: "critical", priority: "high" });
      expect(res.statusCode, res.body).toBe(200);
      const report = teamCrowdReportDto.parse(res.json());
      expect(report).toMatchObject({
        status: "accepted",
        finalSeverity: "critical",
        points: 5,
        version: 2,
        triagedBy: { id: s.fx.tester.user.id },
      });
      expect(report.triagedAt).not.toBeNull();
      expect(report.bug).not.toBeNull();
      expect(report.events.map((e) => e.toStatus)).toEqual(["submitted", "accepted"]);
      expectNoEmail(res);

      const bugRes = await teamRequest(app, "GET", s.fx, `/bugs/${report.bug!.number}`, s.fx.viewer.cookie);
      const bug = bugDto.parse(bugRes.json());
      expect(bug).toMatchObject({
        title: "Tombol simpan error",
        labels: ["crowd"],
        severity: "critical",
        priority: "high",
        status: "open",
        reporter: { id: s.fx.tester.user.id },
        crowdOrigin: { cycleNumber: s.cycle.number, cycleTitle: s.cycle.title, reportNumber: s.report.number, reporterName: s.crowd.user.name },
      });
      expect(bug.description).toBe(
        buildCrowdBugDescription({
          reportNumber: s.report.number,
          cycleNumber: s.cycle.number,
          cycleTitle: s.cycle.title,
          reporterName: s.crowd.user.name,
          environment: "Chrome 130 / Windows 11",
          steps: "1. Buka form\n2. Klik **Simpan**",
          expected: "Data tersimpan",
          actual: "Muncul error 500",
          links: ["https://evidence.example.com/v/1"],
        }),
      );
      expectNoEmail(bugRes);
    });

    it("tanpa severity/prioritas: memakai usulan pelapor dan medium", async () => {
      const s = await setup({ suggestedSeverity: "minor" });
      const report = teamCrowdReportDto.parse((await triage(s, s.report.number, { version: 1, decision: "accept" })).json());
      expect(report).toMatchObject({ finalSeverity: "minor", points: 1 });
      const bug = bugDto.parse((await teamRequest(app, "GET", s.fx, `/bugs/${report.bug!.number}`, s.fx.admin.cookie)).json());
      expect(bug).toMatchObject({ severity: "minor", priority: "medium" });
    });

    it("dua penerimaan paralel dengan version sama → tepat satu bug, satu 409 REPORT_CONFLICT", async () => {
      const s = await setup();
      const bugsBefore = await app.db.execute(`select count(*)::int as n from bugs where project_id = '${s.fx.project.id}'`);
      const results = await Promise.all([
        triage(s, s.report.number, { version: 1, decision: "accept" }),
        triage(s, s.report.number, { version: 1, decision: "accept" }, s.fx.admin.cookie),
      ]);
      expect(results.map((r) => r.statusCode).toSorted()).toEqual([200, 409]);
      expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe("REPORT_CONFLICT");
      const bugsAfter = await app.db.execute(`select count(*)::int as n from bugs where project_id = '${s.fx.project.id}'`);
      expect((bugsAfter.rows[0] as { n: number }).n - (bugsBefore.rows[0] as { n: number }).n).toBe(1);
    });

    it("pelapor melihat poin dan leaderboard cycle & global berubah", async () => {
      const s = await setup();
      await triage(s, s.report.number, { version: 1, decision: "accept", severity: "blocker" });
      const mine = crowdReportDto.parse((await pub("GET", `/reports/${s.report.id}`, s.crowd)).json());
      expect(mine).toMatchObject({ status: "accepted", finalSeverity: "blocker", points: 8 });
      const board = leaderboardDto.parse((await pub("GET", `/cycles/${s.cycle.id}/leaderboard`, s.crowd)).json());
      expect(board.entries[0]).toMatchObject({ user: { id: s.crowd.user.id }, points: 8 });
      const global = leaderboardDto.parse((await pub("GET", "/leaderboard", s.crowd)).json());
      expect(global.me).toMatchObject({ points: 8, accepted: 1 });
    });
  });

  describe("tolak, duplikat, kembalikan", () => {
    it("tolak: other tanpa catatan → 400; dengan catatan → rejected, poin 0, alasan terlihat pelapor", async () => {
      const s = await setup();
      expectError(await triage(s, s.report.number, { version: 1, decision: "reject", reason: "other" }), 400, "VALIDATION_ERROR", "note");
      const res = await triage(s, s.report.number, { version: 1, decision: "reject", reason: "other", note: "Sudah ada di backlog" });
      expect(teamCrowdReportDto.parse(res.json())).toMatchObject({ status: "rejected", rejectReason: "other", triageNote: "Sudah ada di backlog", points: 0, bug: null });
      const mine = crowdReportDto.parse((await pub("GET", `/reports/${s.report.id}`, s.crowd)).json());
      expect(mine).toMatchObject({ status: "rejected", rejectReason: "other", triageNote: "Sudah ada di backlog" });
    });

    it("duplikat sah → duplicate; cycle lain / lebih baru / diri sendiri / withdrawn → 400 fields.duplicateOf", async () => {
      const s = await setup({ title: "Laporan asli" });
      const dup = await submitAnother(s, { title: "Duplikat" });
      const newer = await submitAnother(s, { title: "Lebih baru" });
      const withdrawn = await submitAnother(s, { title: "Ditarik" });
      await pub("DELETE", `/reports/${withdrawn.id}`, s.crowd);

      const otherCycle = await createCycle(app, s.fx, { open: true });
      await pub("POST", `/cycles/${otherCycle.id}/join`, s.crowd, { acceptRules: true });
      const elsewhere = crowdReportDto.parse((await pub("POST", `/cycles/${otherCycle.id}/reports`, s.crowd, reportBody())).json());

      for (const target of [elsewhere.number, newer.number, dup.number, withdrawn.number, 9999]) {
        expectError(await triage(s, dup.number, { version: 1, decision: "duplicate", duplicateOf: target }), 400, "VALIDATION_ERROR", "duplicateOf");
      }
      // Laporan lebih baru tidak bisa menjadi duplikat dari laporan yang ditarik (bad_status), tetapi bisa dari yang asli.
      const ok = await triage(s, dup.number, { version: 1, decision: "duplicate", duplicateOf: s.report.number });
      expect(teamCrowdReportDto.parse(ok.json())).toMatchObject({ status: "duplicate", duplicateOf: { number: s.report.number, title: "Laporan asli" }, points: 0 });
      const mine = crowdReportDto.parse((await pub("GET", `/reports/${dup.id}`, s.crowd)).json());
      expect(mine.duplicateOf).toEqual({ number: s.report.number, title: "Laporan asli" });
    });

    it("kembalikan dari rejected/duplicate → submitted, field triase dikosongkan; dari accepted → 409 INVALID_TRIAGE", async () => {
      const s = await setup();
      const rejected = teamCrowdReportDto.parse(
        (await triage(s, s.report.number, { version: 1, decision: "reject", reason: "not_reproducible", note: "Coba lagi" })).json(),
      );
      const reopened = teamCrowdReportDto.parse((await triage(s, s.report.number, { version: rejected.version, decision: "reopen" })).json());
      expect(reopened).toMatchObject({ status: "submitted", rejectReason: null, triageNote: null, duplicateOf: null, triagedBy: null, triagedAt: null });
      expect(reopened.events.map((e) => e.toStatus)).toEqual(["submitted", "rejected", "submitted"]);

      const accepted = teamCrowdReportDto.parse((await triage(s, s.report.number, { version: reopened.version, decision: "accept" })).json());
      expectError(await triage(s, s.report.number, { version: accepted.version, decision: "reopen" }), 409, "INVALID_TRIAGE");
      expectError(await triage(s, s.report.number, { version: accepted.version, decision: "accept" }), 409, "INVALID_TRIAGE");
    });

    it("version basi → 409 REPORT_CONFLICT", async () => {
      const s = await setup();
      await triage(s, s.report.number, { version: 1, decision: "reject", reason: "out_of_scope" });
      expectError(await triage(s, s.report.number, { version: 1, decision: "reopen" }), 409, "REPORT_CONFLICT");
    });
  });

  describe("sembunyikan dari masalah diketahui", () => {
    it("hanya accepted; tersembunyi hilang dari masalah diketahui & profil, poin tetap", async () => {
      const s = await setup();
      expectError(
        await teamRequest(app, "PATCH", s.fx, `/crowd-reports/${s.report.number}`, s.fx.tester.cookie, { version: 1, hideFromKnownIssues: true }),
        409,
        "INVALID_TRIAGE",
      );
      const accepted = teamCrowdReportDto.parse((await triage(s, s.report.number, { version: 1, decision: "accept", severity: "major" })).json());
      const before = knownIssuesPageDto.parse((await pub("GET", `/cycles/${s.cycle.id}/known-issues`)).json());
      expect(before.items).toHaveLength(1);

      const hidden = await teamRequest(app, "PATCH", s.fx, `/crowd-reports/${s.report.number}`, s.fx.tester.cookie, {
        version: accepted.version,
        hideFromKnownIssues: true,
      });
      expect(hidden.statusCode, hidden.body).toBe(200);
      expect(teamCrowdReportDto.parse(hidden.json()).hideFromKnownIssues).toBe(true);
      expect(knownIssuesPageDto.parse((await pub("GET", `/cycles/${s.cycle.id}/known-issues`)).json()).items).toHaveLength(0);
      const profile = testerProfileDto.parse((await pub("GET", `/testers/${s.crowd.user.id}`)).json());
      expect(profile).toMatchObject({ points: 3, recentAccepted: [] });
    });
  });

  describe("bug dihapus dan akses", () => {
    it("menghapus bug → laporan tetap accepted, bug null, poin tetap", async () => {
      const s = await setup();
      const accepted = teamCrowdReportDto.parse((await triage(s, s.report.number, { version: 1, decision: "accept" })).json());
      expect((await teamRequest(app, "DELETE", s.fx, `/bugs/${accepted.bug!.number}`, s.fx.admin.cookie)).statusCode).toBe(204);
      const after = teamCrowdReportDto.parse((await teamRequest(app, "GET", s.fx, `/crowd-reports/${s.report.number}`, s.fx.admin.cookie)).json());
      expect(after).toMatchObject({ status: "accepted", bug: null, points: 3 });
    });

    it("viewer 403; bukan anggota publik 403; anonim publik 401", async () => {
      const s = await setup({}, "public");
      expectError(await triage(s, s.report.number, { version: 1, decision: "accept" }, s.fx.viewer.cookie), 403, "FORBIDDEN");
      expectError(await triage(s, s.report.number, { version: 1, decision: "accept" }, s.crowd.cookie), 403, "FORBIDDEN");
      expectError(await teamRequest(app, "POST", s.fx, `/crowd-reports/${s.report.number}/triage`, null, { version: 1, decision: "accept" }), 401, "UNAUTHENTICATED");
    });
  });
});
