import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";
import {
  BUDI_ID,
  COOKIE_HEADERS,
  CROWD_COMMENT_ID,
  CROWD_REPORT_ID,
  CYCLE_ID,
  JSON_COOKIE_HEADERS,
  PROJECT_SLUG,
  STATE,
  TEAM_COMMENT_ID,
  TINI_ID,
  clientFor,
  createPact,
  dateTime,
  errorBody,
  uuidLike,
} from "./pact.js";

const pact = createPact();
const { like } = MatchersV3;

const BASE = `/api/v1/projects/${PROJECT_SLUG}`;
const CROWD = "/api/v1/crowd";

// Nilai tetap dari provider state (apps/api/test/contract/states.ts); state deterministik → nilai persis.
const tini = { id: TINI_ID, name: "Tini" };
const budi = { id: BUDI_ID, name: "Budi" };
const at = (hour: number) => `2026-01-01T0${hour}:00:00.000Z`;
const counts = (c: Partial<Record<"submitted" | "accepted" | "rejected" | "duplicate" | "withdrawn", number>> = {}) => ({
  submitted: c.submitted ?? 0,
  accepted: c.accepted ?? 0,
  rejected: c.rejected ?? 0,
  duplicate: c.duplicate ?? 0,
  withdrawn: c.withdrawn ?? 0,
});

const cycleContent = {
  title: "Uji rilis",
  summary: "Coba alur checkout dan laporkan bug.",
  links: [{ url: "https://app.example.com", label: "Aplikasi web" }],
  instructions: "Coba **checkout**",
  inScope: "Checkout",
  outOfScope: "Serangan DoS",
  environments: ["Chrome desktop"],
  appVersion: "v1.0.1",
  endsAt: null,
};

/** TeamCycleDto CY-1 terbuka dari `crowdSeeded`. */
const teamCycle = {
  id: CYCLE_ID,
  number: 1,
  ...cycleContent,
  status: "open",
  effectiveStatus: "open",
  openedAt: at(0),
  closedAt: null,
  createdAt: at(0),
  updatedAt: at(0),
  version: 1,
  participants: 1,
  reportCounts: counts({ submitted: 1 }),
};

const reportContent = {
  id: CROWD_REPORT_ID,
  number: 1,
  title: "Tombol bayar error",
  steps: "1. Buka keranjang\n2. Klik Bayar",
  expected: "Halaman pembayaran terbuka",
  actual: "Layar putih",
  environment: "Chrome 130",
  suggestedSeverity: "major",
  links: [],
  status: "submitted",
  finalSeverity: null,
  points: 0,
  rejectReason: null,
  triageNote: null,
  submittedAt: at(2),
  updatedAt: at(2),
  triagedAt: null,
  version: 1,
  // Id event bigserial tidak ikut di-reset antar interaksi, jadi hanya bentuknya yang dikunci.
  events: [{ id: like("1"), actor: tini, fromStatus: null, toStatus: "submitted", detail: null, createdAt: at(2) }],
};

/** CrowdReportDto CR-1 (sisi pelapor) dari `crowdSeeded`. */
const myReport = { ...reportContent, cycle: { id: CYCLE_ID, title: "Uji rilis" }, duplicateOf: null };

/** TeamCrowdReportDto CR-1 (sisi tim) dari `crowdSeeded`. */
const teamReport = {
  ...reportContent,
  cycle: { number: 1, title: "Uji rilis" },
  reporter: tini,
  hideFromKnownIssues: false,
  triagedBy: null,
  bug: null,
  duplicateOf: null,
  nextSubmittedNumber: null,
};

const reportListItem = {
  id: CROWD_REPORT_ID,
  number: 1,
  title: "Tombol bayar error",
  status: "submitted",
  suggestedSeverity: "major",
  finalSeverity: null,
  points: 0,
  submittedAt: at(2),
};

const tiniComment = { id: CROWD_COMMENT_ID, author: tini, body: "Bisa saya kirim video", createdAt: at(3), deletedAt: null };

/** Leaderboard setelah `crowdAccepted`: Tini satu laporan major diterima (+3). */
const acceptedBoard = { entries: [{ rank: 1, user: tini, points: 3, accepted: 1 }], me: null };

const reportBody = {
  title: "Checkout macet",
  steps: "1. Klik bayar",
  expected: "Berhasil",
  actual: "Gagal",
  environment: "Firefox 130",
  suggestedSeverity: "minor" as const,
};

describe("kontrak crowdtesting: API publik", () => {
  it("GET /crowd/cycles mengembalikan direktori cycle terbuka (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.crowdSeeded)
      .uponReceiving("direktori cycle crowdtesting")
      .withRequest("GET", `${CROWD}/cycles`)
      .willRespondWith(200, (b) =>
        b.jsonBody({
          items: [
            {
              id: CYCLE_ID,
              title: "Uji rilis",
              summary: cycleContent.summary,
              project: { name: "Pact Project", slug: null },
              status: "open",
              endsAt: null,
              openedAt: at(0),
              participants: 1,
              accepted: 0,
            },
          ],
          nextCursor: null,
        }),
      )
      .executeTest(async (server) => {
        const page = await clientFor(server).crowd.directory();
        expect(page.items).toMatchObject([{ id: CYCLE_ID, project: { slug: null } }]);
      });
  });

  it("GET /crowd/cycles/:id mengembalikan isi cycle untuk anonim (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.crowdSeeded)
      .uponReceiving("cycle publik untuk anonim")
      .withRequest("GET", `${CROWD}/cycles/${CYCLE_ID}`)
      .willRespondWith(200, (b) =>
        b.jsonBody({
          id: CYCLE_ID,
          ...cycleContent,
          status: "open",
          openedAt: at(0),
          project: { name: "Pact Project", slug: null },
          stats: { participants: 1, accepted: 0 },
          me: { state: "anonymous", participantStatus: null },
        }),
      )
      .executeTest(async (server) => {
        const cycle = await clientFor(server).crowd.cycle(CYCLE_ID);
        expect(cycle.me.state).toBe("anonymous");
      });
  });

  it("POST /crowd/cycles/:id/join membuat pengguna login menjadi peserta (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("ikut cycle")
      .withRequest("POST", `${CROWD}/cycles/${CYCLE_ID}/join`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ acceptRules: true }))
      .willRespondWith(200, (b) => b.jsonBody({ state: "joined", participantStatus: "active" }))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).crowd.join(CYCLE_ID)).resolves.toEqual({ state: "joined", participantStatus: "active" });
      });
  });

  it("POST /crowd/cycles/:id/join sebagai anggota project -> 403 MEMBER_CANNOT_JOIN", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("anggota project mencoba ikut cycle")
      .withRequest("POST", `${CROWD}/cycles/${CYCLE_ID}/join`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ acceptRules: true }))
      .willRespondWith(403, (b) => b.jsonBody(errorBody("MEMBER_CANNOT_JOIN", "Anggota project tidak bisa ikut cycle project sendiri")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).crowd.join(CYCLE_ID)).rejects.toMatchObject({ status: 403, code: "MEMBER_CANNOT_JOIN" });
      });
  });

  it("POST /crowd/cycles/:id/join setelah dikeluarkan -> 403 PARTICIPANT_REMOVED", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.tiniRemoved)
      .uponReceiving("peserta yang dikeluarkan mencoba ikut lagi")
      .withRequest("POST", `${CROWD}/cycles/${CYCLE_ID}/join`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ acceptRules: true }))
      .willRespondWith(403, (b) => b.jsonBody(errorBody("PARTICIPANT_REMOVED", "Anda telah dikeluarkan dari cycle ini")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).crowd.join(CYCLE_ID)).rejects.toMatchObject({ status: 403, code: "PARTICIPANT_REMOVED" });
      });
  });

  it("DELETE /crowd/cycles/:id/join keluar dari cycle (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("keluar dari cycle")
      .withRequest("DELETE", `${CROWD}/cycles/${CYCLE_ID}/join`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).crowd.leave(CYCLE_ID)).resolves.toBeUndefined();
      });
  });

  it("GET /crowd/cycles/:id/known-issues mengembalikan laporan diterima (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.crowdAccepted)
      .uponReceiving("daftar masalah diketahui")
      .withRequest("GET", `${CROWD}/cycles/${CYCLE_ID}/known-issues`)
      .willRespondWith(200, (b) =>
        b.jsonBody({ items: [{ title: "Tombol bayar error", severity: "major", acceptedAt: dateTime() }], nextCursor: null }),
      )
      .executeTest(async (server) => {
        const page = await clientFor(server).crowd.knownIssues(CYCLE_ID);
        expect(page.items).toMatchObject([{ title: "Tombol bayar error" }]);
      });
  });

  it("GET /crowd/cycles/:id/leaderboard mengembalikan peringkat cycle (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.crowdAccepted)
      .uponReceiving("leaderboard cycle publik")
      .withRequest("GET", `${CROWD}/cycles/${CYCLE_ID}/leaderboard`)
      .willRespondWith(200, (b) => b.jsonBody(acceptedBoard))
      .executeTest(async (server) => {
        await expect(clientFor(server).crowd.leaderboard(CYCLE_ID)).resolves.toEqual(acceptedBoard);
      });
  });

  it("GET /crowd/leaderboard mengembalikan leaderboard global (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.crowdAccepted)
      .uponReceiving("leaderboard global")
      .withRequest("GET", `${CROWD}/leaderboard`)
      .willRespondWith(200, (b) => b.jsonBody(acceptedBoard))
      .executeTest(async (server) => {
        await expect(clientFor(server).crowd.globalLeaderboard()).resolves.toEqual(acceptedBoard);
      });
  });

  it("GET /crowd/testers/:userId mengembalikan profil tester tanpa email (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.crowdAccepted)
      .uponReceiving("profil tester")
      .withRequest("GET", `${CROWD}/testers/${TINI_ID}`)
      .willRespondWith(200, (b) =>
        b.jsonBody({
          user: tini,
          points: 3,
          acceptanceRate: 1,
          cycles: 1,
          recentAccepted: [{ title: "Tombol bayar error", severity: "major", cycle: { id: CYCLE_ID, title: "Uji rilis" }, acceptedAt: dateTime() }],
        }),
      )
      .executeTest(async (server) => {
        const profile = await clientFor(server).crowd.tester(TINI_ID);
        expect(profile).toMatchObject({ user: tini, points: 3 });
        expect(profile).not.toHaveProperty("user.email");
      });
  });

  it("GET /crowd/me mengembalikan ringkasan peserta (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("ringkasan crowdtesting saya")
      .withRequest("GET", `${CROWD}/me`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          cycles: [{ cycle: { id: CYCLE_ID, title: "Uji rilis", status: "open" }, status: "active", reportCounts: counts({ submitted: 1 }), points: 0 }],
          points: 0,
          acceptanceRate: null,
        }),
      )
      .executeTest(async (server) => {
        const me = await clientFor(server, true).crowd.me();
        expect(me.cycles).toHaveLength(1);
      });
  });

  it("GET /crowd/cycles/:id/reports mengembalikan laporan saya di cycle (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("laporan saya di cycle")
      .withRequest("GET", `${CROWD}/cycles/${CYCLE_ID}/reports`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody({ items: [reportListItem] }))
      .executeTest(async (server) => {
        const mine = await clientFor(server, true).crowd.myReports(CYCLE_ID);
        expect(mine.items.map((r) => r.id)).toEqual([CROWD_REPORT_ID]);
      });
  });

  it("POST /crowd/cycles/:id/reports mengirim laporan baru (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("mengirim laporan crowd")
      .withRequest("POST", `${CROWD}/cycles/${CYCLE_ID}/reports`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody(reportBody))
      .willRespondWith(201, (b) =>
        b.jsonBody({
          id: uuidLike("20202020-2020-4020-8020-202020202020"),
          number: 2,
          ...reportBody,
          links: [],
          status: "submitted",
          finalSeverity: null,
          points: 0,
          submittedAt: dateTime(),
          version: 1,
          cycle: { id: CYCLE_ID, title: "Uji rilis" },
          duplicateOf: null,
        }),
      )
      .executeTest(async (server) => {
        const report = await clientFor(server, true).crowd.submitReport(CYCLE_ID, reportBody);
        expect(report).toMatchObject({ number: 2, status: "submitted" });
      });
  });

  it("POST /crowd/cycles/:id/reports di cycle yang ditutup -> 409 CYCLE_NOT_OPEN", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.crowdClosed)
      .uponReceiving("mengirim laporan ke cycle yang ditutup")
      .withRequest("POST", `${CROWD}/cycles/${CYCLE_ID}/reports`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody(reportBody))
      .willRespondWith(409, (b) => b.jsonBody(errorBody("CYCLE_NOT_OPEN", "Cycle sudah ditutup")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).crowd.submitReport(CYCLE_ID, reportBody)).rejects.toMatchObject({ status: 409, code: "CYCLE_NOT_OPEN" });
      });
  });

  it("POST /crowd/cycles/:id/reports ke-11 yang menunggu triase -> 429 RATE_LIMITED", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.tiniAtLimit)
      .uponReceiving("mengirim laporan melewati batas menunggu triase")
      .withRequest("POST", `${CROWD}/cycles/${CYCLE_ID}/reports`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody(reportBody))
      .willRespondWith(429, (b) => b.jsonBody(errorBody("RATE_LIMITED", "Anda sudah punya 10 laporan yang menunggu triase")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).crowd.submitReport(CYCLE_ID, reportBody)).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
      });
  });

  it("GET /crowd/reports/:id mengembalikan laporan pelapor (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("laporan saya")
      .withRequest("GET", `${CROWD}/reports/${CROWD_REPORT_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(myReport))
      .executeTest(async (server) => {
        const report = await clientFor(server, true).crowd.report(CROWD_REPORT_ID);
        expect(report).toMatchObject({ id: CROWD_REPORT_ID, status: "submitted" });
      });
  });

  it("GET /crowd/reports/:id milik orang lain -> 404 REPORT_NOT_FOUND", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("membuka laporan crowd milik orang lain")
      .withRequest("GET", `${CROWD}/reports/${CROWD_REPORT_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(404, (b) => b.jsonBody(errorBody("REPORT_NOT_FOUND", "Laporan tidak ditemukan")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).crowd.report(CROWD_REPORT_ID)).rejects.toMatchObject({ status: 404, code: "REPORT_NOT_FOUND" });
      });
  });

  it("PATCH /crowd/reports/:id mengubah laporan sendiri (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("mengubah laporan sendiri")
      .withRequest("PATCH", `${CROWD}/reports/${CROWD_REPORT_ID}`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 1, title: "Tombol bayar error di Safari" }),
      )
      .willRespondWith(200, (b) => b.jsonBody({ id: CROWD_REPORT_ID, title: "Tombol bayar error di Safari", status: "submitted", version: 2, updatedAt: dateTime() }))
      .executeTest(async (server) => {
        const report = await clientFor(server, true).crowd.updateReport(CROWD_REPORT_ID, { version: 1, title: "Tombol bayar error di Safari" });
        expect(report.version).toBe(2);
      });
  });

  it("DELETE /crowd/reports/:id menarik laporan sendiri (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("menarik laporan sendiri")
      .withRequest("DELETE", `${CROWD}/reports/${CROWD_REPORT_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody({ id: CROWD_REPORT_ID, status: "withdrawn", version: 2 }))
      .executeTest(async (server) => {
        const report = await clientFor(server, true).crowd.withdrawReport(CROWD_REPORT_ID);
        expect(report.status).toBe("withdrawn");
      });
  });

  it("GET /crowd/reports/:id/comments mengembalikan thread laporan (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("komentar laporan sisi pelapor")
      .withRequest("GET", `${CROWD}/reports/${CROWD_REPORT_ID}/comments`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody({ items: [tiniComment], nextCursor: null }))
      .executeTest(async (server) => {
        const page = await clientFor(server, true).crowd.comments(CROWD_REPORT_ID);
        expect(page.items.map((c) => c.id)).toEqual([CROWD_COMMENT_ID]);
      });
  });

  it("POST /crowd/reports/:id/comments menambah komentar pelapor (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("komentar baru dari pelapor")
      .withRequest("POST", `${CROWD}/reports/${CROWD_REPORT_ID}/comments`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ body: "Video terlampir" }))
      .willRespondWith(201, (b) =>
        b.jsonBody({ id: uuidLike("21212121-2121-4121-8121-212121212121"), author: tini, body: "Video terlampir", createdAt: dateTime(), deletedAt: null }),
      )
      .executeTest(async (server) => {
        const comment = await clientFor(server, true).crowd.addComment(CROWD_REPORT_ID, { body: "Video terlampir" });
        expect(comment.body).toBe("Video terlampir");
      });
  });

  it("DELETE /crowd/reports/:id/comments/:commentId menghapus komentar sendiri (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.tiniLoggedIn)
      .given(STATE.crowdSeeded)
      .uponReceiving("pelapor menghapus komentarnya")
      .withRequest("DELETE", `${CROWD}/reports/${CROWD_REPORT_ID}/comments/${CROWD_COMMENT_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).crowd.deleteComment(CROWD_REPORT_ID, CROWD_COMMENT_ID)).resolves.toBeUndefined();
      });
  });
});

describe("kontrak crowdtesting: API tim", () => {
  it("GET /projects/:slug/cycles mengembalikan daftar cycle (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("daftar cycle tim")
      .withRequest("GET", `${BASE}/cycles`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody({ items: [teamCycle], nextCursor: null }))
      .executeTest(async (server) => {
        const page = await clientFor(server, true).cycles.list(PROJECT_SLUG);
        expect(page.items).toMatchObject([{ number: 1, effectiveStatus: "open" }]);
      });
  });

  it("GET /projects/:slug/cycles/:number mengembalikan detail cycle (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("detail cycle tim")
      .withRequest("GET", `${BASE}/cycles/1`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(teamCycle))
      .executeTest(async (server) => {
        const cycle = await clientFor(server, true).cycles.get(PROJECT_SLUG, 1);
        expect(cycle.reportCounts.submitted).toBe(1);
      });
  });

  it("POST /projects/:slug/cycles membuat cycle draf (201)", async () => {
    const body = { title: "Uji baru", links: [{ url: "https://staging.example.com", label: "Staging" }] };
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .uponReceiving("membuat cycle")
      .withRequest("POST", `${BASE}/cycles`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody(body))
      .willRespondWith(201, (b) =>
        b.jsonBody({
          id: uuidLike("22222222-2222-4222-8222-000000000001"),
          number: 1,
          title: "Uji baru",
          summary: "",
          links: body.links,
          instructions: "",
          inScope: "",
          outOfScope: "",
          environments: [],
          appVersion: null,
          endsAt: null,
          status: "draft",
          effectiveStatus: "draft",
          openedAt: null,
          closedAt: null,
          createdAt: dateTime(),
          updatedAt: dateTime(),
          version: 1,
          participants: 0,
          reportCounts: counts(),
        }),
      )
      .executeTest(async (server) => {
        const cycle = await clientFor(server, true).cycles.create(PROJECT_SLUG, body);
        expect(cycle).toMatchObject({ number: 1, status: "draft" });
      });
  });

  it("PATCH /projects/:slug/cycles/:number membuka cycle draf (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdDraft)
      .uponReceiving("membuka cycle draf")
      .withRequest("PATCH", `${BASE}/cycles/1`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 1, status: "open" }))
      .willRespondWith(200, (b) =>
        b.jsonBody({ id: CYCLE_ID, number: 1, status: "open", effectiveStatus: "open", openedAt: dateTime(), version: 2, participants: 0 }),
      )
      .executeTest(async (server) => {
        const cycle = await clientFor(server, true).cycles.update(PROJECT_SLUG, 1, { version: 1, status: "open" });
        expect(cycle.status).toBe("open");
      });
  });

  it("DELETE /projects/:slug/cycles/:number menghapus cycle tanpa laporan (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdDraft)
      .uponReceiving("menghapus cycle tanpa laporan")
      .withRequest("DELETE", `${BASE}/cycles/1`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).cycles.remove(PROJECT_SLUG, 1)).resolves.toBeUndefined();
      });
  });

  it("DELETE /projects/:slug/cycles/:number yang punya laporan -> 409 CYCLE_HAS_REPORTS", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("menghapus cycle yang punya laporan")
      .withRequest("DELETE", `${BASE}/cycles/1`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(409, (b) => b.jsonBody(errorBody("CYCLE_HAS_REPORTS", "Cycle yang sudah punya laporan tidak bisa dihapus")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).cycles.remove(PROJECT_SLUG, 1)).rejects.toMatchObject({ status: 409, code: "CYCLE_HAS_REPORTS" });
      });
  });

  it("GET /projects/:slug/cycles/:number/participants mengembalikan peserta tanpa email (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("daftar peserta cycle")
      .withRequest("GET", `${BASE}/cycles/1/participants`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) =>
        b.jsonBody({ items: [{ user: tini, status: "active", joinedAt: at(1), reportCounts: counts({ submitted: 1 }) }], nextCursor: null }),
      )
      .executeTest(async (server) => {
        const page = await clientFor(server, true).cycles.participants(PROJECT_SLUG, 1);
        expect(page.items[0]?.user).toEqual(tini);
      });
  });

  it("POST /projects/:slug/cycles/:number/participants/:userId/remove mengeluarkan peserta (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("mengeluarkan peserta")
      .withRequest("POST", `${BASE}/cycles/1/participants/${TINI_ID}/remove`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ reason: "Spam" }))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).cycles.removeParticipant(PROJECT_SLUG, 1, TINI_ID, { reason: "Spam" })).resolves.toBeUndefined();
      });
  });

  it("GET /projects/:slug/cycles/:number/reports mengembalikan antrian triase (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("antrian triase")
      .withRequest("GET", `${BASE}/cycles/1/reports`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody({ items: [{ ...reportListItem, reporter: tini }], nextCursor: null }))
      .executeTest(async (server) => {
        const page = await clientFor(server, true).cycles.reports(PROJECT_SLUG, 1);
        expect(page.items.map((r) => r.number)).toEqual([1]);
      });
  });

  it("GET /projects/:slug/cycles/:number/leaderboard mengembalikan peringkat cycle (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdAccepted)
      .uponReceiving("leaderboard cycle tim")
      .withRequest("GET", `${BASE}/cycles/1/leaderboard`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(acceptedBoard))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).cycles.leaderboard(PROJECT_SLUG, 1)).resolves.toEqual(acceptedBoard);
      });
  });

  it("GET /projects/:slug/crowd/summary mengembalikan ringkasan dashboard (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("ringkasan crowdtesting dashboard")
      .withRequest("GET", `${BASE}/crowd/summary`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody({ openCycles: 1, awaitingTriage: 1, accepted30d: 0 }))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).cycles.summary(PROJECT_SLUG)).resolves.toEqual({ openCycles: 1, awaitingTriage: 1, accepted30d: 0 });
      });
  });

  it("GET /projects/:slug/crowd-reports/:number mengembalikan laporan untuk triase (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("laporan crowd untuk triase")
      .withRequest("GET", `${BASE}/crowd-reports/1`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody(teamReport))
      .executeTest(async (server) => {
        const report = await clientFor(server, true).crowdReports.get(PROJECT_SLUG, 1);
        expect(report.reporter).toEqual(tini);
      });
  });

  it("POST /projects/:slug/crowd-reports/:number/triage menerima laporan menjadi bug (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("menerima laporan crowd")
      .withRequest("POST", `${BASE}/crowd-reports/1/triage`, (b) =>
        b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 1, decision: "accept", severity: "critical", priority: "high" }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          id: CROWD_REPORT_ID,
          number: 1,
          status: "accepted",
          finalSeverity: "critical",
          points: 5,
          triagedBy: budi,
          triagedAt: dateTime(),
          version: 2,
          bug: { number: 1, title: "Tombol bayar error", status: "open" },
          nextSubmittedNumber: null,
        }),
      )
      .executeTest(async (server) => {
        const report = await clientFor(server, true).crowdReports.triage(PROJECT_SLUG, 1, {
          version: 1,
          decision: "accept",
          severity: "critical",
          priority: "high",
        });
        expect(report.bug?.number).toBe(1);
      });
  });

  it("POST /projects/:slug/crowd-reports/:number/triage dengan versi lama -> 409 REPORT_CONFLICT", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("triase dengan versi laporan lama")
      .withRequest("POST", `${BASE}/crowd-reports/1/triage`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 2, decision: "accept" }))
      .willRespondWith(409, (b) => b.jsonBody(errorBody("REPORT_CONFLICT", "Laporan ini baru saja diubah")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).crowdReports.triage(PROJECT_SLUG, 1, { version: 2, decision: "accept" })).rejects.toMatchObject({
          status: 409,
          code: "REPORT_CONFLICT",
        });
      });
  });

  it("POST /projects/:slug/crowd-reports/:number/triage mengembalikan laporan diterima -> 409 INVALID_TRIAGE", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdAccepted)
      .uponReceiving("mengembalikan laporan yang sudah diterima")
      .withRequest("POST", `${BASE}/crowd-reports/1/triage`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 2, decision: "reopen" }))
      .willRespondWith(409, (b) => b.jsonBody(errorBody("INVALID_TRIAGE", "Keputusan ini tidak berlaku untuk status laporan sekarang")))
      .executeTest(async (server) => {
        await expect(clientFor(server, true).crowdReports.triage(PROJECT_SLUG, 1, { version: 2, decision: "reopen" })).rejects.toMatchObject({
          status: 409,
          code: "INVALID_TRIAGE",
        });
      });
  });

  it("PATCH /projects/:slug/crowd-reports/:number menyembunyikan laporan dari masalah diketahui (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdAccepted)
      .uponReceiving("menyembunyikan laporan diterima")
      .withRequest("PATCH", `${BASE}/crowd-reports/1`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ version: 2, hideFromKnownIssues: true }))
      .willRespondWith(200, (b) => b.jsonBody({ id: CROWD_REPORT_ID, status: "accepted", hideFromKnownIssues: true, version: 3 }))
      .executeTest(async (server) => {
        const report = await clientFor(server, true).crowdReports.setHidden(PROJECT_SLUG, 1, { version: 2, hideFromKnownIssues: true });
        expect(report.hideFromKnownIssues).toBe(true);
      });
  });

  it("GET /projects/:slug/crowd-reports/:number/comments mengembalikan thread laporan (200)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("komentar laporan sisi tim")
      .withRequest("GET", `${BASE}/crowd-reports/1/comments`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(200, (b) => b.jsonBody({ items: [tiniComment], nextCursor: null }))
      .executeTest(async (server) => {
        const page = await clientFor(server, true).crowdReports.comments(PROJECT_SLUG, 1);
        expect(page.items).toHaveLength(1);
      });
  });

  it("POST /projects/:slug/crowd-reports/:number/comments menambah komentar tim (201)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .uponReceiving("komentar baru dari tim")
      .withRequest("POST", `${BASE}/crowd-reports/1/comments`, (b) => b.headers(JSON_COOKIE_HEADERS).jsonBody({ body: "Bisa kirim video?" }))
      .willRespondWith(201, (b) =>
        b.jsonBody({ id: uuidLike("23232323-2323-4323-8323-232323232323"), author: budi, body: "Bisa kirim video?", createdAt: dateTime(), deletedAt: null }),
      )
      .executeTest(async (server) => {
        const comment = await clientFor(server, true).crowdReports.addComment(PROJECT_SLUG, 1, { body: "Bisa kirim video?" });
        expect(comment.author).toEqual(budi);
      });
  });

  it("DELETE /projects/:slug/crowd-reports/:number/comments/:id menghapus komentar tim sendiri (204)", async () => {
    await pact
      .addInteraction()
      .given(STATE.budiAdmin)
      .given(STATE.crowdSeeded)
      .given(STATE.teamComment)
      .uponReceiving("tim menghapus komentarnya")
      .withRequest("DELETE", `${BASE}/crowd-reports/1/comments/${TEAM_COMMENT_ID}`, (b) => b.headers(COOKIE_HEADERS))
      .willRespondWith(204)
      .executeTest(async (server) => {
        await expect(clientFor(server, true).crowdReports.deleteComment(PROJECT_SLUG, 1, TEAM_COMMENT_ID)).resolves.toBeUndefined();
      });
  });
});
