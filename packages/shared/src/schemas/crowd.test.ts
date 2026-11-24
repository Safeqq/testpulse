import { describe, expect, it } from "vitest";
import {
  CROWD_REPORT_STATUSES,
  CROWD_SEVERITIES,
  CYCLE_STATUSES,
  LEADERBOARD_SIZE,
  MAX_CYCLE_LINKS,
  MAX_ENVIRONMENTS,
  MAX_REPORTS_PER_CYCLE,
  MAX_REPORTS_PER_DAY,
  MAX_SUBMITTED_PER_CYCLE,
  PARTICIPANT_STATUSES,
  REJECT_REASONS,
  SEVERITY_POINTS,
  bugDto,
  createCrowdReportBody,
  createCycleBody,
  crowdCommentBody,
  crowdDirectoryQuery,
  crowdMeDto,
  crowdReportDto,
  hideBody,
  joinBody,
  leaderboardDto,
  participantDto,
  publicCycleDto,
  removeParticipantBody,
  teamCrowdReportDto,
  teamCycleDto,
  testerProfileDto,
  triageBody,
  updateCrowdReportBody,
  updateCycleBody,
} from "../index.js";

const link = { url: "https://app.example.com", label: "Web" };
const validCycle = { title: "Uji rilis", links: [link] };
const validReport = {
  title: "Tombol simpan",
  steps: "1. Buka form 2. Klik",
  expected: "Tersimpan",
  actual: "Error 500",
  environment: "Chrome 130",
  suggestedSeverity: "major",
};

const user = { id: "00000000-0000-4000-8000-000000000001", name: "Budi" };
const withEmail = { ...user, email: "budi@example.com" };

describe("konstanta crowd", () => {
  it("nilai sesuai spec", () => {
    expect(CYCLE_STATUSES).toEqual(["draft", "open", "closed"]);
    expect(CROWD_REPORT_STATUSES).toEqual(["submitted", "accepted", "rejected", "duplicate", "withdrawn"]);
    expect(CROWD_SEVERITIES).toEqual(["minor", "major", "critical", "blocker"]);
    expect(REJECT_REASONS).toEqual(["not_reproducible", "out_of_scope", "not_a_bug", "insufficient_info", "other"]);
    expect(PARTICIPANT_STATUSES).toEqual(["active", "left", "removed"]);
    expect(SEVERITY_POINTS).toEqual({ minor: 1, major: 3, critical: 5, blocker: 8 });
    expect([MAX_CYCLE_LINKS, MAX_ENVIRONMENTS, MAX_SUBMITTED_PER_CYCLE, MAX_REPORTS_PER_CYCLE, MAX_REPORTS_PER_DAY]).toEqual([
      5, 10, 10, 50, 30,
    ]);
    expect(LEADERBOARD_SIZE).toBe(50);
  });
});

describe("createCycleBody", () => {
  it("menerima cycle minimal", () => {
    expect(createCycleBody.safeParse(validCycle).success).toBe(true);
  });

  it.each([
    ["ab", false],
    ["abc", true],
    ["x".repeat(120), true],
    ["x".repeat(121), false],
  ])("judul %#", (title, ok) => {
    expect(createCycleBody.safeParse({ ...validCycle, title }).success).toBe(ok);
  });

  it("ringkasan maksimal 280", () => {
    expect(createCycleBody.safeParse({ ...validCycle, summary: "x".repeat(280) }).success).toBe(true);
    expect(createCycleBody.safeParse({ ...validCycle, summary: "x".repeat(281) }).success).toBe(false);
  });

  it("link 1–5", () => {
    expect(createCycleBody.safeParse({ ...validCycle, links: [] }).success).toBe(false);
    expect(createCycleBody.safeParse({ ...validCycle, links: Array(5).fill(link) }).success).toBe(true);
    expect(createCycleBody.safeParse({ ...validCycle, links: Array(6).fill(link) }).success).toBe(false);
  });

  it.each(["javascript:alert(1)", "https://user:pass@x.io", "ftp://x.io", "https://x.io/" + "a".repeat(2000)])(
    "URL %j ditolak",
    (url) => {
      expect(createCycleBody.safeParse({ ...validCycle, links: [{ url, label: "x" }] }).success).toBe(false);
    },
  );

  it("label link di-trim 1–60", () => {
    expect(createCycleBody.safeParse({ ...validCycle, links: [{ url: link.url, label: "  " }] }).success).toBe(false);
    expect(createCycleBody.safeParse({ ...validCycle, links: [{ url: link.url, label: "x".repeat(61) }] }).success).toBe(false);
  });

  it("lingkungan unik tanpa peka huruf besar/kecil, maks 10, masing-masing 1–40", () => {
    expect(createCycleBody.safeParse({ ...validCycle, environments: ["Chrome", "chrome"] }).success).toBe(false);
    expect(createCycleBody.safeParse({ ...validCycle, environments: Array.from({ length: 10 }, (_, i) => `E${i}`) }).success).toBe(true);
    expect(createCycleBody.safeParse({ ...validCycle, environments: Array.from({ length: 11 }, (_, i) => `E${i}`) }).success).toBe(false);
    expect(createCycleBody.safeParse({ ...validCycle, environments: ["x".repeat(41)] }).success).toBe(false);
  });

  it("instruksi ≤ 10.000, cakupan ≤ 2000", () => {
    expect(createCycleBody.safeParse({ ...validCycle, instructions: "x".repeat(10000) }).success).toBe(true);
    expect(createCycleBody.safeParse({ ...validCycle, instructions: "x".repeat(10001) }).success).toBe(false);
    expect(createCycleBody.safeParse({ ...validCycle, inScope: "x".repeat(2001) }).success).toBe(false);
    expect(createCycleBody.safeParse({ ...validCycle, outOfScope: "x".repeat(2001) }).success).toBe(false);
  });

  it("appVersion memakai aturan runVersion", () => {
    expect(createCycleBody.safeParse({ ...validCycle, appVersion: "0.5.0" }).success).toBe(true);
    expect(createCycleBody.safeParse({ ...validCycle, appVersion: "1 0" }).success).toBe(false);
  });

  it("menolak karakter kontrol", () => {
    expect(createCycleBody.safeParse({ ...validCycle, title: "a\u0000bc" }).success).toBe(false);
  });
});

describe("updateCycleBody", () => {
  it("hanya version ditolak", () => {
    expect(updateCycleBody.safeParse({ version: 1 }).success).toBe(false);
  });

  it("status dan endsAt null diterima sebagai perubahan", () => {
    expect(updateCycleBody.safeParse({ version: 1, status: "open" }).success).toBe(true);
    expect(updateCycleBody.safeParse({ version: 1, endsAt: null }).success).toBe(true);
  });
});

describe("joinBody", () => {
  it("acceptRules wajib true", () => {
    expect(joinBody.safeParse({ acceptRules: true }).success).toBe(true);
    expect(joinBody.safeParse({ acceptRules: false }).success).toBe(false);
    expect(joinBody.safeParse({}).success).toBe(false);
  });
});

describe("createCrowdReportBody", () => {
  it("menerima laporan valid", () => {
    expect(createCrowdReportBody.safeParse(validReport).success).toBe(true);
  });

  it.each([
    ["abcd", false],
    ["abcde", true],
    ["x".repeat(200), true],
    ["x".repeat(201), false],
  ])("judul %#", (title, ok) => {
    expect(createCrowdReportBody.safeParse({ ...validReport, title }).success).toBe(ok);
  });

  it("steps minimal 10 setelah trim, maksimal 10.000", () => {
    expect(createCrowdReportBody.safeParse({ ...validReport, steps: "123456789" }).success).toBe(false);
    expect(createCrowdReportBody.safeParse({ ...validReport, steps: "  123456789  " }).success).toBe(false);
    expect(createCrowdReportBody.safeParse({ ...validReport, steps: "x".repeat(10001) }).success).toBe(false);
  });

  it("expected/actual 1–2000, environment 3–200", () => {
    expect(createCrowdReportBody.safeParse({ ...validReport, expected: " " }).success).toBe(false);
    expect(createCrowdReportBody.safeParse({ ...validReport, actual: "x".repeat(2001) }).success).toBe(false);
    expect(createCrowdReportBody.safeParse({ ...validReport, environment: "ab" }).success).toBe(false);
    expect(createCrowdReportBody.safeParse({ ...validReport, environment: "x".repeat(201) }).success).toBe(false);
  });

  it("link bukti maksimal 5 dengan aturan link bug", () => {
    expect(createCrowdReportBody.safeParse({ ...validReport, links: Array(5).fill({ url: link.url }) }).success).toBe(true);
    expect(createCrowdReportBody.safeParse({ ...validReport, links: Array(6).fill({ url: link.url }) }).success).toBe(false);
    expect(createCrowdReportBody.safeParse({ ...validReport, links: [{ url: "javascript:x" }] }).success).toBe(false);
  });

  it("severity tidak dikenal ditolak", () => {
    expect(createCrowdReportBody.safeParse({ ...validReport, suggestedSeverity: "trivial" }).success).toBe(false);
  });

  it("emoji dan blok kode panjang tersimpan utuh", () => {
    const steps = "😀".repeat(100) + "\n```\n" + "a".repeat(500) + "\n```";
    const parsed = createCrowdReportBody.parse({ ...validReport, steps });
    expect(parsed.steps).toBe(steps);
  });
});

describe("updateCrowdReportBody", () => {
  it("butuh minimal satu perubahan", () => {
    expect(updateCrowdReportBody.safeParse({ version: 1 }).success).toBe(false);
    expect(updateCrowdReportBody.safeParse({ version: 1, title: "Judul baru" }).success).toBe(true);
  });
});

describe("triageBody", () => {
  it("accept boleh tanpa severity/prioritas", () => {
    expect(triageBody.safeParse({ version: 1, decision: "accept" }).success).toBe(true);
    expect(triageBody.safeParse({ version: 1, decision: "accept", severity: "critical", priority: "high" }).success).toBe(true);
  });

  it("reject butuh alasan; other butuh catatan", () => {
    expect(triageBody.safeParse({ version: 1, decision: "reject" }).success).toBe(false);
    expect(triageBody.safeParse({ version: 1, decision: "reject", reason: "out_of_scope" }).success).toBe(true);
    const other = triageBody.safeParse({ version: 1, decision: "reject", reason: "other" });
    expect(other.success).toBe(false);
    expect(other.error?.issues[0]?.path).toEqual(["note"]);
    expect(triageBody.safeParse({ version: 1, decision: "reject", reason: "other", note: "Lihat komentar" }).success).toBe(true);
    expect(triageBody.safeParse({ version: 1, decision: "reject", reason: "other", note: "x".repeat(1001) }).success).toBe(false);
  });

  it("duplicate butuh duplicateOf", () => {
    expect(triageBody.safeParse({ version: 1, decision: "duplicate" }).success).toBe(false);
    expect(triageBody.safeParse({ version: 1, decision: "duplicate", duplicateOf: 3 }).success).toBe(true);
  });

  it("reopen hanya butuh version", () => {
    expect(triageBody.safeParse({ version: 1, decision: "reopen" }).success).toBe(true);
  });

  it("keputusan tidak dikenal ditolak", () => {
    expect(triageBody.safeParse({ version: 1, decision: "approve" }).success).toBe(false);
  });
});

describe("body lain", () => {
  it("komentar 1–5000 setelah trim", () => {
    expect(crowdCommentBody.safeParse({ body: "  " }).success).toBe(false);
    expect(crowdCommentBody.safeParse({ body: "x".repeat(5000) }).success).toBe(true);
    expect(crowdCommentBody.safeParse({ body: "x".repeat(5001) }).success).toBe(false);
  });

  it("alasan dikeluarkan ≤ 500, opsional", () => {
    expect(removeParticipantBody.safeParse({}).success).toBe(true);
    expect(removeParticipantBody.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });

  it("hideBody", () => {
    expect(hideBody.safeParse({ version: 1, hideFromKnownIssues: true }).success).toBe(true);
    expect(hideBody.safeParse({ version: 1 }).success).toBe(false);
  });

  it("direktori: default open, q ≤ 100", () => {
    expect(crowdDirectoryQuery.parse({})).toMatchObject({ status: "open" });
    expect(crowdDirectoryQuery.safeParse({ q: "x".repeat(101) }).success).toBe(false);
  });
});

// Privasi (spec §6): DTO crowd tidak pernah membawa email. Skema strip membuang field yang tidak dikenal.
describe("DTO crowd tanpa email", () => {
  it("participantDto membuang email", () => {
    const parsed = participantDto.parse({
      user: withEmail,
      status: "active",
      joinedAt: "2026-11-16T00:00:00.000Z",
      reportCounts: { submitted: 0, accepted: 0, rejected: 0, duplicate: 0, withdrawn: 0 },
    });
    expect(JSON.stringify(parsed)).not.toContain("@");
  });

  it("leaderboardDto membuang email di entri dan me", () => {
    const parsed = leaderboardDto.parse({
      entries: [{ rank: 1, user: withEmail, points: 5, accepted: 1 }],
      me: { rank: 1, user: withEmail, points: 5, accepted: 1 },
    });
    expect(JSON.stringify(parsed)).not.toContain("@");
  });

  it("teamCrowdReportDto membuang email pelapor", () => {
    const parsed = teamCrowdReportDto.parse({
      id: "00000000-0000-4000-8000-000000000002",
      number: 1,
      cycle: { number: 1, title: "Uji" },
      ...validReport,
      links: [],
      status: "submitted",
      finalSeverity: null,
      points: 0,
      rejectReason: null,
      triageNote: null,
      hideFromKnownIssues: false,
      triagedBy: null,
      triagedAt: null,
      submittedAt: "2026-11-16T00:00:00.000Z",
      updatedAt: "2026-11-16T00:00:00.000Z",
      version: 1,
      reporter: withEmail,
      events: [],
      bug: null,
      duplicateOf: null,
      nextSubmittedNumber: null,
    });
    expect(JSON.stringify(parsed)).not.toContain("@");
  });

  it("publicCycleDto: slug project boleh null (project privat)", () => {
    const parsed = publicCycleDto.parse({
      id: "00000000-0000-4000-8000-000000000003",
      title: "Uji",
      summary: "",
      links: [link],
      instructions: "",
      inScope: "",
      outOfScope: "",
      environments: [],
      appVersion: null,
      status: "open",
      endsAt: null,
      openedAt: "2026-11-16T00:00:00.000Z",
      project: { name: "Rahasia", slug: null },
      stats: { participants: 0, accepted: 0 },
      me: { state: "anonymous" },
    });
    expect(parsed.project.slug).toBeNull();
  });

  it("DTO lain dapat di-parse", () => {
    expect(
      crowdReportDto.safeParse({
        id: "00000000-0000-4000-8000-000000000002",
        number: 1,
        cycle: { id: "00000000-0000-4000-8000-000000000003", title: "Uji" },
        ...validReport,
        links: [],
        status: "accepted",
        finalSeverity: "critical",
        points: 5,
        rejectReason: null,
        triageNote: null,
        duplicateOf: null,
        submittedAt: "2026-11-16T00:00:00.000Z",
        updatedAt: "2026-11-16T00:00:00.000Z",
        triagedAt: "2026-11-16T00:00:00.000Z",
        version: 2,
        events: [],
      }).success,
    ).toBe(true);
    expect(
      teamCycleDto.safeParse({
        id: "00000000-0000-4000-8000-000000000003",
        number: 1,
        title: "Uji",
        summary: "",
        links: [link],
        instructions: "",
        inScope: "",
        outOfScope: "",
        environments: [],
        appVersion: null,
        status: "draft",
        effectiveStatus: "draft",
        endsAt: null,
        openedAt: null,
        closedAt: null,
        createdAt: "2026-11-16T00:00:00.000Z",
        updatedAt: "2026-11-16T00:00:00.000Z",
        version: 1,
        participants: 0,
        reportCounts: { submitted: 0, accepted: 0, rejected: 0, duplicate: 0, withdrawn: 0 },
      }).success,
    ).toBe(true);
    expect(
      testerProfileDto.safeParse({
        user,
        points: 0,
        acceptanceRate: null,
        cycles: 0,
        recentAccepted: [],
      }).success,
    ).toBe(true);
    expect(crowdMeDto.safeParse({ cycles: [], points: 0, acceptanceRate: null }).success).toBe(true);
  });
});

describe("bugDto.crowdOrigin", () => {
  it("menerima null dan objek asal crowd", () => {
    const base = {
      number: 1,
      title: "x",
      status: "open",
      resolution: null,
      priority: "medium",
      severity: "major",
      assignee: null,
      labels: [],
      updatedAt: "",
      createdAt: "",
      description: "",
      reporter: user,
      links: [],
      testCase: null,
      runId: null,
      version: 1,
      resolvedAt: null,
      closedAt: null,
      testHint: null,
      manualOrigin: null,
    };
    expect(bugDto.safeParse({ ...base, crowdOrigin: null }).success).toBe(true);
    expect(
      bugDto.safeParse({ ...base, crowdOrigin: { cycleNumber: 2, cycleTitle: "Uji", reportNumber: 14, reporterName: "Budi" } }).success,
    ).toBe(true);
  });
});
