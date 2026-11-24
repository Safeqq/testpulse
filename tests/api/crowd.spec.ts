import type { APIResponse } from "@playwright/test";
import {
  bugDto,
  crowdCommentDto,
  crowdCommentsPageDto,
  crowdMeDto,
  crowdReportDto,
  crowdReportsPageDto,
  crowdSummaryDto,
  cycleDirectoryPageDto,
  knownIssuesPageDto,
  leaderboardDto,
  myCrowdReportsDto,
  participantsPageDto,
  publicCycleDto,
  teamCrowdReportDto,
  teamCycleDto,
  teamCyclesPageDto,
  testerProfileDto,
} from "@testpulse/shared";
import type { TestApi, TestUser } from "../support/api-client.js";
import { crowdReportBody, cycleBody } from "../support/crowd.js";
import { expect, test } from "../support/fixtures.js";
import { expectApiError, parseBody } from "../support/http.js";

const API = "/api/v1";
const meDto = publicCycleDto.shape.me;

/** Body respons (JSON mentah) tidak boleh memuat email siapa pun yang terlibat. */
async function expectNoEmails(res: APIResponse, users: TestUser[]): Promise<void> {
  const text = await res.text();
  for (const user of users) expect(text, `email ${user.user.email} bocor`).not.toContain(user.user.email);
  expect(text).not.toMatch(/"email"\s*:/);
}

interface Setup {
  owner: TestUser;
  member: TestUser;
  tester: TestUser;
  slug: string;
  base: string;
}

async function setup(api: TestApi): Promise<Setup> {
  const owner = await api.register();
  const { slug } = await api.createProject(owner);
  const member = await api.addMember(owner, slug, "tester");
  const tester = await api.register();
  return { owner, member, tester, slug, base: `${API}/projects/${slug}` };
}

test.describe("Crowdtesting lewat proxy: siklus hidup", () => {
  test("cycle → ikut → lapor → komentar → triase → bug → leaderboard → profil, semua respons sesuai schema dan tanpa email", async ({ api }) => {
    const { owner, member, tester, base } = await setup(api);
    const everyone = [owner, member, tester];
    const check = async <T>(res: APIResponse, status: number, schema: { parse(data: unknown): T }) => {
      await expectNoEmails(res, everyone);
      return parseBody(res, status, schema);
    };

    // Tim: buat (draft), buka, daftar.
    const draft = await check(await owner.request.post(`${base}/cycles`, { data: cycleBody({ title: "Uji API crowd" }) }), 201, teamCycleDto);
    expect(draft).toMatchObject({ number: 1, status: "draft", version: 1 });
    const open = await check(
      await owner.request.patch(`${base}/cycles/1`, { data: { version: draft.version, status: "open" } }),
      200,
      teamCycleDto,
    );
    expect(open.status).toBe("open");
    const list = await check(await member.request.get(`${base}/cycles`), 200, teamCyclesPageDto);
    expect(list.items.map((c) => c.number)).toEqual([1]);

    // Publik: direktori, detail, ikut.
    const directory = await check(await tester.request.get(`${API}/crowd/cycles?q=${encodeURIComponent("Uji API crowd")}`), 200, cycleDirectoryPageDto);
    expect(directory.items.some((c) => c.id === open.id)).toBe(true);
    const pub = await check(await tester.request.get(`${API}/crowd/cycles/${open.id}`), 200, publicCycleDto);
    expect(pub.me.state).toBe("can_join");
    const me = await check(await tester.request.post(`${API}/crowd/cycles/${open.id}/join`, { data: { acceptRules: true } }), 200, meDto);
    expect(me.state).toBe("joined");

    // Lapor dan baca laporan sendiri.
    const report = await check(
      await tester.request.post(`${API}/crowd/cycles/${open.id}/reports`, { data: crowdReportBody({ title: "Checkout macet" }) }),
      201,
      crowdReportDto,
    );
    expect(report).toMatchObject({ number: 1, status: "submitted", version: 1 });
    const mine = await check(await tester.request.get(`${API}/crowd/cycles/${open.id}/reports`), 200, myCrowdReportsDto);
    expect(mine.items.map((r) => r.id)).toEqual([report.id]);
    await check(await tester.request.get(`${API}/crowd/reports/${report.id}`), 200, crowdReportDto);

    // Tim: peserta, antrian, detail, komentar dua arah.
    const participants = await check(await member.request.get(`${base}/cycles/1/participants`), 200, participantsPageDto);
    expect(participants.items.map((p) => p.user.id)).toEqual([tester.user.id]);
    const queue = await check(await member.request.get(`${base}/cycles/1/reports`), 200, crowdReportsPageDto);
    expect(queue.items.map((r) => r.number)).toEqual([1]);
    const team = await check(await member.request.get(`${base}/crowd-reports/1`), 200, teamCrowdReportDto);
    expect(team.reporter).toEqual({ id: tester.user.id, name: tester.user.name });
    await check(await member.request.post(`${base}/crowd-reports/1/comments`, { data: { body: "Bisa kirim video?" } }), 201, crowdCommentDto);
    await check(await tester.request.post(`${API}/crowd/reports/${report.id}/comments`, { data: { body: "Sudah" } }), 201, crowdCommentDto);
    const thread = await check(await tester.request.get(`${API}/crowd/reports/${report.id}/comments`), 200, crowdCommentsPageDto);
    expect(thread.items.map((c) => c.body)).toEqual(["Bisa kirim video?", "Sudah"]);
    await check(await member.request.get(`${base}/crowd-reports/1/comments`), 200, crowdCommentsPageDto);

    // Triase: terima → bug dengan crowdOrigin; poin, masalah diketahui, leaderboard, profil, ringkasan.
    const accepted = await check(
      await member.request.post(`${base}/crowd-reports/1/triage`, { data: { version: team.version, decision: "accept", severity: "critical" } }),
      200,
      teamCrowdReportDto,
    );
    expect(accepted).toMatchObject({ status: "accepted", finalSeverity: "critical", points: 5, bug: { number: 1 } });
    const bug = await check(await member.request.get(`${base}/bugs/1`), 200, bugDto);
    expect(bug.labels).toContain("crowd");
    expect(bug.crowdOrigin).toEqual({ cycleNumber: 1, cycleTitle: "Uji API crowd", reportNumber: 1, reporterName: tester.user.name });
    const known = await check(await tester.request.get(`${API}/crowd/cycles/${open.id}/known-issues`), 200, knownIssuesPageDto);
    expect(known.items.map((k) => k.title)).toEqual(["Checkout macet"]);
    const hidden = await check(
      await member.request.patch(`${base}/crowd-reports/1`, { data: { version: accepted.version, hideFromKnownIssues: true } }),
      200,
      teamCrowdReportDto,
    );
    expect(hidden.hideFromKnownIssues).toBe(true);
    const cycleBoard = await check(await tester.request.get(`${API}/crowd/cycles/${open.id}/leaderboard`), 200, leaderboardDto);
    expect(cycleBoard.entries[0]).toMatchObject({ rank: 1, user: { id: tester.user.id }, points: 5, accepted: 1 });
    await check(await member.request.get(`${base}/cycles/1/leaderboard`), 200, leaderboardDto);
    const global = await check(await tester.request.get(`${API}/crowd/leaderboard`), 200, leaderboardDto);
    expect(global.me).toMatchObject({ user: { id: tester.user.id }, points: 5 });
    const profile = await check(await owner.request.get(`${API}/crowd/testers/${tester.user.id}`), 200, testerProfileDto);
    expect(profile.points).toBe(5);
    const crowdMe = await check(await tester.request.get(`${API}/crowd/me`), 200, crowdMeDto);
    expect(crowdMe.points).toBe(5);
    const summary = await check(await member.request.get(`${base}/crowd/summary`), 200, crowdSummaryDto);
    expect(summary).toEqual({ openCycles: 1, awaitingTriage: 0, accepted30d: 1 });

    // Keluarkan peserta lalu tutup cycle.
    const removed = await owner.request.post(`${base}/cycles/1/participants/${tester.user.id}/remove`, { data: { reason: "Uji" } });
    expect(removed.status(), await removed.text()).toBe(204);
    const closed = await check(await owner.request.patch(`${base}/cycles/1`, { data: { version: open.version, status: "closed" } }), 200, teamCycleDto);
    expect(closed.status).toBe("closed");
  });
});

test.describe("Crowdtesting lewat proxy: status error", () => {
  test("409 REPORT_CONFLICT, INVALID_TRIAGE, CYCLE_NOT_OPEN, CYCLE_HAS_REPORTS", async ({ api }) => {
    const { owner, member, tester, slug, base } = await setup(api);
    const cycle = await api.createOpenCycle(owner, slug, cycleBody());
    await api.joinCycle(tester, cycle.id);
    const report = await api.submitCrowdReport(tester, cycle.id, crowdReportBody());

    await api.triage(owner, slug, report.number, { version: report.version, decision: "accept" });
    // Versi lama: anggota lain yang menerima bersamaan kalah.
    await expectApiError(
      await member.request.post(`${base}/crowd-reports/${report.number}/triage`, { data: { version: report.version, decision: "accept" } }),
      409,
      "REPORT_CONFLICT",
    );
    // Versi terbaru tetapi transisi tidak sah: laporan diterima itu final.
    const current = teamCrowdReportDto.parse(await (await member.request.get(`${base}/crowd-reports/${report.number}`)).json());
    await expectApiError(
      await member.request.post(`${base}/crowd-reports/${report.number}/triage`, { data: { version: current.version, decision: "reopen" } }),
      409,
      "INVALID_TRIAGE",
    );
    await expectApiError(await owner.request.delete(`${base}/cycles/${cycle.number}`), 409, "CYCLE_HAS_REPORTS");

    const latest = teamCycleDto.parse(await (await owner.request.get(`${base}/cycles/${cycle.number}`)).json());
    await api.updateCycle(owner, slug, cycle.number, { version: latest.version, status: "closed" });
    await expectApiError(
      await tester.request.post(`${API}/crowd/cycles/${cycle.id}/reports`, { data: crowdReportBody() }),
      409,
      "CYCLE_NOT_OPEN",
    );
  });

  test("403 MEMBER_CANNOT_JOIN dan PARTICIPANT_REMOVED; 404 REPORT_NOT_FOUND untuk laporan orang lain", async ({ api }) => {
    const { owner, member, tester, slug } = await setup(api);
    const cycle = await api.createOpenCycle(owner, slug, cycleBody());
    await expectApiError(
      await member.request.post(`${API}/crowd/cycles/${cycle.id}/join`, { data: { acceptRules: true } }),
      403,
      "MEMBER_CANNOT_JOIN",
    );

    await api.joinCycle(tester, cycle.id);
    const report = await api.submitCrowdReport(tester, cycle.id, crowdReportBody());
    const other = await api.register();
    await api.joinCycle(other, cycle.id);
    const res = await other.request.get(`${API}/crowd/reports/${report.id}`);
    await expectApiError(res, 404, "REPORT_NOT_FOUND");

    await api.removeParticipant(owner, slug, cycle.number, tester.user.id);
    await api.leaveCycle(tester, cycle.id).catch(() => undefined);
    await expectApiError(
      await tester.request.post(`${API}/crowd/cycles/${cycle.id}/join`, { data: { acceptRules: true } }),
      403,
      "PARTICIPANT_REMOVED",
    );
  });

  test("429 RATE_LIMITED pada laporan ke-11 yang menunggu triase", async ({ api }) => {
    const { owner, tester, slug } = await setup(api);
    const cycle = await api.createOpenCycle(owner, slug, cycleBody());
    await api.joinCycle(tester, cycle.id);
    for (let i = 0; i < 10; i++) await api.submitCrowdReport(tester, cycle.id, crowdReportBody({ title: `Laporan ke-${i + 1}` }));
    await expectApiError(
      await tester.request.post(`${API}/crowd/cycles/${cycle.id}/reports`, { data: crowdReportBody({ title: "Laporan ke-11" }) }),
      429,
      "RATE_LIMITED",
    );
  });
});
