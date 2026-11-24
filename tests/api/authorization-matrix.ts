import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { ErrorCode } from "@testpulse/shared";
import { buildJUnit } from "../support/junit.js";

/**
 * Matriks otorisasi dari spec §7 ("Matriks otorisasi"), sebagai data.
 * `authorization.spec.ts` membangkitkan satu test per (baris × aktor).
 */
export type Actor = "anonymous" | "nonMemberPrivate" | "nonMemberPublic" | "viewer" | "tester" | "admin";

export const ACTORS: readonly Actor[] = ["anonymous", "nonMemberPrivate", "nonMemberPublic", "viewer", "tester", "admin"];

export interface MatrixContext {
  /** Sesi aktor (anonim = tanpa cookie). */
  http: APIRequestContext;
  slug: string;
  /** ID user aktor; untuk anonim berupa UUID acak yang tidak dikenal. */
  actorId: string;
  /** Anggota `tester` lain di project yang sama, dibuat saat pertama diminta. */
  targetMemberId(): Promise<string>;
  /** Undangan aktif di project yang sama, dibuat saat pertama diminta. */
  invitationId(): Promise<string>;
  /** Run di project yang sama (diunggah dengan token CI), dibuat saat pertama diminta. */
  runId(): Promise<string>;
  /** Test case dari run tersebut, dibuat saat pertama diminta. */
  testCaseId(): Promise<string>;
  /** Token CI aktif di project yang sama, dibuat saat pertama diminta. */
  tokenId(): Promise<string>;
  /** Nomor bug (versi 1) di project yang sama, dibuat saat pertama diminta oleh admin project. */
  bugNumber(): Promise<number>;
  /** Komentar pada bug tersebut yang ditulis tester lain (bukan aktor), dibuat saat pertama diminta. */
  commentId(): Promise<string>;
  /** Suite kosong (tanpa case) di project yang sama, dibuat saat pertama diminta; aman untuk DELETE suite. */
  suiteId(): Promise<string>;
  /** Nomor case aktif (TC-n) di project yang sama, dibuat saat pertama diminta. */
  caseNumber(): Promise<number>;
  /** Nomor run manual (TR-n) berisi case di atas, dibuat saat pertama diminta. */
  manualRunNumber(): Promise<number>;
  /** Id run case pertama dari run manual tersebut, dibuat saat pertama diminta. */
  runCaseId(): Promise<string>;
  /** Cycle crowd terbuka (CY-n) dengan satu peserta luar dan satu laporan `submitted`, dibuat saat pertama diminta. */
  cycle(): Promise<{ number: number; version: number }>;
  /** Laporan `submitted` (CR-n, versi 1) dari peserta luar di cycle tersebut. */
  crowdReportNumber(): Promise<number>;
  /** Laporan lain di cycle yang sama yang sudah diterima admin; `version` = versi terbarunya. */
  acceptedReport(): Promise<{ number: number; version: number }>;
  /** Id user peserta luar cycle tersebut (bukan anggota project). */
  participantId(): Promise<string>;
  /** Cycle terbuka lain tanpa laporan (aman untuk DELETE cycle). */
  emptyCycleNumber(): Promise<number>;
}

export interface MatrixRow {
  /** Nama endpoint untuk judul test. */
  name: string;
  /** Baris tabel §7 yang dicakup (satu baris tabel dapat memuat beberapa method). */
  specRow: string;
  request: (ctx: MatrixContext) => Promise<APIResponse>;
  /** Status yang diharapkan per aktor; `anonymous` = anonim terhadap project privat. */
  expected: Record<Actor, number>;
  /** Status untuk anonim terhadap project publik; default sama dengan `expected.anonymous`. */
  anonymousOnPublic?: number;
  /** Kode error yang diharapkan jika menyimpang dari kode bawaan status (401, 403, 404, 409). */
  errorCodes?: Partial<Record<Actor, ErrorCode>>;
  /**
   * Token CI yang valid hanya diterima di endpoint upload; di semua endpoint lain Bearer diabaikan sehingga
   * pembawanya diperlakukan anonim (spec §7.1). Default `true`; `false` hanya untuk endpoint upload itu sendiri.
   */
  bearerIgnored?: boolean;
}

/** Kode error bawaan untuk status non-2xx pada matriks. */
export const DEFAULT_ERROR_CODE: Record<number, ErrorCode> = {
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "PROJECT_NOT_FOUND",
  409: "LAST_ADMIN",
};

const P = "/api/v1/projects";

/** Laporan JUnit sah minimal untuk baris upload. */
const SAMPLE_REPORT = buildJUnit([{ name: "lulus" }]);

/** Aturan yang sama untuk semua endpoint yang hanya boleh dikelola admin. */
function adminOnly(adminStatus: number): Record<Actor, number> {
  return {
    anonymous: 401,
    nonMemberPrivate: 404,
    nonMemberPublic: 403,
    viewer: 403,
    tester: 403,
    admin: adminStatus,
  };
}

export const MATRIX: MatrixRow[] = [
  // Baris 1: GET project
  {
    name: "GET project",
    specRow: "GET project",
    request: ({ http, slug }) => http.get(`${P}/${slug}`),
    expected: { anonymous: 404, nonMemberPrivate: 404, nonMemberPublic: 200, viewer: 200, tester: 200, admin: 200 },
    anonymousOnPublic: 200,
  },
  // Baris 2: GET members
  {
    name: "GET members",
    specRow: "GET members",
    request: ({ http, slug }) => http.get(`${P}/${slug}/members`),
    expected: { anonymous: 401, nonMemberPrivate: 404, nonMemberPublic: 403, viewer: 200, tester: 200, admin: 200 },
  },
  // Baris 3: PATCH / DELETE project
  {
    name: "PATCH project",
    specRow: "PATCH / DELETE project",
    request: ({ http, slug }) => http.patch(`${P}/${slug}`, { data: { name: "Nama Baru" } }),
    expected: adminOnly(200),
  },
  {
    name: "DELETE project",
    specRow: "PATCH / DELETE project",
    request: ({ http, slug }) => http.delete(`${P}/${slug}`, { data: { confirmSlug: slug } }),
    expected: adminOnly(204),
  },
  // Baris 4: PATCH member role
  {
    name: "PATCH member role",
    specRow: "PATCH member role",
    request: async (ctx) =>
      ctx.http.patch(`${P}/${ctx.slug}/members/${await ctx.targetMemberId()}`, { data: { role: "viewer" } }),
    expected: adminOnly(200),
  },
  // Baris 5: DELETE member (orang lain)
  {
    name: "DELETE member (orang lain)",
    specRow: "DELETE member (orang lain)",
    request: async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/members/${await ctx.targetMemberId()}`),
    expected: adminOnly(204),
  },
  // Baris 6: DELETE member (diri sendiri). Admin di sini admin satu-satunya, sehingga 409 LAST_ADMIN.
  {
    name: "DELETE member (diri sendiri)",
    specRow: "DELETE member (diri sendiri)",
    request: ({ http, slug, actorId }) => http.delete(`${P}/${slug}/members/${actorId}`),
    expected: { anonymous: 401, nonMemberPrivate: 404, nonMemberPublic: 404, viewer: 204, tester: 204, admin: 409 },
    errorCodes: { nonMemberPublic: "MEMBER_NOT_FOUND" },
  },
  // Baris 7: GET / POST / DELETE invitations
  {
    name: "GET invitations",
    specRow: "GET / POST / DELETE invitations",
    request: ({ http, slug }) => http.get(`${P}/${slug}/invitations`),
    expected: adminOnly(200),
  },
  {
    name: "POST invitations",
    specRow: "GET / POST / DELETE invitations",
    request: ({ http, slug }) => http.post(`${P}/${slug}/invitations`, { data: { role: "viewer" } }),
    expected: adminOnly(201),
  },
  {
    name: "DELETE invitations",
    specRow: "GET / POST / DELETE invitations",
    request: async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/invitations/${await ctx.invitationId()}`),
    expected: adminOnly(204),
  },
  // Tahap 2, §7.1 baris 1: baca hasil mengikuti aturan Tahap 1 (publik → siapa saja; privat → minimal viewer, selain itu 404).
  ...readRows(),
  // Tahap 2, §7.1 baris 2: hapus run = tester+.
  {
    name: "DELETE run",
    specRow: "DELETE run",
    request: async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/runs/${await ctx.runId()}`),
    expected: { anonymous: 401, nonMemberPrivate: 404, nonMemberPublic: 403, viewer: 403, tester: 204, admin: 204 },
  },
  // Tahap 2, §7.1 baris 3: CRUD token = admin.
  {
    name: "GET tokens",
    specRow: "GET/POST/DELETE tokens",
    request: ({ http, slug }) => http.get(`${P}/${slug}/tokens`),
    expected: adminOnly(200),
  },
  {
    name: "POST tokens",
    specRow: "GET/POST/DELETE tokens",
    request: ({ http, slug }) => http.post(`${P}/${slug}/tokens`, { data: { name: "Token baru" } }),
    expected: adminOnly(201),
  },
  {
    name: "DELETE tokens",
    specRow: "GET/POST/DELETE tokens",
    request: async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/tokens/${await ctx.tokenId()}`),
    expected: adminOnly(204),
  },
  // Tahap 3, §6.3: bug, label, aktivitas, versi, dan perbandingan.
  ...bugReadRows(),
  ...bugWriteRows(),
  // Tahap 4, §7.1: test manual (suite, case, run manual, run case).
  ...manualReadRows(),
  ...manualWriteRows(),
  // Tahap 5, §8.4: API tim crowdtesting.
  ...crowdTeamRows(),
  // Tahap 2, §7.1 baris 4: cookie sesi tanpa token tidak berlaku di endpoint upload, apa pun role-nya.
  {
    name: "POST runs dengan cookie sesi (tanpa token)",
    specRow: "POST runs dengan cookie sesi (tanpa token)",
    request: ({ http, slug }) =>
      http.post(`${P}/${slug}/runs?branch=main`, { headers: { "content-type": "application/xml" }, data: SAMPLE_REPORT }),
    expected: { anonymous: 401, nonMemberPrivate: 401, nonMemberPublic: 401, viewer: 401, tester: 401, admin: 401 },
    bearerIgnored: false,
  },
];

/** Endpoint baca hasil: sama untuk semua, jadi dibangkitkan dari daftar path. */
function readRows(): MatrixRow[] {
  const read: Record<Actor, number> = {
    anonymous: 404,
    nonMemberPrivate: 404,
    nonMemberPublic: 200,
    viewer: 200,
    tester: 200,
    admin: 200,
  };
  const endpoints: Array<{ name: string; path: (ctx: MatrixContext) => Promise<string> | string }> = [
    { name: "GET branches", path: ({ slug }) => `${P}/${slug}/branches` },
    { name: "GET runs", path: ({ slug }) => `${P}/${slug}/runs` },
    { name: "GET run", path: async (ctx) => `${P}/${ctx.slug}/runs/${await ctx.runId()}?status=all` },
    { name: "GET stats", path: ({ slug }) => `${P}/${slug}/stats` },
    { name: "GET flaky", path: ({ slug }) => `${P}/${slug}/flaky` },
    { name: "GET test history", path: async (ctx) => `${P}/${ctx.slug}/tests/${await ctx.testCaseId()}/history` },
  ];
  return endpoints.map(({ name, path }) => ({
    name,
    specRow: "GET branches/runs/run/stats/flaky/history",
    request: async (ctx) => ctx.http.get(await path(ctx)),
    expected: read,
    anonymousOnPublic: 200,
  }));
}

/** Tahap 3 §6.3 baris 1: baca bug/label/aktivitas/versi/perbandingan mengikuti aturan baca project (token CI = anonim). */
function bugReadRows(): MatrixRow[] {
  const read: Record<Actor, number> = {
    anonymous: 404,
    nonMemberPrivate: 404,
    nonMemberPublic: 200,
    viewer: 200,
    tester: 200,
    admin: 200,
  };
  const endpoints: Array<{ name: string; path: (ctx: MatrixContext) => Promise<string> | string }> = [
    { name: "GET bugs", path: ({ slug }) => `${P}/${slug}/bugs` },
    { name: "GET bugs/labels", path: ({ slug }) => `${P}/${slug}/bugs/labels` },
    { name: "GET bug", path: async (ctx) => `${P}/${ctx.slug}/bugs/${await ctx.bugNumber()}` },
    { name: "GET bug activity", path: async (ctx) => `${P}/${ctx.slug}/bugs/${await ctx.bugNumber()}/activity` },
    { name: "GET versions", path: ({ slug }) => `${P}/${slug}/versions` },
    { name: "GET compare", path: async (ctx) => `${P}/${ctx.slug}/compare?target=${await ctx.runId()}` },
    { name: "GET compare (groups=none)", path: ({ slug }) => `${P}/${slug}/compare?groups=none` },
  ];
  return endpoints.map(({ name, path }) => ({
    name,
    specRow: "GET bug, label, activity, versions, compare",
    request: async (ctx) => ctx.http.get(await path(ctx)),
    expected: read,
    anonymousOnPublic: 200,
  }));
}

/** Tahap 3 §6.3 baris 2–5: tulis bug/komentar = tester+, hapus bug = admin, komentar orang lain. */
function bugWriteRows(): MatrixRow[] {
  const testerPlus = (status: number): Record<Actor, number> => ({
    anonymous: 401,
    nonMemberPrivate: 404,
    nonMemberPublic: 403,
    viewer: 403,
    tester: status,
    admin: status,
  });
  return [
    {
      name: "POST bug",
      specRow: "POST bug, PATCH bug, POST komentar",
      request: ({ http, slug }) => http.post(`${P}/${slug}/bugs`, { data: { title: "Bug dari matriks" } }),
      expected: testerPlus(201),
    },
    {
      name: "PATCH bug",
      specRow: "POST bug, PATCH bug, POST komentar",
      request: async (ctx) =>
        ctx.http.patch(`${P}/${ctx.slug}/bugs/${await ctx.bugNumber()}`, { data: { version: 1, priority: "high" } }),
      expected: testerPlus(200),
    },
    {
      name: "POST komentar",
      specRow: "POST bug, PATCH bug, POST komentar",
      request: async (ctx) =>
        ctx.http.post(`${P}/${ctx.slug}/bugs/${await ctx.bugNumber()}/comments`, { data: { body: "Komentar matriks" } }),
      expected: testerPlus(201),
    },
    {
      name: "DELETE bug",
      specRow: "DELETE bug",
      request: async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/bugs/${await ctx.bugNumber()}`),
      expected: adminOnly(204),
    },
    // Hanya penulis yang boleh mengubah komentar: admin pun 403.
    {
      name: "PATCH komentar orang lain",
      specRow: "PATCH komentar orang lain",
      request: async (ctx) =>
        ctx.http.patch(`${P}/${ctx.slug}/bugs/${await ctx.bugNumber()}/comments/${await ctx.commentId()}`, {
          data: { body: "Diubah orang lain" },
        }),
      expected: { anonymous: 401, nonMemberPrivate: 404, nonMemberPublic: 403, viewer: 403, tester: 403, admin: 403 },
    },
    // Admin boleh menghapus komentar siapa pun; tester hanya miliknya sendiri.
    {
      name: "DELETE komentar orang lain",
      specRow: "DELETE komentar orang lain",
      request: async (ctx) =>
        ctx.http.delete(`${P}/${ctx.slug}/bugs/${await ctx.bugNumber()}/comments/${await ctx.commentId()}`),
      expected: adminOnly(204),
    },
  ];
}

/** Tahap 4 §7.1 baris 1: semua `GET` baru mengikuti aturan baca project (token CI = anonim). */
function manualReadRows(): MatrixRow[] {
  const read: Record<Actor, number> = {
    anonymous: 404,
    nonMemberPrivate: 404,
    nonMemberPublic: 200,
    viewer: 200,
    tester: 200,
    admin: 200,
  };
  const endpoints: Array<{ name: string; path: (ctx: MatrixContext) => Promise<string> | string }> = [
    { name: "GET suites", path: ({ slug }) => `${P}/${slug}/suites` },
    { name: "GET cases", path: ({ slug }) => `${P}/${slug}/cases` },
    { name: "GET cases/labels", path: ({ slug }) => `${P}/${slug}/cases/labels` },
    { name: "GET case", path: async (ctx) => `${P}/${ctx.slug}/cases/${await ctx.caseNumber()}` },
    { name: "GET tests?q=", path: ({ slug }) => `${P}/${slug}/tests?q=ab` },
    { name: "GET manual-runs", path: ({ slug }) => `${P}/${slug}/manual-runs` },
    { name: "GET manual-run", path: async (ctx) => `${P}/${ctx.slug}/manual-runs/${await ctx.manualRunNumber()}` },
    { name: "GET manual-run cases", path: async (ctx) => `${P}/${ctx.slug}/manual-runs/${await ctx.manualRunNumber()}/cases` },
    {
      name: "GET manual-run case",
      path: async (ctx) => `${P}/${ctx.slug}/manual-runs/${await ctx.manualRunNumber()}/cases/${await ctx.runCaseId()}`,
    },
    { name: "GET manual/summary", path: ({ slug }) => `${P}/${slug}/manual/summary` },
  ];
  return endpoints.map(({ name, path }) => ({
    name,
    specRow: "Semua GET baru",
    request: async (ctx) => ctx.http.get(await path(ctx)),
    expected: read,
    anonymousOnPublic: 200,
  }));
}

/** Tahap 4 §7.1 baris 2–3: tulis suite/case/run/run case = tester+ (2xx), hapus suite/case/run = admin (204). */
function manualWriteRows(): MatrixRow[] {
  const testerPlus = (status: number): Record<Actor, number> => ({
    anonymous: 401,
    nonMemberPrivate: 404,
    nonMemberPublic: 403,
    viewer: 403,
    tester: status,
    admin: status,
  });
  const runPath = async (ctx: MatrixContext) => `${P}/${ctx.slug}/manual-runs/${await ctx.manualRunNumber()}`;
  return [
    {
      name: "POST suite",
      specRow: "POST/PATCH suite, case, run, run case",
      request: ({ http, slug }) => http.post(`${P}/${slug}/suites`, { data: { name: "Suite baru matriks" } }),
      expected: testerPlus(201),
    },
    {
      name: "PATCH suite",
      specRow: "POST/PATCH suite, case, run, run case",
      request: async (ctx) =>
        ctx.http.patch(`${P}/${ctx.slug}/suites/${await ctx.suiteId()}`, { data: { description: "Diubah matriks" } }),
      expected: testerPlus(200),
    },
    {
      name: "POST case",
      specRow: "POST/PATCH suite, case, run, run case",
      request: async (ctx) =>
        ctx.http.post(`${P}/${ctx.slug}/cases`, {
          data: { suiteId: await ctx.suiteId(), title: "Case baru matriks", steps: [{ action: "Buka halaman", expected: "" }] },
        }),
      expected: testerPlus(201),
    },
    {
      name: "PATCH case",
      specRow: "POST/PATCH suite, case, run, run case",
      request: async (ctx) =>
        ctx.http.patch(`${P}/${ctx.slug}/cases/${await ctx.caseNumber()}`, { data: { version: 1, priority: "high" } }),
      expected: testerPlus(200),
    },
    {
      name: "POST manual-run",
      specRow: "POST/PATCH suite, case, run, run case",
      request: async (ctx) =>
        ctx.http.post(`${P}/${ctx.slug}/manual-runs`, {
          data: { name: "Run baru matriks", caseNumbers: [await ctx.caseNumber()] },
        }),
      expected: testerPlus(201),
    },
    {
      name: "PATCH manual-run",
      specRow: "POST/PATCH suite, case, run, run case",
      request: async (ctx) => ctx.http.patch(await runPath(ctx), { data: { version: 1, name: "Run diubah matriks" } }),
      expected: testerPlus(200),
    },
    {
      name: "PATCH manual-run case",
      specRow: "POST/PATCH suite, case, run, run case",
      request: async (ctx) =>
        ctx.http.patch(`${await runPath(ctx)}/cases/${await ctx.runCaseId()}`, { data: { version: 1, status: "passed" } }),
      expected: testerPlus(200),
    },
    {
      name: "DELETE suite",
      specRow: "DELETE suite, case, run",
      request: async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/suites/${await ctx.suiteId()}`),
      expected: adminOnly(204),
    },
    {
      name: "DELETE case",
      specRow: "DELETE suite, case, run",
      request: async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/cases/${await ctx.caseNumber()}`),
      expected: adminOnly(204),
    },
    {
      name: "DELETE manual-run",
      specRow: "DELETE suite, case, run",
      request: async (ctx) => ctx.http.delete(await runPath(ctx)),
      expected: adminOnly(204),
    },
  ];
}

/** Tahap 5 §8.4 (API tim): cycle publik dibaca seperti project; data laporan/peserta hanya anggota; triase tester+. */
function crowdTeamRows(): MatrixRow[] {
  const read: Record<Actor, number> = { anonymous: 404, nonMemberPrivate: 404, nonMemberPublic: 200, viewer: 200, tester: 200, admin: 200 };
  // Anonim selalu 401 (sesi dicek sebelum visibilitas, Ruling Task 1 Tahap 5), sama dengan GET members.
  const membersOnly: Record<Actor, number> = { anonymous: 401, nonMemberPrivate: 404, nonMemberPublic: 403, viewer: 200, tester: 200, admin: 200 };
  const testerPlus = (status: number): Record<Actor, number> => ({
    anonymous: 401,
    nonMemberPrivate: 404,
    nonMemberPublic: 403,
    viewer: 403,
    tester: status,
    admin: status,
  });
  const cyclePath = async (ctx: MatrixContext) => `${P}/${ctx.slug}/cycles/${(await ctx.cycle()).number}`;
  const reportPath = async (ctx: MatrixContext) => `${P}/${ctx.slug}/crowd-reports/${await ctx.crowdReportNumber()}`;
  const row = (
    name: string,
    specRow: string,
    request: MatrixRow["request"],
    expected: Record<Actor, number>,
    anonymousOnPublic?: number,
  ): MatrixRow => ({ name, specRow, request, expected, ...(anonymousOnPublic === undefined ? {} : { anonymousOnPublic }) });
  const READ = "GET cycles, cycle (non-draft), leaderboard cycle";
  const MEMBERS = "GET participants, reports, crowd-report, comments, summary";
  const TRIAGE = "POST triage, PATCH report, POST comment, remove participant";
  const MANAGE = "POST/PATCH/DELETE cycle";
  return [
    row("GET cycles", READ, ({ http, slug }) => http.get(`${P}/${slug}/cycles`), read, 200),
    row("GET cycle", READ, async (ctx) => ctx.http.get(await cyclePath(ctx)), read, 200),
    row("GET cycle leaderboard", READ, async (ctx) => ctx.http.get(`${await cyclePath(ctx)}/leaderboard`), read, 200),
    row("GET cycle participants", MEMBERS, async (ctx) => ctx.http.get(`${await cyclePath(ctx)}/participants`), membersOnly),
    row("GET cycle reports", MEMBERS, async (ctx) => ctx.http.get(`${await cyclePath(ctx)}/reports`), membersOnly),
    row("GET crowd-report", MEMBERS, async (ctx) => ctx.http.get(await reportPath(ctx)), membersOnly),
    row("GET crowd-report comments", MEMBERS, async (ctx) => ctx.http.get(`${await reportPath(ctx)}/comments`), membersOnly),
    row("GET crowd/summary", MEMBERS, ({ http, slug }) => http.get(`${P}/${slug}/crowd/summary`), membersOnly),
    row(
      "POST crowd-report triage",
      TRIAGE,
      async (ctx) => ctx.http.post(`${await reportPath(ctx)}/triage`, { data: { version: 1, decision: "accept" } }),
      testerPlus(200),
    ),
    row(
      "PATCH crowd-report (sembunyikan)",
      TRIAGE,
      async (ctx) => {
        const accepted = await ctx.acceptedReport();
        return ctx.http.patch(`${P}/${ctx.slug}/crowd-reports/${accepted.number}`, {
          data: { version: accepted.version, hideFromKnownIssues: true },
        });
      },
      testerPlus(200),
    ),
    row(
      "POST crowd-report comment",
      TRIAGE,
      async (ctx) => ctx.http.post(`${await reportPath(ctx)}/comments`, { data: { body: "Komentar matriks" } }),
      testerPlus(201),
    ),
    row(
      "POST remove participant",
      TRIAGE,
      async (ctx) => ctx.http.post(`${await cyclePath(ctx)}/participants/${await ctx.participantId()}/remove`, { data: {} }),
      testerPlus(204),
    ),
    row(
      "POST cycle",
      MANAGE,
      ({ http, slug }) =>
        http.post(`${P}/${slug}/cycles`, { data: { title: "Cycle matriks", links: [{ url: "https://app.example.com", label: "Aplikasi" }] } }),
      adminOnly(201),
    ),
    row(
      "PATCH cycle",
      MANAGE,
      async (ctx) => ctx.http.patch(await cyclePath(ctx), { data: { version: (await ctx.cycle()).version, title: "Cycle diubah matriks" } }),
      adminOnly(200),
    ),
    row("DELETE cycle", MANAGE, async (ctx) => ctx.http.delete(`${P}/${ctx.slug}/cycles/${await ctx.emptyCycleNumber()}`), adminOnly(204)),
  ];
}

// --- API publik crowdtesting (Tahap 5 §8.4, tabel kedua) -------------------------------------------------------

/** Aktor API publik, dilihat dari satu cycle terbuka di project publik. */
export type PublicActor = "anonymous" | "nonParticipant" | "active" | "left" | "removed" | "member";

export const PUBLIC_ACTORS: readonly PublicActor[] = ["anonymous", "nonParticipant", "active", "left", "removed", "member"];

export interface PublicMatrixContext {
  http: APIRequestContext;
  cycleId: string;
  /** Peserta lain yang punya laporan diterima (untuk profil tester). */
  otherTesterId: string;
  /** Laporan milik aktor (dikirim sebelum keluar/dikeluarkan); `null` bila aktor tidak punya laporan. */
  ownReportId: string | null;
  /** Laporan peserta lain di cycle yang sama. */
  otherReportId: string;
}

export interface PublicMatrixRow {
  name: string;
  specRow: string;
  request: (ctx: PublicMatrixContext) => Promise<APIResponse>;
  /** Aktor tanpa nilai tidak berlaku untuk baris ini ("—" di spec). */
  expected: Partial<Record<PublicActor, number>>;
  /** Kode error bila menyimpang dari bawaan status (401 UNAUTHENTICATED). */
  errorCodes?: Partial<Record<PublicActor, ErrorCode>>;
}

const C = "/api/v1/crowd";
const REPORT_BODY = {
  title: "Laporan matriks",
  steps: "1. Buka halaman",
  expected: "Berhasil",
  actual: "Gagal",
  environment: "Chrome 130",
  suggestedSeverity: "minor",
};

const everyone = (status: number): Record<PublicActor, number> => ({
  anonymous: status,
  nonParticipant: status,
  active: status,
  left: status,
  removed: status,
  member: status,
});

const publicReads: Array<[string, (ctx: PublicMatrixContext) => string]> = [
  ["GET direktori", () => `${C}/cycles`],
  ["GET cycle publik", (ctx) => `${C}/cycles/${ctx.cycleId}`],
  ["GET known-issues", (ctx) => `${C}/cycles/${ctx.cycleId}/known-issues`],
  ["GET leaderboard cycle (publik)", (ctx) => `${C}/cycles/${ctx.cycleId}/leaderboard`],
  ["GET leaderboard global", () => `${C}/leaderboard`],
  ["GET profil tester", (ctx) => `${C}/testers/${ctx.otherTesterId}`],
];

const ownReport = (ctx: PublicMatrixContext) => `${C}/reports/${ctx.ownReportId ?? ctx.otherReportId}`;

export const PUBLIC_MATRIX: PublicMatrixRow[] = [
  ...publicReads.map(
    ([name, path]): PublicMatrixRow => ({
      name,
      specRow: "GET direktori, cycle, known-issues, leaderboard, profil",
      request: (ctx) => ctx.http.get(path(ctx)),
      expected: everyone(200),
    }),
  ),
  {
    name: "POST join",
    specRow: "POST join",
    request: (ctx) => ctx.http.post(`${C}/cycles/${ctx.cycleId}/join`, { data: { acceptRules: true } }),
    expected: { anonymous: 401, nonParticipant: 200, active: 200, left: 200, removed: 403, member: 403 },
    errorCodes: { removed: "PARTICIPANT_REMOVED", member: "MEMBER_CANNOT_JOIN" },
  },
  {
    name: "GET laporan saya di cycle",
    specRow: "GET/POST laporan cycle",
    request: (ctx) => ctx.http.get(`${C}/cycles/${ctx.cycleId}/reports`),
    expected: { anonymous: 401, nonParticipant: 403, active: 200, left: 200, removed: 200, member: 403 },
    errorCodes: { nonParticipant: "NOT_PARTICIPANT", member: "NOT_PARTICIPANT" },
  },
  {
    name: "POST laporan di cycle",
    specRow: "GET/POST laporan cycle",
    request: (ctx) => ctx.http.post(`${C}/cycles/${ctx.cycleId}/reports`, { data: REPORT_BODY }),
    expected: { anonymous: 401, nonParticipant: 403, active: 201, left: 403, removed: 403, member: 403 },
    errorCodes: { nonParticipant: "NOT_PARTICIPANT", left: "NOT_PARTICIPANT", removed: "PARTICIPANT_REMOVED", member: "MEMBER_CANNOT_JOIN" },
  },
  {
    name: "GET laporan sendiri",
    specRow: "GET/PATCH/DELETE laporan sendiri",
    request: (ctx) => ctx.http.get(ownReport(ctx)),
    expected: { anonymous: 401, active: 200, left: 200, removed: 200 },
  },
  {
    name: "PATCH laporan sendiri",
    specRow: "GET/PATCH/DELETE laporan sendiri",
    request: (ctx) => ctx.http.patch(ownReport(ctx), { data: { version: 1, title: "Judul diubah matriks" } }),
    expected: { anonymous: 401, active: 200, left: 200, removed: 403 },
    errorCodes: { removed: "PARTICIPANT_REMOVED" },
  },
  {
    name: "DELETE laporan sendiri (tarik)",
    specRow: "GET/PATCH/DELETE laporan sendiri",
    request: (ctx) => ctx.http.delete(ownReport(ctx)),
    expected: { anonymous: 401, active: 200, left: 200, removed: 403 },
    errorCodes: { removed: "PARTICIPANT_REMOVED" },
  },
  {
    name: "GET laporan orang lain",
    specRow: "Laporan orang lain",
    request: (ctx) => ctx.http.get(`${C}/reports/${ctx.otherReportId}`),
    expected: { anonymous: 401, nonParticipant: 404, active: 404, left: 404, removed: 404, member: 404 },
    errorCodes: {
      nonParticipant: "REPORT_NOT_FOUND",
      active: "REPORT_NOT_FOUND",
      left: "REPORT_NOT_FOUND",
      removed: "REPORT_NOT_FOUND",
      member: "REPORT_NOT_FOUND",
    },
  },
];
